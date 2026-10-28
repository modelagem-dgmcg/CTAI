'use strict';
// Apuração do trimestre para o Parecer CTAI (Redator CTAI, 1ª entrega): quadros 01 e 02, apontamentos de descontos, campos manuais
// (informações financeiras, parecer da CMA, "impossibilitado de análise"), considerações finais sugeridas e a conferência número a número.
// REGRAS DE SEGURANÇA DOS NÚMEROS:
//  1. Só entra número CONFIRMADO (gaveta/RM/planilha) ou número que a analista digitou COM motivo. Proposto, ausente ou divergente aparece como pendência, nunca como valor.
//  2. Todo cálculo é refeito por um segundo caminho (inteiros/BigInt, lendo de volta os textos que vão para o documento). Qualquer diferença BLOQUEIA o "pronto para conferência".
//  3. Percentual de desconto e repasse não são adivinhados: sem informação, ficam "a definir pela analista" e bloqueiam.
//  4. Seções 7, 8 e "impossibilitado de análise" são campos manuais (vindos da observação que a analista registrou na lista de conferência).
//  5. Mudança de meta no trimestre (termo aditivo) vira aviso. Tudo é rastreável e vai para a trilha de auditoria.
const U = require('../core/util');
const C = require('./catalogo');
const G = require('./gaveta');
const CR = require('./contrato-regras');
const trilha = require('./trilha');
const { erro } = require('./auth');

const agora = () => new Date().toISOString();
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ler = (s, p) => { try { const v = JSON.parse(s); return v === null || v === undefined ? p : v; } catch (_) { return p; } };

// indicadores do Quadro 01 (valorados) e do Quadro 02 (não valorado); de onde vem cada número
const Q1 = [
  { chave: 'consultas_medicas', nome: 'Consultas Médicas Especializadas', fontes: [['anexo_I', 'consultas_medicas']], regra: /consultas medicas/ },
  { chave: 'consultas_nao_medicas', nome: 'Consultas de Especialidades não médicas', fontes: [['anexo_I', 'consultas_nao_medicas']], regra: /nao medicas/ },
  { chave: 'sessoes_reabilitacao', nome: 'Sessões de Reabilitação', fontes: [['anexo_I', 'sessoes_reabilitacao']], regra: /reabilitacao/ },
  { chave: 'mamografia', nome: 'Ampliar a oferta de exames de mamografias', fontes: [['anexo_I', 'mamografia']], regra: /mamografia/ },
  { chave: 'ostomizados', nome: 'Descentralização do Programa de Ostomizados (número de pacientes)', fontes: [['anexo_II', 'ostomizados_pessoas']], regra: /ostomizados/ },
  { chave: 'matriciamento', nome: 'Matriciamento das equipes de Saúde da Família', fontes: [['anexo_I', 'matriciamento']], regra: /matriciamento/ },
  { chave: 'supervisao_cuidado', nome: 'Supervisão do cuidado prestado nas UBS', fontes: [['anexo_I', 'supervisao_cuidado']], regra: /supervisao/ },
];
const Q2 = [{ chave: 'consultas_medicas_tea', nome: 'Consultas de Neuropediatria – Transtorno do Espectro Autista (TEA) (não valorado)', fontes: [['anexo_I', 'consultas_medicas_tea']], regra: /neuropediatr|tea\b/ }];

// ---------- números e textos em português ----------
const nBR = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const cent = (v) => Math.round(Number(v) * 100);                      // reais/unidades -> centésimos
const pctTxt = (bp) => (bp / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const rsTxt = (c) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// leitura de volta (usada pela verificação independente)
function lerBR(t) {
  const s = String(t == null ? '' : t).replace(/R\$|%|\s/g, '');
  if (!/^-?\d[\d.]*(,\d+)?$/.test(s)) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}
const numOk = (v) => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : lerBR(v); return Number.isFinite(n) ? n : null; };

// ---------- caminho A (cálculo) ----------
function pctA(soma, metaTotal) { return metaTotal > 0 ? Math.round((soma / metaTotal) * 10000) : null; } // pontos-base (49,77% = 4977)
function descA(totalCent, bp) { return Math.round(totalCent * bp / 10000); }
// ---------- caminho B (independente: BigInt, arredondamento meio para cima) ----------
function pctB(soma, metaTotal) {
  const s = BigInt(cent(soma)), m = BigInt(cent(metaTotal)); if (m <= 0n) return null;
  return Number((s * 10000n * 2n + m) / (m * 2n));
}
function descB(totalCent, bp) { const n = BigInt(totalCent) * BigInt(bp); return Number((n * 2n + 10000n) / 20000n); }
function somaExataB(totalCent, bps) { const n = bps.reduce((s, bp) => s + BigInt(totalCent) * BigInt(bp), 0n); return Number((n * 2n + 10000n) / 20000n); }

