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

test('ponte com o Analista: contatos, conversa e envio pela chave de serviço (servidor simulado)', async () => {
  const http = require('node:http');
  const visto = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const acao = new URL(req.url, 'http://x').searchParams.get('action'); const j = JSON.parse(b || '{}'); visto.push([acao, j]);
      const ok = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (j.servico_chave !== 'chave-teste') return ok({ ok: false, erro: 'chave inválida' });
      if (acao === 'servico/contatos') return ok({ ok: true, contatos: [{ nome: 'Fulana', email: 'fulana@x', gerencia: 'GGPCG' }] });
      if (acao === 'servico/mensagens-listar') return ok({ ok: true, mensagens: [{ id: 1, da_ctai: false, de_nome: 'Fulana', texto: 'oi', enviado_em: '2026-10-22T10:00:00Z' }] });
      if (acao === 'servico/mensagem-enviar') return ok({ ok: true, mensagem: { id: 2, conversa_id: 'c', enviado_em: '2026-10-22T10:01:00Z' } });
      ok({ ok: false, erro: 'acao?' });
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.ANALISTA_API_URL = 'http://127.0.0.1:' + srv.address().port + '/exec'; process.env.ANALISTA_SERVICO_CHAVE = 'chave-teste';
  try {
    assert.equal((await a.get('/api/mensageiro/ponte/estado')).json.configurada, true);
    const c = (await a.get('/api/mensageiro/ponte/contatos')).json.contatos;
    assert.deepEqual(c.map((x) => [x.id, x.nome]), [['fulana@x', 'Fulana']]);
    assert.equal((await a.get('/api/mensageiro/ponte/conversa?id=fulana@x')).json.mensagens[0].texto, 'oi');
    assert.equal((await a.post('/api/mensageiro/ponte/enviar', { id: 'fulana@x', texto: 'Bom dia' })).status, 200);
    const env = visto.find((v) => v[0] === 'servico/mensagem-enviar')[1];
    assert.equal(env.texto, 'Bom dia'); assert.equal(env.para_email, 'fulana@x'); assert.ok(env.de_nome);
    assert.equal((await g.get('/api/mensageiro/ponte/contatos')).status, 403);
    assert.equal((await a.post('/api/mensageiro/ponte/enviar', { id: 'fulana@x', texto: '' })).status, 400);
    process.env.ANALISTA_SERVICO_CHAVE = 'errada';
    assert.equal((await a.get('/api/mensageiro/ponte/contatos')).status, 502);
    process.env.ANALISTA_SERVICO_CHAVE = '';
    assert.equal((await a.get('/api/mensageiro/ponte/contatos')).status, 503);
  } finally { srv.close(); delete process.env.ANALISTA_API_URL; delete process.env.ANALISTA_SERVICO_CHAVE; }
});

test('status da pessoa e mensagem para um grupo', async () => {
  const lista = (await a.get('/api/mensageiro/contatos')).json.contatos;
  assert.ok(lista.length && lista.every((x) => x.status && x.status.texto));
  const r = await a.post('/api/mensageiro/enviar-grupo', { grupo: 'todos', texto: 'Reunião às 14h' });
  assert.equal(r.status, 200); assert.ok(r.json.enviadas >= 1);
  const outro = lista[0].login;
  const msgs = (await a.get('/api/mensageiro/conversa/' + outro)).json.mensagens;
  assert.ok(msgs.some((m) => m.grupo === 'Toda a equipe' && m.texto === 'Reunião às 14h'));
  assert.equal((await a.post('/api/mensageiro/enviar-grupo', { grupo: 'x', texto: 'a' })).status, 400);
});
