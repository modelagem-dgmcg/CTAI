'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { interpretar, verificado } = require('../modules/analista/propor-ficha');

const campos = [
  { id: 'a', rotulo: 'A', tipo: 'inteiro' },
  { id: 'b', rotulo: 'B', tipo: 'sim_nao' },
  { id: 'c', rotulo: 'C', tipo: 'selecao', opcoes: ['x', 'y'] },
  { id: 'd', rotulo: 'D', tipo: 'percentual' },
];

test('interpreta a resposta da IA só com campos válidos e marca números achados no texto', () => {
  const o = interpretar('```json\n{"a":"1.234","b":"Sim","c":"z","d":"abc","zz":"1"}\n```', campos, 'total de 1.234 atendimentos');
  assert.deepEqual(Object.keys(o).sort(), ['a', 'b']);
  assert.equal(o.a.verificado, true);
  assert.equal(o.b.valor, 'sim');
});

test('número ausente do texto não é verificado', () => {
  assert.equal(verificado('99', 'nada aqui 12'), false);
  assert.equal(verificado('12,5', 'taxa 12,5%'), true);
});