// ---------- dados da analista ----------
function carregar(db, cid, tri) {
  const l = db.get('SELECT * FROM par_apuracao WHERE contrato_id = ? AND trimestre = ?', cid, tri);
  return { linha: l || null, dados: l ? ler(l.dados, {}) : {} };
}
const hashDe = (o) => U.sha256(JSON.stringify(o));

function candidatos(db, cid, mes, fonte, chave) {
  return db.all('SELECT n.*, d.nome_arquivo FROM gaveta_numeros n LEFT JOIN gaveta_documentos d ON d.id = n.doc_id WHERE n.contrato_id = ? AND n.mes = ? AND n.fonte = ? AND n.chave = ? ORDER BY n.id', cid, mes, fonte, chave);
}

// valor de um campo (meta/realizado) de um indicador em um mês: ajuste da analista, número confirmado, ou pendência
function valorDoMes(db, cid, ind, mes, campo, ajustes, pend, conf) {
  const aj = ajustes.find((a) => a.chave === ind.chave && a.mes === mes && a.campo === campo);
  if (aj) {
    const r = { v: aj.valor, origem: 'digitado pela analista', ref: aj.motivo, estado: 'digitado' };
    conf.push({ indicador: ind.nome, mes, campo, valor: aj.valor, origem: 'digitado pela analista', arquivo: null, trecho: 'Motivo informado: ' + aj.motivo, estado: 'digitado' });
    return r;
  }
  const todos = [];
  for (const [fonte, chave] of ind.fontes) for (const x of candidatos(db, cid, mes, fonte, chave)) todos.push(x);
  const confirmados = todos.filter((x) => x.estado === 'confirmado' && x[campo] !== null && x[campo] !== undefined);
  if (confirmados.length) {
    const x = confirmados[0];
    conf.push({ indicador: ind.nome, mes, campo, valor: x[campo], origem: (x.fonte === 'anexo_I' ? 'RM (Anexo I)' : 'Planilha de monitoramento (Anexo II)') + ' · confirmado por ' + x.confirmado_por, arquivo: x.nome_arquivo || null, trecho: x.trecho || null, estado: 'confirmado' });
    return { v: x[campo], origem: x.fonte, ref: x.trecho, estado: 'confirmado' };
  }
  const prop = todos.filter((x) => x[campo] !== null && x[campo] !== undefined);
  pend.push(C.rotuloMes(mes) + ' — ' + (campo === 'meta' ? 'meta' : 'realizado') + (prop.length ? ': há número LIDO mas NÃO confirmado (' + nBR(prop[0][campo]) + '); confirme em Alimentar o Analista ou digite com motivo' : ': sem número lido; confirme a leitura ou digite com motivo'));
  return null;
}

function apurarIndicador(db, cid, meses, ind, ajustes) {
  const pend = [], conf = [], avisos = [];
  const linhas = meses.map((mes) => ({ mes, meta: valorDoMes(db, cid, ind, mes, 'meta', ajustes, pend, conf), realizado: valorDoMes(db, cid, ind, mes, 'realizado', ajustes, pend, conf) }));
  const metas = linhas.map((l) => (l.meta ? l.meta.v : null)).filter((v) => v !== null);
  if (new Set(metas).size > 1) avisos.push('A meta mudou dentro do trimestre (' + linhas.filter((l) => l.meta).map((l) => C.rotuloMes(l.mes) + ' ' + nBR(l.meta.v)).join('; ') + '). Confira se há termo aditivo; o percentual usa a soma das metas de cada mês.');
  const completo = pend.length === 0;
  const somaReal = completo ? linhas.reduce((s, l) => s + l.realizado.v, 0) : null;
  const metaTri = completo ? linhas.reduce((s, l) => s + l.meta.v, 0) : null;
  const a = completo ? pctA(somaReal, metaTri) : null;
  const b = completo ? pctB(somaReal, metaTri) : null;
  return { chave: ind.chave, nome: ind.nome, linhas, soma_realizado: somaReal, meta_trimestre: metaTri, pct_bp: a, pct_bp_verificacao: b, pendencias: pend, avisos, conferencia: conf, ind };
}

const statusDe = (bp) => (bp === null ? 'Pendente' : (bp >= 10000 ? 'Meta cumprida' : 'Meta não cumprida'));
const faixa = (bp) => (bp === null ? null : (bp >= 10000 ? 'cumprida' : (bp >= 8500 ? 'entre_85_e_100' : 'abaixo_85')));

function pesoNoContrato(db, cid, ind) {
  const r = CR.ler(db, cid); if (!r) return null;
  const i = (r.conteudo.indicadores || []).find((x) => ind.regra.test(sem(x.nome)));
  return i && i.peso_pct_total !== null && i.peso_pct_total !== undefined ? i.peso_pct_total : null;
}

