'use strict';
// Verificações que funcionam sem internet e sem chave. Determinísticas: o mesmo texto gera os mesmos achados.
const { extensoParaNumero } = require('./extenso');
const U = require('../../core/util');

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const recorte = (t, i, f) => String(t).slice(Math.max(0, i), Math.min(String(t).length, f)).replace(/\s+/g, ' ').trim();

const SETOR_POR_TEMA = [
  [/vermelh|amarel|verde|classifica|espera|ecg|iam|ave|sepse|retorno|dor tor/i, 'assistencia'],
  [/pnsp|seguran|[oó]bito|prontu/i, 'qualidade'],
  [/satisfa|queixa|ouvidoria|transpar/i, 'ouvidoria'],
  [/educa|capacit|ades/i, 'educacao'],
  [/bid|transfer|remo[cç]/i, 'bid'],
  [/pessoal|escala|quadro|folha/i, 'rh'],
];
function setorSugerido(s) { for (const [re, setor] of SETOR_POR_TEMA) if (re.test(s)) return setor; return null; }

function achado(gravidade, tipo, trecho, risco, sugestao) {
  return { gravidade, tipo, trecho, risco, sugestao, setor_sugerido: setorSugerido(tipo + ' ' + trecho) };
}

function verificarExtenso(texto, out) {
  // R$ 1.647.464,17 (um milhão, ... ) | 63% (sessenta e três por cento) | 12 (doze)
  const re = /(R\$\s*[\d.]+(?:,\d{1,2})?|\d[\d.]*(?:,\d+)?\s*%|\b\d[\d.]*\b)\s*\(([^()]{3,200})\)/g;
  let m;
  while ((m = re.exec(texto))) {
    const ext = extensoParaNumero(m[2]);
    if (ext === null) continue;
    const num = U.numero(m[1].replace(/R\$/, '').replace('%', ''));
    if (num === null) continue;
    if (Math.abs(num - ext) > 0.005) {
      out.push(achado('ALTA', 'Valor por extenso diferente do numérico', recorte(texto, m.index, m.index + m[0].length + 10),
        'O número e o extenso não dizem a mesma coisa (' + U.formatarNumero(num) + ' contra ' + U.formatarNumero(ext) + '). Em documento oficial, vale o extenso.', 'Peça a correção do valor ou do extenso antes de aceitar o documento.'));
    }
  }
}

function verificarProporcoes(texto, out) {
  const re = /(\d[\d.]*)\s+de\s+(?:um total de\s+)?(\d[\d.]*)\s*\((\d+(?:,\d+)?)\s*%\)/g;
  let m;
  while ((m = re.exec(texto))) {
    const x = U.numero(m[1]), y = U.numero(m[2]), z = U.numero(m[3]);
    if (!y || x === null || z === null) continue;
    const real = (x / y) * 100;
    if (Math.abs(real - z) > 0.6) out.push(achado(Math.abs(real - z) > 3 ? 'ALTA' : 'MÉDIA', 'Percentual que não bate com a conta', recorte(texto, m.index, m.index + m[0].length),
      m[1] + ' de ' + m[2] + ' dá ' + U.formatarNumero(real, 1) + '%, e o texto diz ' + m[3] + '%.', 'Confira os números de origem e peça o cálculo.'));
  }
}

function verificarTabelas(tabelas, out) {
  for (const t of tabelas || []) {
    const linhas = t.linhas || [];
    if (linhas.length < 3) continue;
    const ult = linhas[linhas.length - 1];
    if (!/total/i.test(String(ult[0]))) continue;
    for (let c = 1; c < (t.colunas || []).length; c++) {
      const tot = U.numero(ult[c]);
      if (tot === null) continue;
      const partes = linhas.slice(0, -1).map((l) => U.numero(l[c]));
      if (partes.some((p) => p === null)) continue;
      const soma = partes.reduce((s, p) => s + p, 0);
      if (Math.abs(soma - tot) > Math.max(0.01, Math.abs(tot) * 0.0005)) {
        out.push(achado('ALTA', 'Soma da tabela não fecha', (t.titulo ? t.titulo + ' · ' : '') + 'coluna "' + t.colunas[c] + '": total ' + U.formatarNumero(tot) + ', soma das linhas ' + U.formatarNumero(soma),
          'O total informado difere da soma das linhas em ' + U.formatarNumero(Math.abs(soma - tot)) + '.', 'Peça a tabela corrigida ou a explicação da diferença.'));
      }
    }
  }
}

