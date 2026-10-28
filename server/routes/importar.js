'use strict';
// Importar Arquivos (etapa 1 da página da unidade): lista de conferência, relatório-modelo, arquivos recebidos e conclusão.
// O envio dos arquivos usa a fila de /api/alimentar (lote com destino); aqui ficam a lista, os checks e a conclusão.
// Perfis: criador e colega (só unidades da carteira), superintendente e administrador. A carteira é conferida em cada chamada.
const express = require('express');
const A = require('../auth');
const I = require('../importar');

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  const b = (req) => req.body || {};
  r.get('/unidade/:c/lista', (req, res) => res.json(I.visaoLista(db, req.usuario, req.params.c)));
  r.put('/unidade/:c/lista', (req, res) => res.json(I.salvarRascunho(db, req.usuario, req.params.c, b(req).itens)));
  r.post('/unidade/:c/lista/completar-padrao', (req, res) => res.json(I.completarComPadrao(db, req.usuario, req.params.c)));
  r.post('/unidade/:c/lista/descartar', (req, res) => res.json(I.descartarRascunho(db, req.usuario, req.params.c)));
  r.post('/unidade/:c/lista/confirmar', (req, res) => res.json(I.confirmarLista(db, req.usuario, req.params.c)));
  // Texto completo (mascarado) do relatório-modelo: base do Redator CTAI (ainda não construído).
  r.get('/unidade/:c/modelo', (req, res) => res.json(I.textoDoModelo(db, req.usuario, req.params.c)));
  r.get('/unidade/:c/:tri', (req, res) => res.json(I.estado(db, req.usuario, req.params.c, req.params.tri)));
  r.post('/unidade/:c/:tri/check', (req, res) => res.json(I.marcarCheck(db, req.usuario, req.params.c, req.params.tri, b(req))));
  r.post('/unidade/:c/:tri/concluir', (req, res) => res.json(I.concluir(db, req.usuario, req.params.c, req.params.tri, b(req))));
  r.post('/unidade/:c/:tri/reabrir', (req, res) => res.json(I.reabrir(db, req.usuario, req.params.c, req.params.tri)));
  r.post('/arquivos/apontar', (req, res) => res.json(I.apontar(db, req.usuario, b(req))));
  r.delete('/arquivos/:id', (req, res) => res.json(I.tirarArquivo(db, req.usuario, req.params.id)));
  r.get('/fila', (req, res) => res.json({ itens: I.fila(db, req.usuario, String(req.query.ids || '').split(',')) }));
  return r;
};
