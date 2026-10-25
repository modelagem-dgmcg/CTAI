'use strict';
const express = require('express');
const A = require('../auth');
const G = require('../gaocg');
const trilha = require('../trilha');

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  const equipe = (u) => { if (!['admin', 'criador', 'superintendente'].includes(u.perfil)) throw A.erro(403, 'Sem permissão.'); };
  r.get('/estado', (req, res) => res.json(G.estado(db)));
  r.put('/config', (req, res) => { if (req.usuario.perfil !== 'admin') throw A.erro(403, 'Só a administração guarda a chave.'); res.json(G.salvarConfig(db, req.usuario, req.body)); });
  r.post('/testar', async (req, res) => { equipe(req.usuario); res.json(await G.testar(db, req.usuario)); });
  r.post('/atualizar', async (req, res) => {
    equipe(req.usuario);
    const ep = (req.body && req.body.endpoint) || 'api_unidades';
    const o = await G.ler(db, ep, {}, { forcar: true, usuario: req.usuario.login });
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'gaocg', registro: ep, campo: 'atualizacao', valor_novo: o.linhas.length + ' linha(s)' });
    res.json({ total: o.linhas.length, lido_em: o.lido_em, aviso: o.aviso || null });
  });
  r.get('/campos/:endpoint', async (req, res) => { if (req.usuario.perfil !== 'admin') throw A.erro(403, 'Só a administração.'); res.json(await G.campos(db, req.params.endpoint, req.usuario.login)); });
  r.get('/unidade/:contrato', async (req, res) => res.json(await G.unidadeDoContrato(db, req.params.contrato, req.usuario.login)));
  return r;
};
