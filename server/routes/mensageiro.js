'use strict';
const express = require('express');
const A = require('../auth');
const MS = require('../mensageiro');

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  r.get('/contatos', (req, res) => res.json({ contatos: MS.contatos(db, req.usuario) }));
  r.get('/contador', (req, res) => res.json(MS.contador(db, req.usuario)));
  r.get('/conversa/:login', (req, res) => res.json(MS.conversa(db, req.usuario, req.params.login)));
  r.post('/enviar', (req, res) => res.json({ msg_id: MS.enviar(db, req.usuario, req.body || {}) }));
  r.get('/anexo/:id', (req, res) => {
    const a = MS.anexo(db, req.usuario, req.params.id);
    res.set({ 'content-type': a.mime, 'content-disposition': 'attachment; filename="' + a.nome.replace(/[^\w.\- ]/g, '_') + '"', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
    res.send(Buffer.from(a.dados));
  });
  return r;
};
