'use strict';
// "Alimentar o Analista": primeiro acesso de quem tem carteira e ainda não tem histórico confirmado.
// A pessoa solta vários arquivos (ZIP, PDF, Word, Excel, CSV, TXT); o servidor lê, MASCARA dado pessoal, identifica unidade e trimestre
// e monta rascunhos do Histórico (a IA só propõe). Um arquivo por vez, em segundo plano. Só o confirmado entra nos cruzamentos.
// O arquivo original NUNCA é guardado: fica só na memória do servidor até ser lido.
const JSZip = require('jszip');
const A = require('./auth');
const CART = require('./carteira');
const H = require('./historico');
const X = require('./extrair-texto');
const M = require('./mascara');
const trilha = require('./trilha');
const { erro } = A;

const ELEGIVEIS = ['criador', 'colega'];
const FINAIS = ['pronto', 'aprovado', 'duplicado', 'problema', 'descartado'];
const OCUPADOS = ['fila', 'lendo', 'montando'];
const MAX_ZIP = 300;
const agora = () => new Date().toISOString();
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const memoria = new Map(); // id da fila -> Buffer (o original só existe aqui, até ser lido)
let rodando = false;

// ---------- quem fica travado ----------
function confirmadosNaCarteira(db, usuarioId) {
  const meus = CART.doUsuario(db, usuarioId);
  if (!meus.length) return 0;
  return db.get(`SELECT COUNT(*) AS n FROM hist_relatorios WHERE estado = 'confirmado' AND contrato_id IN (${meus.map(() => '?').join(',')})`, ...meus).n;
}
function trava(db, u) {
  if (!u || !ELEGIVEIS.includes(u.perfil)) return { trava: false, motivo: 'perfil' };
  if (!CART.doUsuario(db, u.usuario_id).length) return { trava: false, motivo: 'sem carteira' };
  if (db.get('SELECT 1 AS x FROM alimentar_liberacao WHERE usuario_id = ?', u.usuario_id)) return { trava: false, motivo: 'liberado' };
  if (confirmadosNaCarteira(db, u.usuario_id) > 0) return { trava: false, motivo: 'já tem histórico' };
  return { trava: true, motivo: 'primeiro acesso' };
}

// ---------- IA ----------
function iaPronta() {
  try {
    const providers = require('../modules/analista/providers');
    const est = providers.estado();
    return est.ordem.some((n) => { const p = providers.PROVEDORES[n]; return p && p.ativo() && (!p.nuvem || est.enviarNuvem || (p.nuvemLiberada && p.nuvemLiberada())); });
  } catch (_) { return false; }
}

// ---------- identificar unidade, trimestre e tipo ----------
function trimestreDe(s) {
  const t = String(s || '');
  let m = /(20\d{2})\s*[-_/. ]?\s*T\s*([1-4])\b/i.exec(t) || null;
  if (m) return m[1] + '-T' + m[2];
  m = /\bT\s*([1-4])\s*[-_/. ]?\s*(20\d{2})\b/i.exec(t);
  if (m) return m[2] + '-T' + m[1];
  m = /\b([1-4])\s*[ºo°ª]?\s*(?:tri(?:mestre)?)\b[^0-9]{0,12}(20\d{2})/i.exec(t);
  if (m) return m[2] + '-T' + m[1];
  return null;
}
function unidadeDe(db, meus, nome, texto) {
  const base = sem(nome + ' ' + String(texto || '').slice(0, 6000));
  const unidades = meus.map((id) => db.get('SELECT contrato_id, unidade FROM contratos WHERE contrato_id = ?', id)).filter(Boolean);
  const achadas = unidades.filter((u) => { const n = sem(u.unidade); return n.length >= 4 && base.includes(n); });
  if (achadas.length === 1) return { contrato_id: achadas[0].contrato_id, assumida: false };
  if (!achadas.length && unidades.length === 1) return { contrato_id: unidades[0].contrato_id, assumida: true };
  return null;
}
const tipoDe = (nome, texto) => (/parecer/i.test(nome + ' ' + String(texto || '').slice(0, 1500)) ? 'parecer' : /relat[oó]rio/i.test(nome) ? 'relatório da OSS' : 'parecer');

// ---------- fila ----------
const set = (db, id, campos) => {
  const ks = Object.keys(campos);
  db.run(`UPDATE alimentar_fila SET ${ks.map((k) => k + ' = ?').join(', ')}, atualizado_em = ? WHERE id = ?`, ...ks.map((k) => campos[k]), agora(), id);
};
function entrar(db, usuario, nome, buf, lote) {
  const id = Number(db.run('INSERT INTO alimentar_fila (usuario_id, lote, nome, tamanho, estado, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)', usuario.usuario_id, lote || null, String(nome).slice(0, 160), buf.length, 'fila', agora(), agora()).lastInsertRowid);
  memoria.set(id, buf);
  return id;
}

