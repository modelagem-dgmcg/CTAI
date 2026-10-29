'use strict';
// Origem dos achados: quem apontou, em qual documento, em que parte e de que data; achados antigos não ganham documento inventado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrir, envolver } = require('../server/db');
const A = require('../server/achados');

function banco() {
  const db = envolver(abrir(':memory:'));
  db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('U1','UPA Teste','OSS','UPA',0)");
  return db;
}

test('salvar guarda fonte, documento, local e data; o padrão da chamada vale quando o achado não traz', () => {
  const db = banco();
  A.salvar(db, { origem_tipo: 'minuta', origem_id: 7, cid: null, provedor: 'x', usuario: 't',
    origem: { fonte: 'Minuta lida pela IA', documento: 'Minuta do parecer 213/2026', data: '2026-10-29' },
    achados: [{ gravidade: 'ALTA', tipo: 'Texto × desconto', trecho: 'Seção 6', origem: 'conferência local' }, { gravidade: 'BAIXA', tipo: 'IA', trecho: 'um trecho longo '.repeat(10) }, { gravidade: 'MÉDIA', tipo: 'GAOCG', trecho: 'x', origem: 'GAOCG' }] });
  const l = A.listar(db, { origem_tipo: 'minuta' });
  const a = l.find((x) => x.tipo === 'Texto × desconto'); const b = l.find((x) => x.tipo === 'IA'); const c = l.find((x) => x.tipo === 'GAOCG');
  assert.equal(a.origem_fonte, 'Conferência do sistema na minuta'); assert.equal(a.origem_local, 'Seção 6'); assert.equal(a.origem_doc, 'Minuta do parecer 213/2026'); assert.equal(a.origem_data, '2026-10-29');
  assert.equal(b.origem_fonte, 'Minuta lida pela IA'); assert.equal(b.origem_local, null, 'trecho longo não vira "local"');
  assert.equal(c.origem_fonte, 'Conferência com a base do GAOCG');
});

test('achados antigos: só a fonte do tipo de origem é preenchida; documento e data continuam vazios', () => {
  const db = banco();
  db.run("INSERT INTO achados (origem_tipo, origem_id, gravidade, tipo, trecho, status, criado_em) VALUES ('envio', 1, 'ALTA', 'Antigo', 't', 'novo', '2026-01-01')");
  db.run("INSERT INTO achados (origem_tipo, origem_id, gravidade, tipo, trecho, status, criado_em) VALUES ('outro', 2, 'ALTA', 'Sem tipo conhecido', 't', 'novo', '2026-01-01')");
  require('../server/db').abrir; // a migração roda na abertura; reaplicar o backfill é idempotente
  db.exec("UPDATE achados SET origem_fonte = CASE origem_tipo WHEN 'envio' THEN 'Relatório da unidade, lido pela IA' END WHERE origem_fonte IS NULL AND origem_tipo IN ('simas','envio','minuta','texto')");
  const x = db.get("SELECT * FROM achados WHERE tipo = 'Antigo'"), y = db.get("SELECT * FROM achados WHERE tipo = 'Sem tipo conhecido'");
  assert.equal(x.origem_fonte, 'Relatório da unidade, lido pela IA'); assert.equal(x.origem_doc, null); assert.equal(x.origem_data, null);
  assert.equal(y.origem_fonte, null);
});

test('front-end: achadoCard mostra o bloco de origem com aviso quando não registrada', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/ctai.js'), 'utf8');
  assert.match(src, /function origemBloco/); assert.match(src, /origemBloco\(a\),/); assert.match(src, /não registrada \(achado anterior/);
});
