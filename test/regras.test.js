'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const R = require('../core/regras');

const regras = R.carregarRegras();
const perto = (a, b) => Math.abs(a - b) < 0.005;

test('os três descontos de maio e junho da UPA Olinda são reproduzidos', () => {
  const fixo = R.descontoPeriodo(regras, [{ competencia: '2026-05', igq: 63 }, { competencia: '2026-06', igq: 57 }], 'fixo');
  assert.ok(perto(fixo.total, 329492.83), 'parecer 10% fixo: ' + fixo.total);
  const planilha = R.descontoPeriodo(regras, [{ competencia: '2026-05', igq: 65 }, { competencia: '2026-06', igq: 64 }], 'faixa');
  assert.ok(perto(planilha.total, 197695.70), 'planilha por faixa: ' + planilha.total);
  const faixas = R.descontoPeriodo(regras, [{ competencia: '2026-05', igq: 63 }, { competencia: '2026-06', igq: 57 }], 'faixa');
  assert.ok(perto(faixas.total, 230644.98), 'faixas com 63 e 57: ' + faixas.total);
});

test('abril é mês de implantação e não gera desconto', () => {
  const d = R.descontoPeriodo(regras, [{ competencia: '2026-04', igq: 42, implantacao: true }], 'fixo');
  assert.equal(d.total, 0);
});

test('os máximos somam 100 e a eficiência de abril é 20', () => {
  assert.equal(regras.indicadores.reduce((s, i) => s + i.max, 0), 100);
  const abril = R.calcularIGQ(regras, { '2.1': 26.73, '2.2': 26.28, '2.3': 23.51, '2.4': 0.15, '2.5': true });
  assert.equal(abril.total, 20);
});

test('faixas de pagamento', () => {
  assert.equal(R.percentualPago(regras, 95), 10);
  assert.equal(R.percentualPago(regras, 89), 8);
  assert.equal(R.percentualPago(regras, 60), 4);
  assert.equal(R.percentualPago(regras, 49), 0);
});

test('vermelho: por faixa ou só a meta, conforme a decisão', () => {
  const ind = regras.indicadores.find((i) => i.id === '2.3');
  const porFaixa = R.pontosIndicador(ind, 9.92, { vermelho: 'faixa' });
  const binario = R.pontosIndicador(ind, 9.92, { vermelho: 'binario' });
  assert.ok(porFaixa > binario, 'por faixa dá ' + porFaixa + ' e só a meta dá ' + binario);
});

test('integridade: zero sem motivo, acima do máximo e implantação com desconto', () => {
  const e = R.validarIntegridade(regras, { mes_implantacao: true }, [{ indicador_id: '2.1', pontos_adotados: 0 }, { indicador_id: '2.2', pontos_adotados: 99 }], { desconto_valor: 10 });
  const codigos = e.map((x) => x.codigo);
  assert.ok(codigos.includes('ZERO_SEM_MOTIVO') && codigos.includes('ACIMA_DO_MAXIMO') && codigos.includes('IMPLANTACAO_COM_DESCONTO'));
});
