'use strict';
// Motor de regras do IGQ e do desconto. Não acessa banco nem dado de paciente.
// Lê as regras de regras/igq_v1.json (ou de um objeto já carregado).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function carregarRegras(arquivoOuObjeto) {
  if (arquivoOuObjeto && typeof arquivoOuObjeto === 'object') return arquivoOuObjeto;
  const p = arquivoOuObjeto || path.join(RAIZ, 'regras', 'igq_v1.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function arredondar2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function vazio(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

// opcoes:
//   vermelho: 'faixa' (padrão, ficha do contrato) ou 'binario' (cumpre a meta = máximo; senão 0)
//   iamMeta: minutos da meta do porta-saída IAMCSST (padrão: a da regra, 30)
function pontosIndicador(ind, valor, opcoes) {
  const op = opcoes || {};
  if (vazio(valor)) return 0;
  switch (ind.tipo) {
    case 'binario':
      return (valor === true || valor === 'sim' || valor === 1 || valor === '1') ? ind.max : 0;
    case 'categorico':
      return ind.categorias[valor] || 0;
    case 'faixa_menor_melhor': {
      const v = Number(valor);
      if (Number.isNaN(v)) return 0;
      let faixas = ind.faixas;
      if (ind.id === '2.3' && op.vermelho === 'binario') faixas = [{ ate: ind.faixas[0].ate, pontos: ind.max }];
      if (ind.id === '2.7' && op.iamMeta) faixas = [{ ate: Number(op.iamMeta), pontos: ind.max }];
      for (const f of faixas) if (v <= f.ate) return f.pontos;
      return 0;
    }
    case 'faixa_maior_melhor': {
      const v = Number(valor);
      if (Number.isNaN(v)) return 0;
      for (const f of ind.faixas) {
        const ok = f.de_exclusivo !== undefined ? v > f.de_exclusivo : v >= f.de;
        if (ok) return f.pontos;
      }
      return 0;
    }
    default:
      throw new Error('tipo de indicador desconhecido: ' + ind.tipo);
  }
}

// valores: { '2.1': 26.73, ... } -> { total, porIndicador }
function calcularIGQ(regras, valores, opcoes) {
  const porIndicador = {};
  let total = 0;
  for (const ind of regras.indicadores) {
    const p = pontosIndicador(ind, valores[ind.id], opcoes);
    porIndicador[ind.id] = p;
    total += p;
  }
  return { total, porIndicador };
}

// Soma de pontos já definidos (ex.: pontos adotados pela CTAI), respeitando o máximo de cada item.
function somarPontos(regras, pontos) {
  let total = 0;
  for (const ind of regras.indicadores) {
    const p = Number(pontos[ind.id] || 0);
    total += Math.min(p, ind.max);
  }
  return total;
}

// Faixa de pagamento (% pago da parcela de qualidade) para um IGQ total.
function percentualPago(regras, igq) {
  const n = Math.floor(igq);
  for (const f of regras.faixas_pagamento) if (n >= f.igq_min && n <= f.igq_max) return f.paga_pct;
  return 0;
}

// modo 'faixa' (planilha) ou 'fixo' (parecer: 10% quando o IGQ não chega a 90).
// O valor sai sem arredondar; some os meses e arredonde só no fim (o parecer soma assim).
function descontoMensal(regras, igq, modo, base) {
  const b = base !== undefined ? base : regras.base_desconto_mensal.valor;
  let pct;
  if (modo === 'fixo') pct = igq >= 90 ? 0 : 10;
  else pct = 10 - percentualPago(regras, igq);
  // O parecer 204/2026 aplicou 10% a IGQ 63 e 57. Em modo 'fixo' abaixo de 90 o desconto é 10%.
  return { pct, valor: (b * pct) / 100 };
}

// Soma o desconto de vários meses. meses: [{ igq, implantacao }]
function descontoPeriodo(regras, meses, modo, base) {
  let total = 0;
  const detalhe = [];
  for (const m of meses) {
    if (m.implantacao) {
      detalhe.push({ competencia: m.competencia, igq: m.igq, pct: 0, valor: 0, implantacao: true });
      continue;
    }
    const d = descontoMensal(regras, m.igq, modo, base);
    total += d.valor;
    detalhe.push({ competencia: m.competencia, igq: m.igq, pct: d.pct, valor: d.valor, implantacao: false });
  }
  return { total: arredondar2(total), detalhe };
}

// Matriz de cenários: linhas = origem do IGQ; colunas = modo de desconto.
// fontes: { rotuloDaLinha: [{competencia, igq, implantacao}] }
function cenariosDesconto(regras, fontes, base) {
  const linhas = [];
  for (const [rotulo, meses] of Object.entries(fontes)) {
    linhas.push({
      origem: rotulo,
      igqs: meses.map((m) => ({ competencia: m.competencia, igq: m.igq })),
      faixa: descontoPeriodo(regras, meses, 'faixa', base),
      fixo: descontoPeriodo(regras, meses, 'fixo', base),
    });
  }
  const valores = new Set();
  for (const l of linhas) { valores.add(l.faixa.total); valores.add(l.fixo.total); }
  return { linhas, valoresDistintos: [...valores].sort((a, b) => a - b) };
}

// Regras de integridade do esquema. Retorna lista de { codigo, mensagem, gravidade }.
// ctai: [{ indicador_id, pontos_adotados, motivo_do_zero, origem, justificativa }]
function validarIntegridade(regras, competencia, ctai, desconto) {
  const erros = [];
  const porId = Object.fromEntries(regras.indicadores.map((i) => [i.id, i]));
  let soma = 0;
  for (const linha of ctai || []) {
    const ind = porId[linha.indicador_id];
    if (!ind) { erros.push({ codigo: 'INDICADOR_DESCONHECIDO', mensagem: 'Indicador ' + linha.indicador_id + ' não existe na regra.', gravidade: 'alta' }); continue; }
    const p = Number(linha.pontos_adotados);
    if (p > ind.max) erros.push({ codigo: 'ACIMA_DO_MAXIMO', mensagem: 'Indicador ' + ind.id + ' tem ' + p + ' pontos; o máximo é ' + ind.max + '.', gravidade: 'alta' });
    if (p === 0 && !String(linha.motivo_do_zero || '').trim()) erros.push({ codigo: 'ZERO_SEM_MOTIVO', mensagem: 'Indicador ' + ind.id + ' está com zero ponto e sem motivo registrado.', gravidade: 'alta' });
    if (linha.origem === 'ajuste manual' && !String(linha.justificativa || '').trim()) erros.push({ codigo: 'AJUSTE_SEM_JUSTIFICATIVA', mensagem: 'Indicador ' + ind.id + ' foi ajustado à mão sem justificativa.', gravidade: 'alta' });
    soma += Math.min(p, ind.max);
  }
  if (soma > 100) erros.push({ codigo: 'SOMA_ACIMA_DE_100', mensagem: 'A soma dos pontos adotados passa de 100.', gravidade: 'alta' });
  if (competencia && competencia.mes_implantacao && desconto && Number(desconto.desconto_valor) > 0) {
    erros.push({ codigo: 'IMPLANTACAO_COM_DESCONTO', mensagem: 'Mês de implantação não gera desconto.', gravidade: 'alta' });
  }
  return erros;
}

// Texto curto com as faixas de um indicador, para telas e PDFs.
function descricaoFaixas(ind) {
  const u = ind.unidade ? ' ' + ind.unidade : '';
  switch (ind.tipo) {
    case 'binario': return 'Atende: ' + ind.max + ' ponto(s); não atende: 0';
    case 'categorico': return Object.entries(ind.categorias).map(([k, v]) => k + ' ' + v).join(' · ');
    case 'faixa_menor_melhor': return ind.faixas.map((f) => 'até ' + f.ate + u + ': ' + f.pontos).join(' · ') + ' · acima: 0';
    case 'faixa_maior_melhor': return ind.faixas.map((f) => (f.de_exclusivo !== undefined ? 'acima de ' + f.de_exclusivo : 'a partir de ' + f.de) + u + ': ' + f.pontos).join(' · ') + ' · abaixo: 0';
    default: return '';
  }
}

// Pendências da regra que o usuário precisa ver na tela.
function pendencias(regras) {
  const lista = [];
  if (regras.base_desconto_mensal && regras.base_desconto_mensal.pendente) lista.push({ onde: 'Base do desconto', texto: regras.base_desconto_mensal.pendente });
  if (regras.pendente_desconto) lista.push({ onde: 'Conversão do IGQ em desconto', texto: regras.pendente_desconto });
  for (const i of regras.indicadores) if (i.pendente) lista.push({ onde: i.id + ' ' + i.nome, texto: i.pendente });
  return lista;
}

module.exports = {
  arredondar2, carregarRegras, pontosIndicador, calcularIGQ, somarPontos, percentualPago,
  descontoMensal, descontoPeriodo, cenariosDesconto, validarIntegridade, pendencias, descricaoFaixas,
};
