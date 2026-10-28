'use strict';
// "Alimentar o Analista": primeiro envio em lote do histórico (ver server/alimentar.js).
const express = require('express');
const A = require('../auth');
const AL = require('../alimentar');
const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  AL.recuperar(db);
  const soAdmin = (u) => { if (!['admin', 'superintendente'].includes(u.perfil)) throw erro(403, 'Esta ação é da administração ou da superintendência.'); };

  r.get('/estado', (req, res) => res.json(AL.estado(db, req.usuario)));
  // O navegador abre o ZIP e avisa a lista dos arquivos úteis; cada um ganha uma linha na fila e é enviado depois, um por vez.
  r.post('/lote', (req, res) => res.json(AL.registrarLote(db, req.usuario, req.body || {})));
  // O arquivo vai cru no corpo (sem base64), com o nome no cabeçalho; até 60 MB por arquivo. Com x-fila-id, é um arquivo de lote já registrado:
  // a resposta só volta depois da leitura (assim o navegador manda um por vez e o servidor nunca segura vários arquivos grandes).
  r.post('/arquivo', express.raw({ type: () => true, limit: '60mb' }), async (req, res) => {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const filaId = Number(req.get('x-fila-id'));
    if (filaId) return res.json(await AL.receberDoLote(db, req.usuario, filaId, corpo));
    const nome = decodeURIComponent(String(req.get('x-nome-arquivo') || 'arquivo'));
    res.json(await AL.receber(db, req.usuario, nome, corpo));
  });
  r.post('/:id/identificar', async (req, res) => res.json(await AL.identificar(db, req.usuario, req.params.id, req.body || {})));
  r.delete('/:id', (req, res) => { AL.descartar(db, req.usuario, req.params.id); res.json({ ok: true }); });
  r.post('/aprovar', (req, res) => res.json(AL.aprovar(db, req.usuario, (req.body || {}).ids)));
  r.post('/pular-problemas', (req, res) => res.json(AL.pularProblemas(db, req.usuario)));
  r.post('/liberar', (req, res) => res.json(AL.liberarProprio(db, req.usuario)));
  // Administração libera uma pessoa sem esperar o envio.
  r.post('/liberar-usuario', (req, res) => {
    soAdmin(req.usuario);
    const b = req.body || {};
    const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ? OR login = ?', Number(b.usuario_id) || -1, String(b.login || ''));
    if (!u) throw erro(404, 'Usuário não encontrado.');
    res.json(AL.liberar(db, u, req.usuario.login, String(b.motivo || 'Liberado pela administração').slice(0, 200)));
  });
  return r;
};
