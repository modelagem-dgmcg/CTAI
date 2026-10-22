'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
let S, a, b, g;
test.before(async () => { S = await iniciar(); a = cliente(S.base); b = cliente(S.base); g = cliente(S.base); await a.entrar('cleuton'); await b.entrar('colega1'); await g.entrar('gestor.demo'); });
test.after(async () => { await S.fechar(); });

test('texto e anexo entre a equipe; só os dois veem; unidade fica de fora', async () => {
  assert.equal((await g.get('/api/mensageiro/contatos')).status, 403);
  const e = await a.post('/api/mensageiro/enviar', { para: 'colega1', texto: 'Oi, segue o rascunho.', anexo: { nome: 'rascunho.pdf', base64: Buffer.from('%PDF-1.4 teste').toString('base64') } });
  assert.equal(e.status, 200);
  assert.equal((await b.get('/api/mensageiro/contador')).json.naoLidas, 1);
  const c = (await b.get('/api/mensageiro/conversa/cleuton')).json;
  assert.equal(c.mensagens.length, 1); assert.equal(c.mensagens[0].meu, false); assert.equal(c.mensagens[0].anexo.nome, 'rascunho.pdf');
  assert.equal((await b.get('/api/mensageiro/contador')).json.naoLidas, 0);
  const d = await b.get('/api/mensageiro/anexo/' + c.mensagens[0].anexo.id);
  assert.equal(d.status, 200);
  const outro = cliente(S.base); await outro.entrar('colega2');
  assert.equal((await outro.get('/api/mensageiro/anexo/' + c.mensagens[0].anexo.id)).status, 404);
});

test('recusa tipo perigoso, arquivo grande, vazio e contato inválido', async () => {
  assert.equal((await a.post('/api/mensageiro/enviar', { para: 'colega1', anexo: { nome: 'x.exe', base64: 'AAAA' } })).status, 400);
  assert.equal((await a.post('/api/mensageiro/enviar', { para: 'colega1', anexo: { nome: 'x.pdf', base64: Buffer.alloc(4 * 1024 * 1024 + 10).toString('base64') } })).status, 413);
  assert.equal((await a.post('/api/mensageiro/enviar', { para: 'colega1', texto: '  ' })).status, 400);
  assert.equal((await a.post('/api/mensageiro/enviar', { para: 'cleuton', texto: 'eu' })).status, 404);
  assert.equal((await a.post('/api/mensageiro/enviar', { para: 'gestor.demo', texto: 'x' })).status, 404);
});
