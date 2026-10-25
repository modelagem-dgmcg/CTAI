'use strict';
// Histórico dos relatórios anteriores. Perfis da CTAI; cada pessoa só mexe nas unidades da sua carteira (administração e superintendência, em todas).
const express = require('express');
const A = require('../auth');
const H = require('../historico');
const ESPELHO = require('../espelho-drive');
const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  const soAdmin = (u) => { if (!['admin', 'superintendente'].includes(u.perfil)) throw erro(403, 'Esta ação é da administração ou da superintendência.'); };

  r.get('/meta', (req, res) => res.json({ tipos: H.TIPOS_DOC, situacoes: H.SITUACOES, espelho: ESPELHO.estado(), voce: { perfil: req.usuario.perfil } }));
  r.get('/carteira', (req, res) => res.json({ unidades: H.carteira(db, req.usuario) }));
  r.get('/unidades/:contrato', (req, res) => res.json(H.unidade(db, req.usuario, req.params.contrato)));
  r.get('/unidades/:contrato/avisos', (req, res) => res.json(H.avisosDaUnidade(db, req.usuario, req.params.contrato)));

  r.post('/relatorios', (req, res) => res.json(H.criarManual(db, req.usuario, req.body || {})));
  r.post('/importar', async (req, res) => res.json(await H.importar(db, req.usuario, req.body || {})));
  r.get('/relatorios/:id', (req, res) => res.json(H.obter(db, req.usuario, req.params.id, req.query.texto === '1')));
  r.put('/relatorios/:id', (req, res) => res.json(H.salvar(db, req.usuario, req.params.id, req.body || {})));
  r.post('/relatorios/:id/confirmar', (req, res) => res.json(H.confirmar(db, req.usuario, req.params.id)));
  r.delete('/relatorios/:id', (req, res) => { H.excluirRascunho(db, req.usuario, req.params.id); res.json({ ok: true }); });
  r.put('/recomendacoes/:id', (req, res) => res.json(H.mudarSituacao(db, req.usuario, req.params.id, (req.body || {}).situacao, (req.body || {}).nota)));

  r.post('/espelho/enviar', async (req, res) => { soAdmin(req.usuario); res.json(await H.espelharAgora(db, req.usuario)); });
  r.post('/espelho/restaurar', async (req, res) => { soAdmin(req.usuario); res.json(await H.restaurarDoEspelho(db, req.usuario)); });
  return r;
};
