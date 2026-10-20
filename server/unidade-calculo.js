'use strict';
// Cálculo do LADO DA UNIDADE. Serve para o gestor ver os valores reunidos e para gerar o PDF.
// É deliberadamente separado de core/recalculo.js, que é o módulo da CTAI: quem lança não confere o próprio trabalho.
const R = require('../core/regras');
const U = require('../core/util');

const SPEC = {
  '2.1': { campo: 'i2_1_valor', tipo: 'tempo', fonte: 'classificacao', cor: 'verde' },
  '2.2': { campo: 'i2_2_valor', tipo: 'tempo', fonte: 'classificacao', cor: 'amarelo' },
  '2.3': { campo: 'i2_3_valor', tipo: 'tempo', fonte: 'classificacao', cor: 'vermelho' },
  '2.4': { campo: 'i2_4_valor', tipo: 'retorno' },
  '2.5': { campo: 'i2_5_valor', tipo: 'simnao' },
  '2.6': { campo: 'i2_6_valor', tipo: 'tempo', fonte: 'dor_toracica' },
  '2.7': { campo: 'i2_7_valor', tipo: 'tempo', fonte: 'iamcsst' },
  '2.8': { campo: 'i2_8_valor', tipo: 'tempo', fonte: 'ave' },
  '2.9': { campo: 'i2_9_valor', tipo: 'tempo', fonte: 'sepse' },
  '2.10': { campo: 'i2_10_valor', tipo: 'obitos' },
  '2.11': { campo: 'i2_11_valor', tipo: 'razao', num: 'satisfacao_satisfeitos', den: 'satisfacao_respondentes' },
  '2.12': { campo: 'i2_12_valor', tipo: 'razao', num: 'queixas_aceitas', den: 'queixas_identificadas' },
  '2.13': { campo: 'i2_13_valor', tipo: 'texto' },
  '2.14': { campo: 'i2_14_valor', tipo: 'razao', num: 'educ_realizadas', den: 'educ_previstas' },
  '2.15': { campo: 'i2_15_valor', tipo: 'razao', num: 'educ_capacitados_assist', den: 'educ_ativos_assist' },
  '2.16': { campo: 'i2_16_valor', tipo: 'razao', num: 'educ_capacitados_adm', den: 'educ_ativos_adm' },
};

function mediaMinutos(linhas) {
  const xs = [];
  for (const l of linhas) {
    let m = l.minutos;
    if (m === null || m === undefined) m = U.minutosEntre(l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim);
    if (m !== null && m !== undefined && m >= 0) xs.push(Number(m));
  }
  return xs.length ? { valor: U.arred(U.media(xs), 2), n: xs.length } : null;
}

// Devolve { '2.1': { valor, origem, n }, ... }. origem: 'digitado' | 'apoio' | 'linhas' | null
function consolidarDeclarados(flat, linhas) {
  const out = {};
  for (const [id, s] of Object.entries(SPEC)) {
    const digitado = flat[s.campo];
    const temDigitado = digitado !== undefined && digitado !== null && digitado !== '';
    let valor = null, origem = null, n = null;
    if (temDigitado) {
      valor = s.tipo === 'simnao' ? (U.simNao(digitado)) : (s.tipo === 'texto' ? String(digitado) : U.numero(digitado));
      origem = 'digitado';
    } else if (s.tipo === 'tempo') {
      let ls = (linhas[s.fonte] || []);
      if (s.cor) ls = ls.filter((l) => l.categoria === s.cor);
      const m = mediaMinutos(ls);
      if (m) { valor = m.valor; origem = 'linhas'; n = m.n; }
    } else if (s.tipo === 'retorno') {
      const ls = linhas.retorno || [];
      if (ls.length) { valor = U.arred((ls.filter((l) => l.categoria === 'sim').length / ls.length) * 100, 2); origem = 'linhas'; n = ls.length; }
    } else if (s.tipo === 'obitos') {
      const ls = linhas.obitos || [];
      if (ls.length) {
        const elig = ls.filter((l) => { const m = U.minutosEntre(l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim); return m !== null && m / 60 >= 24; });
        if (elig.length) { valor = U.arred((elig.filter((l) => l.categoria === 'sim').length / elig.length) * 100, 1); origem = 'linhas'; n = elig.length; }
      } else {
        const e = U.numero(flat.obitos_24h), r = U.numero(flat.obitos_24h_revisados);
        if (e && r !== null) { valor = U.arred((r / e) * 100, 1); origem = 'apoio'; }
      }
    } else if (s.tipo === 'razao') {
      const num = U.numero(flat[s.num]), den = U.numero(flat[s.den]);
      if (den && num !== null) { valor = U.arred((num / den) * 100, 2); origem = 'apoio'; }
    }
    out[id] = { valor, origem, n, anexo: flat['i' + id.replace('.', '_') + '_anexo'] || null };
  }
  return out;
}

