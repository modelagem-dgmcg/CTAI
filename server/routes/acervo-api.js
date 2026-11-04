'use strict';
// Leitura do Acervo CTAI por outros sistemas (Raio-X, Analista da diretoria etc.), só com chave de leitura. Não usa login de pessoa.
// Só devolve texto já sem dados de paciente. Cada chave é de um sistema, pode ser revogada, e o uso fica contado.
const express = require('express');
const AC = require('../acervo-ctai');

module.exports = (db) => {
  const r = express.Router();
  r.use((req, res, next) => {
    if (req.method !== 'GET') return res.status(405).json({ erro: 'Este acesso é só de leitura.' });
    const c = AC.validarChave(db, req.get('authorization'));
    if (!c) return res.status(401).json({ erro: 'Chave inválida ou revogada.' });
    req.sistema = c.sistema; next();
  });
  r.get('/documentos', (req, res) => res.json({ documentos: AC.listar(db, req.query) }));
  r.get('/documentos/:id', async (req, res) => {
    try { const d = await AC.ler(db, req.params.id); if (!d) return res.status(404).json({ erro: 'Documento não encontrado no Acervo.' }); res.json(d); }
    catch (e) { res.status(502).json({ erro: 'O Drive não respondeu agora. Tente de novo em instantes.' }); }
  });
  return r;
};
