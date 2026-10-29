'use strict';
// Perguntas de contrato por unidade (dados fictícios): importação com prévia, resposta pela dona da carteira, reimportação sem perder resposta, contadores e decisões.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
let S, sup, dona, outra;
const UN = 'UPAE-PERGUNTAS';
const IMP = '/api/gestao/perguntas-contrato/';
const csv = (...l) => '﻿unidade;analista;tipo;pergunta;opcoes;documento_pedido;onde_encontrar;valor_atual;valor_proposto\n' + l.join('\n');
const L1 = 'UPAE Perguntas;cleuton;decisao;Qual valor vale para o repasse mensal?;R$ 1,00|R$ 2,00;;;R$ 1,00;R$ 2,00';
const L2 = 'UPAE Perguntas;cleuton;documento;Falta o termo aditivo.;;3º Termo Aditivo;Drive > pasta;;';

test.before(async () => {
  S = await iniciar();
  sup = cliente(S.base); dona = cliente(S.base); outra = cliente(S.base);
  await sup.entrar('nathalia'); await dona.entrar('cleuton'); await outra.entrar('colega1');
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES (?,?,?,?,0)", UN, 'UPAE Perguntas', 'OSS Teste', 'UPAE');
  const a = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'").usuario_id;
  CART.definir(S.db, 'admin', a, [UN, 'DEMO-UPA'], 'teste');
  const b = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega1'").usuario_id;
  CART.definir(S.db, 'admin', b, ['DEMO-UPA'], 'teste');
});
test.after(async () => { await S.fechar(); });

test('importar: só a superintendência; prévia não grava; gravar cria as perguntas', async () => {
  assert.equal((await dona.post(IMP + 'previa', { csv: csv(L1) })).status, 403);
  const p = await sup.post(IMP + 'previa', { csv: csv(L1, L2, 'Unidade Fantasma;cleuton;decisao;x?;a') });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.resumo.linhas, 2); assert.equal(p.json.naoCasadas.length, 1);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM perguntas_contrato').n, 0, 'a prévia não grava');
  const g = await sup.post(IMP + 'gravar', { csv: csv(L1, L2) });
  assert.equal(g.status, 200, JSON.stringify(g.json)); assert.equal(g.json.novas, 2);
  const o = S.db.get("SELECT opcoes FROM perguntas_contrato WHERE tipo = 'decisao'").opcoes;
  assert.ok(o.split('|').includes('Ainda não sei'), 'sempre há a opção Ainda não sei');
});

