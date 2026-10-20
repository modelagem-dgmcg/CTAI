'use strict';
// Modo de exposição: rede interna acessa tudo; origem externa só o Portal da Unidade.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, interno, externoGestor, externoNath, externoAdmin;
const TUNEL = { 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'abc-GRU' };
const ext = (base) => { const c = cliente(base); const orig = c.req; c.req = (m, u, b, extra) => orig(m, u, b, { headers: Object.assign({}, TUNEL, extra && extra.headers) }); return c; };

test.before(async () => {
  S = await iniciar();
  interno = cliente(S.base); await interno.entrar('nathalia');
  // quem vai usar pelo túnel precisa ter trocado a senha antes, pela rede interna
  for (const l of ['gestor.demo', 'admin']) await cliente(S.base).entrar(l);
  externoGestor = ext(S.base); externoNath = ext(S.base); externoAdmin = ext(S.base);
});
test.after(async () => { await S.fechar(); });

test('rede interna acessa tudo', async () => {
  for (const u of ['/api/ctai/contratos', '/api/analista/estado', '/api/gestao/painel']) assert.equal((await interno.get(u)).status, 200, u);
  const adm = cliente(S.base); await adm.entrar('admin'); assert.equal((await adm.get('/api/admin/saude')).status, 200);
  for (const u of ['/ctai', '/js/ctai.js', '/js/gestao.js', '/unidade', '/']) assert.equal((await fetch(S.base + u)).status, 200, u);
});

test('origem externa: só o Portal da Unidade; o resto é 404', async () => {
  const f = (u, h) => fetch(S.base + u, { headers: h || TUNEL });
  for (const u of ['/ctai', '/ctai.html', '/js/ctai.js', '/js/gestao.js']) assert.equal((await f(u)).status, 404, u);
  for (const u of ['/api/ctai/contratos', '/api/analista/estado', '/api/gestao/painel', '/api/admin/saude', '/api/integracoes/x']) assert.equal((await f(u)).status, 404, u);
  for (const u of ['/', '/unidade', '/js/unidade.js', '/js/core.js', '/css/app.css', '/api/saude']) assert.equal((await f(u)).status, 200, u);
  // outros jeitos de chegar de fora
  assert.equal((await f('/api/ctai/contratos', { 'x-forwarded-host': 'portal.exemplo.gov.br' })).status, 404, 'proxy com host encaminhado');
  assert.equal((await f('/ctai', { 'cf-ipcountry': 'BR' })).status, 404);

  // login da unidade funciona; usuário da CTAI não entra pelo túnel (mesma mensagem de senha errada)
  assert.equal((await externoGestor.post('/api/auth/login', { login: 'gestor.demo', senha: 'Senha@12345' })).status, 200);
  assert.equal((await externoGestor.get('/api/unidade/competencias')).status, 200);
  assert.equal((await externoGestor.get('/api/ctai/contratos')).status, 404);
  const n = await externoNath.post('/api/auth/login', { login: 'nathalia', senha: 'Senha@12345' });
  assert.equal(n.status, 401); assert.equal(n.json.erro, 'Usuário ou senha incorretos.');
  assert.equal((await externoAdmin.post('/api/auth/login', { login: 'admin', senha: 'Senha@12345' })).status, 401);
});

test('modo aberto (desenvolvimento) desliga o bloqueio; padrão é restrito', async () => {
  const { modo } = require('../server/exposicao');
  assert.equal(modo(), 'restrita');
  process.env.CTAI_EXPOSICAO = 'aberta';
  try { assert.equal((await fetch(S.base + '/api/ctai/contratos', { headers: TUNEL })).status, 401, 'chega na autenticação'); }
  finally { delete process.env.CTAI_EXPOSICAO; }
  assert.equal((await fetch(S.base + '/api/ctai/contratos', { headers: TUNEL })).status, 404);
});

test('hosts públicos configurados contam como externos', async () => {
  process.env.CTAI_HOSTS_PUBLICOS = 'portal.exemplo.gov.br, 127.0.0.1';
  try {
    assert.equal((await fetch(S.base + '/api/ctai/contratos')).status, 404, 'o próprio host está na lista pública');
    assert.equal((await fetch(S.base + '/api/unidade/competencias')).status, 401);
  } finally { delete process.env.CTAI_HOSTS_PUBLICOS; }
  process.env.CTAI_HOSTS_INTERNOS = 'proxy.interno';
  try { assert.equal((await fetch(S.base + '/api/ctai/contratos', { headers: { 'x-forwarded-host': 'proxy.interno' } })).status, 401, 'proxy interno confiável'); }
  finally { delete process.env.CTAI_HOSTS_INTERNOS; }
});
