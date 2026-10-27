'use strict';
// Funcionário de setor vê só o seu setor; o gestor da unidade continua vendo tudo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
let S, g, a;
test.before(async () => { S = await iniciar(); g = cliente(S.base); a = cliente(S.base); await g.entrar('gestor.demo'); await a.entrar('assistencia.demo'); });
test.after(async () => { await S.fechar(); });

test('o resumo do mês mostra só o setor do funcionário; o gestor vê todos', async () => {
  const cid = (await g.get('/api/unidade/competencias')).json.competencias[0].cid;
  const todos = (await g.get('/api/unidade/competencias/' + cid)).json;
  const meu = (await a.get('/api/unidade/competencias/' + cid)).json;
  assert.ok(todos.setores.length > 1);
  assert.deepEqual(meu.setores.map((s) => s.id), ['assistencia']);
  assert.equal(meu.consolidado, null); assert.equal(meu.pontos, null);
  assert.deepEqual(meu.envios, []); assert.deepEqual(meu.bloqueios, []);
  // as listas (fontes) de outros setores não aparecem
  const F = require('../core/formularios');
  for (const f of Object.keys(meu.contagem)) assert.equal(F.FONTES[f].setor, 'assistencia');
  // a lista de meses mostra só as fichas dele
  const lista = (await a.get('/api/unidade/competencias')).json.competencias[0];
  assert.equal(lista.fichasTotal, 1);
});

test('ficha, listas, conferência e PDF de outro setor ou do gestor são recusados', async () => {
  const cid = (await g.get('/api/unidade/competencias')).json.competencias[0].cid;
  assert.equal((await a.get('/api/unidade/competencias/' + cid + '/ficha/assistencia')).status, 200);
  assert.equal((await a.get('/api/unidade/competencias/' + cid + '/ficha/rh')).status, 403);
  assert.equal((await g.get('/api/unidade/competencias/' + cid + '/ficha/rh')).status, 200);
  const F = require('../core/formularios');
  const deOutro = Object.entries(F.FONTES).find(([, f]) => f.setor !== 'assistencia')[0];
  const meu = Object.entries(F.FONTES).find(([, f]) => f.setor === 'assistencia');
  assert.equal((await a.get('/api/unidade/competencias/' + cid + '/linhas/' + deOutro)).status, 403);
  if (meu) assert.equal((await a.get('/api/unidade/competencias/' + cid + '/linhas/' + meu[0])).status, 200);
  assert.equal((await a.get('/api/unidade/competencias/' + cid + '/conferir')).status, 403);
  assert.equal((await g.get('/api/unidade/competencias/' + cid + '/conferir')).status, 200);
  const fontes = (await a.get('/api/unidade/fontes')).json.fontes;
  assert.ok(fontes.every((f) => f.setor === 'assistencia'));
});
