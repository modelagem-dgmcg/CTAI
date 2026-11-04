'use strict';
// Acervo CTAI no Google Drive: guarda o TEXTO (já sem dados de paciente) dos documentos que chegaram ao SEI.
// Estrutura: Acervo / <Unidade> / <Trimestre> / <Título> - SEI <número>.txt. O original nunca é guardado; o banco do CTAI continua sendo a base de trabalho.
// Falha do Drive nunca atrapalha quem está trabalhando: o item fica "pendente" e a administração reenvia.
const G = require('./google-drive');
const { mascarar } = require('./mascara');
const agora = () => new Date().toISOString();
const limpoNome = (s) => String(s || 'sem nome').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sem nome';

function textoDeConteudo(c) { // a minuta guarda JSON: junta só os textos, na ordem
  let o = c; if (typeof c === 'string') { try { o = JSON.parse(c); } catch (_) { return c; } }
  const out = []; const ande = (v) => { if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); } else if (Array.isArray(v)) v.forEach(ande); else if (v && typeof v === 'object') Object.values(v).forEach(ande); };
  ande(o); return out.join('\n\n');
}
function montar(db, origem, id) {
  if (origem === 'documento') {
    const d = db.get('SELECT * FROM documentos WHERE doc_id = ?', id); if (!d || !d.sei_numero) return null;
    const c = d.contrato_id ? db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', d.contrato_id) : null;
    return { unidade: c ? c.unidade : 'Sem unidade', trimestre: d.trimestre || 'Sem trimestre', titulo: d.titulo, sei: d.sei_numero, tipo: d.tipo, texto: d.texto };
  }
  if (origem === 'parecer') {
    const p = db.get('SELECT * FROM pareceres WHERE parecer_id = ?', id); if (!p || !p.sei_numero) return null;
    const v = db.get("SELECT * FROM versoes_minuta WHERE parecer_id = ? AND status = 'autorizada' ORDER BY numero DESC LIMIT 1", id) || db.get('SELECT * FROM versoes_minuta WHERE parecer_id = ? ORDER BY numero DESC LIMIT 1', id);
    const c = db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', p.contrato_id);
    return { unidade: c ? c.unidade : p.contrato_id, trimestre: p.trimestre, titulo: p.titulo || ('Parecer ' + (p.numero_parecer || '')), sei: p.sei_numero, tipo: 'parecer', texto: v ? textoDeConteudo(v.conteudo) : '' };
  }
  if (origem === 'historico') {
    const r = db.get('SELECT * FROM hist_relatorios WHERE hist_id = ?', id); if (!r) return null;
    const c = db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', r.contrato_id);
    const rotulo = { parecer: 'Parecer', relatorio: 'Relatório' }[r.documento_tipo] || 'Documento';
    return { unidade: c ? c.unidade : r.contrato_id, trimestre: r.trimestre, titulo: rotulo + ' ' + (r.numero_parecer || String(r.nome_arquivo || '').replace(/\.[a-z0-9]{2,5}$/i, '')) + ' [' + String(r.hash || '').slice(0, 8) + ']', sei: null, tipo: r.documento_tipo, texto: r.texto || '' };
  }
  return null;
}

async function arquivar(db, origem, id, textoExtra) {
  const reg = db.get('SELECT * FROM acervo_arquivos WHERE origem = ? AND origem_id = ?', origem, id);
  if (!reg) db.run("INSERT INTO acervo_arquivos (origem, origem_id, estado, tentativas, atualizado_em) VALUES (?,?,'pendente',0,?)", origem, id, agora());
  if (textoExtra) db.run('UPDATE acervo_arquivos SET texto_pendente = ? WHERE origem = ? AND origem_id = ?', mascarar(textoExtra).texto, origem, id); // o histórico apaga o texto ao confirmar: guarda até o Drive aceitar
  if (!G.ligado()) { db.run("UPDATE acervo_arquivos SET estado = 'pendente', erro = 'Acervo desligado: faltam as variáveis do Google Drive.', atualizado_em = ? WHERE origem = ? AND origem_id = ?", agora(), origem, id); return { ok: false, motivo: 'desligado' }; }
  try {
    const m = montar(db, origem, id); if (!m) throw new Error('Documento sem número do SEI.');
    const guardado = db.get('SELECT texto_pendente FROM acervo_arquivos WHERE origem = ? AND origem_id = ?', origem, id);
    if (!m.texto && guardado && guardado.texto_pendente) m.texto = guardado.texto_pendente;
    if (!String(m.texto || '').trim()) throw new Error('Documento sem texto para guardar.');
    const raiz = G.pastaRaiz();
    const pu = await G.garantirPasta(limpoNome(m.unidade), raiz);
    const pt = await G.garantirPasta(limpoNome(m.trimestre), pu);
    const nome = limpoNome(m.titulo) + (m.sei ? ' - SEI ' + limpoNome(m.sei) : '') + '.txt';
    const corpo = ['ACERVO CTAI — texto sem dados de paciente (o original não é guardado)', 'Unidade: ' + m.unidade, 'Trimestre: ' + m.trimestre, 'Tipo: ' + m.tipo, 'Número no SEI: ' + (m.sei || 'não informado (documento histórico)'), 'Arquivado em: ' + agora(), '', mascarar(m.texto).texto].join('\n');
    const r = await G.gravarTexto(nome, corpo, pt);
    db.run("UPDATE acervo_arquivos SET estado = 'arquivado', drive_id = ?, caminho = ?, unidade = ?, trimestre = ?, titulo = ?, sei = ?, tipo = ?, texto_pendente = NULL, erro = NULL, tentativas = tentativas + 1, atualizado_em = ? WHERE origem = ? AND origem_id = ?", r.id, m.unidade + ' / ' + m.trimestre + ' / ' + nome, m.unidade, m.trimestre, m.titulo, m.sei, m.tipo, agora(), origem, id);
    return { ok: true };
  } catch (e) {
    db.run("UPDATE acervo_arquivos SET estado = 'pendente', erro = ?, tentativas = tentativas + 1, atualizado_em = ? WHERE origem = ? AND origem_id = ?", String(e.message || e).slice(0, 200), agora(), origem, id);
    return { ok: false, motivo: String(e.message || e) };
  }
}
// Chamado quando o número do SEI é registrado. Não espera, não quebra nada.
function agendar(db, origem, id, textoExtra) { Promise.resolve().then(() => arquivar(db, origem, id, textoExtra)).catch(() => {}); }

