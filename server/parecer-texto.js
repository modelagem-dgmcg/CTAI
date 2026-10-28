'use strict';
// Texto corrido do Parecer CTAI (seções 1 a 4, 9 e 10 e identificação) gerado a partir do relatório-modelo do trimestre anterior.
// DETERMINÍSTICO, sem IA: troca só o que o sistema sabe trocar (período, trimestre, valor de repasse confirmado) e DESTACA o que mudou
// (kind "trocado") e o que a analista precisa revisar (kind "revisar"). Texto jurídico entre aspas fica como está (kind "fixo").
// O que não se sabe trocar nunca é chutado: fica no texto, destacado.
const U = require('../core/util');
const C = require('./catalogo');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cap = (modelo, novo) => (modelo && modelo[0] === modelo[0].toUpperCase() && modelo[0] !== modelo[0].toLowerCase() ? novo[0].toUpperCase() + novo.slice(1) : novo);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nomeMeses = (tri) => C.mesesDoTrimestre(tri).map((m) => MESES[Number(m.slice(5)) - 1]);
const triParte = (tri) => { const m = /^(\d{4})-T([1-4])$/.exec(String(tri || '')); return m ? { ano: m[1], n: m[2] } : null; };

// ---------- valor por extenso (reais) ----------
const U1 = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const D1 = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const C1 = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, p = [];
  if (c) p.push(C1[c]);
  if (r) p.push(r < 20 ? U1[r] : D1[Math.floor(r / 10)] + (r % 10 ? ' e ' + U1[r % 10] : ''));
  return p.join(' e ');
}
function numeroExtenso(n) {
  if (n === 0) return 'zero';
  const mi = Math.floor(n / 1000000), mil = Math.floor((n % 1000000) / 1000), r = n % 1000, p = [];
  if (mi) p.push(ate999(mi) + (mi === 1 ? ' milhão' : ' milhões'));
  if (mil) p.push(mil === 1 ? 'mil' : ate999(mil) + ' mil');
  if (r) p.push(ate999(r));
  let s = p[0];
  for (let i = 1; i < p.length; i++) { const ultimo = i === p.length - 1; s += (ultimo && (r < 100 || r % 100 === 0) ? ' e ' : ' ') + p[i]; }
  return s;
}
function valorExtenso(cent) {
  const r = Math.floor(cent / 100), c = cent % 100;
  const reais = numeroExtenso(r) + (r === 1 ? ' real' : (r % 1000000 === 0 && r > 0 ? ' de reais' : ' reais'));
  return reais + (c ? ' e ' + numeroExtenso(c) + (c === 1 ? ' centavo' : ' centavos') : '');
}
const moedaTxt = (cent) => 'R$ ' + (cent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const centDe = (t) => Math.round(Number(String(t).replace(/R\$|\s|\./g, '').replace(',', '.')) * 100);

// ---------- regras de troca / destaque ----------
// ctx: { triModelo, triNovo, repasseModeloCent, repasseNovoCent, perfil }  perfil: 'completo' | 'periodo' (só troca de período) | 'fixo'
function regrasDe(ctx) {
  const rs = [];
  const pm = triParte(ctx.triModelo), pn = triParte(ctx.triNovo);
  if (pm && pn) {
    const mm = nomeMeses(ctx.triModelo), mn = nomeMeses(ctx.triNovo);
    rs.push({ re: /(\d)\s*([º°o])\s*(trimestre)(\s+de\s+)(\d{4})/gi, f: (m) => (m[1] === pm.n && m[5] === pm.ano ? { k: 'trocado', para: pn.n + m[2] + ' ' + m[3] + m[4] + pn.ano } : { k: ctx.perfil === 'completo' ? 'revisar' : 'igual', motivo: 'outro trimestre citado' }) });
    rs.push({ re: /(\d)\s*([º°o])\s*(trimestre)\b(?!\s+de\s+\d{4})/gi, f: (m) => (m[1] === pm.n ? { k: 'trocado', para: pn.n + m[2] + ' ' + m[3] } : { k: 'igual' }) });
    rs.push({ re: new RegExp('\\b(' + mm[0] + ')(\\s+a\\s+)(' + mm[2] + ')\\b(\\s+de\\s+(\\d{4}))?', 'gi'), f: (m) => {
      const ano = m[5] ? (m[5] === pm.ano ? pn.ano : null) : '';
      if (ano === null) return { k: 'revisar' };
      return { k: 'trocado', para: cap(m[1], mn[0]) + m[2] + cap(m[3], mn[2]) + (m[5] ? ' de ' + ano : '') };
    } });
    rs.push({ re: new RegExp('\\b(' + mm[0] + '),\\s*(' + mm[1] + ')\\s+e\\s+(' + mm[2] + ')\\b', 'gi'), f: (m) => ({ k: 'trocado', para: cap(m[1], mn[0]) + ', ' + cap(m[2], mn[1]) + ' e ' + cap(m[3], mn[2]) }) });
  }
  if (ctx.perfil === 'completo') {
    if (ctx.repasseModeloCent && ctx.repasseNovoCent && ctx.repasseModeloCent !== ctx.repasseNovoCent) {
      const v = moedaTxt(ctx.repasseModeloCent).replace('R$ ', '');
      rs.unshift({ re: new RegExp('R\\$\\s*' + esc(v) + '(\\s*\\([^)]*\\))?', 'g'), f: () => ({ k: 'trocado', para: moedaTxt(ctx.repasseNovoCent) + ' (' + valorExtenso(ctx.repasseNovoCent) + ')', motivo: 'repasse mensal confirmado do trimestre' }) });
    }
    const ini = pn ? new Date(Number(pn.ano), (Number(pn.n) - 1) * 3, 1) : null;
    rs.push({ re: new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + MESES.join('|') + ')\\s+de\\s+(\\d{4})\\b', 'gi'), f: (m) => {
      const d = new Date(Number(m[3]), MESES.indexOf(sem(m[2]) === 'marco' ? 'março' : m[2].toLowerCase()), Number(m[1]));
      return ini && d >= ini ? { k: 'revisar', motivo: 'data dentro do trimestre ou depois (vigência, termo aditivo?)' } : { k: 'igual' };
    } });
    rs.push({ re: /R\$\s*[\d.]+,\d{2}(\s*\([^)]*\))?/g, f: () => ({ k: 'revisar', motivo: 'valor em reais' }) });
    rs.push({ re: /\d+(?:[.,]\d+)?\s*%/g, f: () => ({ k: 'revisar', motivo: 'percentual' }) });
    rs.push({ re: /\b\d{10}\.\d{6}\/\d{4}-\d{2}\b/g, f: () => ({ k: 'revisar', motivo: 'número de processo SEI' }) });
    rs.push({ re: new RegExp('\\b(' + MESES.join('|') + ')\\b', 'gi'), f: () => ({ k: 'revisar', motivo: 'mês citado' }) });
  }
  return rs;
}

