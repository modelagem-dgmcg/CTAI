'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
let S, cond, a, b, unidade, contrato;

test.before(async () => {
  S = await iniciar();
  cond = cliente(S.base); a = cliente(S.base); b = cliente(S.base); unidade = cliente(S.base);
  await cond.entrar('cleuton'); await a.entrar('colega1'); await b.entrar('colega2'); await unidade.entrar('gestor.demo');
  contrato = S.db.get('SELECT contrato_id FROM contratos LIMIT 1').contrato_id;
});
test.after(async () => { await S.fechar(); });

const TEXTO = 'Ofício nº 123/2024\nRecife, 10/03/2024\nSenhor Gestor, encaminhamos o processo 0012345678.000123/2024-11 para as providências cabíveis, conforme combinado.';

test('unidade não usa documentos; sem IA o modelo é aprendido por detecção simples', async () => {
  assert.equal((await unidade.get('/api/documentos/modelos')).status, 403);
  const r = await cond.post('/api/documentos/modelos/aprender', { texto: TEXTO });
  assert.equal(r.status, 200);
  assert.ok(r.json.corpo.includes('{{'));
  assert.ok(r.json.campos.length >= 1);
});

test('modelo: criar, versionar, compartilhar e esconder do que não é dono', async () => {
  const ap = (await cond.post('/api/documentos/modelos/aprender', { texto: TEXTO })).json;
  const c = await cond.post('/api/documentos/modelos', { nome: 'Ofício de encaminhamento', tipo: 'oficio', corpo: ap.corpo, campos: ap.campos });
  assert.equal(c.status, 200);
  const id = c.json.modelo_id;
  assert.equal((await a.get('/api/documentos/modelos')).json.modelos.length, 0); // pessoal por padrão
  assert.equal((await cond.put('/api/documentos/modelos/' + id, { nome: 'Ofício de encaminhamento', corpo: ap.corpo, campos: ap.campos, compartilhado: true })).status, 200);
  const vistos = (await a.get('/api/documentos/modelos')).json.modelos;
  assert.equal(vistos.length, 1); assert.equal(vistos[0].versao, 2); assert.equal(vistos[0].meu, false);
  assert.equal((await a.put('/api/documentos/modelos/' + id, { nome: 'x', corpo: ap.corpo })).status, 403);
  assert.equal((await cond.post('/api/documentos/modelos', { nome: 'x', tipo: 'branco', corpo: ap.corpo })).status, 400);
});

test('redigir com o modelo, sem IA, deixa [campos] visíveis', async () => {
  const m = (await cond.get('/api/documentos/modelos')).json.modelos[0];
  const campo = m.campos[0];
  const r = await cond.post('/api/documentos/redigir', { modelo_id: m.modelo_id, campos: { [campo.id]: 'VALOR-X' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.texto.includes('VALOR-X'));
  assert.ok(/\[[^\]]+\]/.test(r.json.texto));
});

test('documento em branco: sem conferência vai direto ao PDF e ao SEI', async () => {
  const c = await cond.post('/api/documentos', { tipo: 'branco', titulo: 'Nota', texto: 'Texto livre.\n\nSegundo parágrafo.', contrato_id: contrato });
  assert.equal(c.status, 200);
  const id = c.json.doc_id;
  const pdf = await cond.get('/api/documentos/' + id + '/pdf');
  assert.equal(pdf.status, 200); assert.equal(pdf.buffer.slice(0, 4).toString(), '%PDF');
  assert.equal((await cond.post('/api/documentos/' + id + '/sei', {})).status, 400);
  assert.equal((await cond.post('/api/documentos/' + id + '/sei', { numero: '99887766' })).status, 200);
  assert.equal((await cond.put('/api/documentos/' + id, { texto: 'mudou' })).status, 409);
  assert.equal((await cond.get('/api/documentos/' + id)).json.status, 'finalizado');
});

test('conferência opcional: trava PDF até todos darem ok; mudar o texto zera', async () => {
  const colegas = (await cond.get('/api/documentos/colegas')).json.colegas;
  const ca = colegas.find((x) => x.nome && true);
  const id = (await cond.post('/api/documentos', { tipo: 'despacho', titulo: 'Despacho 1', texto: 'Despacho de teste.', conferencia: true })).json.doc_id;
  const eu = (await a.get('/api/auth/me')).json;
  const idA = colegas.find((x) => x.usuario_id === (eu.usuario_id || eu.usuario && eu.usuario.usuario_id)).usuario_id;
  assert.equal((await cond.post('/api/documentos/' + id + '/conferencia', { pedir: true, convocados: [] })).status, 400);
  assert.equal((await cond.post('/api/documentos/' + id + '/conferencia', { pedir: true, convocados: [idA] })).status, 200);
  assert.equal((await cond.get('/api/documentos/' + id + '/pdf')).status, 409);
  assert.equal((await b.post('/api/documentos/' + id + '/conferir', { status: 'ok' })).status, 403);
  assert.equal((await a.post('/api/documentos/' + id + '/conferir', { status: 'reparo' })).status, 400);
  assert.equal((await a.post('/api/documentos/' + id + '/conferir', { status: 'reparo', comentario: 'ajustar o 2º parágrafo' })).status, 200);
  assert.equal((await cond.get('/api/documentos/' + id)).json.status, 'com reparos');
  assert.equal((await a.post('/api/documentos/' + id + '/conferir', { status: 'ok' })).status, 200);
  assert.equal((await cond.get('/api/documentos/' + id + '/pdf')).status, 200);
  await cond.put('/api/documentos/' + id, { texto: 'Despacho alterado.' });
  assert.equal((await cond.get('/api/documentos/' + id + '/pdf')).status, 409);
  assert.equal(((await a.get('/api/documentos?paraConferir=1')).json.documentos).length >= 1, true);
  assert.equal((await a.put('/api/documentos/' + id, { texto: 'invasão' })).status, 403);
  void ca;
});
