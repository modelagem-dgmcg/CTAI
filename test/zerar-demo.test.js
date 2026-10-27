'use strict';
// Zerar dados de demonstração: prévia, confirmação forte, cópia antes, limpeza completa (inclusive envios de contrato real), trilha preservada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { iniciar, cliente } = require('./helpers');
let S, adm, eq;
test.before(async () => { S = await iniciar(); adm = cliente(S.base); eq = cliente(S.base); await adm.entrar('admin'); await eq.entrar('colega1'); });
test.after(async () => { await S.fechar(); });

test('só o admin vê a prévia; ZERAR e a senha certa são obrigatórios', async () => {
  assert.equal((await eq.get('/api/admin/zerar/previa')).status, 403);
  assert.equal((await eq.post('/api/admin/zerar', { confirmar: 'ZERAR', senha: 'x' })).status, 403);
  const pv = (await adm.get('/api/admin/zerar/previa')).json;
  assert.ok(pv.apagar.length > 0); assert.ok(pv.contratosApagados.some((c) => /DEMO-UPA/.test(c)));
  assert.ok(pv.usuariosApagados.some((u) => /gestor\.demo/.test(u))); assert.ok(pv.usuariosMantidos.some((u) => /admin/.test(u)));
  assert.equal((await adm.post('/api/admin/zerar', { confirmar: 'zerar', senha: 'Senha@12345' })).status, 400);
  assert.equal((await adm.post('/api/admin/zerar', { confirmar: 'ZERAR', senha: 'errada' })).status, 403);
  assert.ok(S.db.get('SELECT COUNT(*) AS n FROM competencias').n > 0, 'nada foi apagado com senha errada');
});

test('zera tudo, inclusive envio de contrato real; mantém equipe, configurações e trilha; guarda a cópia', async () => {
  // um envio num contrato REAL (que os gatilhos normalmente não deixam apagar)
  const cid = S.db.get("SELECT cid FROM competencias WHERE contrato_id = 'UPA-OLINDA' LIMIT 1").cid;
  S.db.run("INSERT INTO envios (cid, versao, enviado_por, enviado_em, snapshot, hash_snapshot) VALUES (?,?,?,?,?,?)", cid, 1, 'teste', '2026-06-01', '{}', 'h');
  assert.throws(() => S.db.run('DELETE FROM envios WHERE cid = ?', cid), /não pode ser apagado/, 'o gatilho protege contrato real');
  S.db.run("INSERT INTO gestao_config (chave, valor) VALUES ('teste_mantida','sim')");
  const trilhaAntes = S.db.get('SELECT COUNT(*) AS n FROM trilha_auditoria').n;
  const r = await adm.post('/api/admin/zerar', { confirmar: 'ZERAR', senha: 'Senha@12345' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const t of ['competencias', 'envios', 'fichas', 'linhas_brutas', 'pareceres', 'caixa_itens', 'msg', 'carteira', 'hist_relatorios', 'achados']) assert.equal(S.db.get('SELECT COUNT(*) AS n FROM ' + t).n, 0, t + ' zerada');
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM contratos WHERE contrato_id = 'DEMO-UPA'").n, 0);
  const real = S.db.get("SELECT demo FROM contratos WHERE contrato_id = 'UPA-OLINDA'");
  assert.ok(real && real.demo === 0, 'contrato real mantido e continua protegido');
  for (const l of ['admin', 'nathalia', 'cleuton']) assert.ok(S.db.get('SELECT 1 FROM usuarios WHERE login = ?', l), l + ' mantido');
  for (const l of ['gestor.demo', 'assistencia.demo', 'ouvidoria.demo', 'colega1']) assert.equal(S.db.get('SELECT 1 AS x FROM usuarios WHERE login = ?', l), undefined, l + ' removido');
  assert.equal(S.db.get("SELECT valor FROM gestao_config WHERE chave = 'teste_mantida'").valor, 'sim', 'configuração mantida');
  assert.ok(S.db.get('SELECT COUNT(*) AS n FROM trilha_auditoria').n > trilhaAntes, 'trilha só cresce');
  const ev = S.db.get("SELECT * FROM trilha_auditoria WHERE campo = 'zerar_demo' AND valor_novo NOT LIKE 'recusado%'");
  assert.ok(ev && ev.usuario === 'admin' && /backup-antes-de-zerar/.test(ev.valor_novo));
  assert.equal(require('../server/trilha').verificar(S.db).ok, true, 'cadeia da trilha íntegra');
  assert.ok(fs.existsSync(path.join(S.dir, r.json.backup)), 'cópia feita antes');
  const dl = await adm.get('/api/admin/zerar/backup/' + r.json.backup);
  assert.equal(dl.status, 200);
  assert.equal((await adm.get('/api/admin/zerar/backup/..%2Fctai.sqlite')).status, 400);
});
