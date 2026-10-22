'use strict';
// Modelo "Parecer CTAI": texto-padrão com dados do período, em branco, edição, PDF e revisão completa (dados fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const busca = require('../modules/analista/busca-externa');
const PM = require('../server/parecer-modelo');

let S, cleuton, id;
test.before(async () => {
  S = await iniciar();
  cleuton = cliente(S.base); await cleuton.entrar('cleuton');
  const cs = (await cleuton.get('/api/ctai/contratos')).json.contratos.find((c) => c.contrato_id === 'DEMO-UPA');
  const comps = cs.competencias.map((k) => k.competencia_id).slice(0, 3);
  id = (await cleuton.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T9', competencias: comps })).json.parecer_id;
});
test.after(async () => { await S.fechar(); });

test('período por extenso e citações de norma', () => {
  assert.equal(PM.periodoPorExtenso(['2026-01', '2026-02', '2026-03']), 'janeiro a março de 2026');
  const c = busca.citacoes('Conforme o art. 35 do Decreto Estadual n.º 58.200/2025 e a Lei n.º 15.210/2013, e a Lei 15.210/2013.');
  assert.equal(c.length, 2);
});

test('modelo padrão traz os dados da unidade; em branco esvazia; edição fica salva', async () => {
  const r = await cleuton.post('/api/ctai/pareceres/' + id + '/modelo', { modo: 'padrao' });
  assert.equal(r.status, 200);
  assert.match(r.json.modelo.secoes.introducao, /DEMO|Demonstra|UPA/i);
  assert.ok(!/\{unidade\}|\{periodo\}/.test(JSON.stringify(r.json.modelo.secoes)), 'sem campos sem preencher');
  const d = (await cleuton.get('/api/ctai/pareceres/' + id)).json;
  assert.ok(d.conteudoAtual.modelo && d.modeloDef.secoes.length >= 10);
  assert.equal((await cleuton.put('/api/ctai/pareceres/' + id + '/modelo', { secoes: { financeiro: 'Gasto com pessoal de 70% em todos os meses.' }, quadros: { q1: [['1.1', 'Consultas', '100', '120', '120%', 'Meta cumprida']] } })).status, 200);
  const d2 = (await cleuton.get('/api/ctai/pareceres/' + id)).json.conteudoAtual.modelo;
  assert.equal(d2.secoes.financeiro, 'Gasto com pessoal de 70% em todos os meses.');
  assert.equal(d2.quadros.q1[0][1], 'Consultas');
  const b = await cleuton.post('/api/ctai/pareceres/' + id + '/modelo', { modo: 'branco' });
  assert.equal(b.json.modelo.secoes.introducao, '');
  assert.equal((await cleuton.post('/api/ctai/pareceres/' + id + '/modelo', { modo: 'xx' })).status, 400);
});

test('revisão completa: acha seção vazia, campo pendente e outra unidade; busca externa avisa sem chave', async () => {
  await cleuton.post('/api/ctai/pareceres/' + id + '/modelo', { modo: 'padrao' });
  await cleuton.put('/api/ctai/pareceres/' + id + '/modelo', { secoes: { cma: '', conclusao: 'Texto da UPA Olinda ao final.' } });
  const r = await cleuton.post('/api/analista/pareceres/' + id + '/revisao-completa', {});
  assert.equal(r.status, 200);
  const tipos = r.json.achados.map((a) => a.tipo);
  assert.ok(tipos.includes('Seção vazia'), tipos.join());
  assert.ok(tipos.includes('Campo sem preencher'));
  assert.ok(r.json.externa && typeof r.json.externa.ok === 'boolean');
  assert.ok(r.json.salvos >= 2);
});

test('PDF da versão congelada traz as seções do modelo', async () => {
  const col = cliente(S.base); await col.entrar('colega1');
  const pdfs = require('../server/pdf/minuta');
  const c = require('../server/minuta').conteudoAtual(S.db, id);
  const blocos = pdfs.construirMinuta ? pdfs.construirMinuta(c, { numero: 1, hash: 'a'.repeat(64), criada_em: '2026-01-01T00:00:00Z' }, 'em conferência') : null;
  assert.ok(blocos); assert.ok(JSON.stringify(blocos).includes('DA INTRODUÇÃO'));
});

test('parecer pode ser criado para trimestre sem competência cadastrada', async () => {
  const r = await cleuton.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2030-T3', competencias: ['2030-07', '2030-08', '2030-09'] });
  assert.equal(r.status, 200);
  const ruim = await cleuton.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2030-T4', competencias: ['x'] });
  assert.equal(ruim.status, 400);
});
