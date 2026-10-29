'use strict';
// Registro de contratos e termos aditivos (dados fictícios): prévia, gravação, conferência, nova importação sem sobrescrever o conferido.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
let S, nath, cleuton;
const R = '/api/gestao/registro-contratos';
const CAB = 'instrumento;numero;contrato_gestao;sei;oss;unidade_planilha;objeto;tipo_ta;regular;vigencia_cg;inicio;fim;observacao;aba;unidade_sistema;casada';
const csv = (...l) => '﻿' + [CAB].concat(l).join('\n');
const L1 = 'CONTRATO;x;024/2022;2300000214.000078/2022-19;FGH;Hosp X;Gerenciamento;;;C.G. VIGENTE;2022-11-01;2027-04-30;;HOSPITAL;Hospital Registro Teste;sim';
const L2 = 'ADITIVO;1º;024/2022;2300000302.000143/2023-90;FGH;Hosp X;Rateio;Rateio;S;C.G. VIGENTE;2024-08-05;2024-10-31;;HOSPITAL;Hospital Registro Teste;sim';
const L3 = 'ADITIVO;8º;024/2022;2300002754.000006/2025-24;FGH;Hosp X;Ajuste;Ajuste Contratual;S;C.G. VIGENTE;2026-06-01;2027-04-30;;HOSPITAL;Hospital Registro Teste;sim';
const L4 = 'APOSTILAMENTO;1º;024/2022;;FGH;Hosp X;Dotação;;;C.G. VIGENTE;2025-03-03;;;HOSPITAL;Hospital Registro Teste;sim';
const LX = 'ADITIVO;1º;999/2000;;ZZZ;Hosp Y;Fora;;;C.G. VIGENTE;2020-01-01;;;HOSPITAL;;nao';
test.before(async () => {
  S = await iniciar(); nath = cliente(S.base); cleuton = cliente(S.base);
  await nath.entrar('nathalia'); await cleuton.entrar('cleuton');
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('HOSP-REG', 'Hospital Registro Teste', 'FGH', 'Hospital', 0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['HOSP-REG'], 'teste');
});
test.after(async () => { await S.fechar(); });

test('só superintendente/admin usam a importação; prévia não grava e separa o que não casou', async () => {
  assert.equal((await cleuton.post(R + '/previa', { csv: csv(L1) })).status, 403);
  assert.equal((await nath.post(R + '/previa', {})).status, 400);
  const p = await nath.post(R + '/previa', { csv: csv(L1, L2, L3, L4, LX) });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.resumo.linhas, 4); assert.equal(p.json.resumo.novos, 4);
  assert.deepEqual(p.json.naoCasadas.map((x) => x.nome), ['(sem unidade)']);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM registro_instrumentos').n, 0, 'prévia não grava');
});

test('grava, resume o contrato vigente com último aditivo e vigência, e mostra na página da unidade', async () => {
  const g = await nath.post(R + '/gravar', { csv: csv(L1, L2, L3, L4) });
  assert.equal(g.json.novos, 4);
  const r = (await cleuton.get('/api/ctai/contratos/HOSP-REG/instrumentos')).json.registro;
  assert.equal(r.contrato.numero, '024/2022'); assert.equal(r.contagem.aditivos, 2); assert.equal(r.contagem.apostilamentos, 1);
  assert.equal(r.ultimo_aditivo.numero, '8º'); assert.equal(r.vigencia_fim, '2027-04-30');
  assert.match(r.texto, /024\/2022.*2 termo\(s\) aditivo\(s\).*8º TA.*vigência até 30\/04\/2027/);
  assert.equal(r.conferido, false);
});

test('conferido não é sobrescrito por nova importação; o resto é atualizado', async () => {
  assert.equal((await cleuton.post('/api/ctai/contratos/HOSP-REG/instrumentos/confirmar', {})).json.confirmadas, 4);
  const alterado = L3.replace('Ajuste;', 'Objeto CORRIGIDO;');
  const p = await nath.post(R + '/previa', { csv: csv(L1, L2, alterado, L4) });
  assert.equal(p.json.resumo.mantidos, 4);
  const g = await nath.post(R + '/gravar', { csv: csv(L1, L2, alterado, L4) });
  assert.equal(g.json.mantidos, 4); assert.equal(g.json.atualizados, 0);
  assert.equal(S.db.get("SELECT objeto FROM registro_instrumentos WHERE numero = '8º'").objeto, 'Ajuste');
  assert.equal((await cleuton.get('/api/ctai/contratos/HOSP-REG/instrumentos')).json.registro.conferido, true);
});

test('a unidade fora da carteira não vê o registro de outra', async () => {
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('HOSP-OUTRA', 'Hospital Outra', 'FGH', 'Hospital', 0)");
  assert.equal((await cleuton.get('/api/ctai/contratos/HOSP-OUTRA/instrumentos')).status, 403);
});
