'use strict';
// Base da equipe (CTAI_SEMENTE=equipe): só admin, superintendente e as analistas, senha temporária; analistas conferem umas às outras.
process.env.CTAI_SEMENTE = 'equipe'; process.env.CTAI_SENHA_TEMPORARIA = '123'; process.env.CTAI_TROCA_SENHA_OBRIGATORIA = 'nao';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S;
const entrar = async (c, l) => { const r = await c.post('/api/auth/login', { login: l, senha: '123' }); assert.equal(r.status, 200, l); };
test.before(async () => { S = await iniciar(); });
test.after(async () => { await S.fechar(); });

test('só a equipe existe, todos entram com 123 e não há usuário de demonstração', async () => {
  const logins = S.db.all('SELECT login FROM usuarios ORDER BY login').map((u) => u.login);
  assert.deepEqual(logins, ['admin', 'cecilia', 'juliana.ludmila', 'juliana.rocha', 'jussara', 'nathalia']);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM contratos WHERE demo = 1").n, 0);
  for (const l of logins) { const c = cliente(S.base); const r = await c.post('/api/auth/login', { login: l, senha: '123' }); assert.equal(r.status, 200, l); assert.equal(r.json.usuario.trocar_senha, false); }
});

test('carteira por importação; analista cria o parecer e a colega confere; ninguém confere o próprio', async () => {
  const nath = cliente(S.base); await entrar(nath, 'nathalia');
  const csv = ['tipo;unidade;municipio;analista', 'UPA;Exemplo Alfa;Cidade A;juliana.rocha', 'Hospital;Exemplo Beta;Cidade B;cecilia'].join('\n');
  const g = await nath.post('/api/gestao/carteira/importar/gravar', { csv, modo: 'substituir' });
  assert.equal(g.status, 200);
  const jr = cliente(S.base), ce = cliente(S.base); await entrar(jr, 'juliana.rocha'); await entrar(ce, 'cecilia');
  assert.ok((await jr.get('/api/ctai/contratos')).json.contratos.some((c) => /Exemplo Alfa/.test(c.unidade)));
  assert.ok(!(await jr.get('/api/ctai/contratos')).json.contratos.some((c) => /Exemplo Beta/.test(c.unidade)));
});

test('o analista pode ser convocado para conferir (não o criador)', async () => {
  const M = require('../server/minuta');
  const adm = cliente(S.base); await entrar(adm, 'admin');
  const jr = S.db.get("SELECT * FROM usuarios WHERE login = 'juliana.rocha'");
  const ce = S.db.get("SELECT * FROM usuarios WHERE login = 'cecilia'");
  const id = M.criar(S.db, jr, { contrato_id: 'UPA-OLINDA', trimestre: '2026-T9', competencias: [S.db.get("SELECT competencia_id FROM competencias WHERE contrato_id = 'UPA-OLINDA' ORDER BY competencia_id LIMIT 1").competencia_id] });
  assert.throws(() => M.congelar(S.db, id, jr, { convocados: [jr.usuario_id] }), /não confere|próprio/i);
  const vid = M.congelar(S.db, id, jr, { convocados: [ce.usuario_id] });
  assert.ok(M.detalhe(S.db, id, ce).colegasDisponiveis.some((x) => x.usuario_id === jr.usuario_id) === false, 'o criador não aparece como conferente do próprio parecer');
  assert.doesNotThrow(() => M.conferir(S.db, vid, ce, 'identificacao', 'ok'));
  assert.throws(() => M.conferir(S.db, vid, jr, 'identificacao', 'ok'), /próprio trabalho/);
  const outra = S.db.get("SELECT * FROM usuarios WHERE login = 'jussara'");
  assert.throws(() => M.conferir(S.db, vid, outra, 'identificacao', 'ok'), /convocado/);
});
