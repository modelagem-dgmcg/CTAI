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

test('ponte com o Analista: login de serviço, contatos, conversa e envio com o nome de quem escreveu (servidor simulado)', async () => {
  const http = require('node:http');
  const visto = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const acao = new URL(req.url, 'http://x').searchParams.get('action'); const j = JSON.parse(b || '{}'); visto.push([acao, j]);
      const ok = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (acao === 'auth/login') return ok(j.email === 'svc@teste' && /^[0-9a-f]{64}$/.test(j.senha_hash) ? { ok: true, token: 'T1' } : { ok: false, erro: 'x' });
      if (j.token !== 'T1') return ok({ ok: false, sessao_expirada: true });
      if (acao === 'mensagens/contatos') return ok({ ok: true, individuais: [{ conversa_id: 'c1', nome: 'Fulana' }], grupos: [{ conversa_id: 'g1', nome: 'Grupo A' }] });
      if (acao === 'mensagens/listar') return ok({ ok: true, mensagens: [{ de_usuario: 'outra@x', de_nome: 'Fulana', texto: 'oi', enviado_em: '2026-10-22T10:00:00Z' }] });
      if (acao === 'mensagens/enviar') return ok({ ok: true });
      ok({ ok: false, erro: 'acao?' });
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.CTAI_ANALISTA_URL = 'http://127.0.0.1:' + srv.address().port + '/exec'; process.env.CTAI_ANALISTA_EMAIL = 'svc@teste'; process.env.CTAI_ANALISTA_SENHA = 'segredo-de-teste';
  require('../server/ponte-analista')._zerar();
  try {
    assert.equal((await a.get('/api/mensageiro/ponte/estado')).json.configurada, true);
    const c = (await a.get('/api/mensageiro/ponte/contatos')).json.contatos;
    assert.deepEqual(c.map((x) => x.nome), ['Fulana', 'Grupo A']);
    assert.equal((await a.get('/api/mensageiro/ponte/conversa?id=c1')).json.mensagens[0].texto, 'oi');
    assert.equal((await a.post('/api/mensageiro/ponte/enviar', { id: 'c1', texto: 'Bom dia' })).status, 200);
    const env = visto.find((v) => v[0] === 'mensagens/enviar')[1];
    assert.match(env.texto, /^\[CTAI · .+\] Bom dia$/);
    assert.equal((await g.get('/api/mensageiro/ponte/contatos')).status, 403);
    assert.equal((await a.post('/api/mensageiro/ponte/enviar', { id: 'c1', texto: '' })).status, 400);
    process.env.CTAI_ANALISTA_SENHA = ''; require('../server/ponte-analista')._zerar();
    assert.equal((await a.get('/api/mensageiro/ponte/contatos')).status, 503);
  } finally { srv.close(); delete process.env.CTAI_ANALISTA_URL; delete process.env.CTAI_ANALISTA_EMAIL; delete process.env.CTAI_ANALISTA_SENHA; }
});
