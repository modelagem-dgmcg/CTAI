'use strict';
// Leitura de NÚMEROS de dois documentos da UPAE: o quadro de produção do Relatório Mensal (Anexo I) e o ofício/despacho de justificativa de metas.
// Só devolve o que o padrão do texto permite achar; o que não achou fica vazio (null). A IA/regra apenas propõe: quem confirma é a analista.
// Também faz o conferidor ofício x RM (gera divergência, nunca corrige nada).
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "1.872" -> 1872; "43,29%" -> 43.29; "#DIV/0!" -> null
function numeroBR(tok) {
  const t = String(tok === undefined || tok === null ? '' : tok).trim().replace('%', '');
  if (!/^-?\d[\d.]*(?:,\d+)?$/.test(t)) return null;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d{1,3}(?:\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}

const INDICADORES = [
  { chave: 'consultas_medicas_tea', rotulo: 'Consultas médicas (TEA e neurodiversidades)', re: /neuropediatra/ },
  { chave: 'bexiga_neurogenica', rotulo: 'Programa: pessoas com bexiga neurogênica', re: /bexiga neurogenica/ },
  { chave: 'pe_diabetico', rotulo: 'Programa: pessoas com pé diabético e feridas complexas', re: /pe diabetico/ },
  { chave: 'ostomizados', rotulo: 'Programa de Ostomizados (estomia)', re: /ostomizados|estomia/ },
  { chave: 'consultas_nao_medicas', rotulo: 'Consultas de especialidades não médicas', re: /nao medicas|exceto medicos/ },
  { chave: 'consultas_medicas', rotulo: 'Consultas médicas especializadas', re: /consultas medicas|atendimentos ambulatoriais medicos/ },
  { chave: 'sessoes_reabilitacao', rotulo: 'Sessões de reabilitação', re: /reabilitacao/ },
  { chave: 'mamografia', rotulo: 'Exames de mamografia', re: /mamografia/ },
  { chave: 'matriciamento', rotulo: 'Matriciamento das equipes de Saúde da Família', re: /matriciamento/ },
  { chave: 'supervisao_cuidado', rotulo: 'Supervisão do cuidado nas UBS', re: /supervisao/ },
];

// ---------- Anexo I (RM): quadro "Indicadores de Produção" ----------
// Cada linha do quadro começa com o período ("jul/26") e termina com 4 números: meta mensal, ofertado, produção (realizado) e % da meta.
// (O modelo do 10º Termo Aditivo, a partir de set/2026, mantém as 4 colunas: meta, oferta, produção e %.)
const PERIODO = /\b(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}\b/gi;
const FIM4 = /(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*(?:,\d+)?)\s+(#DIV\/0!|\d[\d.]*(?:,\d+)?%)\s*$/;
function extrairProducaoRM(texto) {
  const t = String(texto || '');
  const marcas = [...t.matchAll(PERIODO)];
  const saida = []; const vistos = new Set();
  for (let i = 0; i < marcas.length; i++) {
    const ini = marcas[i].index;
    const fim = i + 1 < marcas.length ? marcas[i + 1].index : Math.min(t.length, ini + 1200);
    let janela = t.slice(ini + marcas[i][0].length, fim);
    // o fim da linha do quadro: nota de rodapé, legenda do quadro ou marca de página
    const corte = /Fonte:|Envelope eletr|---\s*p[aá]gina|\n\s*\d+(?:\.\d+)?\.?\s+Indicadores\b/i.exec(janela);
    if (corte) janela = janela.slice(0, corte.index);
    janela = janela.trimEnd();
    if (janela.length > 900) continue;
    const m = FIM4.exec(janela);
    if (!m) continue; // não é linha de produção (ex.: quadro de qualidade)
    const rotuloBruto = janela.slice(0, m.index);
    const nome = sem(rotuloBruto);
    if (nome.length < 6) continue;
    const ind = INDICADORES.find((x) => x.re.test(nome));
    let chave, rotulo;
    if (ind) { chave = ind.chave; rotulo = ind.rotulo; }
    else { chave = 'outro_' + nome.replace(/\s+/g, '_').slice(0, 40); rotulo = rotuloBruto.replace(/\s+/g, ' ').replace(/Total de.*$/i, '').trim().slice(0, 80) || chave; }
    // o mesmo indicador pela 2ª vez é o quadro TEA (1.1)
    if (vistos.has(chave)) { if (vistos.has(chave + '_tea')) continue; chave += '_tea'; rotulo += ' (TEA e neurodiversidades)'; }
    vistos.add(chave);
    saida.push({ chave, rotulo, periodo: marcas[i][0].toLowerCase(), meta: numeroBR(m[1]), ofertado: numeroBR(m[2]), regulado: null, realizado: numeroBR(m[3]), pct: numeroBR(m[4]), pct_ofertado: null,
      trecho: (marcas[i][0] + ' ' + rotuloBruto + ' ' + m.slice(1, 5).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 400) });
  }
  return saida;
}

// ---------- Ofício / despacho de justificativa de metas ----------
const SECOES = [
  { chave: 'consultas_medicas', rotulo: 'Consultas médicas especializadas', re: /consultas medicas|consultas realizadas/ },
  { chave: 'ostomizados', rotulo: 'Programa de Ostomizados', re: /ostomizados/ },
  { chave: 'sessoes_reabilitacao', rotulo: 'Sessões de reabilitação', re: /fisioterapia|sessoes de reabilitacao|reabilitacao/ },
];
function extrairOficio(texto) {
  const linhas = String(texto || '').split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const por = new Map(); let atual = null;
  const pega = (chave) => { const s = SECOES.find((x) => x.chave === chave); if (!por.has(chave)) por.set(chave, { chave, rotulo: s.rotulo, periodo: null, meta: null, ofertado: null, regulado: null, realizado: null, pct: null, pct_ofertado: null, trechos: [] }); return por.get(chave); };
  for (const l of linhas) {
    const n = sem(l);
    // cabeçalho de seção: linha curta, sem ":" com número no fim
    if (!/:\s*[\d.,]+%?\s*$/.test(l)) {
      if (l.length <= 60) { const s = SECOES.find((x) => x.re.test(n)); if (s) atual = s.chave; }
      continue;
    }
    const m = /^[-•·\s]*(.+?):\s*(-?[\d.]+(?:,\d+)?%?)\s*$/.exec(l);
    if (!m) continue;
    const rot = sem(m[1]); const val = numeroBR(m[2]); const ehPct = /%$/.test(m[2]);
    const s = SECOES.find((x) => x.re.test(rot)); if (s) atual = s.chave;
    if (!atual) continue;
    const r = pega(atual); const registra = (campo) => { if (r[campo] === null) { r[campo] = val; r.trechos.push(l.slice(0, 160)); } };
    if (ehPct) { if (/realizad/.test(rot)) registra('pct'); else if (/ofertad/.test(rot)) registra('pct_ofertado'); }
    else if (/regulad/.test(rot)) registra('regulado');
    else if (/ofertad/.test(rot)) registra('ofertado');
    else if (/realizad/.test(rot)) registra('realizado');
  }
  return [...por.values()].filter((r) => r.ofertado !== null || r.realizado !== null || r.regulado !== null || r.pct !== null).map((r) => { const { trechos, ...resto } = r; return Object.assign(resto, { trecho: trechos.join(' | ').slice(0, 400) }); });
}

// ---------- Conferidor ofício x RM ----------
// rm e oficio: listas de números ({chave, ofertado, realizado, pct...}). fonte: "Ofício" ou "Despacho".
function conferir(rm, oficio, fonte) {
  const div = [];
  const f = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  for (const o of oficio || []) {
    const r = (rm || []).find((x) => x.chave === o.chave);
    if (!r) continue;
    const testes = [
      ['ofertado', 'ofertados', 0, ''], ['realizado', 'realizados', 0, ''], ['pct', '% de cumprimento (realizado)', 0.05, '%'],
    ];
    for (const [campo, nome, tol, un] of testes) {
      const a = o[campo], b = r[campo];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      if (Math.abs(a - b) <= tol) continue;
      div.push({ chave: o.chave, rotulo: o.rotulo, campo, fonte, oficio: a, rm: b, diferenca: Math.round((a - b) * 100) / 100, nivel: campo === 'pct' ? 'media' : 'alta',
        texto: o.rotulo + ': ' + fonte + ' diz ' + f(a) + un + ' ' + nome + ' e o Relatório Mensal diz ' + f(b) + un + '.' });
    }
  }
  return div;
}

module.exports = { numeroBR, extrairProducaoRM, extrairOficio, conferir, INDICADORES };
