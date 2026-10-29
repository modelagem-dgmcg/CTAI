'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrir, envolver } = require('../server/db');
const { limpar } = require('../server/limpeza-exemplos');

test('remove unidade de exemplo sem dados e preserva as demais', () => {
  const db = envolver(abrir(':memory:'));
  const nova = (id, nome, demo) => db.run('INSERT INTO contratos (contrato_id, unidade, tipo, municipio, demo, criado_por, criado_em) VALUES (?,?,?,?,?,?,?)', id, nome, 'UPA', null, demo, 'x', '2026-01-01');
  nova('a1', 'UPA Exemplo Alfa', 0); nova('a2', 'UPAE Exemplo Beta', 0); nova('a3', 'UPA Igarassu', 0); nova('a4', 'UPA Exemplo Gama', 1);
  const r = limpar(db);
  assert.deepEqual(r.sort(), ['UPA Exemplo Alfa', 'UPAE Exemplo Beta']);
  const resta = db.all('SELECT contrato_id FROM contratos').map((x) => x.contrato_id).sort();
  assert.deepEqual(resta, ['a3', 'a4']);
});