// ---------- visão completa ----------
function textosDoModelo(db, cid) {
  const m = db.get('SELECT id, trimestre, nome_arquivo, texto, estrutura FROM imp_modelos WHERE contrato_id = ? AND ativo = 1 ORDER BY id DESC LIMIT 1', cid);
  if (!m) return null;
  const est = ler(m.estrutura, {}); const linhas = String(m.texto || '').replace(/\r/g, '').split('\n');
  const secoes = (est.secoes || []).filter((s) => s.nivel === undefined || s.nivel === 1 || /^\d+\.?$/.test(String(s.numero || '')));
  const RE = /(\d{1,2}[°ºo]?\s*trimestre(?:\s+de)?\s+\d{4}|\b20\d{2}\b|R\$\s*[\d.,]+|\d+(?:[.,]\d+)?\s*%|\bn[.º°o]+\s*\d+[\d./-]*|\b(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b)/gi;
  const out = secoes.map((s, k) => {
    const ini = s.linha, fim = secoes[k + 1] ? secoes[k + 1].linha - 1 : linhas.length;
    const texto = linhas.slice(ini, fim).map((l) => l.trim()).filter(Boolean).join('\n');
    return { numero: s.numero || '', titulo: s.titulo, texto, revisar: [...new Set((texto.match(RE) || []).map((x) => x.trim()))].slice(0, 60) };
  });
  return { id: m.id, trimestre: m.trimestre, nome_arquivo: m.nome_arquivo, secoes: out };
}

function observacaoDaLista(db, cid, tri, codigos) {
  for (const cod of codigos) {
    const r = db.get("SELECT observacao FROM imp_checks WHERE contrato_id = ? AND trimestre = ? AND item_codigo = ? AND observacao IS NOT NULL AND observacao <> '' ORDER BY marcado_em DESC LIMIT 1", cid, tri, cod);
    if (r) return r.observacao;
  }
  return '';
}

function montar(db, c, tri) {
  const cid = c.contrato_id; const meses = C.mesesDoTrimestre(tri);
  const { linha, dados } = carregar(db, cid, tri);
  const ajustes = Array.isArray(dados.ajustes) ? dados.ajustes : [];
  const avisos = [], bloqueios = [];
  const q1 = Q1.map((i) => apurarIndicador(db, cid, meses, i, ajustes));
  const q2 = Q2.map((i) => apurarIndicador(db, cid, meses, i, ajustes));
  for (const q of [...q1, ...q2]) {
    for (const p of q.pendencias) bloqueios.push(q.nome + ': ' + p);
    for (const a of q.avisos) avisos.push(q.nome + ': ' + a);
    if (q.pct_bp !== q.pct_bp_verificacao) bloqueios.push(q.nome + ': o recálculo independente do percentual não bate (' + q.pct_bp + ' x ' + q.pct_bp_verificacao + ').');
  }
  // ostomizados: unidade de medida é paciente; meses com "atendimentos" na planilha não servem
  const ostoAt = db.all("SELECT mes FROM gaveta_numeros WHERE contrato_id = ? AND fonte = 'anexo_II' AND chave = 'ostomizados_atendimentos' AND mes IN (" + meses.map(() => '?').join(',') + ')', cid, ...meses);
  if (ostoAt.length) avisos.push('Ostomizados: em ' + ostoAt.map((x) => C.rotuloMes(x.mes)).join(', ') + ' a planilha traz ATENDIMENTOS (sessões), não número de pacientes. O indicador conta pacientes: esses meses ficam pendentes até a analista digitar o número de pacientes com motivo.');
  // achados ainda abertos
  const abertos = db.all("SELECT achado_id, tipo, trecho FROM achados WHERE contrato_id = ? AND trimestre = ? AND gravidade = 'A CONFERIR' AND status = 'novo'", cid, tri);
  for (const a of abertos) bloqueios.push('Achado "A CONFERIR" ainda sem decisão (#' + a.achado_id + '): ' + String(a.tipo || '').slice(0, 120));
  // descontos
  const repasses = dados.repasses && typeof dados.repasses === 'object' ? dados.repasses : {};
  const rep = meses.map((m) => ({ mes: m, cent: repasses[m] === undefined || repasses[m] === null || repasses[m] === '' ? null : cent(repasses[m]) }));
  const repOk = rep.every((r) => r.cent !== null);
  if (!repOk) bloqueios.push('Valor de repasse mensal não informado para ' + rep.filter((r) => r.cent === null).map((r) => C.rotuloMes(r.mes)).join(', ') + ': a definir pela analista (não está nas regras carregadas).');
  if (repOk && !String(dados.repasse_fonte || '').trim()) bloqueios.push('Informe de onde vem o valor do repasse (documento/cláusula) para o rastreio.');
  const repTotal = repOk ? rep.reduce((s, r) => s + r.cent, 0) : null;
  const pctDesc = dados.descontos_pct && typeof dados.descontos_pct === 'object' ? dados.descontos_pct : {};
  const descontos = q1.map((q) => {
    const f = faixa(q.pct_bp);
    const peso = pesoNoContrato(db, cid, q.ind);
    const base = { chave: q.chave, nome: q.nome, faixa: f, peso_contrato_pct: peso, aplicavel: f === 'abaixo_85' || f === 'entre_85_e_100', pct_bp: null, valor_cent: null, valor_cent_verificacao: null, pendencia: null };
    if (!base.aplicavel) return base;
    const bruto = pctDesc[q.chave];
    const bp = numOk(bruto) === null ? null : Math.round(numOk(bruto) * 100);
    if (f === 'entre_85_e_100') base.aviso = 'Entre 85% e 100%: as regras carregadas não dizem se há desconto nesta faixa. A analista define.';
    if (bp === null) { base.pendencia = 'percentual de desconto a definir pela analista' + (peso !== null ? ' (peso do indicador no contrato: ' + nBR(peso) + '% do repasse; o peso não é o percentual aplicado)' : ''); bloqueios.push(q.nome + ': ' + base.pendencia + '.'); return base; }
    base.pct_bp = bp;
    if (!repOk) { base.pendencia = 'repasse não informado'; return base; }
    base.valor_cent = descA(repTotal, bp); base.valor_cent_verificacao = descB(repTotal, bp);
    if (base.valor_cent !== base.valor_cent_verificacao) bloqueios.push(q.nome + ': o recálculo independente do desconto não bate.');
    return base;
  });
  const comValor = descontos.filter((d) => d.valor_cent !== null);
  const somaLinhas = comValor.reduce((s, d) => s + d.valor_cent, 0);
  const exato = repOk ? somaExataB(repTotal, comValor.map((d) => d.pct_bp)) : null;
  let totalProducao = null, arred = dados.arredondamento || null;
  if (repOk && comValor.length === descontos.filter((d) => d.aplicavel).length) {
    if (somaLinhas === exato) totalProducao = somaLinhas;
    else if (arred === 'linhas') totalProducao = somaLinhas;
    else if (arred === 'exato') totalProducao = exato;
    else bloqueios.push('A soma das linhas dos descontos (' + rsTxt(somaLinhas) + ') difere do total calculado sem arredondar (' + rsTxt(exato) + ') por arredondamento de centavos. Escolha qual vale no parecer.');
  }
  const qualidade = dados.qualidade_desconto === undefined || dados.qualidade_desconto === null || dados.qualidade_desconto === '' ? null : cent(dados.qualidade_desconto);
  if (qualidade === null) bloqueios.push('Descontos de qualidade: a definir pela analista (informe 0,00 se não houver).');
  if (totalProducao === null && !descontos.some((d) => d.aplicavel)) totalProducao = 0;
  const totalGeral = totalProducao !== null && qualidade !== null ? totalProducao + qualidade : null;
  // campos manuais
  const obs7 = observacaoDaLista(db, cid, tri, ['financeiro']), obs8 = observacaoDaLista(db, cid, tri, ['parecer_cma']);
  const manual = {
    s7: { texto: dados.s7 !== undefined ? dados.s7 : obs7, origem: dados.s7 !== undefined ? 'digitado pela analista' : (obs7 ? 'observação registrada na lista de conferência' : 'vazio') },
    s8: { texto: dados.s8 !== undefined ? dados.s8 : obs8, origem: dados.s8 !== undefined ? 'digitado pela analista' : (obs8 ? 'observação registrada na lista de conferência' : 'vazio') },
    impossibilitados: Array.isArray(dados.impossibilitados) ? dados.impossibilitados : [],
  };
  if (!String(manual.s7.texto || '').trim()) bloqueios.push('Seção 7 (informações financeiras do trimestre anterior): campo manual vazio.');
  if (!String(manual.s8.texto || '').trim()) bloqueios.push('Seção 8 (parecer conclusivo da CMA do trimestre anterior): campo manual vazio.');
  // considerações finais: sugestões a partir de achados fixados; só as aceitas entram
  const fixados = db.all("SELECT achado_id, tipo, trecho FROM achados WHERE contrato_id = ? AND trimestre = ? AND status = 'fixado' ORDER BY achado_id", cid, tri);
  const sugestoes = fixados.map((a) => ({ origem: 'achado #' + a.achado_id, texto: String(a.tipo || 'Achado').slice(0, 160) + ': ' + String(a.trecho || '').slice(0, 300), marca: 'sugestão, revisar' }));
  for (const q of q1) if (q.pct_bp !== null && q.pct_bp < 8500) sugestoes.push({ origem: 'cálculo', texto: 'Recomenda-se à Contratada atenção ao indicador "' + q.nome + '", que alcançou ' + pctTxt(q.pct_bp) + ' no trimestre, abaixo do mínimo contratual de 85%.', marca: 'sugestão, revisar' });
  const finais = Array.isArray(dados.consideracoes_finais) ? dados.consideracoes_finais : [];

  const doc = documento({ tri, meses, q1, q2, rep, repTotal, descontos, totalProducao, qualidade, totalGeral, manual, finais, unidade: c.unidade, arred });
  // verificação independente lendo de volta o que está escrito no documento
  for (const e of verificarTextos(doc, { q1, q2, repTotal, descontos, totalProducao, qualidade, totalGeral })) bloqueios.push(e);
  const conferencia = [...q1, ...q2].flatMap((q) => q.conferencia);
  const estado = { dados, q1: q1.map(semInd), q2: q2.map(semInd), rep, repTotal, descontos, totalProducao, qualidade, totalGeral, manual, finais };
  const hash = hashDe(estado);
  const pronto = !!(linha && linha.pronto_hash && linha.pronto_hash === hash && bloqueios.length === 0);
  return {
    unidade: c.unidade, trimestre: tri, meses, modelo: textosDoModelo(db, cid), quadro1: q1.map(semInd), quadro2: q2.map(semInd),
    repasse: { meses: rep, total_cent: repTotal, fonte: dados.repasse_fonte || '' }, descontos, arredondamento: arred,
    total_producao_cent: totalProducao, qualidade_cent: qualidade, total_geral_cent: totalGeral, manual, sugestoes, consideracoes_finais: finais,
    ajustes, descontos_pct: pctDesc, avisos, bloqueios, conferencia, documento: doc, hash,
    pronto, pronto_em: pronto ? linha.pronto_em : null, pronto_por: pronto ? linha.pronto_por : null,
    desatualizado: !!(linha && linha.pronto_hash && linha.pronto_hash !== hash),
  };
}
const semInd = (q) => { const o = Object.assign({}, q); delete o.ind; delete o.conferencia; o.pct_txt = q.pct_bp === null ? null : pctTxt(q.pct_bp); o.status = statusDe(q.pct_bp); return o; };

// ---------- o documento (o que vai para a tela e para o PDF) ----------
function documento(x) {
  const rot = (m) => C.rotuloMes(m);
  const quadro = (q, titulo, extra) => ({
    titulo,
    colunas: ['Nº', 'Período', 'Indicador', 'Meta', 'Produção mensal', '% trimestral', 'Status'],
    linhas: q.flatMap((i, k) => i.linhas.map((l, j) => [j === 0 ? String(k + 1) : '', rot(l.mes), j === 0 ? i.nome : '', l.meta ? nBR(l.meta.v) : 'PENDENTE', l.realizado ? nBR(l.realizado.v) : 'PENDENTE', j === 0 ? (i.pct_bp === null ? 'PENDENTE' : pctTxt(i.pct_bp)) : '', j === 0 ? statusDe(i.pct_bp) : ''])),
    extra,
  });
  const tabelasDesc = x.descontos.filter((d) => d.aplicavel).map((d, k) => ({
    titulo: 'Tabela 0' + (k + 1) + ' - Apontamento de Desconto - Indicador de Produção - ' + d.nome,
    repasses: x.rep.map((r) => ['VALOR DE REPASSE MENSAL - ' + rot(r.mes), r.cent === null ? 'PENDENTE' : rsTxt(r.cent)]),
    repasse_total: x.repTotal === null ? 'PENDENTE' : rsTxt(x.repTotal),
    pct: d.pct_bp === null ? 'A DEFINIR PELA ANALISTA' : pctTxt(d.pct_bp), valor: d.valor_cent === null ? 'PENDENTE' : rsTxt(d.valor_cent),
    base: 'Base para o cálculo: Anexo Técnico II do Contrato de Gestão.',
  }));
  const t5 = { titulo: 'Tabela ' + String(tabelasDesc.length + 1).padStart(2, '0') + ' - Apontamento de Desconto - Valor total apontado', linhas: [['PRODUÇÃO', x.totalProducao === null ? 'PENDENTE' : rsTxt(x.totalProducao)], ['QUALIDADE', x.qualidade === null ? 'A DEFINIR PELA ANALISTA' : rsTxt(x.qualidade)], ['TOTAL', x.totalGeral === null ? 'PENDENTE' : rsTxt(x.totalGeral)]] };
  const frases = x.q1.filter((i) => i.pct_bp !== null).map((i) => 'O indicador "' + i.nome + '" alcançou ' + pctTxt(i.pct_bp) + ' no trimestre (' + nBR(i.soma_realizado) + ' de ' + nBR(i.meta_trimestre) + ') — ' + statusDe(i.pct_bp).toLowerCase() + '.');
  return {
    titulo: 'Apuração do trimestre ' + x.tri + ' - ' + x.unidade, quadro1: quadro(x.q1, 'Quadro 01 - Resultados Alcançados - ' + x.tri + ' - Indicadores de Produção valorados'),
    quadro2: quadro(x.q2, 'Quadro 02 - Resultados Alcançados - ' + x.tri + ' - Indicadores de Produção (não valorado)'), frases,
    descontos: tabelasDesc, total: t5, s7: x.manual.s7.texto || '', s8: x.manual.s8.texto || '', impossibilitados: x.manual.impossibilitados, finais: x.finais,
    lei: 'Art. 15-A da Lei Estadual n.º 15.210/2013: mínimo de 85% das metas pactuadas no trimestre; compensação por produção excedente nos dois trimestres seguintes.',
  };
}

// ---------- verificação independente: lê de volta o texto do documento ----------
function verificarTextos(doc, ref) {
  const erros = [];
  const nome = (q) => q.nome;
  for (const [quadro, lista] of [[doc.quadro1, ref.q1], [doc.quadro2, ref.q2]]) {
    let pos = 0;
    for (const q of lista) {
      const n = q.linhas.length; const cel = quadro.linhas.slice(pos, pos + n); pos += n;
      if (q.pct_bp === null) continue;
      const metas = cel.map((l) => lerBR(l[3])), reais = cel.map((l) => lerBR(l[4])), pctLido = lerBR(cel[0][5]);
      if (metas.some((v) => v === null) || reais.some((v) => v === null) || pctLido === null) { erros.push(nome(q) + ': não consegui ler de volta os números do quadro.'); continue; }
      const b = pctB(reais.reduce((s, v) => s + v, 0), metas.reduce((s, v) => s + v, 0));
      if (Math.round(pctLido * 100) !== b) erros.push(nome(q) + ': o percentual escrito no quadro (' + cel[0][5] + ') difere do recálculo a partir dos meses escritos (' + pctTxt(b) + ').');
      if (!doc.frases.some((f) => f.includes('"' + q.nome + '"') && f.includes(' alcançou ' + cel[0][5] + ' '))) { if (!q.nome.includes('não valorado')) erros.push(nome(q) + ': o texto do parecer não repete o percentual do quadro.'); }
    }
  }
  if (ref.repTotal !== null) {
    for (const t of doc.descontos) {
      const soma = t.repasses.reduce((s, r) => s + Math.round(lerBR(r[1]) * 100), 0);
      if (soma !== Math.round(lerBR(t.repasse_total) * 100)) erros.push(t.titulo + ': a soma dos repasses mensais escritos difere do total escrito.');
      const bp = lerBR(t.pct) === null ? null : Math.round(lerBR(t.pct) * 100);
      if (bp !== null && t.valor !== 'PENDENTE' && descB(Math.round(lerBR(t.repasse_total) * 100), bp) !== Math.round(lerBR(t.valor) * 100)) erros.push(t.titulo + ': o valor do desconto escrito difere do recálculo (' + rsTxt(descB(Math.round(lerBR(t.repasse_total) * 100), bp)) + ').');
    }
    if (ref.totalGeral !== null) {
      const p = Math.round(lerBR(doc.total.linhas[0][1]) * 100), q = Math.round(lerBR(doc.total.linhas[1][1]) * 100), t = Math.round(lerBR(doc.total.linhas[2][1]) * 100);
      if (p + q !== t) erros.push('Tabela do total: produção + qualidade não é igual ao total escrito.');
      const somaTabelas = doc.descontos.reduce((s, d) => s + Math.round(lerBR(d.valor) * 100), 0);
      if (somaTabelas !== p && ref.totalProducao === somaTabelas) erros.push('Tabela do total: a produção escrita difere da soma das tabelas.');
    }
  }
  // números citados nas considerações finais aceitas precisam existir nos cálculos deste trimestre
  const pcts = new Set(ref.q1.concat(ref.q2).filter((q) => q.pct_bp !== null).map((q) => q.pct_bp)), reais = new Set();
  if (ref.repTotal !== null) { reais.add(ref.repTotal); ref.descontos.forEach((d) => { if (d.valor_cent !== null) reais.add(d.valor_cent); }); if (ref.totalProducao !== null) reais.add(ref.totalProducao); if (ref.totalGeral !== null) reais.add(ref.totalGeral); }
  for (const f of doc.finais || []) {
    const t = typeof f === 'string' ? f : (f && f.texto) || '';
    for (const m of t.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*%/g)) if (!pcts.has(Math.round(lerBR(m[1]) * 100))) erros.push('Consideração final cita ' + m[1] + '% que não corresponde a nenhum cálculo deste trimestre: "' + t.slice(0, 80) + '".');
    for (const m of t.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g)) if (!reais.has(Math.round(lerBR(m[1]) * 100))) erros.push('Consideração final cita R$ ' + m[1] + ' que não corresponde a nenhum cálculo deste trimestre: "' + t.slice(0, 80) + '".');
  }
  return erros;
}