// quebra a linha em segmentos { t, k, de?, motivo? }; k: igual | trocado | revisar | fixo
function segmentar(linha, regras) {
  const achados = [];
  regras.forEach((r, prioridade) => {
    r.re.lastIndex = 0;
    for (const m of linha.matchAll(r.re)) achados.push({ ini: m.index, fim: m.index + m[0].length, prioridade, r: r.f(m), txt: m[0] });
  });
  achados.sort((a, b) => a.ini - b.ini || a.prioridade - b.prioridade || (b.fim - b.ini) - (a.fim - a.ini));
  const segs = []; let pos = 0;
  for (const a of achados) {
    if (a.ini < pos) continue; // sobreposto: vale o de maior prioridade já aceito
    if (a.ini > pos) segs.push({ t: linha.slice(pos, a.ini), k: 'igual' });
    if (a.r.k === 'trocado') segs.push({ t: a.r.para, k: 'trocado', de: a.txt, motivo: a.r.motivo || 'período do trimestre' });
    else if (a.r.k === 'revisar') segs.push({ t: a.txt, k: 'revisar', motivo: a.r.motivo || 'conferir' });
    else segs.push({ t: a.txt, k: 'igual' });
    pos = a.fim;
  }
  if (pos < linha.length) segs.push({ t: linha.slice(pos), k: 'igual' });
  return segs.length ? segs : [{ t: linha, k: 'igual' }];
}

// texto de uma seção -> parágrafos com segmentos. Trechos entre aspas (texto jurídico) ficam fixos.
function processar(texto, ctx) {
  const fixos = [];
  const protegido = String(texto || '').replace(/[“"][^”"]{20,}[”"]/g, (m) => { fixos.push(m); return '\u0001' + (fixos.length - 1) + '\u0002'; });
  const regras = regrasDe(ctx);
  return protegido.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    if (ctx.perfil === 'fixo') return { segs: [{ t: l.replace(/\u0001(\d+)\u0002/g, (_, i) => fixos[Number(i)]), k: 'fixo' }] };
    const partes = l.split(/(\u0001\d+\u0002)/).filter((x) => x !== '');
    const segs = [];
    for (const p of partes) {
      const q = /^\u0001(\d+)\u0002$/.exec(p);
      if (q) segs.push({ t: fixos[Number(q[1])], k: 'fixo' }); else segs.push(...segmentar(p, regras));
    }
    return { segs };
  });
}
const plano = (par) => par.segs.map((s) => s.t).join('');
const contar = (pars, k) => pars.reduce((n, p) => n + p.segs.filter((s) => s.k === k).length, 0);

