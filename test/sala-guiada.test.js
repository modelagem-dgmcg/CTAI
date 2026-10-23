'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
let S, cond, a, b, unidade, cookies = {};

// Assina um canal de eventos (SSE) e junta o que chega.
async function ouvir(cookie, codigo, eu) {
  const ctrl = new AbortController();
  const r = await fetch(S.base + '/api/sala/eventos?codigo=' + codigo + '&eu=' + eu, { headers: { cookie }, signal: ctrl.signal });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const eventos = []; let resto = '';
  (async () => {
    const dec = new TextDecoder();
    try { for await (const pedaco of r.body) { resto += dec.decode(pedaco); let i; while ((i = resto.indexOf('\n\n')) >= 0) { const bloco = resto.slice(0, i); resto = resto.slice(i + 2); const ev = /event: (.*)/.exec(bloco), da = /data: (.*)/.exec(bloco); if (ev && da) eventos.push({ ev: ev[1], d: JSON.parse(da[1]) }); } } } catch (_) { /* fechou */ }
  })();
  return { eventos, fechar: () => ctrl.abort(), espera: async (nome, ms = 2000) => { const ate = Date.now() + ms; while (Date.now() < ate) { const x = eventos.filter((e) => e.ev === nome); if (x.length) return x; await new Promise((k) => setTimeout(k, 20)); } return []; } };
}
async function cookieDe(login) {
  const r = await fetch(S.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ctai': '1' }, body: JSON.stringify({ login, senha: 'Senha@12345' }) });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

test.before(async () => {
  S = await iniciar();
  cond = cliente(S.base); a = cliente(S.base); b = cliente(S.base); unidade = cliente(S.base);
  await cond.entrar('cleuton'); await a.entrar('colega1'); await b.entrar('colega2'); await unidade.entrar('gestor.demo');
  for (const l of ['cleuton', 'colega1', 'colega2', 'gestor.demo']) cookies[l] = await cookieDe(l);
});
test.after(async () => { await S.fechar(); });
const { _salas } = require('../server/sala-guiada');

test('qualquer pessoa com login cria; quem entra precisa do código', async () => {
  assert.equal((await unidade.get('/api/sala/estado')).json.podeCriar, true);
  assert.equal((await cond.get('/api/sala/estado')).json.podeCriar, true);
  const c = await cond.post('/api/sala/criar');
  assert.equal(c.status, 200); assert.match(c.json.codigo, /^[A-HJ-NP-Z2-9]{5}$/); assert.ok(c.json.ice.length >= 1);
  const e = await unidade.post('/api/sala/entrar', { codigo: c.json.codigo.toLowerCase() });
  assert.equal(e.status, 200); assert.equal(e.json.condutor, false);
  assert.equal((await unidade.post('/api/sala/entrar', { codigo: 'ZZZZZ' })).status, 404);
  await cond.post('/api/sala/encerrar', { codigo: c.json.codigo, eu: c.json.eu });
});

test('sem login não entra', async () => {
  const anon = cliente(S.base);
  assert.equal((await anon.get('/api/sala/estado')).status, 401);
});

test('apontador, sinal, mudo e silenciar chegam a quem deve', async () => {
  const c = (await cond.post('/api/sala/criar')).json;
  const ea = (await a.post('/api/sala/entrar', { codigo: c.codigo })).json;
  const eb = (await b.post('/api/sala/entrar', { codigo: c.codigo })).json;
  const oc = await ouvir(cookies.cleuton, c.codigo, c.eu), oa = await ouvir(cookies.colega1, c.codigo, ea.eu), ob = await ouvir(cookies.colega2, c.codigo, eb.eu);
  const ola = (await oa.espera('ola'))[0].d;
  assert.equal(ola.participantes.length, 3); assert.equal(ola.condutor, c.eu);

  // só quem conduz move o apontador
  const p = await cond.post('/api/sala/ponteiro', { codigo: c.codigo, eu: c.eu, dados: { tipo: 'mover', alvo: '#menu>a:nth-of-type(2)', fx: 0.4, fy: 0.5, x: 0.2, y: 0.3, pagina: '/ctai#/painel' } });
  assert.equal(p.status, 200);
  const ra = (await oa.espera('ponteiro'))[0].d, rb = (await ob.espera('ponteiro'))[0].d;
  assert.equal(ra.alvo, '#menu>a:nth-of-type(2)'); assert.equal(ra.fx, 0.4); assert.equal(rb.pagina, '/ctai#/painel');
  assert.equal((await oc.espera('ponteiro', 300)).length, 0, 'quem conduz não recebe o próprio apontador');
  assert.equal((await a.post('/api/sala/ponteiro', { codigo: c.codigo, eu: ea.eu, dados: { tipo: 'mover', x: 0.1, y: 0.1 } })).status, 403);

  // dados malformados não derrubam nada
  assert.equal((await cond.post('/api/sala/ponteiro', { codigo: c.codigo, eu: c.eu, dados: { tipo: 'x', fx: 'abc', alvo: 'a'.repeat(900) } })).status, 200);

  // sinal de áudio vai só ao destinatário
  assert.equal((await a.post('/api/sala/sinal', { codigo: c.codigo, eu: ea.eu, para: eb.eu, dados: { tipo: 'oferta', sdp: { type: 'offer', sdp: 'v=0' } } })).status, 200);
  const sb = (await ob.espera('sinal'))[0].d;
  assert.equal(sb.de, ea.eu); assert.equal(sb.dados.tipo, 'oferta');
  assert.equal((await oc.espera('sinal', 300)).length, 0);
  // não dá para se passar por outro participante
  assert.equal((await a.post('/api/sala/sinal', { codigo: c.codigo, eu: eb.eu, para: c.eu, dados: {} })).status, 403);

  // microfone e silenciar
  await a.post('/api/sala/mudo', { codigo: c.codigo, eu: ea.eu, mudo: false });
  let aberto = false;
  for (let i = 0; i < 100 && !aberto; i++) { aberto = ob.eventos.some((e) => e.ev === 'participantes' && e.d.participantes.some((x) => x.id === ea.eu && x.mudo === false)); if (!aberto) await new Promise((k) => setTimeout(k, 20)); }
  assert.equal(aberto, true, 'a lista mostra o microfone aberto');
  assert.equal((await a.post('/api/sala/silenciar', { codigo: c.codigo, eu: ea.eu })).status, 403);
  assert.equal((await cond.post('/api/sala/silenciar', { codigo: c.codigo, eu: c.eu })).status, 200);
  assert.equal((await ob.espera('silenciar')).length, 1);

  // retomar depois de trocar de página
  const ret = await a.get('/api/sala/retomar?codigo=' + c.codigo + '&eu=' + ea.eu);
  assert.equal(ret.status, 200); assert.equal(ret.json.eu, ea.eu);

  // quem conduz encerra: todos recebem
  assert.equal((await b.post('/api/sala/encerrar', { codigo: c.codigo, eu: eb.eu })).status, 403);
  assert.equal((await cond.post('/api/sala/encerrar', { codigo: c.codigo, eu: c.eu })).status, 200);
  assert.equal((await oa.espera('encerrada')).length, 1);
  assert.equal(_salas.has(c.codigo), false);
  assert.equal((await a.get('/api/sala/retomar?codigo=' + c.codigo + '&eu=' + ea.eu)).status, 404);
  oc.fechar(); oa.fechar(); ob.fechar();
});

test('sair: participante some da lista; condutor saindo encerra', async () => {
  const c = (await cond.post('/api/sala/criar')).json;
  const ea = (await a.post('/api/sala/entrar', { codigo: c.codigo })).json;
  const oc = await ouvir(cookies.cleuton, c.codigo, c.eu);
  await oc.espera('ola');
  await a.post('/api/sala/sair', { codigo: c.codigo, eu: ea.eu });
  const l = (await oc.espera('saiu'))[0].d; assert.equal(l.id, ea.eu);
  assert.equal(_salas.get(c.codigo).parts.size, 1);
  await cond.post('/api/sala/sair', { codigo: c.codigo, eu: c.eu });
  assert.equal(_salas.has(c.codigo), false);
  oc.fechar();
});

test('sala cheia, mesma pessoa em duas abas e nova sala encerra a antiga', async () => {
  const c = (await cond.post('/api/sala/criar')).json;
  const sala = _salas.get(c.codigo);
  for (let i = 0; i < 20 && sala.parts.size < require('../server/sala-guiada').MAX; i++) sala.parts.set('x' + i, { id: 'x' + i, login: 'fake' + i, nome: 'F' + i, mudo: true, res: null, offlineDesde: Date.now() });
  assert.equal((await a.post('/api/sala/entrar', { codigo: c.codigo })).status, 409);
  assert.equal((await cond.post('/api/sala/entrar', { codigo: c.codigo })).status, 409, 'quem conduz não entra como participante');
  const outra = (await cond.post('/api/sala/criar')).json;
  assert.equal(_salas.has(c.codigo), false); assert.ok(_salas.has(outra.codigo));
  const e1 = (await a.post('/api/sala/entrar', { codigo: outra.codigo })).json;
  const e2 = (await a.post('/api/sala/entrar', { codigo: outra.codigo })).json;
  assert.notEqual(e1.eu, e2.eu);
  assert.equal(_salas.get(outra.codigo).parts.size, 2, 'a entrada antiga da mesma pessoa foi trocada');
  await cond.post('/api/sala/encerrar', { codigo: outra.codigo, eu: outra.eu });
});

test('código errado várias vezes é barrado', async () => {
  let ultimo;
  for (let i = 0; i < 10; i++) ultimo = await b.post('/api/sala/entrar', { codigo: 'QQQQ' + i });
  assert.equal(ultimo.status, 429);
});

test('assumir a condução passa o apontador para quem assumiu', async () => {
  const c = (await cond.post('/api/sala/criar')).json;
  const ea = (await a.post('/api/sala/entrar', { codigo: c.codigo })).json;
  assert.equal((await a.post('/api/sala/ponteiro', { codigo: c.codigo, eu: ea.eu, dados: { tipo: 'mover', fx: 0.5, fy: 0.5 } })).status, 403);
  assert.equal((await a.post('/api/sala/assumir', { codigo: c.codigo, eu: ea.eu })).status, 200);
  assert.equal((await a.post('/api/sala/ponteiro', { codigo: c.codigo, eu: ea.eu, dados: { tipo: 'mover', fx: 0.5, fy: 0.5 } })).status, 200);
  assert.equal((await cond.post('/api/sala/ponteiro', { codigo: c.codigo, eu: c.eu, dados: { tipo: 'mover', fx: 0.1, fy: 0.1 } })).status, 403);
  await a.post('/api/sala/encerrar', { codigo: c.codigo, eu: ea.eu });
});

test('convidar: aviso para quem está fora, mensagem para a equipe da CTAI, recusa some', async () => {
  const c = (await cond.post('/api/sala/criar')).json;
  assert.equal((await a.post('/api/sala/convidar', { codigo: c.codigo, eu: c.eu, quem: 'todos' })).status, 403);
  assert.equal((await cond.post('/api/sala/convidar', { codigo: c.codigo, eu: c.eu, quem: 'xx' })).status, 400);
  const r = await cond.post('/api/sala/convidar', { codigo: c.codigo, eu: c.eu, quem: 'todos' });
  assert.equal(r.status, 200); assert.ok(r.json.convidados >= 3);
  const v = (await a.get('/api/sala/convites')).json.convites;
  assert.equal(v.length, 1); assert.equal(v[0].codigo, c.codigo);
  assert.equal((await unidade.get('/api/sala/convites')).json.convites.length, 1, 'quem é da unidade também recebe o aviso');
  const conv = (await a.get('/api/mensageiro/conversa/cleuton')).json.mensagens;
  assert.ok(conv.some((m) => m.grupo === 'Sala guiada' && m.texto.includes(c.codigo)));
  await a.post('/api/sala/convites/recusar', { codigo: c.codigo });
  assert.equal((await a.get('/api/sala/convites')).json.convites.length, 0);
  assert.equal((await unidade.post('/api/sala/entrar', { codigo: c.codigo })).status, 200);
  assert.equal((await unidade.get('/api/sala/convites')).json.convites.length, 0, 'quem já entrou não recebe');
  await cond.post('/api/sala/encerrar', { codigo: c.codigo, eu: c.eu });
});
