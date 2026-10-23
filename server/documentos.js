'use strict';
// Documentos além do parecer: ofício, despacho e documento em branco.
// A pessoa ensina o sistema com um modelo (PDF/TXT/texto colado); o sistema guarda o texto com campos {{assim}}
// e, na próxima vez, monta o rascunho. Conferência por colegas é opcional (padrão: desligada).
const express = require('express');
const A = require('./auth');
const trilha = require('./trilha');
const providers = require('../modules/analista/providers');
const { mascarar } = require('../modules/analista/mascara');
const render = require('./pdf/render');

const { erro } = A;
const TIPOS = { oficio: 'Ofício', despacho: 'Despacho', branco: 'Documento em branco' };
const agora = () => new Date().toISOString();
const json = (s, vazio) => { try { return JSON.parse(s); } catch (_) { return vazio; } };
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'campo';
const LIMITE = 40000;

// ---------- modelos ----------
function visivel(m, u) { return m.ativo && (m.dono_id === u.usuario_id || m.compartilhado || u.perfil === 'admin'); }
function formaModelo(m, u) {
  return { modelo_id: m.modelo_id, nome: m.nome, tipo: m.tipo, tipoNome: TIPOS[m.tipo], compartilhado: !!m.compartilhado, versao: m.versao, corpo: m.corpo,
    campos: json(m.campos, []), meu: m.dono_id === u.usuario_id, dono: (m.dono_nome || '') };
}
function listarModelos(db, u, tipo) {
  const l = db.all('SELECT m.*, u.nome AS dono_nome FROM modelos_documento m JOIN usuarios u ON u.usuario_id = m.dono_id WHERE m.ativo = 1 ORDER BY m.nome');
  return l.filter((m) => visivel(m, u) && (!tipo || m.tipo === tipo)).map((m) => formaModelo(m, u));
}
function validarModelo(b) {
  const nome = String(b.nome || '').trim();
  if (!nome) throw erro(400, 'Dê um nome ao modelo.');
  if (!TIPOS[b.tipo] || b.tipo === 'branco') throw erro(400, 'Escolha se o modelo é de ofício ou de despacho.');
  const corpo = String(b.corpo || '').trim();
  if (corpo.length < 20) throw erro(400, 'O texto do modelo está vazio ou muito curto.');
  const campos = [];
  const vistos = new Set();
  for (const c of Array.isArray(b.campos) ? b.campos : []) {
    const id = slug(c.id || c.rotulo);
    if (vistos.has(id)) continue; vistos.add(id);
    campos.push({ id, rotulo: String(c.rotulo || id).trim().slice(0, 80) });
  }
  // todo {{campo}} do texto precisa existir na lista
  for (const m of corpo.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)) if (!vistos.has(m[1])) { vistos.add(m[1]); campos.push({ id: m[1], rotulo: m[1].replace(/_/g, ' ') }); }
  return { nome: nome.slice(0, 120), tipo: b.tipo, corpo: corpo.slice(0, LIMITE), campos, compartilhado: b.compartilhado ? 1 : 0 };
}
function criarModelo(db, u, b) {
  const m = validarModelo(b); const t = agora();
  const r = db.run('INSERT INTO modelos_documento (nome, tipo, dono_id, compartilhado, corpo, campos, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)',
    m.nome, m.tipo, u.usuario_id, m.compartilhado, m.corpo, JSON.stringify(m.campos), t, t);
  trilha.registrar(db, { usuario: u.login, tabela: 'modelos_documento', registro: Number(r.lastInsertRowid), campo: 'modelo criado', valor_novo: m.nome });
  return Number(r.lastInsertRowid);
}
function doModelo(db, id, u, soDono) {
  const m = db.get('SELECT * FROM modelos_documento WHERE modelo_id = ?', Number(id));
  if (!m || !m.ativo) throw erro(404, 'Modelo não encontrado.');
  if (!visivel(m, u)) throw erro(403, 'Este modelo é de outra pessoa e não foi compartilhado.');
  if (soDono && m.dono_id !== u.usuario_id && !['admin', 'superintendente'].includes(u.perfil)) throw erro(403, 'Só quem criou o modelo (ou a superintendência) pode alterá-lo.');
  return m;
}
function alterarModelo(db, u, id, b) {
  const m = doModelo(db, id, u, true);
  const n = validarModelo(Object.assign({ tipo: m.tipo }, b));
  db.tx(() => {
    db.run('INSERT INTO modelos_documento_hist (modelo_id, versao, corpo, campos, salvo_em, salvo_por) VALUES (?,?,?,?,?,?)', m.modelo_id, m.versao, m.corpo, m.campos, agora(), u.usuario_id);
    db.run('UPDATE modelos_documento SET nome=?, tipo=?, compartilhado=?, corpo=?, campos=?, versao=versao+1, atualizado_em=? WHERE modelo_id=?',
      n.nome, n.tipo, n.compartilhado, n.corpo, JSON.stringify(n.campos), agora(), m.modelo_id);
  });
  trilha.registrar(db, { usuario: u.login, tabela: 'modelos_documento', registro: m.modelo_id, campo: 'modelo alterado', valor_novo: 'versão ' + (m.versao + 1) });
}
function removerModelo(db, u, id) {
  const m = doModelo(db, id, u, true);
  db.run('UPDATE modelos_documento SET ativo = 0 WHERE modelo_id = ?', m.modelo_id);
  trilha.registrar(db, { usuario: u.login, tabela: 'modelos_documento', registro: m.modelo_id, campo: 'modelo removido', valor_anterior: m.nome });
}