async function reenviarPendentes(db) {
  const l = db.all("SELECT origem, origem_id FROM acervo_arquivos WHERE estado = 'pendente' ORDER BY id LIMIT 50");
  let ok = 0; for (const x of l) if ((await arquivar(db, x.origem, x.origem_id)).ok) ok++;
  return { tentados: l.length, arquivados: ok };
}
function estado(db) {
  const n = (e) => db.get('SELECT COUNT(*) AS n FROM acervo_arquivos WHERE estado = ?', e).n;
  return { ligado: G.ligado(), conta: G.emailConta(), motivo: G.ligado() ? null : 'Desligado: falta a chave da conta de serviço (CTAI_DRIVE_CHAVE) ou a pasta do Acervo (CTAI_ACERVO_PASTA).',
    arquivados: n('arquivado'), pendentes: n('pendente'), ultimos: db.all('SELECT origem, origem_id, estado, caminho, erro, atualizado_em FROM acervo_arquivos ORDER BY atualizado_em DESC LIMIT 15') };
}
// ---------- leitura por outros sistemas, com chave (só leitura) ----------
const crypto = require('node:crypto');
const U = require('../core/util');
function criarChave(db, sistema, usuario) {
  const nome = String(sistema || '').trim().slice(0, 80); if (nome.length < 3) throw Object.assign(new Error('Diga qual sistema vai usar a chave (ex.: Raio-X).'), { status: 400 });
  const chave = 'ctai_acv_' + crypto.randomBytes(32).toString('base64url');
  db.run('INSERT INTO acervo_chaves (sistema, hash, final, criada_por, criada_em) VALUES (?,?,?,?,?)', nome, U.sha256(chave), chave.slice(-4), usuario.login, agora());
  return { sistema: nome, chave, aviso: 'Esta é a única vez que a chave aparece. Guarde só no sistema que vai usá-la.' };
}
const listarChaves = (db) => db.all('SELECT chave_id, sistema, final, criada_por, criada_em, revogada_em, ultimo_uso, usos FROM acervo_chaves ORDER BY chave_id DESC');
function revogarChave(db, id) { db.run('UPDATE acervo_chaves SET revogada_em = ? WHERE chave_id = ? AND revogada_em IS NULL', agora(), Number(id)); }
function validarChave(db, cabecalho) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(cabecalho || '')); if (!m) return null;
  const c = db.get('SELECT * FROM acervo_chaves WHERE hash = ? AND revogada_em IS NULL', U.sha256(m[1])); if (!c) return null;
  db.run('UPDATE acervo_chaves SET ultimo_uso = ?, usos = usos + 1 WHERE chave_id = ?', agora(), c.chave_id); return c;
}
function listar(db, f) {
  const w = ["estado = 'arquivado'"], a = [];
  if (f.unidade) { w.push('unidade LIKE ?'); a.push('%' + f.unidade + '%'); }
  if (f.trimestre) { w.push('trimestre = ?'); a.push(String(f.trimestre)); }
  if (f.tipo) { w.push('tipo = ?'); a.push(String(f.tipo)); }
  if (f.q) { w.push('(titulo LIKE ? OR unidade LIKE ? OR sei LIKE ?)'); a.push('%' + f.q + '%', '%' + f.q + '%', '%' + f.q + '%'); }
  return db.all('SELECT id, unidade, trimestre, titulo, sei, tipo, atualizado_em FROM acervo_arquivos WHERE ' + w.join(' AND ') + ' ORDER BY unidade, trimestre, titulo LIMIT ?', ...a, Math.min(Number(f.limite) || 100, 500));
}
async function ler(db, id) {
  const r = db.get("SELECT * FROM acervo_arquivos WHERE id = ? AND estado = 'arquivado'", Number(id)); if (!r) return null;
  const texto = await G.lerTexto(r.drive_id);
  return { id: r.id, unidade: r.unidade, trimestre: r.trimestre, titulo: r.titulo, sei: r.sei, tipo: r.tipo, texto };
}
module.exports = { criarChave, listarChaves, revogarChave, validarChave, listar, ler, arquivar, agendar, reenviarPendentes, estado, textoDeConteudo };