// Recebe um arquivo (ou ZIP, que vira vários).
async function receber(db, usuario, nomeBruto, buf) {
  const nome = String(nomeBruto || 'arquivo').replace(/[\\/\r\n"]/g, '_').slice(0, 160);
  const ext = (nome.split('.').pop() || '').toLowerCase();
  const lote = agora();
  const ids = [];
  if (!buf || !buf.length) throw erro(400, 'Arquivo vazio.');
  if (ext === 'zip') {
    let z;
    try { z = await JSZip.loadAsync(buf); } catch (_) { throw erro(400, 'Não consegui abrir o ZIP.'); }
    const entradas = Object.values(z.files).filter((f) => !f.dir && !/(^|\/)(\.|__MACOSX)/.test(f.name));
    if (entradas.length > MAX_ZIP) throw erro(413, 'O ZIP tem mais de ' + MAX_ZIP + ' arquivos. Divida em partes.');
    for (const f of entradas) {
      const base = f.name.split('/').pop();
      const e = (base.split('.').pop() || '').toLowerCase();
      if (!X.TIPOS.includes(e)) { const id = entrar(db, usuario, base, Buffer.alloc(0), lote); memoria.delete(id); set(db, id, { estado: 'problema', motivo: 'Tipo não aceito (use PDF, Word, Excel, CSV ou TXT).' }); ids.push(id); continue; }
      const b = await f.async('nodebuffer');
      if (b.length > X.MAX_ARQUIVO) { const id = entrar(db, usuario, base, Buffer.alloc(0), lote); memoria.delete(id); set(db, id, { estado: 'problema', motivo: 'Arquivo acima de 4 MB.' }); ids.push(id); continue; }
      ids.push(entrar(db, usuario, base, b, lote));
    }
    if (!entradas.length) throw erro(400, 'O ZIP não tem arquivos.');
  } else {
    if (!X.TIPOS.includes(ext)) throw erro(400, 'Tipo não aceito. Use ZIP, PDF, Word (.docx), Excel (.xlsx), CSV ou TXT.');
    if (buf.length > X.MAX_ARQUIVO) throw erro(413, 'Arquivo acima de 4 MB.');
    ids.push(entrar(db, usuario, nome, buf, lote));
  }
  trilha.registrar(db, { usuario: usuario.login, tabela: 'alimentar_fila', registro: ids[0], campo: 'recebido', valor_novo: { arquivos: ids.length, bytes: buf.length } });
  setImmediate(() => processar(db).catch(() => {}));
  return { ids };
}

async function umArquivo(db, item) {
  const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', item.usuario_id);
  const buf = memoria.get(item.id);
  if (!buf) { set(db, item.id, { estado: 'problema', motivo: 'O servidor foi reiniciado antes de ler este arquivo. Envie de novo.' }); return; }
  set(db, item.id, { estado: 'lendo' });
  let ex;
  try { ex = await X.extrair(item.nome, buf); } catch (e) { set(db, item.id, { estado: 'problema', motivo: String(e.message || e).slice(0, 220) }); memoria.delete(item.id); return; }
  memoria.delete(item.id); // o original some da memória assim que é lido
  let texto = ex.texto; let mascarados = ex.mascarados || {};
  // Reforço opcional: segunda passada pela IA para nomes de pacientes que escaparam das regras fixas.
  if (iaPronta()) { const r = await M.reforcarComIA(texto); if (r.usada) { texto = r.texto; if (r.nomes) mascarados = M.somar(mascarados, { 'nome (IA)': r.nomes }); } }
  const meus = CART.doUsuario(db, u.usuario_id);
  const un = unidadeDe(db, meus, item.nome, texto);
  const tri = trimestreDe(item.nome) || trimestreDe(texto.slice(0, 4000));
  const tipo = tipoDe(item.nome, texto);
  if (!un || !tri) {
    set(db, item.id, { estado: 'precisa_dados', texto, paginas: ex.paginas || null, mascarados: JSON.stringify(mascarados), contrato_id: un ? un.contrato_id : null, trimestre: tri, documento_tipo: tipo,
      motivo: !un && !tri ? 'Não identifiquei a unidade nem o trimestre.' : !un ? 'Não identifiquei a unidade.' : 'Não identifiquei o trimestre.' });
    return;
  }
  await montar(db, item.id, u, { contrato_id: un.contrato_id, trimestre: tri, documento_tipo: tipo, texto, paginas: ex.paginas || null, mascarados, nome: item.nome, aviso: un.assumida ? 'Unidade assumida (única da sua carteira). Confira.' : null });
}

async function montar(db, id, u, d) {
  set(db, id, { estado: 'montando', contrato_id: d.contrato_id, trimestre: d.trimestre, documento_tipo: d.documento_tipo, motivo: d.aviso || null });
  try {
    const r = await H.importarTexto(db, u, { contrato_id: d.contrato_id, trimestre: d.trimestre, documento_tipo: d.documento_tipo, nome: d.nome, texto: d.texto, paginas: d.paginas, mascarados: d.mascarados });
    set(db, id, { estado: 'pronto', hist_id: r.hist_id, ia_ok: r.ia.ok ? 1 : 0, texto: null, mascarados: JSON.stringify(d.mascarados || {}), motivo: r.ia.ok ? (d.aviso || null) : (r.ia.motivo ? 'Sem leitura por IA: preencha à mão. ' + (d.aviso || '') : d.aviso || null) });
  } catch (e) {
    if (e.status === 409) set(db, id, { estado: 'duplicado', hist_id: e.hist_id || null, texto: null, motivo: 'Este arquivo já tinha sido importado.' });
    else set(db, id, { estado: 'problema', texto: null, motivo: String(e.message || e).slice(0, 220) });
  }
}

async function processar(db) {
  if (rodando) return; rodando = true;
  try {
    for (;;) {
      const item = db.get("SELECT * FROM alimentar_fila WHERE estado = 'fila' ORDER BY id LIMIT 1");
      if (!item) break;
      try { await umArquivo(db, item); } catch (e) { set(db, item.id, { estado: 'problema', motivo: 'Erro inesperado: ' + String(e.message || e).slice(0, 160) }); }
    }
  } finally { rodando = false; }
}

// Ao subir o servidor, o que estava no meio do caminho não tem mais o arquivo na memória.
function recuperar(db) {
  try { db.run("UPDATE alimentar_fila SET estado = 'problema', motivo = 'O servidor foi reiniciado antes de ler este arquivo. Envie de novo.', atualizado_em = ? WHERE estado IN ('fila','lendo','montando')", agora()); } catch (_) { /* tabela ainda não existe */ }
}

// ---------- o que a pessoa vê ----------
function divergencias(db, item) {
  if (item.estado !== 'pronto' || !item.hist_id) return [];
  const r = db.get('SELECT * FROM hist_relatorios WHERE hist_id = ?', item.hist_id);
  if (!r) return [];
  const f = H.filhos(db, item.hist_id);
  const d = [];
  if (!item.ia_ok && !f.indicadores.length && !f.achados.length && !f.recomendacoes.length) d.push('A IA não leu este arquivo: preencha à mão.');
  if (item.ia_ok && r.igq === null) d.push('Nota total não encontrada no texto.');
  const sem0 = [...f.indicadores, ...f.achados, ...f.recomendacoes].filter((x) => !x.verificada).length;
  if (sem0) d.push(sem0 + ' item(ns) sem trecho conferido no texto.');
  const pts = f.indicadores.filter((x) => x.pontos !== null);
  if (r.igq !== null && pts.length) { const s = pts.reduce((t, x) => t + Number(x.pontos), 0); if (Math.abs(s - r.igq) > 1) d.push('A soma das notas dos indicadores (' + s.toFixed(1).replace('.', ',') + ') não bate com a nota total (' + String(r.igq).replace('.', ',') + ').'); }
  const outro = db.get("SELECT hist_id FROM hist_relatorios WHERE contrato_id = ? AND trimestre = ? AND hist_id <> ?", r.contrato_id, r.trimestre, r.hist_id);
  if (outro) d.push('Já existe outro relatório deste trimestre para esta unidade.');
  return d;
}

function estado(db, u) {
  const t = trava(db, u);
  const itens = db.all('SELECT * FROM alimentar_fila WHERE usuario_id = ? AND estado <> ? ORDER BY id DESC LIMIT 600', u.usuario_id, 'descartado').reverse().map((i) => {
    const c = i.contrato_id ? db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', i.contrato_id) : null;
    let masc = {}; try { masc = JSON.parse(i.mascarados || '{}'); } catch (_) { /* vazio */ }
    return { id: i.id, nome: i.nome, estado: i.estado, motivo: i.motivo, contrato_id: i.contrato_id, unidade: c ? c.unidade : null, trimestre: i.trimestre, documento_tipo: i.documento_tipo, hist_id: i.hist_id, ia_ok: !!i.ia_ok, mascarados: masc, divergencias: divergencias(db, i) };
  });
  const n = (...es) => itens.filter((i) => es.includes(i.estado)).length;
  const meus = CART.doUsuario(db, u.usuario_id).map((id) => db.get('SELECT contrato_id, unidade FROM contratos WHERE contrato_id = ?', id)).filter(Boolean);
  const resumo = { total: itens.length, lidos: n('pronto', 'aprovado', 'duplicado'), aprovados: n('aprovado'), problemas: n('problema'), pendentes: n(...OCUPADOS), precisaDados: n('precisa_dados') };
  const ia = iaPronta();
  return { trava: t.trava, motivo: t.motivo, itens, resumo, unidades: meus, ia: { pronta: ia, mensagem: ia ? null : 'A leitura por IA não está ligada. Os arquivos viram rascunho em branco, para você preencher à mão. Peça ao administrador para cadastrar uma chave em Gestão CTAI > IA.' },
    podeLiberar: resumo.pendentes === 0 && resumo.precisaDados === 0 && resumo.total > 0 };
}

function doItem(db, u, id) {
  const i = db.get('SELECT * FROM alimentar_fila WHERE id = ?', Number(id));
  if (!i || i.usuario_id !== u.usuario_id) throw erro(404, 'Arquivo não encontrado.');
  return i;
}

async function identificar(db, u, id, d) {
  const i = doItem(db, u, id);
  if (i.estado !== 'precisa_dados') throw erro(409, 'Este arquivo não está esperando identificação.');
  H.exigirUnidade(db, u, d.contrato_id);
  if (!/^\d{4}-T[1-4]$/.test(String(d.trimestre || ''))) throw erro(400, 'Informe o trimestre no formato 2026-T2.');
  let masc = {}; try { masc = JSON.parse(i.mascarados || '{}'); } catch (_) { /* vazio */ }
  await montar(db, i.id, u, { contrato_id: d.contrato_id, trimestre: d.trimestre, documento_tipo: ['parecer', 'relatório da OSS', 'outro'].includes(d.documento_tipo) ? d.documento_tipo : (i.documento_tipo || 'parecer'), texto: i.texto || '', paginas: i.paginas, mascarados: masc, nome: i.nome });
  return { ok: true };
}

function descartar(db, u, id) {
  const i = doItem(db, u, id);
  if (OCUPADOS.includes(i.estado)) throw erro(409, 'Este arquivo está sendo lido. Aguarde.');
  if (i.estado === 'aprovado') throw erro(409, 'Este relatório já foi confirmado.');
  if (i.hist_id && i.estado === 'pronto') { try { H.excluirRascunho(db, u, i.hist_id); } catch (_) { /* já descartado */ } }
  set(db, i.id, { estado: 'descartado', texto: null });
}

function aprovar(db, u, ids) {
  const feitos = []; const falhas = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    try {
      const i = doItem(db, u, id);
      if (i.estado !== 'pronto' || !i.hist_id) throw erro(409, 'Este arquivo não está pronto para aprovar.');
      H.confirmar(db, u, i.hist_id);
      set(db, i.id, { estado: 'aprovado' });
      feitos.push(i.id);
    } catch (e) { falhas.push({ id: Number(id), motivo: e.message }); }
  }
  trilha.registrar(db, { usuario: u.login, tabela: 'alimentar_fila', registro: feitos[0] || '', campo: 'aprovacao_em_bloco', valor_novo: { aprovados: feitos.length, falhas: falhas.length } });
  return { aprovados: feitos.length, falhas };
}

function pularProblemas(db, u) {
  const r = db.run("UPDATE alimentar_fila SET estado = 'descartado', atualizado_em = ? WHERE usuario_id = ? AND estado IN ('problema','precisa_dados')", agora(), u.usuario_id);
  return { puladas: Number(r.changes || 0) };
}

function liberar(db, u, quem, motivo) {
  db.run('INSERT INTO alimentar_liberacao (usuario_id, liberado_em, por, motivo) VALUES (?,?,?,?) ON CONFLICT(usuario_id) DO UPDATE SET liberado_em = excluded.liberado_em, por = excluded.por, motivo = excluded.motivo', u.usuario_id, agora(), quem, motivo || null);
  trilha.registrar(db, { usuario: quem, tabela: 'alimentar_liberacao', registro: u.usuario_id, campo: 'liberado', valor_novo: { login: u.login, motivo: motivo || null } });
  return { ok: true };
}
function liberarProprio(db, u) {
  const e = estado(db, u);
  if (e.resumo.pendentes) throw erro(409, 'Ainda há arquivos sendo lidos. Aguarde terminar.');
  if (e.resumo.precisaDados) throw erro(409, 'Há arquivos esperando você indicar a unidade e o trimestre. Indique ou use "Pular os que deram problema".');
  if (!e.resumo.total) throw erro(409, 'Envie ao menos um arquivo. Se não tiver nenhum agora, peça à administração para liberar o seu acesso.');
  return liberar(db, u, u.login, 'Concluiu o primeiro envio (' + e.resumo.lidos + ' lidos, ' + e.resumo.problemas + ' com problema)');
}

module.exports = { trava, estado, receber, identificar, descartar, aprovar, pularProblemas, liberar, liberarProprio, recuperar, processar, trimestreDe, unidadeDe, ELEGIVEIS };