// ---------- operações ----------
function unidade(db, usuario, cid, tri) {
  const c = G.exigirUnidade(db, usuario, cid);
  if (!C.TRI_OK.test(String(tri || ''))) throw erro(400, 'Informe o trimestre no formato 2026-T4.');
  return c;
}
const visao = (db, usuario, cid, tri) => montar(db, unidade(db, usuario, cid, tri), tri);

function salvar(db, usuario, cid, tri, d) {
  const c = unidade(db, usuario, cid, tri); d = d || {};
  const meses = C.mesesDoTrimestre(tri);
  const { dados: antes } = carregar(db, c.contrato_id, tri);
  const novo = JSON.parse(JSON.stringify(antes));
  if (d.repasses !== undefined) {
    novo.repasses = {};
    for (const m of meses) { const v = d.repasses && d.repasses[m]; if (v === undefined || v === null || v === '') continue; const n = numOk(v); if (n === null || n < 0) throw erro(400, 'Valor de repasse inválido em ' + C.rotuloMes(m) + '.'); novo.repasses[m] = n; }
  }
  if (d.repasse_fonte !== undefined) novo.repasse_fonte = String(d.repasse_fonte || '').trim().slice(0, 300);
  if (d.descontos_pct !== undefined) {
    novo.descontos_pct = {};
    for (const q of Q1) { const v = d.descontos_pct && d.descontos_pct[q.chave]; if (v === undefined || v === null || v === '') continue; const n = numOk(v); if (n === null || n < 0 || n > 100) throw erro(400, 'Percentual de desconto inválido em ' + q.nome + '.'); novo.descontos_pct[q.chave] = n; }
  }
  if (d.qualidade_desconto !== undefined) { if (d.qualidade_desconto === null || d.qualidade_desconto === '') delete novo.qualidade_desconto; else { const n = numOk(d.qualidade_desconto); if (n === null || n < 0) throw erro(400, 'Desconto de qualidade inválido.'); novo.qualidade_desconto = n; } }
  if (d.arredondamento !== undefined) { if (d.arredondamento && !['linhas', 'exato'].includes(d.arredondamento)) throw erro(400, 'Critério de arredondamento inválido.'); if (d.arredondamento) novo.arredondamento = d.arredondamento; else delete novo.arredondamento; }
  for (const k of ['s7', 's8']) if (d[k] !== undefined) novo[k] = String(d[k] || '').slice(0, 6000);
  if (d.impossibilitados !== undefined) novo.impossibilitados = (Array.isArray(d.impossibilitados) ? d.impossibilitados : []).slice(0, 40).map((x) => ({ indicador: String((x && x.indicador) || '').slice(0, 200), motivo: String((x && x.motivo) || '').slice(0, 600) })).filter((x) => x.indicador);
  if (d.consideracoes_finais !== undefined) novo.consideracoes_finais = (Array.isArray(d.consideracoes_finais) ? d.consideracoes_finais : []).slice(0, 40).map((x) => String(typeof x === 'string' ? x : (x && x.texto) || '').slice(0, 1200)).filter(Boolean);
  if (d.ajustes !== undefined) {
    const validas = new Set([...Q1, ...Q2].map((q) => q.chave));
    novo.ajustes = (Array.isArray(d.ajustes) ? d.ajustes : []).slice(0, 80).map((a) => {
      if (!a || !validas.has(a.chave) || !meses.includes(a.mes) || !['meta', 'realizado'].includes(a.campo)) throw erro(400, 'Ajuste inválido (indicador, mês ou campo).');
      const v = numOk(a.valor); if (v === null || v < 0) throw erro(400, 'Valor digitado inválido.');
      const motivo = String(a.motivo || '').trim(); if (motivo.length < 5) throw erro(400, 'Todo número digitado precisa de um motivo/fonte (ex.: "planilha de agosto, linha Pessoas com estomia").');
      return { chave: a.chave, mes: a.mes, campo: a.campo, valor: v, motivo: motivo.slice(0, 400) };
    });
  }
  const json = JSON.stringify(novo);
  db.tx(() => {
    db.run('INSERT INTO par_apuracao (contrato_id, trimestre, dados, atualizado_por, atualizado_em) VALUES (?,?,?,?,?) ON CONFLICT(contrato_id, trimestre) DO UPDATE SET dados = excluded.dados, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em',
      c.contrato_id, tri, json, usuario.login, agora());
    for (const k of Object.keys(novo)) if (JSON.stringify(novo[k]) !== JSON.stringify(antes[k])) trilha.registrar(db, { usuario: usuario.login, tabela: 'par_apuracao', registro: c.contrato_id + '/' + tri, campo: k, valor_anterior: antes[k] === undefined ? null : antes[k], valor_novo: novo[k] });
    for (const k of Object.keys(antes)) if (novo[k] === undefined) trilha.registrar(db, { usuario: usuario.login, tabela: 'par_apuracao', registro: c.contrato_id + '/' + tri, campo: k, valor_anterior: antes[k], valor_novo: null });
  });
  return montar(db, c, tri);
}

