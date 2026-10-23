'use strict';
const express = require('express');
const A = require('../auth');
const MS = require('../mensageiro');
const PA = require('../ponte-analista');

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  r.get('/contatos', (req, res) => res.json({ contatos: MS.contatos(db, req.usuario) }));
  r.get('/contador', (req, res) => res.json(MS.contador(db, req.usuario)));
  r.get('/conversa/:login', (req, res) => res.json(MS.conversa(db, req.usuario, req.params.login)));
  r.post('/enviar', (req, res) => res.json({ msg_id: MS.enviar(db, req.usuario, req.body || {}) }));
  r.get('/grupos', (req, res) => res.json({ grupos: Object.entries(MS.GRUPOS).map(([id, nome]) => ({ id, nome })) }));
  r.post('/enviar-grupo', (req, res) => res.json({ enviadas: MS.enviarGrupo(db, req.usuario, req.body || {}) }));
  // Ponte com o Analista da diretoria (só texto).
  r.get('/ponte/estado', (req, res) => res.json({ configurada: PA.configurada() }));
  r.get('/ponte/contatos', async (req, res) => res.json({ contatos: await PA.contatos() }));
  r.get('/ponte/conversa', async (req, res) => res.json({ mensagens: await PA.conversa(req.query.id) }));
  r.post('/ponte/enviar', async (req, res) => { await PA.enviar(req.body && req.body.id, req.body && req.body.texto, req.usuario.nome); res.json({ ok: true }); });
  r.get('/anexo/:id', (req, res) => {
    const a = MS.anexo(db, req.usuario, req.params.id);
    res.set({ 'content-type': a.mime, 'content-disposition': 'attachment; filename="' + a.nome.replace(/[^\w.\- ]/g, '_') + '"', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
    res.send(Buffer.from(a.dados));
  });
  return r;
};
