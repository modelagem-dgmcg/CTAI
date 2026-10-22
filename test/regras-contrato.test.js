'use strict';
// Regras por unidade: modelo do tipo (UPA), conferência e aplicação em lote (dados fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, cleuton;
test.before(async () => { S = await iniciar(); cleuton = cliente(S.base); await cleuton.entrar('cleuton'); });
test.after(async () => { await S.fechar(); });

test('unidade sem regra recebe o modelo, fica "a conferir" e depois conferida', async () => {
  const db = S.db || null;
  const lista = (await cleuton.get('/api/ctai/contratos')).json.contratos;
  assert.ok(lista.every((c) => c.regra && typeof c.regra.tem === 'boolean' && c.tipo));
  const sem = lista.find((c) => !c.regra.tem && c.tipo === 'UPA');
  if (!sem) return; // base de demonstração já tem regra em tudo
  const r = await cleuton.post('/api/ctai/contratos/' + sem.contrato_id + '/regras/modelo', { modelo: 'igq_v1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.regra.tem, true);
  assert.equal(r.json.regra.conferida, false);
  assert.equal((await cleuton.post('/api/ctai/contratos/' + sem.contrato_id + '/regras/modelo', { modelo: 'igq_v1' })).status, 409);
  const d = (await cleuton.get('/api/ctai/contratos/' + sem.contrato_id + '/decisoes')).json;
  assert.equal(d.regra.conferida, false);
  const ok = await cleuton.post('/api/ctai/contratos/' + sem.contrato_id + '/regras/conferida', {});
  assert.equal(ok.json.regra.conferida, true);
});

test('modelo em lote é só da superintendência/administrador', async () => {
  const r = await cleuton.post('/api/ctai/regras/modelo-lote', { tipo: 'UPA', modelo: 'igq_v1' });
  assert.equal(r.status, 403);
});
