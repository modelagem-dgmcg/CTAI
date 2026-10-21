'use strict';
// CTAI_IPS_INTERNOS: só IP na lista é interno; atrás do proxy do Render o IP vem do X-Forwarded-For contado do fim (premissa documentada).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, nath;
const ENV = ['CTAI_IPS_INTERNOS', 'CTAI_PROXY_SALTOS', 'CTAI_IP_CABECALHO', 'CTAI_PROXIES_CONFIAVEIS'];
const limpar = () => ENV.forEach((k) => delete process.env[k]);
const cfg = (o) => { limpar(); Object.assign(process.env, o); };
const ctai = async (h) => (await fetch(S.base + '/api/ctai/contratos', { headers: h || {} })).status; // 401 = alcançou a autenticação; 404 = bloqueado
const xff = (v) => ({ 'x-forwarded-for': v });
const ALVO = { CTAI_IPS_INTERNOS: '200.1.2.3, 10.0.0.0/8, 2001:db8::/32', CTAI_PROXY_SALTOS: '2' }; // como no Render: "cliente, ip-do-proxy" + o que o cliente forjar à esquerda

test.before(async () => { S = await iniciar(); await cliente(S.base).entrar('admin'); nath = cliente(S.base); await nath.entrar('nathalia'); });
test.after(async () => { limpar(); await S.fechar(); });

test('sem CTAI_IPS_INTERNOS: comportamento de antes (requisição simples é interna)', async () => {
  limpar();
  assert.equal(await ctai(), 401);
  assert.equal(await ctai({ 'cf-connecting-ip': '1.2.3.4' }), 404);
});

test('IP na lista é interno; fora da lista é externo', async () => {
  cfg(ALVO);
  assert.equal(await ctai(xff('200.1.2.3, 10.0.0.1')), 401, 'IP exato na lista');
  assert.equal(await ctai(xff('8.8.8.8, 10.0.0.1')), 404, 'fora da lista');
  assert.equal(await ctai(xff('10.200.1.1, 10.0.0.1')), 401, 'dentro do CIDR IPv4');
  assert.equal(await ctai(xff('11.0.0.1, 10.0.0.1')), 404, 'logo fora do CIDR');
  assert.equal(await ctai(xff('::ffff:200.1.2.3, 10.0.0.1')), 401, 'IPv4 mapeado em IPv6');
  assert.equal(await ctai(xff('200.1.2.3:51234, 10.0.0.1')), 401, 'IP com porta');
  // o Portal da Unidade continua aberto para todos
  assert.equal((await fetch(S.base + '/unidade', { headers: xff('8.8.8.8, 10.0.0.1') })).status, 200);
});

test('IPv6 e CIDR IPv6', async () => {
  cfg(ALVO);
  assert.equal(await ctai(xff('2001:db8:abcd::5, 10.0.0.1')), 401);
  assert.equal(await ctai(xff('2001:db9::1, 10.0.0.1')), 404);
  cfg({ CTAI_IPS_INTERNOS: '2001:db8::1, 192.168.1.0/24, lixo, 1.2.3.4/99', CTAI_PROXY_SALTOS: '2' });
  assert.equal(await ctai(xff('2001:db8::1, 10.0.0.1')), 401, 'IPv6 exato; entradas inválidas são ignoradas');
  assert.equal(await ctai(xff('2001:db8::2, 10.0.0.1')), 404);
  assert.equal(await ctai(xff('192.168.1.77, 10.0.0.1')), 401);
  assert.equal(await ctai(xff('1.2.3.4, 10.0.0.1')), 404, 'prefixo inválido não vira "libera tudo"');
});

test('cabeçalho forjado pelo cliente não vale', async () => {
  cfg(ALVO);
  // cliente real (8.8.8.8) escreve um IP interno à esquerda; o proxy acrescenta o IP real e o dele
  assert.equal(await ctai(xff('200.1.2.3, 8.8.8.8, 10.0.0.1')), 404);
  assert.equal(await ctai(xff('200.1.2.3, 200.1.2.3, 8.8.8.8, 10.0.0.1')), 404);
  // cabeçalhos de IP que a plataforma não é a fonte são ignorados
  assert.equal(await ctai({ ...xff('8.8.8.8, 10.0.0.1'), 'cf-connecting-ip': '200.1.2.3', 'true-client-ip': '200.1.2.3', 'x-real-ip': '200.1.2.3' }), 404);
  // com 1 salto só vale o último valor
  cfg({ CTAI_IPS_INTERNOS: '200.1.2.3', CTAI_PROXY_SALTOS: '1' });
  assert.equal(await ctai(xff('200.1.2.3, 8.8.8.8')), 404);
  assert.equal(await ctai(xff('8.8.8.8, 200.1.2.3')), 401);
});

