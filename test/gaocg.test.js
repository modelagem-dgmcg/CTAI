'use strict';
// GAOCG (leitura): conexão, cópia local, preenchimento da seção 3 e conferências do parecer. Servidor simulado, dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { iniciar, cliente } = require('./helpers');

let S, a, g, srv, id, visto = [];
test.before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); visto.push(u.searchParams.get('action'));
    res.setHeader('content-type', 'application/json');
    if (u.searchParams.get('chave') !== 'chave-fake') return res.end(JSON.stringify({ ok: false, erro: 'Chave inválida' }));
    if (u.searchParams.get('action') === 'api_unidades') return res.end(JSON.stringify({ ok: true, total: 2, dados: [
      { Unidade: 'Outra Unidade Qualquer', 'Nº Contrato': '001/2020', OSS: 'Outra OSS' },
      { Unidade: 'UPA Demonstração', 'Nº Contrato': '9/2099', OSS: 'Instituto Fictício de Saúde', 'Vigência Fim': '2026-02-28', 'Repasse Mensal': '1234567.50', Endereço: 'Rua Fictícia, 1' }] }));
    res.end(JSON.stringify({ ok: true, dados: [] }));
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.GAOCG_API_URL = 'http://127.0.0.1:' + srv.address().port + '/exec';
  S = await iniciar();
  a = cliente(S.base); g = cliente(S.base); await a.entrar('cleuton'); await g.entrar('gestor.demo');
  S.db.run("UPDATE contratos SET numero_cg = '9/2099', unidade = 'UPA Demonstração' WHERE contrato_id = 'DEMO-UPA'");
  const cs = (await a.get('/api/ctai/contratos')).json.contratos.find((c) => c.contrato_id === 'DEMO-UPA');
  id = (await a.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T1', competencias: cs.competencias.map((k) => k.competencia_id).slice(0, 3) })).json.parecer_id;
  await a.post('/api/ctai/pareceres/' + id + '/modelo', { modo: 'padrao' });
});
test.after(async () => { srv.close(); delete process.env.GAOCG_API_URL; delete process.env.GAOCG_API_CHAVE; await S.fechar(); });

test('sem chave: desligado, sem quebrar; a unidade nunca acessa', async () => {
  delete process.env.GAOCG_API_CHAVE;
  assert.equal((await a.get('/api/gaocg/estado')).json.configurada, false);
  assert.equal((await a.post('/api/gaocg/testar', {})).json.ok, false);
  assert.equal((await g.get('/api/gaocg/estado')).status, 403);
  const rv = await a.post('/api/analista/pareceres/' + id + '/revisao-completa', {});
  assert.equal(rv.status, 200); assert.equal(rv.json.gaocg.usado, false);
});

test('chave errada falha com mensagem; chave certa conecta e registra o estado', async () => {
  process.env.GAOCG_API_CHAVE = 'errada';
  const e = (await a.post('/api/gaocg/testar', {})).json;
  assert.equal(e.ok, false); assert.doesNotMatch(JSON.stringify(e), /errada/);
  process.env.GAOCG_API_CHAVE = 'chave-fake';
  const o = (await a.post('/api/gaocg/testar', {})).json;
  assert.equal(o.ok, true);
  const est = (await a.get('/api/gaocg/estado')).json;
  assert.equal(est.configurada, true); assert.equal(est.teste.ok, true);
});

test('preenche a seção 3 pelo GAOCG (casando por número do contrato) e guarda cópia local', async () => {
  const r = (await a.post('/api/ctai/pareceres/' + id + '/modelo/gaocg', {})).json;
  assert.equal(r.encontrada, true); assert.ok(r.preenchidos.includes('OSS'));
  const sec = (await a.get('/api/ctai/pareceres/' + id)).json.conteudoAtual.modelo.secoes.identificacao;
  assert.match(sec, /OSS: Instituto Fictício de Saúde/); assert.match(sec, /Contrato de Gestão: n\.º 9\/2099/); assert.match(sec, /Repasse mensal: R\$ 1\.234\.567,50/); assert.match(sec, /Endereço: Rua Fictícia, 1/);
  const antes = visto.length;
  await a.post('/api/ctai/pareceres/' + id + '/modelo/gaocg', {});
  assert.equal(visto.length, antes, 'segunda leitura vem da cópia local');
  assert.ok((await a.get('/api/gaocg/estado')).json.copias.length >= 1);
});

test('revisão completa confere com o GAOCG: contrato diferente e vigência anterior ao período', async () => {
  await a.put('/api/ctai/pareceres/' + id + '/modelo', { secoes: { introducao: 'Contrato de Gestão n.º 012/2099 firmado com outra entidade.' } });
  const rv = (await a.post('/api/analista/pareceres/' + id + '/revisao-completa', {})).json;
  assert.equal(rv.gaocg.usado, true);
  const t = rv.achados.map((x) => x.tipo);
  assert.ok(t.includes('Número do contrato diferente do GAOCG'), t.join());
  assert.ok(t.includes('Vigência anterior ao período'), t.join());
});

test('só o administrador vê os nomes dos campos; consulta fora da lista é recusada', async () => {
  assert.equal((await a.get('/api/gaocg/campos/api_unidades')).status, 403);
  const adm = cliente(S.base); await adm.entrar('admin');
  const c = (await adm.get('/api/gaocg/campos/api_unidades')).json;
  assert.ok(c.campos.includes('OSS'));
  assert.equal((await adm.get('/api/gaocg/campos/api_usuarios')).status, 400);
});
