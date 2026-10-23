'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
let S, g, a, sup, contrato;
test.before(async () => { S = await iniciar(); g = cliente(S.base); a = cliente(S.base); sup = cliente(S.base); await g.entrar('gestor.demo'); await a.entrar('cleuton'); await sup.entrar('nathalia'); contrato = S.db.get("SELECT contrato_id FROM usuarios WHERE login = 'gestor.demo'").contrato_id; });
test.after(async () => { await S.fechar(); });

test('acesso provisório: exige setor, formulário e justificativa; avisa o analista; concordar torna permanente', async () => {
  assert.equal((await g.post('/api/unidade/equipe', { login: 'prov.um', nome: 'Pessoa Um', setor_livre: 'Farmácia' })).status, 400);
  assert.equal((await g.post('/api/unidade/equipe', { login: 'prov.um', nome: 'Pessoa Um', setor_livre: 'Farmácia', formulario_livre: 'Dispensação mensal' })).status, 400);
  const r = await g.post('/api/unidade/equipe', { login: 'prov.um', nome: 'Pessoa Um', setor_livre: 'Farmácia', formulario_livre: 'Dispensação mensal', justificativa: 'Farmácia precisa enviar a dispensação.' });
  assert.equal(r.status, 200); assert.equal(r.json.provisorio, true);
  const cx = (await sup.get('/api/caixa')).json;
  assert.ok(cx.itens.some((i) => i.tipo === 'acesso_provisorio'));
  const lista = (await a.get('/api/provisorios?contrato=' + encodeURIComponent(contrato))).json.pedidos;
  assert.equal(lista.length, 1); assert.equal(lista[0].justificativa, 'Farmácia precisa enviar a dispensação.');
  assert.equal((await g.post('/api/provisorios/' + lista[0].usuario_id + '/decidir', { concordo: true })).status, 403);
  assert.equal((await a.post('/api/provisorios/' + lista[0].usuario_id + '/decidir', { concordo: true })).status, 200);
  assert.equal((await a.get('/api/provisorios?contrato=' + encodeURIComponent(contrato))).json.pedidos.length, 0);
  const eq = (await g.get('/api/unidade/equipe')).json.usuarios.find((u) => u.login === 'prov.um');
  assert.equal(eq.provisorio, null);
});

test('discordar exige justificativa que volta ao gestor; sem concordância o acesso é apagado em 7 dias', async () => {
  await g.post('/api/unidade/equipe', { login: 'prov.dois', nome: 'Pessoa Dois', setor_livre: 'Almoxarifado', formulario_livre: 'Estoque', justificativa: 'Controle de estoque mensal.' });
  const id = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'prov.dois'").usuario_id;
  assert.equal((await a.post('/api/provisorios/' + id + '/decidir', { concordo: false })).status, 400);
  assert.equal((await a.post('/api/provisorios/' + id + '/decidir', { concordo: false, justificativa: 'Esse formulário não existe no contrato.' })).status, 200);
  const eq = (await g.get('/api/unidade/equipe')).json.usuarios.find((u) => u.login === 'prov.dois');
  assert.equal(eq.provisorio.resposta, 'Esse formulário não existe no contrato.');
  S.db.run("UPDATE usuarios SET prov_expira_em = ? WHERE usuario_id = ?", new Date(Date.now() - 1000).toISOString(), id);
  const eq2 = (await g.get('/api/unidade/equipe')).json.usuarios;
  assert.equal(eq2.some((u) => u.login === 'prov.dois'), false);
  assert.equal(S.db.get('SELECT ativo FROM usuarios WHERE usuario_id = ?', id).ativo, 0);
  const c = cliente(S.base); const t = await c.post('/api/auth/login', { login: 'prov.dois', senha: 'Trocar@123' });
  assert.equal(t.status === 200, false);
});
