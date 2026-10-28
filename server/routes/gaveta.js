'use strict';
// Gaveta por mês: o que já foi lido de cada unidade, o que falta, o trimestre calculado e a conferência dos números (ver server/gaveta.js).
const express = require('express');
const A = require('../auth');
const G = require('../gaveta');
const C = require('../catalogo');

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  // O catálogo em vigor (por tipo de unidade): serve para a tela mostrar o que se espera.
  r.get('/catalogo', (req, res) => { const c = C.carregar(); res.json({ versao: c.versao, tipos: Object.fromEntries(Object.entries(c.tipos).map(([k, t]) => [k, { rotulo: t.rotulo, periodicidade: t.periodicidade, fluxo: t.fluxo, a_confirmar: t.a_confirmar || null, documentos: t.documentos.map((d) => ({ codigo: d.codigo, nome: d.nome, obrigatorio: !!d.obrigatorio, a_partir_de: d.a_partir_de || null, extrair: d.extrair || null })) }])) }); });
  r.get('/unidade/:contrato', (req, res) => res.json(G.visaoUnidade(db, req.usuario, req.params.contrato)));
  r.get('/unidade/:contrato/mes/:mes', (req, res) => res.json(G.mesVisao(db, req.usuario, req.params.contrato, req.params.mes)));
  r.get('/unidade/:contrato/trimestre/:tri', (req, res) => res.json(G.trimestreVisao(db, req.usuario, req.params.contrato, req.params.tri)));
  r.get('/documento/:id', (req, res) => res.json(G.documento(db, req.usuario, req.params.id, req.query.texto === '1')));
  // A leitura só propõe: a analista confere (e pode corrigir o valor) e confirma.
  r.post('/numeros/confirmar', (req, res) => res.json(G.confirmarNumeros(db, req.usuario, (req.body || {}).ids, (req.body || {}).edicoes)));
  return r;
};
