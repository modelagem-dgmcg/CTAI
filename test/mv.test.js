'use strict';
// Rack da API do sistema da unidade, ensaiado contra o servidor de teste (dados fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const mock = require('../adapters/mv/mock-server');

let S, gestor, admin, mockSrv, mockUrl, integ, cid07;

test.before(async () => {
  S = await iniciar();
  mockSrv = mock.criar({ comDadoPessoal: true });
  await new Promise((ok) => mockSrv.listen(0, '127.0.0.1', ok));
  mockUrl = 'http://127.0.0.1:' + mockSrv.address().port;
  gestor = cliente(S.base); admin = cliente(S.base);
  await gestor.entrar('gestor.demo'); await admin.entrar('admin');
  integ = S.db.get("SELECT integracao_id FROM integracoes WHERE contrato_id = 'DEMO-UPA'").integracao_id;
  cid07 = S.db.get("SELECT cid FROM competencias WHERE contrato_id = 'DEMO-UPA' AND competencia_id = '2026-07'").cid;
});
test.after(async () => { mockSrv.close(); await S.fechar(); });

test('configuração só aceita NOME de variável, nunca o segredo', async () => {
  const ruim = await admin.put('/api/integracoes/' + integ, { baseUrl: mockUrl, auth: { tipo: 'bearer', tokenEnv: 'meu token secreto 123' }, ativo: true });
  assert.equal(ruim.status, 400);
  const ok = await admin.put('/api/integracoes/' + integ, { baseUrl: mockUrl, auth: { tipo: 'bearer', tokenEnv: 'MV_API_TOKEN' }, ativo: true });
  assert.equal(ok.status, 200);
  assert.ok(!S.db.get('SELECT config FROM integracoes WHERE integracao_id = ?', integ).config.includes('token-de-teste'));
  assert.equal((await gestor.put('/api/integracoes/' + integ, { baseUrl: 'http://x' })).status, 403, 'só o administrador altera');
});

test('testar a conexão e registrar a chamada', async () => {
  const r = await gestor.post('/api/integracoes/' + integ + '/testar');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(S.db.get('SELECT estado FROM integracoes WHERE integracao_id = ?', integ).estado, 'conectada');
  assert.ok(S.db.get("SELECT COUNT(*) AS n FROM integracao_log WHERE integracao_id = ? AND acao = 'testar'", integ).n >= 1);
});

test('prévia (dry-run) não grava nada', async () => {
  const r = await gestor.post('/api/integracoes/' + integ + '/sincronizar', { cid: cid07, fontes: ['classificacao'], dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.dryRun, true);
  assert.equal(r.json.resumo[0].erros.length, 0);
  assert.ok(r.json.resumo[0].validos > 100);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM linhas_rascunho WHERE cid = ?', cid07).n, 0);
});

test('sincronizar traz um lote PENDENTE que só vale depois da confirmação do gestor', async () => {
  const r = await gestor.post('/api/integracoes/' + integ + '/sincronizar', { cid: cid07, fontes: ['classificacao', 'dor_toracica'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const lote = r.json.resumo[0].lote_id;
  assert.ok(lote);
  const antes = (await gestor.get('/api/unidade/competencias/' + cid07)).json;
  assert.equal(antes.contagem.classificacao.pendentes > 100, true);
  assert.equal(antes.contagem.classificacao.confirmadas, 0);
  assert.equal(antes.consolidado['2.1'].valor, null, 'pendente não entra no cálculo');
  assert.ok(antes.bloqueios.some((b) => /integração aguardam/.test(b)));
  const c = await gestor.post('/api/unidade/lotes/' + lote + '/confirmar', {});
  assert.equal(c.status, 200);
  const depois = (await gestor.get('/api/unidade/competencias/' + cid07)).json;
  assert.ok(depois.consolidado['2.1'].valor > 0);
  assert.equal(depois.consolidado['2.1'].origem, 'linhas');
  const origem = S.db.get("SELECT DISTINCT origem FROM linhas_rascunho WHERE cid = ? AND fonte = 'classificacao'", cid07).origem;
  assert.equal(origem, 'api_mv');
});

test('campos que não estão no mapeamento (nome, CPF) nunca chegam ao banco', async () => {
  const dump = JSON.stringify(S.db.all('SELECT * FROM linhas_rascunho WHERE cid = ?', cid07));
  assert.ok(!/Fulano|123\.456\.789-09|nm_paciente|nr_cpf/.test(dump));
});

test('falha da API aparece no registro e não derruba o resto', async () => {
  const quebra = mock.criar({ falhar: 'ave' });
  await new Promise((ok) => quebra.listen(0, '127.0.0.1', ok));
  await admin.put('/api/integracoes/' + integ, { baseUrl: 'http://127.0.0.1:' + quebra.address().port, auth: { tipo: 'bearer', tokenEnv: 'MV_API_TOKEN' }, ativo: true });
  const r = await gestor.post('/api/integracoes/' + integ + '/sincronizar', { cid: cid07, fontes: ['ave', 'sepse'], dryRun: true });
  quebra.close();
  assert.equal(r.status, 200);
  assert.match(r.json.resumo.find((x) => x.fonte === 'ave').erro, /500/);
  assert.equal(r.json.resumo.find((x) => x.fonte === 'sepse').erro, undefined);
  assert.ok(S.db.get("SELECT COUNT(*) AS n FROM integracao_log WHERE integracao_id = ? AND status = '500'", integ).n >= 1);
});

test('token errado: erro claro, sem gravar', async () => {
  const prot = mock.criar({ token: 'outro-token' });
  await new Promise((ok) => prot.listen(0, '127.0.0.1', ok));
  await admin.put('/api/integracoes/' + integ, { baseUrl: 'http://127.0.0.1:' + prot.address().port, auth: { tipo: 'bearer', tokenEnv: 'MV_API_TOKEN' }, ativo: true });
  const r = await gestor.post('/api/integracoes/' + integ + '/testar');
  prot.close();
  assert.equal(r.status, 502);
  assert.match(r.json.erro, /401/);
});
