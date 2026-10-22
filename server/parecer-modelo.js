'use strict';
// Modelo "Parecer CTAI": texto-padrão por seção, preenchido com os dados da unidade e do período, ou em branco.
// O modelo fica em templates/parecer-ctai-v1.json (só texto fictício). A pessoa edita cada seção; o que vale é o que ela salvar.
const fs = require('fs');
const path = require('path');
const M = require('./minuta');
const trilha = require('./trilha');
const { erro } = require('./auth');

const MODELO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'parecer-ctai-v1.json'), 'utf8'));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const agora = () => new Date().toISOString();

function periodoPorExtenso(comps) {
  const l = (comps || []).slice().sort().map((c) => { const [a, m] = String(c).split('-'); return { a, m: Number(m) }; }).filter((x) => x.m >= 1 && x.m <= 12);
  if (!l.length) return '—';
  const p = l[0], u = l[l.length - 1];
  return p.a === u.a ? (l.length === 1 ? MESES[p.m - 1] + ' de ' + p.a : MESES[p.m - 1] + ' a ' + MESES[u.m - 1] + ' de ' + p.a) : MESES[p.m - 1] + '/' + p.a + ' a ' + MESES[u.m - 1] + '/' + u.a;
}
const num = (v) => (v === null || v === undefined ? 'sem valor' : String(v).replace('.', ','));

// Valores que preenchem os campos {…} do texto-padrão.
function campos(c) {
  const id = c.identificacao;
  const comps = c.indicadores.competencias;
  const prazos = comps.filter((k) => k.prazos).map((k) => '• ' + k.competencia + ': envio ao SEI – ' + (k.prazos.sei.situacao || '—') + (k.prazos.sei.entregue_em ? ' (' + k.prazos.sei.entregue_em + ')' : '') + '; SIMAS – ' + (k.prazos.simas.situacao || '—') + (k.prazos.simas.entregue_em ? ' (' + k.prazos.simas.entregue_em + ')' : '')).join('\n') || '(sem prazos registrados no sistema)';
  const igq = comps.length ? 'Pontuação do IGQ por competência: ' + comps.map((x) => x.competencia + ' – ' + num(x.igq.oss) + ' pela unidade, ' + num(x.igq.recalculado) + ' no recálculo da CTAI e ' + num(x.igq.adotado) + ' adotado' + (x.implantacao ? ' (mês de implantação, sem desconto)' : '')).join('; ') + '.' : '(sem competências selecionadas)';
  const d = c.desconto && c.desconto.adotado;
  const desconto = d && d.total !== undefined
    ? 'Pela regra de desconto decidida, o valor apurado para o período é de R$ ' + num(d.total) + '. O desconto segue o Anexo Técnico II do Contrato – Sistema de Pagamento.'
    : 'O valor a pagar está relacionado ao cumprimento das metas valoradas (Anexo Técnico II do Contrato). (Informe se haverá ou não apontamento de desconto no período.)';
  return { unidade: id.unidade, oss: id.oss || '(OSS)', cg: id.numero_cg || '(nº do contrato)', trimestre: id.trimestre, periodo: periodoPorExtenso(id.competencias), numero: id.numero_parecer || 'xxx/' + String(id.trimestre).slice(0, 4), prazos, analise_igq: igq, desconto };
}
const subst = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? m : v[k]));

function quadroQualidade(c) {
  const comps = c.indicadores.competencias;
  if (!comps.length) return [];
  const ult = comps[comps.length - 1];
  return ult.indicadores.map((i) => {
    const pts = comps.map((k) => { const x = k.indicadores.find((y) => y.id === i.id); return x && x.pontos_adotados !== null && x.pontos_adotados !== undefined ? x.pontos_adotados : null; });
    const ok = pts.every((p) => p !== null);
    const soma = ok ? pts.reduce((a, b) => a + b, 0) : null;
    const max = i.max * comps.length;
    return [i.id, i.nome, '—', ok ? pts.map(num).join(' / ') + ' pts' : 'sem dado', ok ? num(Math.round(soma / max * 10000) / 100) + '%' : '—', !ok ? 'A analisar' : (soma >= max ? 'Meta cumprida' : 'Meta parcial')];
  });
}

function vazio() { return { modo: 'branco', secoes: Object.fromEntries(MODELO.secoes.map((s) => [s.id, ''])), quadros: Object.fromEntries(MODELO.quadros.map((q) => [q.id, []])), atualizado_em: agora() }; }

function montar(db, parecerId, modo) {
  if (modo === 'branco') return vazio();
  const c = M.conteudoAtual(db, parecerId);
  const v = campos(c);
  return { modo: 'padrao', secoes: Object.fromEntries(MODELO.secoes.map((s) => [s.id, subst(s.texto, v)])), quadros: { q1: [], q2: [], q3: quadroQualidade(c) }, atualizado_em: agora() };
}

