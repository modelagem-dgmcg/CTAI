'use strict';
// Orientação da CTAI: de 2.1 a 2.9 a unidade informa numerador, denominador e resultado; 2.15 e 2.16 usam convocados.
const test = require('node:test');
const assert = require('node:assert');
const UC = require('../server/unidade-calculo');
const O = require('../core/obrigatorios');

test('só o resultado digitado gera aviso e deixa o item incompleto', () => {
  const flat = { i2_2_valor: '39,5' };
  const cons = UC.consolidarDeclarados(flat, {});
  assert.strictEqual(cons['2.2'].origem, 'digitado');
  const avisos = UC.conferirAntesDoEnvio(flat, {}, cons);
  assert.ok(avisos.some((a) => a.indicador === '2.2' && /numerador/.test(a.mensagem)));
  const item = O.ITENS.find((i) => i.id === 'eficiencia');
  assert.ok(O.faltas(item, flat, cons, {}).some((f) => /numerador e denominador/.test(f)));
});

test('soma e número de pacientes calculam o resultado quando ele não foi digitado', () => {
  const flat = { i2_3_soma: '736,58', i2_3_n: '183' };
  const cons = UC.consolidarDeclarados(flat, {});
  assert.strictEqual(cons['2.3'].origem, 'apoio');
  assert.ok(cons["2.3"].valor === 4.03);
});

test('resultado que não bate com soma ÷ pacientes gera aviso', () => {
  const flat = { i2_3_valor: '9,9', i2_3_soma: '736,58', i2_3_n: '183' };
  const cons = UC.consolidarDeclarados(flat, {});
  const avisos = UC.conferirAntesDoEnvio(flat, {}, cons);
  assert.ok(avisos.some((a) => a.indicador === '2.3' && /não bate/.test(a.mensagem)));
});

test('retorno em 24 h usa retornos ÷ atendimentos', () => {
  const cons = UC.consolidarDeclarados({ i2_4_retornos: '19', i2_4_saidas: '12456' }, {});
  assert.ok(Math.abs(cons['2.4'].valor - 0.15) < 0.01);
});

test('com numerador e denominador o item de eficiência não fica incompleto por isso', () => {
  const flat = { i2_1_valor: '26,73', i2_1_soma: '205777', i2_1_n: '7699', i2_2_valor: '26,28', i2_2_soma: '108911', i2_2_n: '4145', i2_3_valor: '23,51', i2_3_soma: '6323', i2_3_n: '269', i2_1_anexo: 'SEI 1', i2_2_anexo: 'SEI 1', i2_3_anexo: 'SEI 1' };
  const cons = UC.consolidarDeclarados(flat, {});
  const item = O.ITENS.find((i) => i.id === 'eficiencia');
  assert.strictEqual(O.situacaoSugerida(item, flat, cons, {}), 'recebido');
});
