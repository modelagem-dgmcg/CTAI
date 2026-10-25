'use strict';
// Equipe da unidade pelo gestor (Portal da Unidade) e aba Acessos da Gestão CTAI.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, gestor, olinda, nath, cleuton, assistencia, outro;

test.before(async () => {
  S = await iniciar();
  gestor = cliente(S.base); olinda = cliente(S.base); nath = cliente(S.base); cleuton = cliente(S.base); assistencia = cliente(S.base);
  await gestor.entrar('gestor.demo'); await olinda.entrar('gestor.olinda'); await nath.entrar('nathalia'); await cleuton.entrar('cleuton'); await assistencia.entrar('assistencia.demo');
});
test.after(async () => { await S.fechar(); });

test('gestor cadastra a equipe da própria unidade, define fichas, troca senha e desativa', async () => {
  assert.equal((await assistencia.get('/api/unidade/equipe')).status, 403, 'responsável de setor não cuida da equipe');
  assert.equal((await cleuton.get('/api/unidade/equipe')).status, 403, 'CTAI não usa o portal');
  const l0 = (await gestor.get('/api/unidade/equipe')).json;
  assert.ok(l0.usuarios.some((u) => u.login === 'assistencia.demo' && !u.somenteLeitura));
  assert.ok(l0.usuarios.some((u) => u.perfil === 'gestor_unidade' && u.somenteLeitura), 'gestor aparece só para leitura');
  assert.equal(l0.setores.length, 6);

  assert.equal((await gestor.post('/api/unidade/equipe', { login: 'rh.demo', nome: 'Pessoa do RH', setores: [] })).status, 400, 'precisa de ao menos uma ficha');
  assert.equal((await gestor.post('/api/unidade/equipe', { login: 'rh.demo', nome: 'Pessoa do RH', setores: ['inexistente'] })).status, 400);
  const c = await gestor.post('/api/unidade/equipe', { login: 'rh.demo', nome: 'Pessoa do RH', setores: ['rh', 'bid'] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const novo = S.db.get("SELECT * FROM usuarios WHERE login = 'rh.demo'");
  assert.equal(novo.perfil, 'setor_unidade'); assert.equal(novo.contrato_id, 'DEMO-UPA');
  assert.deepEqual(JSON.parse(novo.setores), ['rh', 'bid']);

  // a nova pessoa entra, troca a senha, preenche só as fichas dela
  const rh = cliente(S.base); await rh.entrar('rh.demo');
  const me = (await rh.get('/api/auth/me')).json.usuario;
  assert.deepEqual(me.setores, ['rh', 'bid']);
  const cid = (await gestor.get('/api/unidade/competencias')).json.competencias[0].cid;
  assert.equal((await rh.get('/api/unidade/competencias/' + cid + '/ficha/rh')).status, 200);
  // quem tem mais de uma ficha pode editar todas as suas (a tela libera os campos de cada uma, não só da primeira)
  assert.equal((await rh.get('/api/unidade/competencias/' + cid + '/ficha/rh')).json.podeEditar, true);
  assert.equal((await rh.get('/api/unidade/competencias/' + cid + '/ficha/bid')).json.podeEditar, true, 'segunda ficha da lista também edita');
  assert.equal((await rh.get('/api/unidade/competencias/' + cid + '/ficha/assistencia')).json.podeEditar, false);
  assert.equal((await rh.put('/api/unidade/competencias/' + cid + '/ficha/assistencia', { dados: {} })).status, 403, 'ficha de outro setor');

  // editar fichas
  assert.equal((await gestor.patch('/api/unidade/equipe/' + novo.usuario_id, { setores: ['ouvidoria'] })).status, 200);
  assert.equal((await rh.put('/api/unidade/competencias/' + cid + '/ficha/ouvidoria', { dados: {} })).status !== 403, true);
  assert.equal((await rh.put('/api/unidade/competencias/' + cid + '/ficha/rh', { dados: {} })).status, 403);
  assert.equal((await gestor.patch('/api/unidade/equipe/' + novo.usuario_id, { setores: ['ouvidoria'] })).status, 400, 'nada para alterar');

  // trocar o responsável por ficha: assistência passa de assistencia.demo para a nova pessoa
  const ass = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'assistencia.demo'").usuario_id;
  const t = await gestor.put('/api/unidade/equipe/fichas/assistencia', { usuario_id: novo.usuario_id });
  assert.equal(t.status, 200);
  assert.deepEqual(t.json.fichas.find((f) => f.id === 'assistencia').responsaveis.map((x) => x.nome), ['Pessoa do RH']);
  assert.equal((await assistencia.put('/api/unidade/competencias/' + cid + '/ficha/assistencia', { dados: {} })).status, 403, 'perdeu a ficha');
  assert.equal((await gestor.put('/api/unidade/equipe/fichas/xx', { usuario_id: novo.usuario_id })).status, 404);

  // senha temporária e desativação
  const s = await gestor.post('/api/unidade/equipe/' + novo.usuario_id + '/senha', {});
  assert.equal(s.status, 200); assert.ok(s.json.senhaTemporaria);
  assert.equal((await gestor.post('/api/unidade/equipe/' + novo.usuario_id + '/senha', { senha: 'fraca' })).status, 400);
  assert.equal((await gestor.post('/api/unidade/equipe/' + novo.usuario_id + '/ativo', { ativo: false })).status, 200);
  assert.equal((await cliente(S.base).post('/api/auth/login', { login: 'rh.demo', senha: 'Trocar@123' })).status, 401);
  assert.equal((await gestor.post('/api/unidade/equipe/' + novo.usuario_id + '/ativo', { ativo: true })).status, 200);
  assert.equal((await gestor.put('/api/unidade/equipe/fichas/rh', { usuario_id: ass })).status, 200);
  void ass;
});

test('o gestor nunca vê nem altera outra unidade nem perfis da CTAI', async () => {
  const lo = (await olinda.get('/api/unidade/equipe')).json;
  assert.ok(!lo.usuarios.some((u) => u.login === 'assistencia.demo' || u.login === 'rh.demo'), 'não vê a equipe de outra unidade');
  const idDemo = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'rh.demo'").usuario_id;
  const idCtai = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'").usuario_id;
  const idGestorDemo = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'gestor.demo'").usuario_id;
  for (const id of [idDemo, idCtai, idGestorDemo]) {
    assert.equal((await olinda.patch('/api/unidade/equipe/' + id, { nome: 'Hackeado' })).status, 404);
    assert.equal((await olinda.post('/api/unidade/equipe/' + id + '/ativo', { ativo: false })).status, 404);
    assert.equal((await olinda.post('/api/unidade/equipe/' + id + '/senha', {})).status, 404);
    assert.equal((await olinda.put('/api/unidade/equipe/fichas/rh', { usuario_id: id })).status, 404);
  }
  assert.equal((await gestor.post('/api/unidade/equipe/' + idCtai + '/senha', {})).status, 404);
  assert.equal((await gestor.post('/api/unidade/equipe/' + idGestorDemo + '/ativo', { ativo: false })).status, 404, 'nem o próprio gestor pela equipe');
  // criar sempre cai na unidade do gestor, e não cria perfil de CTAI nem de gestor
  const c = await olinda.post('/api/unidade/equipe', { login: 'rh.olinda', nome: 'RH Olinda', setores: ['rh'], perfil: 'admin', contrato_id: 'DEMO-UPA' });
  assert.equal(c.status, 200);
  const u = S.db.get("SELECT * FROM usuarios WHERE login = 'rh.olinda'");
  assert.equal(u.perfil, 'setor_unidade'); assert.equal(u.contrato_id, 'UPA-OLINDA');
  assert.equal(S.db.get("SELECT nome FROM usuarios WHERE login = 'cleuton'").nome, 'Cleuton');
});

test('a trilha e os acessos guardam quem fez cada ação de cadastro', async () => {
  const tr = JSON.stringify((await nath.get('/api/ctai/trilha?tabela=usuarios&limite=100')).json);
  assert.match(tr, /gestor\.demo/); assert.match(tr, /rh\.demo/); assert.match(tr, /ficha_cedida/);
  const a = (await nath.get('/api/gestao/acessos?evento=cadastro')).json;
  assert.ok(a.linhas.length >= 6);
  assert.ok(a.linhas.every((l) => l.perfil === 'gestor_unidade' && l.hash_trilha && l.contrato_id));
  assert.ok(a.linhas.some((l) => l.login === 'gestor.olinda'));
  assert.doesNotMatch(JSON.stringify(a), /Trocar@123|Senha@12345/, 'senha nunca aparece');
});

test('acessos: entradas, falhas, bloqueio, saída, origem e filtros; sem edição', async () => {
  const lixo = cliente(S.base);
  for (let i = 0; i < 5; i++) assert.equal((await lixo.post('/api/auth/login', { login: 'colega1', senha: 'errada' + i })).status, 401);
  assert.equal((await lixo.post('/api/auth/login', { login: 'colega1', senha: 'errada9' })).status, 401, 'bloqueado');
  await lixo.post('/api/auth/login', { login: 'nao.existe', senha: 'x' });
  const ext = cliente(S.base); const o = ext.req; ext.req = (m, u, b, e) => o(m, u, b, { headers: { 'cf-connecting-ip': '203.0.113.77', 'user-agent': 'NavegadorTeste/1.0' } });
  assert.equal((await ext.post('/api/auth/login', { login: 'gestor.olinda', senha: 'Senha@12345' })).status, 200);
  assert.equal((await ext.post('/api/auth/login', { login: 'nathalia', senha: 'Senha@12345' })).status, 401, 'CTAI fora da rede interna');
  await ext.post('/api/auth/logout', {});

  assert.equal((await cleuton.get('/api/gestao/acessos')).status, 403);
  const r = (await nath.get('/api/gestao/acessos')).json;
  assert.ok(r.contagens.entrada >= 5 && r.contagens.falha >= 6 && r.contagens.bloqueio === 1 && r.contagens.saida >= 1 && r.contagens.externas >= 3);
  assert.ok(r.falhasPorLogin.some((x) => x.login === 'colega1'));
  const bloq = r.linhas.find((l) => l.evento === 'bloqueio');
  assert.equal(bloq.login, 'colega1'); assert.equal(bloq.perfil, 'colega'); assert.ok(bloq.hash_trilha);
  const sai = r.linhas.find((l) => l.evento === 'saida');
  assert.equal(sai.origem, 'externa'); assert.equal(sai.ip, '203.0.113.x', 'IP mascarado'); assert.equal(sai.agente, 'NavegadorTeste/1.0'); assert.equal(sai.contrato_id, 'UPA-OLINDA');
  assert.ok(r.linhas.some((l) => l.detalhe === 'recusada fora da rede interna' && l.login === 'nathalia'));
  assert.ok(r.linhas.some((l) => l.origem === 'interna'));
  assert.equal(r.trilha.ok, true);
  // cada linha liga a um evento real da trilha
  for (const l of r.linhas.slice(0, 10)) assert.ok(S.db.get('SELECT 1 FROM trilha_auditoria WHERE hash = ?', l.hash_trilha), 'elo com a trilha');

  // filtros
  assert.ok((await nath.get('/api/gestao/acessos?evento=bloqueio')).json.linhas.every((l) => l.evento === 'bloqueio'));
  assert.ok((await nath.get('/api/gestao/acessos?usuario=colega1')).json.linhas.every((l) => l.login === 'colega1'));
  assert.ok((await nath.get('/api/gestao/acessos?contrato=UPA-OLINDA')).json.linhas.every((l) => l.contrato_id === 'UPA-OLINDA'));
  assert.ok((await nath.get('/api/gestao/acessos?origem=externa')).json.linhas.every((l) => l.origem === 'externa'));
  assert.equal((await nath.get('/api/gestao/acessos?de=2020-01-01&ate=2020-01-02')).json.linhas.length, 0);
  assert.equal((await nath.get('/api/gestao/acessos?de=ontem')).status, 400);
  assert.equal((await nath.get('/api/gestao/acessos?evento=xx')).status, 400);

  // exportações
  const csv = await nath.get('/api/gestao/acessos.csv?evento=falha');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /csv/); assert.match(csv.buffer.toString('utf8'), /data_hora;evento;login/);
  const pdf = await nath.get('/api/gestao/acessos.pdf'); assert.equal(pdf.buffer.slice(0, 4).toString(), '%PDF');
  assert.equal((await cleuton.get('/api/gestao/acessos.csv')).status, 403);

  // sem edição: nem pela API, nem no banco
  assert.equal((await nath.put('/api/gestao/acessos', {})).status, 404);
  assert.equal((await nath.del('/api/gestao/acessos')).status, 404);
  assert.throws(() => S.db.run("UPDATE acessos SET login = 'x'"), /não pode ser alterado/);
  assert.throws(() => S.db.run('DELETE FROM acessos'), /não pode ser apagado/);
  assert.equal((await nath.get('/api/ctai/trilha/verificar')).json.ok, true);
});
