'use strict';
// Contratos e TAs (Drive): só a CTAI usa; a chave nunca volta para a tela; o navegador nunca chama o script (tudo passa pelo servidor).
const express = require('express');
const A = require('../auth');
const CD = require('../contratos-drive');

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  const equipe = (u) => { if (!['admin', 'criador', 'superintendente'].includes(u.perfil)) throw A.erro(403, 'Sem permissão.'); };
  r.get('/estado', (req, res) => res.json(CD.estado(db)));
  r.put('/config', (req, res) => { if (req.usuario.perfil !== 'admin') throw A.erro(403, 'Só a administração guarda o endereço e a chave.'); res.json(CD.salvarConfig(db, req.usuario, req.body)); });
  r.post('/testar', async (req, res) => { equipe(req.usuario); res.json(await CD.testar(db, req.usuario, (req.body || {}).termo)); });
  r.get('/unidade/:contrato', async (req, res) => res.json(await CD.listarDaUnidade(db, req.usuario, req.params.contrato, { termo: req.query.termo, forcar: req.query.atualizar === '1' })));
  r.get('/unidade/:contrato/quadro', (req, res) => res.json(CD.quadro(db, req.usuario, req.params.contrato)));
  r.post('/unidade/:contrato/ler', async (req, res) => res.json(await CD.lerDocumento(db, req.usuario, req.params.contrato, (req.body || {}).drive_id, { semIA: !!(req.body || {}).semIA, termo: (req.body || {}).termo })));
  r.get('/docs/:id', (req, res) => res.json(CD.obter(db, req.usuario, req.params.id, req.query.texto === '1')));
  r.put('/docs/:id', (req, res) => res.json(CD.salvar(db, req.usuario, req.params.id, req.body || {})));
  r.post('/docs/:id/confirmar', (req, res) => res.json(CD.confirmar(db, req.usuario, req.params.id)));
  r.delete('/docs/:id', (req, res) => { CD.descartar(db, req.usuario, req.params.id); res.json({ ok: true }); });
  return r;
};
