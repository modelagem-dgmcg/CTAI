'use strict';
const express = require('express');
const A = require('../auth');
const trilha = require('../trilha');
const seed = require('../seed');
const config = require('../config');
const CART = require('../carteira');

const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, ['admin']));

  r.get('/usuarios', (req, res) => res.json({ usuarios: db.all('SELECT usuario_id, login, nome, perfil, contrato_id, setor, ativo, trocar_senha, ultimo_login FROM usuarios ORDER BY usuario_id'), perfis: A.PERFIS, contratos: db.all('SELECT contrato_id, unidade, municipio, demo FROM contratos ORDER BY demo, unidade') }));

  r.post('/usuarios', (req, res) => {
    const b = req.body || {};
    const id = db.tx(() => {
      const novo = A.criarUsuario(db, b, req.usuario.login);
      if (Array.isArray(b.unidades) && b.unidades.length && CART.ELEGIVEIS.includes(b.perfil)) CART.definir(db, req.usuario.login, novo, b.unidades, 'Definida no cadastro do usuário');
      return novo;
    });
    res.json({ usuario_id: id, senhaTemporaria: b.senha ? undefined : config.senhaTemporaria, aviso: 'A pessoa troca a senha no primeiro acesso.' });
  });

  r.post('/usuarios/:id/redefinir-senha', (req, res) => {
    const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', Number(req.params.id));
    if (!u) throw erro(404, 'Usuário não encontrado.');
    const nova = (req.body && req.body.senha) || config.senhaTemporaria;
    db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = ?, tentativas = 0, bloqueado_ate = NULL WHERE usuario_id = ?', A.gerarHash(nova), config.trocaSenhaObrigatoria ? 1 : 0, u.usuario_id);
    db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'usuarios', registro: u.login, campo: 'senha', valor_novo: 'redefinida' });
    res.json({ ok: true });
  });

  r.post('/usuarios/:id/ativo', (req, res) => {
    const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', Number(req.params.id));
    if (!u) throw erro(404, 'Usuário não encontrado.');
    if (u.usuario_id === req.usuario.usuario_id) throw erro(400, 'Você não pode desativar o próprio acesso.');
    const ativo = req.body && req.body.ativo ? 1 : 0;
    db.run('UPDATE usuarios SET ativo = ? WHERE usuario_id = ?', ativo, u.usuario_id);
    if (!ativo) db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'usuarios', registro: u.login, campo: 'ativo', valor_novo: ativo });
    res.json({ ok: true });
  });

  r.post('/demo/recarregar', (req, res) => { seed.recarregarDemo(db, req.usuario.login); res.json({ ok: true }); });
  r.post('/demo/apagar', (req, res) => {
    if (!(req.body && req.body.confirmar === 'APAGAR')) throw erro(400, 'Confirme digitando APAGAR.');
    seed.apagarDemo(db, req.usuario.login);
    res.json({ ok: true });
  });

  // Cópia consistente do banco (sem parar o sistema) para baixar como backup. Só administrador, só de dentro (a exposição bloqueia /api/admin por fora).
  r.get('/backup', (req, res) => {
    const fs = require('fs'), path = require('path');
    const arq = path.join(config.dataDir, 'backup-' + Date.now() + '.sqlite');
    try {
      db.exec("VACUUM INTO '" + arq.replace(/'/g, "''") + "'");
      trilha.registrar(db, { usuario: req.usuario.login, tabela: 'sistema', registro: 'banco', campo: 'backup', valor_novo: 'baixado' });
      const nome = 'ctai-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite';
      res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment; filename="' + nome + '"');
      res.send(fs.readFileSync(arq));
    } finally { try { fs.unlinkSync(arq); } catch (_) { /* já removido */ } }
  });

  r.get('/saude', (req, res) => {
    const v = trilha.verificar(db);
    res.json({ trilha: { ok: v.ok, eventos: v.total }, contratos: db.get('SELECT COUNT(*) AS n FROM contratos').n, envios: db.get('SELECT COUNT(*) AS n FROM envios').n, node: process.version, senhaTemporariaPadrao: config.senhaTemporaria === 'Trocar@123' });
  });
  return r;
};
