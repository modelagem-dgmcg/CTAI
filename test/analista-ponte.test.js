'use strict';
// Ponte com o Analista: usa um servidor falso no lugar do Apps Script.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { criar, config } = require('../adapters/analista');

let srv, base, chamadas;
test.before(async () => {
  chamadas = [];
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const corpo = JSON.parse(b || '{}'); const acao = new URL(req.url, 'http://x').searchParams.get('action');
      chamadas.push({ acao, corpo, tipo: req.headers['content-type'], url: req.url });
      res.setHeader('Content-Type', 'application/json');
      if (corpo.servico_chave !== 'ctai_certa') return res.end(JSON.stringify({ ok: false, erro: 'Credencial de serviço inválida.' }));
      if (acao === 'servico/contatos') return res.end(JSON.stringify({ ok: true, contatos: [{ nome: 'Ana', email: 'ana@ses', gerencia: 'GGPCG' }] }));
      if (acao === 'servico/mensagem-enviar') return res.end(JSON.stringify({ ok: true, mensagem: { id: 'm1', conversa_id: 'dm:ana@ses:ctai@servico.ses', enviado_em: '2026-10-22T10:00:00Z' }, dados_pessoais_trocados: 1 }));
      if (acao === 'servico/mensagens-listar') return res.end(JSON.stringify({ ok: true, mensagens: [{ id: 'm1', da_ctai: true, de_nome: 'CTAI — Maria', texto: 'Oi', enviado_em: '2026-10-22T10:00:00Z' }, { id: 'm2', da_ctai: false, de_nome: 'Ana', texto: 'Recebi', enviado_em: '2026-10-22T10:05:00Z' }] }));
      res.end(JSON.stringify({ ok: false, erro: 'Ação desconhecida.' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port + '/exec';
});
test.after(() => new Promise((r) => srv.close(r)));

test('desligada sem URL e chave', async () => {
  assert.equal(config({}).ligada, false);
  const p = criar({});
  assert.equal(p.ligada, false);
  await assert.rejects(() => p.contatos(), /desligada/);
});

test('contatos, enviar e conversa; chave vai no corpo e nunca no endereço', async () => {
  const p = criar({ ANALISTA_API_URL: base, ANALISTA_SERVICO_CHAVE: 'ctai_certa' });
  assert.equal(p.ligada, true);
  assert.deepEqual(await p.contatos(), [{ nome: 'Ana', email: 'ana@ses', gerencia: 'GGPCG' }]);
  const e = await p.enviar({ para: 'ana@ses', texto: 'Oi', deQuem: 'Maria' });
  assert.equal(e.id, 'm1'); assert.equal(e.dadosPessoaisTrocados, 1);
  const c = await p.conversa('ana@ses');
  assert.equal(c.length, 2); assert.equal(c[0].daCtai, true); assert.equal(c[1].daCtai, false);
  assert.ok(chamadas.length >= 3);
  for (const x of chamadas) {
    assert.ok(!x.url.includes('ctai_certa'), 'a chave não pode aparecer no endereço');
    assert.match(x.tipo, /text\/plain/);
  }
});

test('chave errada e servidor fora do ar dão mensagem clara', async () => {
  const p = criar({ ANALISTA_API_URL: base, ANALISTA_SERVICO_CHAVE: 'ctai_errada' });
  await assert.rejects(() => p.contatos(), /inválida/);
  const q = criar({ ANALISTA_API_URL: 'http://127.0.0.1:1/exec', ANALISTA_SERVICO_CHAVE: 'ctai_certa' });
  await assert.rejects(() => q.contatos(), /Não consegui falar com o Analista/);
});
