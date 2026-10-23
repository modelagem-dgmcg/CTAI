'use strict';
// "Ensinar ao Sistema": qualquer pessoa da equipe escreve (e anexa) o que quer ensinar. Nada muda sozinho:
// o pedido é guardado e uma cópia vai, pelas conversas, à superintendência e à administração, que avaliam.
// Exceção pedida: se for um modelo de documento para uso imediato, o sistema já aprende e o modelo fica disponível só para quem enviou.
const express = require('express');
const A = require('./auth');
const trilha = require('./trilha');
const MS = require('./mensageiro');
const { extrair } = require('./extrair-texto');
const DOC = require('./documentos');
const { erro } = A;
const agora = () => new Date().toISOString();
const avaliador = (u) => ['superintendente', 'admin'].includes(u.perfil);

async function receber(db, u, b) {
  const texto = String(b.texto || '').trim().slice(0, 20000);
  const a = b.anexo && b.anexo.base64 ? b.anexo : null;
  if (!texto && !a) throw erro(400, 'Escreva o que quer ensinar ou anexe um arquivo.');
  const titulo = (String(b.titulo || '').trim() || texto.split(/\n/)[0] || (a && a.nome) || 'Sem título').slice(0, 100);
  const tipo = b.uso_imediato && DOC.TIPOS[b.tipo_documento] && b.tipo_documento !== 'branco' ? b.tipo_documento : null;
  if (b.uso_imediato && !tipo) throw erro(400, 'Diga se o modelo é de ofício ou de despacho.');
  let anexoId = null, textoAnexo = '';
  if (a) {
    const ext = String(a.nome || '').split('.').pop().toLowerCase();
    if (!MS.TIPOS[ext]) throw erro(400, 'Tipo de arquivo não permitido. Use: ' + Object.keys(MS.TIPOS).join(', ') + '.');
    const buf = Buffer.from(String(a.base64), 'base64');
    if (!buf.length) throw erro(400, 'Arquivo vazio.');
    if (buf.length > MS.MAX) throw erro(413, 'Arquivo acima de 4 MB.');
    const nome = String(a.nome).replace(/[\\/\r\n"]/g, '_').slice(0, 120);
    anexoId = Number(db.run('INSERT INTO msg_anexos (nome, mime, tamanho, dados, criado_em) VALUES (?,?,?,?,?)', nome, MS.TIPOS[ext], buf.length, buf, agora()).lastInsertRowid);
    if (tipo) { try { textoAnexo = (await extrair(nome, buf)).texto || ''; } catch (_) { /* sem texto: usa só o que foi escrito */ } }
  }
  const id = Number(db.run('INSERT INTO ensinos (usuario_id, titulo, texto, anexo_id, uso_imediato, tipo_documento, criado_em) VALUES (?,?,?,?,?,?,?)', u.usuario_id, titulo, texto, anexoId, tipo ? 1 : 0, tipo, agora()).lastInsertRowid);
  // Modelo de documento para uso imediato: o sistema aprende já, só para quem enviou.
  let modeloId = null, avisoModelo = null;
  if (tipo) {
    try {
      const base = (textoAnexo || texto);
      const ap = await DOC.aprender(db, u, { texto: base });
      modeloId = DOC.criarModelo(db, u, { nome: titulo, tipo, corpo: ap.corpo, campos: ap.campos, compartilhado: false });
      db.run('UPDATE ensinos SET modelo_id = ? WHERE ensino_id = ?', modeloId, id);
    } catch (e) { avisoModelo = 'Recebido, mas não consegui aprender o modelo agora: ' + e.message; }
  }
  // Cópias para quem avalia (pelas conversas).
  const dest = db.all("SELECT login FROM usuarios WHERE ativo = 1 AND perfil IN ('superintendente','admin') AND usuario_id <> ?", u.usuario_id);
  const msg = 'Novo pedido em "Ensinar ao Sistema" de ' + u.nome + ' — ' + titulo + (tipo ? ' (modelo de ' + DOC.TIPOS[tipo].toLowerCase() + ' já em uso por quem enviou)' : '') + '.\n\n' + texto;
  for (const d of dest) { try { MS.enviar(db, u, { para: d.login, texto: msg.slice(0, 4000), anexo: a || undefined }, 'Ensinar ao Sistema'); } catch (_) { /* a cópia não derruba o pedido */ } }
  trilha.registrar(db, { usuario: u.login, tabela: 'ensinos', registro: id, campo: 'pedido recebido', valor_novo: titulo });
  return { ensino_id: id, copias: dest.length, modelo_id: modeloId, aviso: avisoModelo };
}

function forma(e, u) {
  return { ensino_id: e.ensino_id, titulo: e.titulo, texto: e.texto, de: e.de_nome, meu: e.usuario_id === u.usuario_id, anexo: e.anexo_id ? { nome: e.anexo_nome, tamanho: e.anexo_tamanho } : null,
    uso_imediato: !!e.uso_imediato, tipo_documento: e.tipo_documento, modelo_id: e.modelo_id, status: e.status, parecer: e.parecer, avaliado_por: e.avaliador_nome || null, criado_em: e.criado_em };
}
function listar(db, u) {
  const l = db.all(`SELECT e.*, us.nome AS de_nome, av.nome AS avaliador_nome, a.nome AS anexo_nome, a.tamanho AS anexo_tamanho FROM ensinos e JOIN usuarios us ON us.usuario_id = e.usuario_id
    LEFT JOIN usuarios av ON av.usuario_id = e.avaliado_por LEFT JOIN msg_anexos a ON a.anexo_id = e.anexo_id ORDER BY e.ensino_id DESC LIMIT 300`);
  return l.filter((e) => avaliador(u) || e.usuario_id === u.usuario_id).map((e) => forma(e, u));
}
function avaliar(db, u, id, b) {
  if (!avaliador(u)) throw erro(403, 'Só a superintendência e a administração avaliam.');
  const e = db.get('SELECT * FROM ensinos WHERE ensino_id = ?', Number(id));
  if (!e) throw erro(404, 'Pedido não encontrado.');
  const status = { aprovado: 'aprovado', recusado: 'recusado', em_analise: 'em análise' }[b.status];
  if (!status) throw erro(400, 'Escolha aprovar, recusar ou deixar em análise.');
  const parecer = String(b.parecer || '').trim().slice(0, 1000);
  if (status === 'recusado' && !parecer) throw erro(400, 'Explique em poucas palavras por que foi recusado.');
  db.run('UPDATE ensinos SET status = ?, parecer = ?, avaliado_por = ?, avaliado_em = ? WHERE ensino_id = ?', status, parecer || null, u.usuario_id, agora(), e.ensino_id);
  if (status === 'aprovado' && e.modelo_id) db.run('UPDATE modelos_documento SET compartilhado = 1 WHERE modelo_id = ?', e.modelo_id); // modelo aprovado passa a valer para a equipe
  trilha.registrar(db, { usuario: u.login, tabela: 'ensinos', registro: e.ensino_id, campo: 'avaliação', valor_novo: status, motivo: parecer || null });
}

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  r.get('/', (req, res) => res.json({ pedidos: listar(db, req.usuario), avaliador: avaliador(req.usuario) }));
  r.post('/', async (req, res) => res.json(await receber(db, req.usuario, req.body || {})));
  r.post('/:id/avaliar', (req, res) => { avaliar(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });
  r.get('/:id/anexo', (req, res) => {
    const e = db.get('SELECT * FROM ensinos WHERE ensino_id = ?', Number(req.params.id));
    if (!e || !e.anexo_id || (e.usuario_id !== req.usuario.usuario_id && !avaliador(req.usuario))) throw erro(404, 'Anexo não encontrado.');
    const a = db.get('SELECT * FROM msg_anexos WHERE anexo_id = ?', e.anexo_id);
    res.set({ 'content-type': a.mime, 'content-disposition': 'attachment; filename="' + a.nome.replace(/[^\w.\- ]/g, '_') + '"', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
    res.send(Buffer.from(a.dados));
  });
  return r;
};