// Pontos que a própria unidade teria pelas regras do contrato (só informativo no relatório).
function pontosDeclarados(regras, consolidado) {
  const porIndicador = {};
  let total = 0;
  for (const ind of regras.indicadores) {
    const c = consolidado[ind.id];
    const v = c ? c.valor : null;
    let p = 0;
    if (v !== null && v !== undefined) p = R.pontosIndicador(ind, v);
    porIndicador[ind.id] = p;
    total += p;
  }
  return { total, porIndicador };
}

// Avisos que o gestor vê antes de enviar (não impedem o envio, exceto os marcados como bloqueio).
function conferirAntesDoEnvio(flat, linhas, consolidado) {
  const avisos = [];
  for (const [id, s] of Object.entries(SPEC)) {
    const c = consolidado[id];
    if (!c || c.valor === null || c.valor === undefined) { avisos.push({ nivel: 'atencao', indicador: id, mensagem: 'Indicador ' + id + ' sem valor. Preencha a ficha ou suba as linhas.' }); continue; }
    if (s.tipo === 'tempo' || s.tipo === 'retorno') {
      const doCalc = (() => {
        let ls = (linhas[s.fonte || 'retorno'] || []);
        if (s.cor) ls = ls.filter((l) => l.categoria === s.cor);
        if (s.tipo === 'retorno') return ls.length ? (ls.filter((l) => l.categoria === 'sim').length / ls.length) * 100 : null;
        const m = mediaMinutos(ls);
        return m ? m.valor : null;
      })();
      if (c.origem === 'digitado' && doCalc !== null && Math.abs(doCalc - c.valor) / Math.max(Math.abs(c.valor), 1e-9) > 0.1) {
        avisos.push({ nivel: 'atencao', indicador: id, mensagem: 'O valor digitado (' + U.formatarNumero(c.valor) + ') difere em mais de 10% do calculado pelas linhas (' + U.formatarNumero(doCalc) + '). Confira antes de enviar.' });
      }
    }
    if (c.anexo === null && s.tipo !== 'texto') avisos.push({ nivel: 'info', indicador: id, mensagem: 'Indicador ' + id + ' sem anexo de comprovação.' });
  }
  const bid = U.numero(flat.bid_remocoes), tr = (linhas.transferencias || []).length;
  if (bid && tr && tr < bid) avisos.push({ nivel: 'atencao', indicador: null, mensagem: 'A lista de transferências tem ' + tr + ' linha(s) e o BID registra ' + bid + ' remoções.' });
  if (U.numero(flat.gasto_pessoal_pct) > 80) avisos.push({ nivel: 'atencao', indicador: null, mensagem: 'Gasto com pessoal acima do limite de 80%.' });
  return avisos;
}

// Resumo simples por fonte (e por cor, na classificação) para o relatório da unidade.
function resumoPorFonte(linhas) {
  const out = {};
  const stats = (ls) => {
    const xs = [];
    for (const l of ls) {
      let m = l.minutos;
      if (m === null || m === undefined) m = U.minutosEntre(l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim);
      if (m !== null && m !== undefined && m >= 0) xs.push(Number(m));
    }
    return { n: ls.length, comTempo: xs.length, media: xs.length ? U.arred(U.media(xs), 2) : null, mediana: xs.length ? U.arred(U.mediana(xs), 2) : null, maximo: xs.length ? U.arred(U.maximo(xs), 2) : null };
  };
  for (const [fonte, ls] of Object.entries(linhas)) {
    out[fonte] = stats(ls);
    if (fonte === 'classificacao') {
      out[fonte].porCor = {};
      for (const cor of ['vermelho', 'laranja', 'amarelo', 'verde', 'azul', 'fast-track']) {
        const sub = ls.filter((l) => l.categoria === cor);
        if (sub.length) out[fonte].porCor[cor] = stats(sub);
      }
    }
  }
  return out;
}

module.exports = { resumoPorFonte, SPEC, consolidarDeclarados, pontosDeclarados, conferirAntesDoEnvio, mediaMinutos };
