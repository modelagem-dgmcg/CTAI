'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
let S, a, sup, g;
test.before(async () => { S = await iniciar(); a = cliente(S.base); sup = cliente(S.base); g = cliente(S.base); await a.entrar('colega1'); await sup.entrar('nathalia'); await g.entrar('gestor.demo'); });
test.after(async () => { await S.fechar(); });

test('pedido livre: guarda, copia para a superintendência e administração, só quem avalia vê tudo', async () => {
  assert.equal((await g.post('/api/ensinar', { texto: 'x' })).status, 403);
  assert.equal((await a.post('/api/ensinar', {})).status, 400);
  const r = await a.post('/api/ensinar', { texto: 'Quando a OSS atrasa o relatório, o prazo conta em dias úteis.', titulo: 'Prazo em dias úteis' });
  assert.equal(r.status, 200); assert.ok(r.json.copias >= 1);
  const conv = (await sup.get('/api/mensageiro/conversa/colega1')).json.mensagens;
  assert.ok(conv.some((m) => m.grupo === 'Ensinar ao Sistema' && /Prazo em dias úteis/.test(m.texto)));
  assert.equal((await a.get('/api/ensinar')).json.pedidos.length, 1);
  assert.equal((await a.post('/api/ensinar/' + r.json.ensino_id + '/avaliar', { status: 'aprovado' })).status, 403);
  assert.equal((await sup.post('/api/ensinar/' + r.json.ensino_id + '/avaliar', { status: 'recusado' })).status, 400);
  assert.equal((await sup.post('/api/ensinar/' + r.json.ensino_id + '/avaliar', { status: 'aprovado', parecer: 'ok' })).status, 200);
});

test('modelo de documento para uso imediato já aparece em Documentos, só para quem enviou, e vira da equipe se aprovado', async () => {
  assert.equal((await a.post('/api/ensinar', { texto: 'texto qualquer com mais de trinta caracteres aqui', uso_imediato: true })).status, 400);
  const r = await a.post('/api/ensinar', { titulo: 'Ofício de cobrança', texto: 'Ofício nº 10/2024\nRecife, 01/02/2024\nSenhor Gestor, solicitamos o relatório do processo 0012345678.000123/2024-11 no prazo de 5 dias.', uso_imediato: true, tipo_documento: 'oficio' });
  assert.equal(r.status, 200); assert.ok(r.json.modelo_id);
  assert.equal((await a.get('/api/documentos/modelos')).json.modelos.some((m) => m.nome === 'Ofício de cobrança'), true);
  assert.equal((await sup.get('/api/documentos/modelos')).json.modelos.some((m) => m.nome === 'Ofício de cobrança'), false);
  await sup.post('/api/ensinar/' + r.json.ensino_id + '/avaliar', { status: 'aprovado' });
  assert.equal((await sup.get('/api/documentos/modelos')).json.modelos.some((m) => m.nome === 'Ofício de cobrança'), true);
});