function verificarMeses(texto, contexto, out) {
  const comp = contexto && contexto.competencia;
  if (!comp) return;
  const [ano, mes] = comp.split('-').map(Number);
  const re = new RegExp('(compet[eê]ncia|referente (?:a|ao)|relat[oó]rio d[eo]|m[eê]s de|per[ií]odo de)\\s+(?:de\\s+)?(' + MESES.join('|') + ')(?:\\s+de\\s+(\\d{4}))?', 'gi');
  const textoSem = semAcento(texto);
  let m;
  const sem = new RegExp('(competencia|referente (?:a|ao)|relatorio d[eo]|mes de|periodo de)\\s+(?:de\\s+)?(' + MESES.join('|') + ')(?:\\s+de\\s+(\\d{4}))?', 'gi');
  while ((m = sem.exec(textoSem))) {
    const idx = MESES.indexOf(m[2]) + 1;
    const a = m[3] ? Number(m[3]) : ano;
    if (idx !== mes || a !== ano) {
      out.push(achado(a > ano || (a === ano && idx > mes) ? 'ALTA' : 'MÉDIA', 'Mês citado diferente da competência', recorte(texto, m.index, m.index + m[0].length + 10),
        'O documento é da competência ' + comp + ' e cita ' + m[2] + (m[3] ? ' de ' + m[3] : '') + ' como referência.', 'Confira se é o relatório do mês certo ou se houve cópia de outro mês.'));
    }
  }
  void re;
}

function verificarCor(texto, contexto, out) {
  const v = contexto && contexto.valores;
  if (!v) return;
  const re = /vermelh[oa]s?[^.\n]{0,80}?(\d+(?:[.,]\d+)?)\s*(?:min|minutos)/gi;
  let m;
  while ((m = re.exec(texto))) {
    const n = U.numero(m[1]);
    for (const cor of ['verde', 'amarelo']) {
      if (v[cor] !== undefined && v[cor] !== null && n !== null && Math.abs(Number(v[cor]) - n) < 0.005 && (v.vermelho === undefined || Math.abs(Number(v.vermelho) - n) > 0.005)) {
        out.push(achado('ALTA', 'Valor de outra cor citado como vermelho', recorte(texto, m.index, m.index + m[0].length),
          'O número ' + m[1] + ' é o da classificação ' + cor + ', não da vermelha' + (v.vermelho !== undefined ? ' (' + U.formatarNumero(v.vermelho) + ' min)' : '') + '.', 'Peça a conferência do valor vermelho com a fonte.'));
      }
    }
  }
}

function verificarTransparencia(texto, contexto, out) {
  const nivel = contexto && contexto.transparencia;
  if (!nivel) return;
  const re = /transpar[eê]ncia[^.\n]{0,100}?(Desejado|Moderado|Intermedi[aá]rio|Insuficiente|Cr[ií]tico)/gi;
  let m;
  while ((m = re.exec(texto))) {
    if (semAcento(m[1]) !== semAcento(nivel)) out.push(achado('ALTA', 'Nível de transparência diferente da ficha', recorte(texto, m.index, m.index + m[0].length),
      'O texto diz "' + m[1] + '" e a ficha de avaliação diz "' + nivel + '".', 'Confira a Ficha de Avaliação de Transparência do mês.'));
  }
}

function normalizar(s) { return semAcento(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function trechosLongos(texto) {
  return String(texto).split(/(?<=[.!?])\s+|\n{2,}/).map((s) => s.trim()).filter((s) => normalizar(s).length >= 110);
}

function verificarCopias(texto, contexto, out) {
  const proprios = trechosLongos(texto);
  const vistos = new Map();
  for (const t of proprios) {
    const k = normalizar(t);
    if (vistos.has(k)) out.push(achado('MÉDIA', 'Trecho repetido no mesmo documento', t.slice(0, 220), 'A mesma frase aparece mais de uma vez; pode ser texto copiado e colado.', 'Pergunte à unidade se o trecho vale para os dois casos.'));
    vistos.set(k, true);
  }
  for (const o of (contexto && contexto.outrosTextos) || []) {
    const outros = new Set(trechosLongos(o.texto).map(normalizar));
    for (const t of proprios) if (outros.has(normalizar(t))) {
      out.push(achado('MÉDIA', 'Trecho copiado de outro documento', t.slice(0, 220), 'O mesmo texto, palavra por palavra, aparece em ' + (o.id || 'outro documento') + '. Pode ser cópia sem atualizar os fatos do mês.', 'Peça à unidade a análise própria desta competência.'));
    }
  }
}

function analisar({ texto, tabelas, contexto }) {
  const out = [];
  const t = String(texto || '');
  verificarExtenso(t, out);
  verificarProporcoes(t, out);
  verificarTabelas(tabelas, out);
  verificarMeses(t, contexto, out);
  verificarCor(t, contexto, out);
  verificarTransparencia(t, contexto, out);
  verificarCopias(t, contexto, out);
  // Sem duplicatas exatas.
  const seen = new Set();
  return out.filter((a) => { const k = a.tipo + '|' + a.trecho; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { analisar };