function definir(db, parecerId, usuario, modo) {
  if (!['padrao', 'branco'].includes(modo)) throw erro(400, 'Modo inválido (padrao ou branco).');
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const novo = montar(db, parecerId, modo);
  db.run('UPDATE pareceres SET blocos = ?, atualizado_em = ?, atualizado_por = ? WHERE parecer_id = ?', JSON.stringify(Object.assign(p.blocos, { modelo: novo })), agora(), usuario.login, p.parecer_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'modelo', valor_novo: modo });
  return novo;
}

function salvar(db, parecerId, usuario, dados) {
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const m = p.blocos.modelo || vazio();
  for (const s of MODELO.secoes) if (dados.secoes && dados.secoes[s.id] !== undefined) m.secoes[s.id] = String(dados.secoes[s.id]).slice(0, 20000);
  for (const q of MODELO.quadros) if (dados.quadros && Array.isArray(dados.quadros[q.id])) m.quadros[q.id] = dados.quadros[q.id].slice(0, 80).map((l) => (Array.isArray(l) ? l : []).slice(0, q.colunas.length).map((x) => String(x === null || x === undefined ? '' : x).slice(0, 400)));
  m.atualizado_em = agora();
  db.run('UPDATE pareceres SET blocos = ?, atualizado_em = ?, atualizado_por = ? WHERE parecer_id = ?', JSON.stringify(Object.assign(p.blocos, { modelo: m })), agora(), usuario.login, p.parecer_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'modelo_texto', valor_novo: 'edição das seções' });
}

// Texto corrido do modelo (para leitura do Analista e conferência).
function textoCompleto(m, numero) {
  if (!m) return '';
  const partes = [subst(MODELO.titulo, { numero: numero || 'xxx' })];
  for (const s of MODELO.secoes) if (m.secoes[s.id]) partes.push(s.titulo + '\n' + m.secoes[s.id]);
  for (const q of MODELO.quadros) if ((m.quadros[q.id] || []).length) partes.push(q.titulo + '\n' + m.quadros[q.id].map((l) => l.join(' | ')).join('\n'));
  return partes.join('\n\n');
}

// Preenche as linhas da seção 3 (OSS, contrato, vigência, repasse, endereço) com o cadastro do GAOCG. Só troca o que o GAOCG trouxe.
async function preencherPeloGaocg(db, parecerId, usuario) {
  const G = require('./gaocg');
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const u = await G.unidadeDoContrato(db, p.contrato_id, usuario.login);
  if (!u.encontrada) return { encontrada: false };
  const m = p.blocos.modelo || vazio();
  const d = u.dados;
  const br = (s) => { const t = String(s); const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); return x ? x[3] + '/' + x[2] + '/' + x[1] : t; };
  const dinheiro = (v) => { const t = String(v).trim(); const n = typeof v === 'number' ? v : (/^[\d.,\s]+$/.test(t) ? (t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)) : NaN); return Number.isFinite(n) ? 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : t; };
  const troca = { 'OSS': d.oss, 'Contrato de Gestão': d.contrato ? 'n.º ' + d.contrato : null, 'Vigência / termos aditivos': d.vigencia_fim ? (d.vigencia_inicio ? br(d.vigencia_inicio) + ' a ' : 'até ') + br(d.vigencia_fim) : null, 'Endereço': d.endereco, 'Repasse mensal': d.repasse_mensal ? dinheiro(d.repasse_mensal) : null };
  const feitos = [];
  let txt = String(m.secoes.identificacao || '');
  for (const [rot, val] of Object.entries(troca)) {
    if (!val) continue;
    const re = new RegExp('^(•\\s*' + rot.replace(/[/]/g, '\\/') + ':).*$', 'm');
    if (re.test(txt)) { txt = txt.replace(re, (_, a) => a + ' ' + val); feitos.push(rot); }
  }
  m.secoes.identificacao = txt; m.atualizado_em = agora();
  db.run('UPDATE pareceres SET blocos = ?, atualizado_em = ?, atualizado_por = ? WHERE parecer_id = ?', JSON.stringify(Object.assign(p.blocos, { modelo: m })), agora(), usuario.login, p.parecer_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'modelo_gaocg', valor_novo: feitos.join(', ') || 'nada novo' });
  return { encontrada: true, preenchidos: feitos, lido_em: u.lido_em, da_copia: u.da_copia };
}

module.exports = { preencherPeloGaocg, MODELO, montar, definir, salvar, textoCompleto, campos, periodoPorExtenso };