// ---------- IA (com saída sem IA) ----------
async function pedirIA(sistema, usuario) {
  const est = providers.estado();
  const erros = [];
  for (const nome of est.ordem) {
    const p = providers.PROVEDORES[nome];
    if (!p.ativo()) { erros.push(nome + ': sem chave'); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { erros.push(nome + ': envio à nuvem desligado'); continue; }
    const entrada = p.nuvem ? mascarar(usuario).texto : usuario;
    try { return { ok: true, provedor: nome, bruto: await p.chamar({ sistema, usuario: entrada }) }; } catch (e) { erros.push(nome + ': ' + String(e.message || e).slice(0, 100)); }
  }
  return { ok: false, motivo: 'Nenhuma IA disponível agora (' + erros.join('; ') + ').' };
}
const objeto = (bruto) => { const s = String(bruto || ''); try { return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch (_) { return {}; } };

// Sem IA: troca por campos o que costuma variar (nº de processo SEI, datas, nº do documento).
function detectarSemIA(texto) {
  const campos = []; let corpo = texto;
  const trocar = (re, id, rotulo) => {
    let achou = false;
    corpo = corpo.replace(re, () => { achou = true; return '{{' + id + '}}'; });
    if (achou) campos.push({ id, rotulo });
  };
  trocar(/\b\d{4,}\.\d{5,}\/\d{4}-\d{2}\b|\b\d{10,}\/\d{4}-\d{2}\b/g, 'processo_sei', 'Nº do processo SEI');
  trocar(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, 'data', 'Data');
  trocar(/\b[Nn]º\s*\d+\/\d{4}\b/g, 'numero', 'Número do documento');
  return { corpo, campos };
}

async function aprender(db, u, b) {
  const texto = String(b.texto || '').trim().slice(0, LIMITE);
  if (texto.length < 30) throw erro(400, 'Cole ou anexe o texto do documento que serve de modelo.');
  const sistema = 'Você transforma um documento oficial em MODELO REUTILIZÁVEL. Mantenha o texto exatamente como está, trocando apenas o que muda a cada documento (nomes de unidade, números de processo, datas, valores, destinatário, assunto específico) por {{campo}}. Use ids curtos em minúsculas com _ . Responda SOMENTE JSON: {"corpo":"texto com {{campos}}","campos":[{"id":"...","rotulo":"nome claro para uma pessoa"}]}';
  const ia = await pedirIA(sistema, 'Documento:\n' + texto);
  if (ia.ok) {
    const o = objeto(ia.bruto);
    if (o.corpo && String(o.corpo).length > 20) {
      const v = validarCorpo(o.corpo, o.campos);
      return { ok: true, provedor: ia.provedor, corpo: v.corpo, campos: v.campos, avisoPacientes: true };
    }
  }
  const d = detectarSemIA(texto);
  return { ok: true, provedor: null, semIA: true, motivo: ia.ok ? 'A IA não devolveu um modelo utilizável.' : ia.motivo, corpo: d.corpo, campos: d.campos, avisoPacientes: true };
}
function validarCorpo(corpo, campos) {
  const lista = []; const ids = new Set();
  for (const c of Array.isArray(campos) ? campos : []) { const id = slug(c.id || c.rotulo); if (!ids.has(id)) { ids.add(id); lista.push({ id, rotulo: String(c.rotulo || id).slice(0, 80) }); } }
  const limpo = String(corpo).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, n) => '{{' + slug(n) + '}}');
  for (const m of limpo.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) if (!ids.has(m[1])) { ids.add(m[1]); lista.push({ id: m[1], rotulo: m[1].replace(/_/g, ' ') }); }
  return { corpo: limpo, campos: lista };
}

