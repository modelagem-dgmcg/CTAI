'use strict';
// Sala guiada: conferência de áudio com "apontador" conduzido por quem criou a sala.
// - Áudio: WebRTC direto entre os navegadores (o servidor só repassa os sinais de conexão; não passa áudio por aqui e nada é gravado).
// - Apontador: posição do mouse de quem conduz, repassada aos participantes. Não carrega conteúdo da tela, só posição.
// - Canal em tempo real: Server-Sent Events (SSE) + POST. Não precisa de biblioteca nova.
// - Tudo fica só na memória: reiniciar o servidor encerra as salas.
const express = require('express');
const crypto = require('crypto');
const A = require('./auth');
const config = require('./config');

const MAX = Math.max(2, Math.min(16, Number(config.env('CTAI_SALA_MAX', '10')) || 10)); // limite de pessoas (áudio ponto a ponto)
const DURACAO_MAX_MS = 4 * 3600 * 1000;      // sala fecha sozinha em 4 horas
const TOLERANCIA_OFFLINE_MS = 45 * 1000;    // tempo para a pessoa reconectar (atualizar a página, rede instável)
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const salas = new Map();                     // codigo -> sala
const erradas = new Map();                   // login -> { n, ate }  (limite de tentativas de código errado)

const erro = A.erro;

// Quem pode criar (conduzir) uma sala: equipe da CTAI e, se quiser, logins extras em CTAI_SALA_CONDUTORES (ex.: um usuário de unidade de teste).
const condutoresExtras = () => String(config.env('CTAI_SALA_CONDUTORES', '')).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
// Qualquer pessoa com login pode criar uma sala (treinamento); quem entra continua precisando do código de 5 letras.
const podeConduzir = () => true;
void condutoresExtras;

function iceServers() {
  const lista = [{ urls: 'stun:stun.l.google.com:19302' }];
  const extra = String(config.env('CTAI_SALA_ICE', '')).trim(); // JSON com servidores TURN/STUN da ATI, se houver
  if (extra) { try { const j = JSON.parse(extra); if (Array.isArray(j)) return j; } catch (_) { /* usa o padrão */ } }
  return lista;
}

function codigoNovo() {
  for (let t = 0; t < 50; t++) {
    let c = ''; for (let i = 0; i < 5; i++) c += ALFA[crypto.randomInt(ALFA.length)];
    if (!salas.has(c)) return c;
  }
  throw erro(503, 'Não foi possível criar a sala agora. Tente de novo.');
}

const publico = (sala) => ({
  codigo: sala.codigo, max: MAX, condutor: sala.condutorId,
  participantes: [...sala.parts.values()].map((p) => ({ id: p.id, nome: p.nome, condutor: p.id === sala.condutorId, mudo: p.mudo, online: !!p.res })),
});

function enviar(p, evento, dados) {
  if (!p || !p.res) return;
  try { p.res.write('event: ' + evento + '\ndata: ' + JSON.stringify(dados === undefined ? {} : dados) + '\n\n'); } catch (_) { /* conexão caiu: o 'close' limpa */ }
}
function transmitir(sala, evento, dados, exceto) { for (const p of sala.parts.values()) if (p.id !== exceto) enviar(p, evento, dados); }
const avisarLista = (sala) => transmitir(sala, 'participantes', publico(sala));

function encerrar(sala, motivo) {
  transmitir(sala, 'encerrada', { motivo: motivo || 'A sala foi encerrada.' });
  for (const p of sala.parts.values()) { try { if (p.res) p.res.end(); } catch (_) { /* ok */ } p.res = null; }
  salas.delete(sala.codigo);
}

function remover(sala, id, motivo) {
  const p = sala.parts.get(id);
  if (!p) return;
  if (id === sala.condutorId) return encerrar(sala, motivo || 'Quem conduzia saiu. A sala foi encerrada.');
  try { if (p.res) p.res.end(); } catch (_) { /* ok */ }
  sala.parts.delete(id);
  transmitir(sala, 'saiu', { id });
  avisarLista(sala);
}

