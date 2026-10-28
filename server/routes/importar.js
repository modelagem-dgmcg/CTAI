'use strict';
// Importar Arquivos (etapa 1 da página da unidade): lista de conferência, relatório-modelo, arquivos recebidos e conclusão.
// O envio dos arquivos usa a fila de /api/alimentar (lote com destino); aqui ficam a lista, os checks e a conclusão.
// Perfis: criador e colega (só unidades da carteira), superintendente e administrador. A carteira é conferida em cada chamada.
const express = require('express');
const A = require('../auth');
const I = require('../importar');
const PT = require('../parecer-trimestre');

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
  r.get('/unidade/:c/:tri/simas', (req, res) => res.json(I.simas.visao(db, req.usuario, req.params.c, req.params.tri)));
  r.post('/unidade/:c/:tri/simas/confirmar', (req, res) => res.json(I.simas.confirmar(db, req.usuario, req.params.c, req.params.tri, b(req))));
  r.post('/unidade/:c/:tri/simas/achados', (req, res) => res.json(I.simas.atualizarAchados(db, req.usuario, req.params.c, req.params.tri)));
  // Parecer do trimestre (Redator CTAI, 1ª entrega): quadros, descontos, campos manuais, conferência número a número e PDF
  r.get('/unidade/:c/:tri/parecer', (req, res) => res.json(PT.visao(db, req.usuario, req.params.c, req.params.tri)));
  r.put('/unidade/:c/:tri/parecer', (req, res) => res.json(PT.salvar(db, req.usuario, req.params.c, req.params.tri, b(req))));
  r.post('/unidade/:c/:tri/parecer/pronto', (req, res) => { try { res.json(PT.marcarPronto(db, req.usuario, req.params.c, req.params.tri)); } catch (e) { if (e.bloqueios) return res.status(e.status || 409).json({ erro: e.message, bloqueios: e.bloqueios }); throw e; } });
  r.get('/unidade/:c/:tri/parecer/pdf', async (req, res) => { const buf = await PT.pdf(db, req.usuario, req.params.c, req.params.tri); res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="apuracao-' + req.params.tri + '.pdf"' }).send(buf); });
  r.get('/unidade/:c/:tri/ausencias', (req, res) => res.json({ ausencias: I.ausenciasRegistradas(db, req.usuario, req.params.c, req.params.tri) }));
  r.post('/unidade/:c/:tri/check', (req, res) => res.json(I.marcarCheck(db, req.usuario, req.params.c, req.params.tri, b(req))));
  r.post('/unidade/:c/:tri/concluir', (req, res) => res.json(I.concluir(db, req.usuario, req.params.c, req.params.tri, b(req))));
  r.post('/unidade/:c/:tri/reabrir', (req, res) => res.json(I.reabrir(db, req.usuario, req.params.c, req.params.tri)));
  r.post('/arquivos/apontar', (req, res) => res.json(I.apontar(db, req.usuario, b(req))));
  r.delete('/arquivos/:id', (req, res) => res.json(I.tirarArquivo(db, req.usuario, req.params.id)));
  r.get('/fila', (req, res) => res.json({ itens: I.fila(db, req.usuario, String(req.query.ids || '').split(',')) }));
  return r;
};
