'use strict';
// Caixa de entrada da CTAI (cada pessoa vê só a sua), substituições e "Minhas unidades".
const express = require('express');
const A = require('../auth');
const CX = require('../caixa');
const CART = require('../carteira');

const { erro } = A;
module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  const antes = (req, res, next) => { CX.sincronizar(db); next(); };

  r.get('/', antes, (req, res) => res.json(CX.listar(db, req.usuario, { unidade: req.query.unidade, tipo: req.query.tipo, situacao: req.query.situacao })));
  r.get('/resumo', antes, (req, res) => res.json(CX.resumo(db, req.usuario)));
  r.get('/contador', antes, (req, res) => res.json(CX.contador(db, req.usuario)));
  r.get('/unidades', antes, (req, res) => res.json(CX.visaoUnidades(db, req.usuario, { tipo: req.query.tipo, situacao: req.query.situacao })));
  r.put('/unidades/:contrato/compartilhar/:usuario', (req, res) => res.json(CX.compartilhar(db, req.usuario, req.params.contrato, req.params.usuario, !!(req.body && req.body.ligado))));
  r.get('/minhas-unidades', (req, res) => res.json(CX.minhasUnidades(db, req.usuario)));
  r.get('/substituicoes', (req, res) => res.json({ substituicoes: CX.listarSubstituicoes(db, req.usuario), pessoas: db.all("SELECT usuario_id, nome, login, perfil FROM usuarios WHERE ativo = 1 AND perfil IN ('criador','colega','superintendente','admin') ORDER BY nome") }));
  r.post('/substituicoes', (req, res) => res.json({ subst_id: CX.criarSubstituicao(db, req.usuario, req.body || {}) }));
  r.delete('/substituicoes/:id', (req, res) => res.json(CX.cancelarSubstituicao(db, req.usuario, req.params.id)));
  r.post('/lidos', (req, res) => res.json(CX.marcarTodosLidos(db, req.usuario)));
  r.get('/:id', (req, res) => res.json(CX.detalhe(db, req.usuario, req.params.id)));
  r.post('/:id/lido', (req, res) => res.json(CX.marcarLido(db, req.usuario, req.params.id)));
  r.post('/:id/tratar', (req, res) => res.json(CX.tratar(db, req.usuario, req.params.id, req.body && req.body.obs)));
  r.post('/:id/reabrir', (req, res) => res.json(CX.reabrir(db, req.usuario, req.params.id, req.body && req.body.motivo)));
  r.post('/:id/redirecionar', (req, res) => res.json(CX.redirecionarItem(db, req.usuario, req.params.id, req.body && req.body.para_usuario_id, req.body && req.body.motivo)));
  return r;
};