// Preenche o modelo com os valores; o que faltar fica visível como [rótulo].
function preencher(corpo, campos, valores) {
  const rot = Object.fromEntries((campos || []).map((c) => [c.id, c.rotulo]));
  return String(corpo).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_, id) => (valores && String(valores[id] || '').trim() ? String(valores[id]).trim() : '[' + (rot[id] || id) + ']'));
}

async function redigir(db, u, b) {
  const pedido = String(b.pedido || '').trim().slice(0, 2000);
  let modelo = null;
  if (b.modelo_id) modelo = doModelo(db, b.modelo_id, u, false);
  if (!modelo && !pedido) throw erro(400, 'Escolha um modelo ou descreva em uma frase o que precisa.');
  const campos = modelo ? json(modelo.campos, []) : [];
  const valores = b.campos && typeof b.campos === 'object' ? b.campos : {};
  const contexto = String(b.contexto || '').slice(0, 4000);
  let texto = modelo ? preencher(modelo.corpo, campos, valores) : '';
  let provedor = null, aviso = null;
  if (pedido) {
    const sistema = 'Você redige documentos administrativos em português formal, claro e objetivo, para uma comissão de acompanhamento de contratos de gestão em saúde. Se houver MODELO, siga a estrutura e o tom dele e complete só o que está entre [colchetes]. Nunca invente números, datas ou nomes: se faltar, deixe [entre colchetes]. Responda SOMENTE JSON: {"texto":"documento completo"}';
    const usuario = (modelo ? 'MODELO:\n' + texto + '\n\n' : '') + (contexto ? 'DADOS DA UNIDADE:\n' + contexto + '\n\n' : '') + 'PEDIDO: ' + pedido;
    const ia = await pedirIA(sistema, usuario);
    if (ia.ok) { const o = objeto(ia.bruto); if (o.texto && String(o.texto).length > 10) { texto = String(o.texto); provedor = ia.provedor; } else aviso = 'A IA não devolveu texto; use o modelo e complete à mão.'; } else aviso = ia.motivo;
  }
  if (!texto) texto = '';
  return { texto, provedor, aviso, modelo_id: modelo ? modelo.modelo_id : null };
}