function marcarPronto(db, usuario, cid, tri) {
  const c = unidade(db, usuario, cid, tri);
  const v = montar(db, c, tri);
  if (v.bloqueios.length) { const e = erro(409, 'Não está pronto para conferência: ' + v.bloqueios.length + ' pendência(s) ou diferença(s) de número.'); e.bloqueios = v.bloqueios; throw e; }
  db.tx(() => {
    db.run('INSERT INTO par_apuracao (contrato_id, trimestre, dados, atualizado_por, atualizado_em, pronto_hash, pronto_por, pronto_em) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(contrato_id, trimestre) DO UPDATE SET pronto_hash = excluded.pronto_hash, pronto_por = excluded.pronto_por, pronto_em = excluded.pronto_em',
      c.contrato_id, tri, '{}', usuario.login, agora(), v.hash, usuario.login, agora());
    trilha.registrar(db, { usuario: usuario.login, tabela: 'par_apuracao', registro: c.contrato_id + '/' + tri, campo: 'pronto_para_conferencia', valor_novo: { hash: v.hash, total_geral_cent: v.total_geral_cent, indicadores: v.quadro1.map((q) => q.chave + '=' + q.pct_txt) } });
  });
  return montar(db, c, tri);
}

async function pdf(db, usuario, cid, tri) {
  const c = unidade(db, usuario, cid, tri);
  const v = montar(db, c, tri);
  if (!v.pronto) throw erro(409, v.desatualizado ? 'Os números mudaram depois do "pronto para conferência". Confira de novo e marque como pronto.' : 'O PDF só sai depois de "pronto para conferência", sem pendências.');
  const d = v.documento; const blocos = [];
  blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'Minuta de apuração gerada pela CTAI, em conferência. O texto corrido das seções 1 a 4, 9 e 10 ainda é redigido pela analista a partir do parecer do trimestre anterior.' });
  const tab = (q) => ({ tipo: 'tabela', titulo: q.titulo, colunas: q.colunas.map((r, i) => ({ rotulo: r, largura: [0.5, 1, 3, 1, 1.2, 1.2, 1.4][i], alinhar: i >= 3 && i <= 5 ? 'right' : 'left' })), linhas: q.linhas });
  blocos.push({ tipo: 'titulo', nivel: 1, texto: '5. Dos indicadores' }, { tipo: 'titulo', nivel: 2, texto: '5.1 Dos Indicadores de Produção - Parte Variável' }, tab(d.quadro1), { tipo: 'lista', itens: d.frases });
  blocos.push({ tipo: 'titulo', nivel: 2, texto: '5.2 Dos indicadores de Produção - não valorados' }, tab(d.quadro2));
  blocos.push({ tipo: 'titulo', nivel: 2, texto: '5.3 Dos Indicadores de Qualidade' });
  blocos.push(d.impossibilitados.length ? { tipo: 'tabela', titulo: 'Quadro 03 - Impossibilitado de análise', colunas: [{ rotulo: 'Indicador', largura: 2 }, { rotulo: 'Motivo', largura: 3 }], linhas: d.impossibilitados.map((x) => [x.indicador, x.motivo || 'Impossibilitado de análise']) } : { tipo: 'paragrafo', texto: 'Nenhum indicador de qualidade foi registrado como impossibilitado de análise pela analista.' });
  blocos.push({ tipo: 'titulo', nivel: 1, texto: '6. Dos apontamentos de descontos' });
  for (const t of d.descontos) blocos.push({ tipo: 'tabela', titulo: t.titulo, colunas: [{ rotulo: 'Descrição', largura: 3 }, { rotulo: 'Valor', largura: 1.5, alinhar: 'right' }], linhas: [...t.repasses, ['VALOR DE REPASSE TOTAL NO TRIMESTRE', t.repasse_total], ['Desconto aplicado (' + t.pct + ' do repasse total do trimestre)', t.valor]] }, { tipo: 'paragrafo', texto: t.base });
  blocos.push({ tipo: 'tabela', titulo: d.total.titulo, colunas: [{ rotulo: 'Descontos totais', largura: 3 }, { rotulo: 'Valor', largura: 1.5, alinhar: 'right' }], linhas: d.total.linhas }, { tipo: 'paragrafo', texto: d.lei });
  blocos.push({ tipo: 'titulo', nivel: 1, texto: '7. Das informações financeiras (trimestre anterior)' }, { tipo: 'paragrafo', texto: d.s7 });
  blocos.push({ tipo: 'titulo', nivel: 1, texto: '8. Considerações sobre o Parecer Conclusivo da CMA (trimestre anterior)' }, { tipo: 'paragrafo', texto: d.s8 });
  if (d.finais.length) blocos.push({ tipo: 'titulo', nivel: 1, texto: '9. Considerações finais' }, { tipo: 'lista', itens: d.finais.map((t, k) => (k + 1) + '. ' + t) });
  const buf = await require('./pdf/render').renderizar({ titulo: d.titulo, subtitulo: 'Minuta de apuração · conferida pelo sistema em ' + new Date().toLocaleDateString('pt-BR'), blocos });
  trilha.registrar(db, { usuario: usuario.login, tabela: 'par_apuracao', registro: c.contrato_id + '/' + tri, campo: 'pdf_gerado', valor_novo: { hash: v.hash } });
  return buf;
}

module.exports = { visao, salvar, marcarPronto, pdf, montar, pctA, pctB, descA, descB, lerBR, Q1, Q2, verificarTextos };