// Faxina: tira quem ficou desconectado e fecha salas velhas.
const faxina = setInterval(() => {
  const agora = Date.now();
  for (const sala of [...salas.values()]) {
    if (agora - sala.criada > DURACAO_MAX_MS) { encerrar(sala, 'A sala passou de 4 horas e foi encerrada.'); continue; }
    for (const p of [...sala.parts.values()]) {
      if (!p.res && p.offlineDesde && agora - p.offlineDesde > TOLERANCIA_OFFLINE_MS) remover(sala, p.id, 'Quem conduzia perdeu a conexão. A sala foi encerrada.');
    }
  }
  for (const [k, v] of erradas) if (v.ate < agora) erradas.delete(k);
}, 15000);
faxina.unref();
// Batimento: mantém a conexão aberta atrás do proxy da hospedagem.
const batimento = setInterval(() => { for (const s of salas.values()) for (const p of s.parts.values()) if (p.res) { try { p.res.write(': ok\n\n'); } catch (_) { /* ok */ } } }, 15000);
batimento.unref();

const num = (v) => (Number.isFinite(Number(v)) ? Math.max(-0.5, Math.min(1.5, Number(v))) : null);
const txt = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n);

function acharSala(req) {
  const b = req.body || {}, q = req.query || {};
  const codigo = txt(b.codigo || q.codigo, 12).toUpperCase().trim();
  const sala = salas.get(codigo);
  if (!sala) throw erro(404, 'Sala não encontrada ou já encerrada.');
  const id = txt(b.eu || q.eu, 40);
  const p = sala.parts.get(id);
  if (!p || p.login !== req.usuario.login) throw erro(403, 'Você não está nesta sala.');
  return { sala, p };
}

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db));

  r.get('/estado', (req, res) => res.json({ podeCriar: podeConduzir(req.usuario), max: MAX }));

  r.post('/criar', (req, res) => {
    if (!podeConduzir(req.usuario)) throw erro(403, 'Não foi possível criar a sala.');
    for (const s of [...salas.values()]) if (s.parts.get(s.condutorId) && s.parts.get(s.condutorId).login === req.usuario.login) encerrar(s, 'Você criou uma nova sala; a anterior foi encerrada.');
    const codigo = codigoNovo(), id = crypto.randomBytes(6).toString('hex');
    const sala = { codigo, criada: Date.now(), condutorId: id, parts: new Map(), ultimo: null };
    sala.parts.set(id, { id, login: req.usuario.login, nome: req.usuario.nome, mudo: true, res: null, offlineDesde: Date.now() });
    salas.set(codigo, sala);
    res.json({ codigo, eu: id, max: MAX, ice: iceServers(), condutor: true });
  });

  r.post('/entrar', (req, res) => {
    const login = req.usuario.login, agora = Date.now();
    const t = erradas.get(login);
    if (t && t.n >= 8 && t.ate > agora) throw erro(429, 'Muitas tentativas com código errado. Espere um minuto.');
    const codigo = txt(req.body && req.body.codigo, 12).toUpperCase().trim();
    const sala = salas.get(codigo);
    if (!sala) { erradas.set(login, { n: (t && t.ate > agora ? t.n : 0) + 1, ate: agora + 60000 }); throw erro(404, 'Código não encontrado. Confira com quem está conduzindo.'); }
    // Mesma pessoa entrando de novo (outra aba, outro computador): a entrada antiga sai.
    for (const q of [...sala.parts.values()]) if (q.login === login && q.id !== sala.condutorId) { enviar(q, 'encerrada', { motivo: 'Você entrou nesta sala em outra aba ou computador.' }); remover(sala, q.id); }
    const eraCondutor = sala.parts.get(sala.condutorId).login === login;
    if (eraCondutor) throw erro(409, 'Você é quem conduz esta sala. Use a aba onde a criou.');
    if (sala.parts.size >= MAX) throw erro(409, 'A sala está cheia (' + MAX + ' pessoas).');
    const id = crypto.randomBytes(6).toString('hex');
    sala.parts.set(id, { id, login, nome: req.usuario.nome, mudo: true, res: null, offlineDesde: agora });
    res.json({ codigo: sala.codigo, eu: id, max: MAX, ice: iceServers(), condutor: false, condutorNome: sala.parts.get(sala.condutorId).nome });
  });

  // Retomar a sala depois de trocar de página (a página recarrega e perde a conexão; o código e o id ficam guardados na aba).
  r.get('/retomar', (req, res) => {
    const { sala, p } = acharSala(req);
    res.json({ codigo: sala.codigo, eu: p.id, max: MAX, ice: iceServers(), condutor: p.id === sala.condutorId, condutorNome: sala.parts.get(sala.condutorId).nome });
  });

  // Canal de eventos em tempo real (SSE). O navegador reconecta sozinho se cair.
  r.get('/eventos', (req, res) => {
    const { sala, p } = acharSala(req);
    if (p.res) { try { p.res.end(); } catch (_) { /* ok */ } }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (req.socket) { req.socket.setTimeout(0); req.socket.setNoDelay(true); }
    res.write('retry: 2000\n\n');
    p.res = res; p.offlineDesde = null;
    enviar(p, 'ola', Object.assign(publico(sala), { eu: p.id, ultimo: sala.ultimo }));
    avisarLista(sala);
    req.on('close', () => {
      if (p.res === res) { p.res = null; p.offlineDesde = Date.now(); if (salas.get(sala.codigo) === sala) avisarLista(sala); }
    });
  });

  // Repasse dos sinais de conexão do áudio (oferta, resposta, candidatos). Nada de áudio passa por aqui.
  r.post('/sinal', (req, res) => {
    const { sala, p } = acharSala(req);
    const para = sala.parts.get(txt(req.body.para, 40));
    if (!para) throw erro(404, 'Participante não está mais na sala.');
    const dados = req.body.dados;
    if (JSON.stringify(dados || {}).length > 20000) throw erro(413, 'Sinal grande demais.');
    enviar(para, 'sinal', { de: p.id, dados });
    res.json({ ok: true });
  });

  // Apontador: só quem conduz envia.
  r.post('/ponteiro', (req, res) => {
    const { sala, p } = acharSala(req);
    if (p.id !== sala.condutorId) throw erro(403, 'Só quem conduz move o apontador.');
    const d = req.body.dados || {};
    const tipo = ['mover', 'clique', 'sumir'].includes(d.tipo) ? d.tipo : 'mover';
    const msg = { tipo, alvo: txt(d.alvo, 300), fx: num(d.fx), fy: num(d.fy), x: num(d.x), y: num(d.y), pagina: txt(d.pagina, 200), ts: Date.now() };
    if (tipo !== 'clique') sala.ultimo = msg;
    transmitir(sala, 'ponteiro', msg, p.id);
    res.json({ ok: true });
  });

  // Assumir a condução: quem está na sala passa a ser quem conduz (apontador); quem conduzia vira participante.
  r.post('/assumir', (req, res) => {
    const { sala, p } = acharSala(req);
    if (p.id === sala.condutorId) return res.json({ ok: true });
    sala.condutorId = p.id; sala.ultimo = null;
    transmitir(sala, 'condutor', { id: p.id, nome: p.nome });
    avisarLista(sala);
    res.json({ ok: true });
  });

  r.post('/mudo', (req, res) => {
    const { sala, p } = acharSala(req);
    p.mudo = !!req.body.mudo;
    avisarLista(sala);
    res.json({ ok: true });
  });

  r.post('/silenciar', (req, res) => {
    const { sala, p } = acharSala(req);
    if (p.id !== sala.condutorId) throw erro(403, 'Só quem conduz silencia a sala.');
    for (const q of sala.parts.values()) if (q.id !== p.id) q.mudo = true;
    transmitir(sala, 'silenciar', {}, p.id);
    avisarLista(sala);
    res.json({ ok: true });
  });

  r.post('/sair', (req, res) => {
    const { sala, p } = acharSala(req);
    remover(sala, p.id, 'Quem conduzia saiu. A sala foi encerrada.');
    res.json({ ok: true });
  });

  r.post('/encerrar', (req, res) => {
    const { sala, p } = acharSala(req);
    if (p.id !== sala.condutorId) throw erro(403, 'Só quem conduz encerra a sala.');
    encerrar(sala, 'A sala foi encerrada por quem conduzia.');
    res.json({ ok: true });
  });

  return r;
};
module.exports.MAX = MAX;
module.exports._salas = salas; // usado nos testes