test('IP indeterminado é externo', async () => {
  cfg(ALVO);
  assert.equal(await ctai(), 404, 'sem X-Forwarded-For');
  assert.equal(await ctai(xff('200.1.2.3')), 404, 'menos valores que os saltos');
  assert.equal(await ctai(xff('nao-e-ip, 10.0.0.1')), 404, 'valor inválido');
  assert.equal(await ctai(xff(', ')), 404);
  cfg({ CTAI_IPS_INTERNOS: '200.1.2.3', CTAI_IP_CABECALHO: 'true-client-ip' });
  assert.equal(await ctai(), 404, 'cabeçalho da plataforma ausente');
  assert.equal(await ctai({ 'true-client-ip': 'xyz' }), 404);
});

test('cabeçalho da plataforma (CTAI_IP_CABECALHO), conexão direta e proxies confiáveis', async () => {
  cfg({ CTAI_IPS_INTERNOS: '200.1.2.3', CTAI_IP_CABECALHO: 'true-client-ip' });
  assert.equal(await ctai({ 'true-client-ip': '200.1.2.3' }), 401);
  assert.equal(await ctai({ 'true-client-ip': '8.8.8.8', ...xff('200.1.2.3') }), 404, 'XFF ignorado quando há cabeçalho da plataforma');
  cfg({ CTAI_IPS_INTERNOS: '127.0.0.1', CTAI_PROXY_SALTOS: '0' });
  assert.equal(await ctai(xff('8.8.8.8, 8.8.4.4')), 401, 'sem proxy: vale o IP da conexão (rede interna direta)');
  cfg({ CTAI_IPS_INTERNOS: '200.1.2.3', CTAI_PROXY_SALTOS: '2', CTAI_PROXIES_CONFIAVEIS: '203.0.113.0/24' });
  assert.equal(await ctai(xff('200.1.2.3, 10.0.0.1')), 404, 'conexão não vem de proxy confiável: cabeçalhos ignorados');
  cfg({ CTAI_IPS_INTERNOS: '200.1.2.3', CTAI_PROXY_SALTOS: '2', CTAI_PROXIES_CONFIAVEIS: '127.0.0.1' });
  assert.equal(await ctai(xff('200.1.2.3, 10.0.0.1')), 401, 'proxy confiável');
});

test('login e acessos: origem e IP mascarado; /api/origem ajuda a calibrar', async () => {
  cfg(ALVO);
  const de = (ip) => { const c = cliente(S.base); const o = c.req; c.req = (m, u, b, e) => o(m, u, b, { headers: { 'x-forwarded-for': ip + ', 10.0.0.1', 'user-agent': 'TesteIP/1' } }); return c; };
  assert.equal((await de('8.8.8.8').post('/api/auth/login', { login: 'admin', senha: 'Senha@12345' })).status, 401, 'admin de fora é recusado');
  assert.equal((await de('200.1.2.3').post('/api/auth/login', { login: 'admin', senha: 'Senha@12345' })).status, 200, 'admin de dentro entra');
  assert.equal((await de('8.8.8.8').post('/api/auth/login', { login: 'gestor.demo', senha: 'Trocar@123' })).status, 200, 'unidade entra de fora');
  limpar();
  const a = (await nath.get('/api/gestao/acessos?origem=externa')).json.linhas;
  const rec = a.find((l) => l.login === 'admin' && /recusada/.test(l.detalhe));
  assert.ok(rec, 'recusa registrada'); assert.equal(rec.ip, '8.8.8.x'); assert.equal(rec.origem, 'externa');
  const ent = (await nath.get('/api/gestao/acessos?evento=entrada&usuario=admin')).json.linhas.find((l) => l.ip === '200.1.2.x');
  assert.equal(ent.origem, 'interna'); assert.match(ent.detalhe, /IP na lista de internos/);

  cfg(ALVO);
  const o = await (await fetch(S.base + '/api/origem', { headers: xff('8.8.8.8, 10.0.0.1') })).json();
  assert.equal(o.seuIp, '8.8.8.8'); assert.equal(o.classe, 'externa'); assert.equal(o.listaDeIpsInternosDefinida, true);
  assert.match(o.comoFoiObtido, /2º valor/);
  const i = await (await fetch(S.base + '/api/origem', { headers: xff('200.1.2.3, 10.0.0.1') })).json();
  assert.equal(i.classe, 'interna');
  assert.equal((await fetch(S.base + '/saude', { headers: xff('8.8.8.8, 10.0.0.1') })).status, 200, 'rota de saúde aberta para a plataforma');
  assert.equal((await fetch(S.base + '/api/saude', { headers: xff('8.8.8.8, 10.0.0.1') })).status, 200);
});
