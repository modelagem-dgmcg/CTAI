// Calculadora de pontos do IGQ e do desconto. Lê as regras de regras/igq_v1.json.
// Não acessa dados de paciente. Uso: const igq = require('./igq.js')
const fs = require('fs');
const path = require('path');

function carregarRegras(arquivo) {
  const p = arquivo || path.join(__dirname, '..', 'regras', 'igq_v1.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Pontos de um indicador a partir do valor medido. Valor null/undefined = sem dado = 0.
function pontosIndicador(ind, valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  switch (ind.tipo) {
    case 'binario':
      return valor ? ind.max : 0;
    case 'categorico':
      return ind.categorias[valor] || 0;
    case 'faixa_menor_melhor': {
      const v = Number(valor);
      for (const f of ind.faixas) if (v <= f.ate) return f.pontos;
      return 0;
    }
    case 'faixa_maior_melhor': {
      const v = Number(valor);
      for (const f of ind.faixas) {
        const ok = f.de_exclusivo !== undefined ? v > f.de_exclusivo : v >= f.de;
        if (ok) return f.pontos;
      }
      return 0;
    }
    default:
      throw new Error('tipo desconhecido: ' + ind.tipo);
  }
}

// valores: { '2.1': 26.73, '2.2': 26.28, ... } -> { total, porIndicador }
function calcularIGQ(regras, valores) {
  const porIndicador = {};
  let total = 0;
  for (const ind of regras.indicadores) {
    const p = pontosIndicador(ind, valores[ind.id]);
    porIndicador[ind.id] = p;
    total += p;
  }
  return { total, porIndicador };
}

// Faixa de pagamento (% pago da parcela de qualidade) para um IGQ total.
function percentualPago(regras, igq) {
  const n = Math.floor(igq);
  for (const f of regras.faixas_pagamento) if (n >= f.igq_min && n <= f.igq_max) return f.paga_pct;
  return 0;
}

// modo 'faixa' (planilha) ou 'fixo' (parecer: desconta 10% quando o IGQ não chega ao máximo da faixa).
function descontoMensal(regras, igq, modo, base) {
  const b = base !== undefined ? base : regras.base_desconto_mensal.valor;
  let pct;
  if (modo === 'fixo') pct = 10;
  else pct = 10 - percentualPago(regras, igq);
  // valor sem arredondar: some os meses e só então arredonde (o parecer soma assim: 329.492,83)
  return { pct, valor: b * pct / 100 };
}

function arredondar2(x) { return Math.round(x * 100) / 100; }

module.exports = { arredondar2, carregarRegras, pontosIndicador, calcularIGQ, percentualPago, descontoMensal };