// ---------- documentos ----------
function exigirContrato(req, contrato) {
  if (contrato && req.escopo && !req.escopo.has(String(contrato))) throw erro(403, 'Esta unidade não está na sua carteira. Peça à superintendente para incluí-la.');
}
function formaDoc(db, d, u) {
  const conv = json(d.convocados, []);
  const nomes = conv.length ? db.all('SELECT usuario_id, nome FROM usuarios WHERE usuario_id IN (' + conv.map(() => '?').join(',') + ')', ...conv) : [];
  const resp = db.all('SELECT c.*, us.nome FROM documentos_conferencia c JOIN usuarios us ON us.usuario_id = c.usuario_id WHERE c.doc_id = ? ORDER BY c.id', d.doc_id);
  const ultima = {}; for (const r of resp) ultima[r.usuario_id] = r;
  const conferencia = nomes.map((n) => ({ usuario_id: n.usuario_id, nome: n.nome, status: ultima[n.usuario_id] ? ultima[n.usuario_id].status : 'pendente', comentario: ultima[n.usuario_id] ? ultima[n.usuario_id].comentario : null }));
  const liberado = !d.conferencia_pedida || (conferencia.length > 0 && conferencia.every((c) => c.status === 'ok'));
  const unidade = d.contrato_id ? (db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', d.contrato_id) || {}).unidade : null;
  return { doc_id: d.doc_id, tipo: d.tipo, tipoNome: TIPOS[d.tipo], titulo: d.titulo, contrato_id: d.contrato_id, unidade, trimestre: d.trimestre, texto: d.texto,
    campos: json(d.campos, {}), modelo_id: d.modelo_id, status: d.status, conferencia_pedida: !!d.conferencia_pedida, conferencia, liberado,
    sei_numero: d.sei_numero, criador_id: d.criador_id, meu: d.criador_id === u.usuario_id, criado_em: d.criado_em, atualizado_em: d.atualizado_em,
    souConferente: conv.includes(u.usuario_id) };
}
function obterDoc(db, id) {
  const d = db.get('SELECT * FROM documentos WHERE doc_id = ?', Number(id));
  if (!d) throw erro(404, 'Documento não encontrado.');
  return d;
}
function soCriador(d, u) { if (d.criador_id !== u.usuario_id && u.perfil !== 'admin') throw erro(403, 'Só quem criou o documento pode alterá-lo.'); }

function criarDoc(db, u, b) {
  if (!TIPOS[b.tipo]) throw erro(400, 'Escolha o tipo do documento.');
  const titulo = String(b.titulo || '').trim() || TIPOS[b.tipo];
  const m = b.modelo_id ? doModelo(db, b.modelo_id, u, false) : null;
  const t = agora();
  const r = db.run('INSERT INTO documentos (tipo, modelo_id, modelo_versao, contrato_id, trimestre, titulo, campos, texto, criador_id, conferencia_pedida, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    b.tipo, m ? m.modelo_id : null, m ? m.versao : null, b.contrato_id ? String(b.contrato_id) : null, b.trimestre || null, titulo.slice(0, 160),
    JSON.stringify(b.campos || {}), String(b.texto || '').slice(0, 200000), u.usuario_id, b.conferencia ? 1 : 0, t, t);
  trilha.registrar(db, { usuario: u.login, tabela: 'documentos', registro: Number(r.lastInsertRowid), campo: 'documento criado', valor_novo: titulo });
  return Number(r.lastInsertRowid);
}
function salvarDoc(db, u, id, b) {
  const d = obterDoc(db, id); soCriador(d, u);
  if (d.sei_numero) throw erro(409, 'Este documento já foi registrado no SEI e não pode mais ser alterado.');
  const texto = b.texto === undefined ? d.texto : String(b.texto).slice(0, 200000);
  const titulo = b.titulo === undefined ? d.titulo : (String(b.titulo).trim() || d.titulo).slice(0, 160);
  const mudou = texto !== d.texto;
  db.tx(() => {
    db.run('UPDATE documentos SET texto=?, titulo=?, campos=?, atualizado_em=? WHERE doc_id=?', texto, titulo, JSON.stringify(b.campos || json(d.campos, {})), agora(), d.doc_id);
    if (mudou && d.conferencia_pedida) { // texto mudou: as respostas anteriores não valem mais
      db.run('DELETE FROM documentos_conferencia WHERE doc_id = ?', d.doc_id);
      db.run("UPDATE documentos SET status = 'em conferência' WHERE doc_id = ? AND status != 'rascunho'", d.doc_id);
    }
  });
}
function pedirConferencia(db, u, id, b) {
  const d = obterDoc(db, id); soCriador(d, u);
  if (!b.pedir) { db.run("UPDATE documentos SET conferencia_pedida = 0, convocados = '[]', status = 'rascunho' WHERE doc_id = ?", d.doc_id); db.run('DELETE FROM documentos_conferencia WHERE doc_id = ?', d.doc_id); return; }
  const ids = [...new Set((b.convocados || []).map(Number).filter((n) => n && n !== u.usuario_id))];
  if (!ids.length) throw erro(400, 'Escolha pelo menos um colega para conferir.');
  const ok = db.all('SELECT usuario_id FROM usuarios WHERE ativo = 1 AND usuario_id IN (' + ids.map(() => '?').join(',') + ')', ...ids).map((x) => x.usuario_id);
  if (!ok.length) throw erro(400, 'Colegas não encontrados.');
  db.run("UPDATE documentos SET conferencia_pedida = 1, convocados = ?, status = 'em conferência' WHERE doc_id = ?", JSON.stringify(ok), d.doc_id);
  db.run('DELETE FROM documentos_conferencia WHERE doc_id = ?', d.doc_id);
  trilha.registrar(db, { usuario: u.login, tabela: 'documentos', registro: d.doc_id, campo: 'conferência pedida', valor_novo: ok });
}
function conferir(db, u, id, b) {
  const d = obterDoc(db, id);
  if (!json(d.convocados, []).includes(u.usuario_id)) throw erro(403, 'Você não foi convocado(a) para conferir este documento.');
  if (!['ok', 'reparo'].includes(b.status)) throw erro(400, 'Responda "ok" ou "reparo".');
  if (b.status === 'reparo' && !String(b.comentario || '').trim()) throw erro(400, 'Diga o que precisa ser ajustado.');
  db.run('INSERT INTO documentos_conferencia (doc_id, usuario_id, status, comentario, data_hora) VALUES (?,?,?,?,?)', d.doc_id, u.usuario_id, b.status, String(b.comentario || '').slice(0, 1000) || null, agora());
  const f = formaDoc(db, obterDoc(db, id), u);
  const novo = f.liberado ? 'conferido' : f.conferencia.some((c) => c.status === 'reparo') ? 'com reparos' : 'em conferência';
  db.run('UPDATE documentos SET status = ? WHERE doc_id = ?', novo, d.doc_id);
  trilha.registrar(db, { usuario: u.login, tabela: 'documentos', registro: d.doc_id, campo: 'conferência', valor_novo: b.status });
}
function exigirLiberado(db, d, u) {
  const f = formaDoc(db, d, u);
  if (!f.liberado) throw erro(409, 'A conferência pedida ainda não terminou: todos os colegas convocados precisam responder "ok".');
  return f;
}
async function pdfDoc(db, u, id) {
  const d = obterDoc(db, id); const f = exigirLiberado(db, d, u);
  const blocos = [];
  const info = [];
  if (f.unidade) info.push(['Unidade', f.unidade]);
  if (d.trimestre) info.push(['Trimestre', d.trimestre]);
  if (info.length) blocos.push({ tipo: 'chaveValor', itens: info });
  for (const par of String(d.texto).split(/\n{2,}/)) if (par.trim()) blocos.push({ tipo: 'paragrafo', texto: par.trim() });
  if (!blocos.length) throw erro(400, 'O documento está vazio.');
  return render.renderizar({ titulo: d.titulo, subtitulo: TIPOS[d.tipo], blocos });
}
function registrarSEI(db, u, id, numero) {
  const d = obterDoc(db, id); soCriador(d, u); exigirLiberado(db, d, u);
  const n = String(numero || '').trim();
  if (!n) throw erro(400, 'Informe o número do documento gerado no SEI.');
  db.run("UPDATE documentos SET sei_numero = ?, sei_em = ?, status = 'finalizado' WHERE doc_id = ?", n.slice(0, 60), agora(), d.doc_id);
  trilha.registrar(db, { usuario: u.login, tabela: 'documentos', registro: d.doc_id, campo: 'número no SEI', valor_novo: n });
}

// ---------- rotas ----------
module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  r.use(require('./carteira').guarda(db));

  r.get('/tipos', (req, res) => res.json({ tipos: Object.entries(TIPOS).map(([id, nome]) => ({ id, nome })) }));
  r.get('/colegas', (req, res) => res.json({ colegas: db.all("SELECT usuario_id, nome FROM usuarios WHERE ativo = 1 AND perfil IN ('admin','criador','colega','superintendente') AND usuario_id != ? ORDER BY nome", req.usuario.usuario_id) }));

  r.get('/modelos', (req, res) => res.json({ modelos: listarModelos(db, req.usuario, req.query.tipo) }));
  r.post('/modelos/aprender', async (req, res) => res.json(await aprender(db, req.usuario, req.body || {})));
  r.post('/modelos', (req, res) => res.json({ modelo_id: criarModelo(db, req.usuario, req.body || {}) }));
  r.put('/modelos/:id', (req, res) => { alterarModelo(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });
  r.delete('/modelos/:id', (req, res) => { removerModelo(db, req.usuario, req.params.id); res.json({ ok: true }); });

  r.post('/redigir', async (req, res) => { exigirContrato(req, req.body && req.body.contrato_id); res.json(await redigir(db, req.usuario, req.body || {})); });

  r.get('/', (req, res) => {
    const u = req.usuario; const c = req.query.contrato ? String(req.query.contrato) : null;
    exigirContrato(req, c);
    let l = db.all('SELECT d.*, us.nome AS criador_nome FROM documentos d JOIN usuarios us ON us.usuario_id = d.criador_id ORDER BY d.atualizado_em DESC LIMIT 500');
    if (c) l = l.filter((d) => d.contrato_id === c);
    else if (req.escopo) l = l.filter((d) => !d.contrato_id || req.escopo.has(d.contrato_id));
    if (req.query.paraConferir) l = l.filter((d) => json(d.convocados, []).includes(u.usuario_id) && d.status !== 'finalizado');
    res.json({ documentos: l.map((d) => Object.assign(formaDoc(db, d, u), { criador_nome: d.criador_nome })) });
  });
  r.post('/', (req, res) => { exigirContrato(req, req.body && req.body.contrato_id); res.json({ doc_id: criarDoc(db, req.usuario, req.body || {}) }); });
  r.get('/:id', (req, res) => { const d = obterDoc(db, req.params.id); exigirContrato(req, d.contrato_id); res.json(formaDoc(db, d, req.usuario)); });
  r.put('/:id', (req, res) => { exigirContrato(req, obterDoc(db, req.params.id).contrato_id); salvarDoc(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });
  r.post('/:id/conferencia', (req, res) => { exigirContrato(req, obterDoc(db, req.params.id).contrato_id); pedirConferencia(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });
  r.post('/:id/conferir', (req, res) => { conferir(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });
  r.get('/:id/pdf', async (req, res) => {
    exigirContrato(req, obterDoc(db, req.params.id).contrato_id);
    const buf = await pdfDoc(db, req.usuario, req.params.id);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="documento-' + req.params.id + '.pdf"').send(buf);
  });
  r.post('/:id/sei', (req, res) => { exigirContrato(req, obterDoc(db, req.params.id).contrato_id); registrarSEI(db, req.usuario, req.params.id, req.body && req.body.numero); res.json({ ok: true }); });
  return r;
};
module.exports.preencher = preencher;
module.exports.aprender = aprender;
module.exports.criarModelo = criarModelo;
module.exports.TIPOS = TIPOS;
module.exports.detectarSemIA = detectarSemIA;
