'use strict';
// GAOCG: endereço e chave digitados na tela pela administração (cifrados), sem expor a chave.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.CTAI_SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres';
delete process.env.GAOCG_API_URL; delete process.env.GAOCG_API_CHAVE;
const { iniciar, cliente } = require('./helpers');
let S, adm, eq;
test.before(async () => { S = await iniciar(); adm = cliente(S.base); eq = cliente(S.base); await adm.entrar('admin'); await eq.entrar('colega1'); });
test.after(async () => { await S.fechar(); });

test('só a administração guarda; endereço e chave são conferidos', async () => {
  const corpo = { url: 'https://script.google.com/macros/s/FAKE/exec', chave: 'gaocg_chave_de_teste_1234' };
  assert.equal((await eq.put('/api/gaocg/config', corpo)).status, 403);
  assert.equal((await adm.put('/api/gaocg/config', { url: 'http://x/exec', chave: corpo.chave })).status, 400);
  assert.equal((await adm.put('/api/gaocg/config', { url: corpo.url, chave: 'curta' })).status, 400);
  assert.equal((await adm.get('/api/gaocg/estado')).json.configurada, false);
});
test('guarda cifrada, liga o GAOCG e nunca devolve a chave', async () => {
  const corpo = { url: 'https://script.google.com/macros/s/FAKE/exec', chave: 'gaocg_chave_de_teste_1234' };
  const r = await adm.put('/api/gaocg/config', corpo);
  assert.equal(r.status, 200); assert.equal(r.json.final, '1234');
  const e = (await adm.get('/api/gaocg/estado')).json;
  assert.equal(e.configurada, true); assert.equal(e.origem, 'tela'); assert.equal(e.chave_final, '1234');
  assert.ok(!JSON.stringify(e).includes('gaocg_chave_de_teste'), 'a chave não volta na resposta');
  const linha = S.db.get('SELECT chave_cifrada FROM gaocg_config WHERE id = 1');
  assert.ok(linha.chave_cifrada.startsWith('v1:') && !linha.chave_cifrada.includes('gaocg_chave'), 'fica cifrada no banco');
  const t = S.db.all("SELECT valor_novo FROM trilha_auditoria WHERE tabela = 'gaocg'").map((x) => x.valor_novo).join(' ');
  assert.ok(t.includes('final 1234') && !t.includes('gaocg_chave'), 'trilha só registra o final');
});