// seções do modelo: [{ numero, titulo, texto }] (de parecer-trimestre.textosDoModelo) + texto inteiro do modelo
const SEC_PERFIL = { '1': 'completo', '2': 'fixo', '3': 'completo', '4': 'periodo', '10': 'completo' };

function repasseDoModelo(textoCompleto) {
  const vs = [...String(textoCompleto || '').matchAll(/VALOR DE REPASSE MENSAL[^R\n]*R\$\s*([\d.]+,\d{2})/gi)].map((m) => centDe(m[1]));
  return vs.length && vs.every((v) => v === vs[0]) ? vs[0] : null;
}

// ctx: { modelo: { trimestre, secoes, texto }, triNovo, repasseNovoCent, numeroParecer }
function gerar(ctx) {
  const m = ctx.modelo;
  if (!m) return null;
  const base = { triModelo: m.trimestre, triNovo: ctx.triNovo, repasseModeloCent: repasseDoModelo(m.texto), repasseNovoCent: ctx.repasseNovoCent || null };
  const sec = (n) => (m.secoes || []).find((s) => s.numero === n);
  const out = { secoes: {}, cabecalho: null, sugestoes: [], aviso_repasse: null };
  // cabeçalho: título e objeto, antes da seção 1
  const cab = String(m.texto || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const i1 = cab.findIndex((l) => /^1\.?\s+(DA|DO)\b/i.test(l));
  const topo = cab.slice(0, i1 > 0 ? i1 : 0).filter((l) => !/^--- página/.test(l)).join('\n');
  if (topo) {
    const pars = processar(topo, Object.assign({ perfil: 'completo' }, base)).map((p, idx) => ({ segs: p.segs.flatMap((s) => {
      if (s.k !== 'igual' || idx !== 0) return [s];
      const q = /(N\.?\s*º\s*)(\d+\/\d{4})/i.exec(s.t);
      if (!q) return [s];
      const novo = ctx.numeroParecer ? { t: ctx.numeroParecer, k: 'trocado', de: q[2], motivo: 'número do parecer informado pela analista' } : { t: '[número do parecer a definir]', k: 'revisar', motivo: 'a analista informa o número' };
      return [{ t: s.t.slice(0, q.index + q[1].length), k: 'igual' }, novo, { t: s.t.slice(q.index + q[0].length), k: 'igual' }];
    }) }));
    out.cabecalho = { paragrafos: pars, n_trocas: contar(pars, 'trocado'), n_revisar: contar(pars, 'revisar') };
  }
  for (const n of Object.keys(SEC_PERFIL)) {
    const s = sec(n); if (!s) continue;
    const pars = processar(s.texto, Object.assign({ perfil: SEC_PERFIL[n] }, base));
    out.secoes[n] = { numero: n, titulo: s.titulo, paragrafos: pars, n_trocas: contar(pars, 'trocado'), n_revisar: contar(pars, 'revisar'), fixo: SEC_PERFIL[n] === 'fixo' };
  }
  const s9 = sec('9');
  if (s9) {
    const linhas = s9.texto.split('\n').map((l) => l.trim()).filter(Boolean);
    const intro = []; const itens = []; let atual = null;
    for (const l of linhas) {
      const q = /^(\d+)\.\s+(.*)$/.exec(l);
      if (q && Number(q[1]) === itens.length + 1) { atual = [q[2]]; itens.push(atual); } else if (atual) atual.push(l); else intro.push(l);
    }
    const pars = processar(intro.join('\n'), Object.assign({ perfil: 'completo' }, base));
    out.secoes['9'] = { numero: '9', titulo: s9.titulo, paragrafos: pars, n_trocas: contar(pars, 'trocado'), n_revisar: contar(pars, 'revisar'), fixo: false };
    out.sugestoes = itens.map((it, k) => {
      const ps = processar(it.join(' '), Object.assign({ perfil: 'completo' }, base));
      return { origem: 'modelo (trimestre anterior), item ' + (k + 1), texto: ps.map(plano).join(' '), segs: ps[0].segs, marca: 'sugestão, revisar' };
    });
  }
  const R = base.repasseModeloCent, N = base.repasseNovoCent;
  if (!R) out.aviso_repasse = 'O repasse mensal do modelo não é único ou não foi encontrado: os valores em reais do texto ficam destacados para revisão, sem troca.';
  else if (!N) out.aviso_repasse = 'Repasse do trimestre ainda não informado: os valores do texto não foram trocados.';
  return out;
}

const hashSecao = (s) => U.sha256(JSON.stringify(s.paragrafos.map(plano)));

module.exports = { gerar, processar, plano, hashSecao, valorExtenso, repasseDoModelo, moedaTxt, nomeMeses };
