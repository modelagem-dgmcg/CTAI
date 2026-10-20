'use strict';
// Normas por unidade: o que vale para cada contrato (cláusulas, regras do IGQ, portarias). O texto é digitado ou colado pela CTAI.
// O Analista sugere as normas mais ligadas a cada achado por palavras em comum: é apoio de consulta, não parecer jurídico.
const trilha = require('./trilha');
const { erro } = require('./auth');

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PARADAS = new Set(['para', 'como', 'qual', 'sobre', 'entre', 'pelo', 'pela', 'esta', 'este', 'deve', 'devem', 'cada', 'mais', 'menos', 'ainda', 'quando', 'sendo', 'essa', 'esse', 'seus', 'suas', 'unidade', 'contrato', 'gestao']);
const palavras = (t) => new Set(norm(t).split(/[^a-z0-9]+/).filter((w) => w.length > 4 && !PARADAS.has(w)));

function listar(db, filtro) {
  const where = [], args = [];
  // Norma sem contrato vale para todas as unidades.
  if (filtro.contrato_id) { where.push('(contrato_id = ? OR contrato_id IS NULL)'); args.push(filtro.contrato_id); }
  if (filtro.somenteVigentes) where.push('vigente = 1');
  let lista = db.all('SELECT * FROM normas' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY vigente DESC, titulo', ...args).map((n) => Object.assign(n, { vigente: !!n.vigente, demo: !!n.demo }));
  if (filtro.q && String(filtro.q).trim()) {
    const q = palavras(filtro.q);
    lista = lista.filter((n) => { const p = palavras(n.titulo + ' ' + n.referencia + ' ' + n.tema + ' ' + n.texto); for (const w of q) if (p.has(w)) return true; return false; });
  }
  return lista;
}

function validar(d, parcial) {
  const o = {};
  const t = (k, max) => { if (d[k] === undefined) return; const v = String(d[k] || '').trim(); if (v.length > max) throw erro(400, 'O campo ' + k + ' passou do limite de ' + max + ' caracteres.'); o[k] = v || null; };
  t('titulo', 160); t('referencia', 200); t('tema', 80); t('texto', 8000);
  if (!parcial && !o.titulo) throw erro(400, 'Informe o título da norma.');
  if (!parcial && !o.texto) throw erro(400, 'Cole o texto ou o resumo da norma.');
  if (d.vigente !== undefined) o.vigente = d.vigente ? 1 : 0;
  return o;
}

function criar(db, usuario, d) {
  const o = validar(d, false);
  const contrato = d.contrato_id ? String(d.contrato_id) : null;
  if (contrato && !db.get('SELECT 1 FROM contratos WHERE contrato_id = ?', contrato)) throw erro(400, 'Contrato não encontrado.');
  const agora = new Date().toISOString();
  const r = db.run('INSERT INTO normas (contrato_id, titulo, referencia, tema, texto, vigente, demo, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)',
    contrato, o.titulo, o.referencia || null, o.tema || null, o.texto, o.vigente === undefined ? 1 : o.vigente, d.demo ? 1 : 0, usuario.login, agora, agora);
  const id = Number(r.lastInsertRowid);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'normas', registro: id, campo: 'criacao', valor_novo: { contrato, titulo: o.titulo } });
  return id;
}

function atualizar(db, usuario, id, d) {
  const n = db.get('SELECT * FROM normas WHERE norma_id = ?', Number(id));
  if (!n) throw erro(404, 'Norma não encontrada.');
  const o = validar(d, true);
  const chaves = Object.keys(o);
  if (!chaves.length) throw erro(400, 'Nada para alterar.');
  db.run('UPDATE normas SET ' + chaves.map((k) => k + ' = ?').join(', ') + ', atualizado_em = ? WHERE norma_id = ?', ...chaves.map((k) => o[k]), new Date().toISOString(), n.norma_id);
  for (const k of chaves) if (String(n[k] === null ? '' : n[k]) !== String(o[k] === null ? '' : o[k])) trilha.registrar(db, { usuario: usuario.login, tabela: 'normas', registro: n.norma_id, campo: k, valor_anterior: k === 'texto' ? '(texto anterior)' : n[k], valor_novo: k === 'texto' ? '(texto novo)' : o[k], motivo: d.motivo || null });
}

// Normas vigentes mais ligadas ao achado (por palavras em comum). Máximo de 2; só quando há ao menos 2 palavras em comum.
function paraAchado(db, achado, contratoId) {
  const base = palavras([achado.tipo, achado.trecho, achado.risco, achado.sugestao].join(' '));
  if (!base.size) return [];
  const pontos = [];
  for (const n of listar(db, { contrato_id: contratoId, somenteVigentes: true })) {
    const p = palavras(n.titulo + ' ' + n.tema + ' ' + n.texto);
    let comum = 0; for (const w of base) if (p.has(w)) comum++;
    if (comum >= 2) pontos.push({ n, comum });
  }
  pontos.sort((a, b) => b.comum - a.comum);
  return pontos.slice(0, 2).map(({ n }) => ({ norma_id: n.norma_id, titulo: n.titulo, referencia: n.referencia, demo: n.demo }));
}

module.exports = { listar, criar, atualizar, paraAchado, palavras };