test('a dona da carteira vê e responde; quem não tem a unidade não vê nem responde', async () => {
  const l = await dona.get('/api/ctai/contratos/' + UN + '/perguntas');
  assert.equal(l.status, 200); assert.equal(l.json.perguntas.length, 2);
  assert.ok(l.json.perguntas.every((q) => q.aberta));
  assert.equal((await outra.get('/api/ctai/contratos/' + UN + '/perguntas')).status, 403);
  const q = l.json.perguntas.find((x) => x.tipo === 'decisao');
  assert.equal((await outra.post('/api/ctai/perguntas/' + q.id + '/responder', { resposta: 'R$ 2,00' })).status, 403);
  assert.equal((await dona.post('/api/ctai/perguntas/' + q.id + '/responder', { resposta: 'Qualquer coisa' })).status, 400, 'só as opções oferecidas');
  const r = await dona.post('/api/ctai/perguntas/' + q.id + '/responder', { resposta: 'R$ 2,00', observacao: 'Conferi no TA' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const dep = (await dona.get('/api/ctai/contratos/' + UN + '/perguntas')).json;
  assert.equal(dep.perguntas.find((x) => x.id === q.id).aberta, false);
  assert.match(dep.decisoes[0].texto, /Decisão da analista \(cleuton\): R\$ 2,00/);
});

test('"Ainda não sei" continua em aberto; documento: marcar anexado e desfazer', async () => {
  const l = (await dona.get('/api/ctai/contratos/' + UN + '/perguntas')).json.perguntas;
  const q = l.find((x) => x.tipo === 'decisao'), d = l.find((x) => x.tipo === 'documento');
  await dona.post('/api/ctai/perguntas/' + q.id + '/responder', { resposta: 'Ainda não sei' });
  assert.equal((await dona.get('/api/ctai/contratos/' + UN + '/perguntas')).json.perguntas.find((x) => x.id === q.id).aberta, true);
  assert.equal((await dona.post('/api/ctai/perguntas/' + q.id + '/anexo', {})).status, 400, 'decisão não se marca como anexo');
  assert.equal((await dona.post('/api/ctai/perguntas/' + d.id + '/responder', { resposta: 'x' })).status, 400);
  assert.equal((await dona.post('/api/ctai/perguntas/' + d.id + '/anexo', {})).status, 200);
  assert.equal((await dona.get('/api/ctai/contratos/' + UN + '/perguntas')).json.perguntas.find((x) => x.id === d.id).aberta, false);
  assert.equal((await dona.post('/api/ctai/perguntas/' + d.id + '/anexo', { desfazer: true })).status, 200);
  assert.equal((await dona.get('/api/ctai/contratos/' + UN + '/perguntas')).json.perguntas.find((x) => x.id === d.id).aberta, true);
});

test('reimportar não apaga resposta; contadores por analista e por unidade; lista de contratos e painel trazem o número', async () => {
  const l = (await dona.get('/api/ctai/contratos/' + UN + '/perguntas')).json.perguntas;
  const q = l.find((x) => x.tipo === 'decisao');
  await dona.post('/api/ctai/perguntas/' + q.id + '/responder', { resposta: 'R$ 1,00' });
  const g = await sup.post(IMP + 'gravar', { csv: csv(L1, L2) });
  assert.equal(g.json.novas, 0); assert.equal(g.json.atualizadas, 2);
  assert.equal(S.db.get('SELECT resposta FROM perguntas_contrato WHERE id = ?', q.id).resposta, 'R$ 1,00');
  const geral = (await sup.get('/api/gestao/perguntas-contrato')).json;
  assert.equal(geral.contagem.total, 2); assert.equal(geral.contagem.abertas, 1);
  assert.equal(geral.contagem.porAnalista[0].login, 'cleuton');
  const lista = (await dona.get('/api/ctai/contratos')).json.contratos.find((c) => c.contrato_id === UN);
  assert.equal(lista.perguntas_abertas, 1);
  const painel = (await sup.get('/api/gestao/painel')).json;
  assert.equal(painel.perguntas_contrato.abertas, 1);
});

test('URGÊNCIAS: campos de origem e impacto, escopo da carteira, ordem por impacto e contador', async () => {
  const cab = '﻿unidade;analista;tipo;pergunta;opcoes;documento_pedido;onde_encontrar;valor_atual;valor_proposto;o_que_e;documento_origem;trecho_origem;data_origem;por_que_importa;o_que_fazer;impacto\n';
  const L3 = 'UPAE Perguntas;cleuton;decisao;Qual o número certo?;A|B;;;;;Número diferente;Contrato.pdf;“trecho do contrato”;2026-09-03;Aparece no parecer;Escolha;3';
  const L4 = 'UPAE Perguntas;cleuton;decisao;Qual a meta certa?;X|Y;;;;;Meta diferente;TA 5.pdf;“trecho da meta”;2026-08-01;Mede a produção;Escolha;1';
  assert.equal((await sup.post(IMP + 'gravar', { csv: cab + L3 + '\n' + L4 })).status, 200);
  const u = await dona.get('/api/ctai/urgencias'); assert.equal(u.status, 200, JSON.stringify(u.json));
  const g = u.json.unidades.find((x) => x.contrato_id === UN); assert.ok(g, 'a unidade da carteira aparece');
  const abertas = g.perguntas.filter((q) => q.aberta);
  assert.equal(abertas[0].impacto, 1, 'maior impacto primeiro'); assert.equal(abertas[0].doc_origem, 'TA 5.pdf'); assert.equal(abertas[0].trecho_origem, '“trecho da meta”'); assert.equal(abertas[0].data_origem, '2026-09-03' === abertas[0].data_origem ? '2026-09-03' : '2026-08-01');
  assert.ok(abertas.every((q) => q.por_que_importa !== undefined && q.o_que_fazer !== undefined));
  assert.equal((await dona.get('/api/ctai/urgencias/contador')).json.abertas, u.json.abertas);
  assert.equal(u.json.porAnalista.length, 0, 'analista não vê o quadro por analista');
  const s = await sup.get('/api/ctai/urgencias'); assert.ok(s.json.porAnalista.some((a) => a.login === 'cleuton'), 'superintendência vê por analista');
  const o = await outra.get('/api/ctai/urgencias'); assert.ok(!o.json.unidades.some((x) => x.contrato_id === UN), 'quem não tem a unidade não a vê');
});
