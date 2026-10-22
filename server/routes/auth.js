'use strict';
const express = require('express');
const A = require('../auth');
const trilha = require('../trilha');
const U = require('../../core/util');
const EX = require('../exposicao');
const AC = require('../acessos');

module.exports = (db) => {
  const r = express.Router();
  const publico = (u) => ({ usuario_id: u.usuario_id, login: u.login, nome: u.nome, perfil: u.perfil, perfilNome: (u.perfil === 'superintendente' && u.funcao) || A.PERFIS[u.perfil], funcao: u.funcao || null, contrato_id: u.contrato_id, setor: u.setor, setores: A.setoresDe(u), trocar_senha: !!u.trocar_senha });

  r.post('/login', (req, res) => {
    const { login, senha } = req.body || {};
    const e = A.entrar(db, login, senha);
    const digitado = String(login || '').trim().toLowerCase().slice(0, 40);
    const falha = (detalhe, conhecido, bloqueio) => {
      const hash = trilha.registrar(db, { usuario: digitado, tabela: 'sessoes', registro: 'login', campo: 'tentativa', valor_novo: detalhe === 'recusada fora da rede interna' ? detalhe : 'falhou' });
      AC.registrar(db, req, { evento: 'falha', login: digitado, usuario: conhecido, detalhe, hash_trilha: hash });
      if (bloqueio) {
        const h2 = trilha.registrar(db, { usuario: digitado, tabela: 'sessoes', registro: 'login', campo: 'bloqueio', valor_novo: '10 minutos', motivo: '5 tentativas erradas' });
        AC.registrar(db, req, { evento: 'bloqueio', login: digitado, usuario: conhecido, detalhe: 'bloqueado por 10 minutos após 5 tentativas erradas', hash_trilha: h2 });
      }
    };
    if (e.erro) { falha(e.motivo || 'falhou', e.conhecido, e.bloqueou); return res.status(401).json({ erro: e.erro }); }
    if (!EX.perfilPermitido(req, e.usuario.perfil)) { falha('recusada fora da rede interna', e.usuario); return res.status(401).json({ erro: 'Usuário ou senha incorretos.' }); }
    const s = A.criarSessao(db, e.usuario.usuario_id);
    res.setHeader('Set-Cookie', A.cookieDe(s.token, s.expira));
    const hash = trilha.registrar(db, { usuario: e.usuario.login, tabela: 'sessoes', registro: 'login', campo: 'entrada', valor_novo: 'ok' });
    AC.registrar(db, req, { evento: 'entrada', usuario: e.usuario, detalhe: 'entrada (' + EX.origemDe(req).motivo + ')', hash_trilha: hash });
    res.json({ usuario: publico(e.usuario) });
  });

  r.post('/logout', (req, res) => {
    const t = A.lerCookies(req).ctai_sid;
    const quem = A.usuarioDaSessao(db, req);
    if (quem) { const hash = trilha.registrar(db, { usuario: quem.login, tabela: 'sessoes', registro: 'login', campo: 'saida', valor_novo: 'ok' }); AC.registrar(db, req, { evento: 'saida', usuario: quem, detalhe: 'saída', hash_trilha: hash }); }
    if (t) db.run('DELETE FROM sessoes WHERE token_hash = ?', U.sha256(t));
    res.setHeader('Set-Cookie', 'ctai_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    const u = A.usuarioDaSessao(db, req);
    if (!u) return res.status(401).json({ erro: 'Sem sessão.' });
    if (!EX.perfilPermitido(req, u.perfil)) return res.status(401).json({ erro: 'Sem sessão.' });
    res.json({ usuario: publico(u) });
  });

  r.post('/trocar-senha', A.exigir(db), (req, res) => {
    const { atual, nova } = req.body || {};
    const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', req.usuario.usuario_id);
    if (!A.conferirSenha(atual || '', u.senha_hash)) return res.status(400).json({ erro: 'A senha atual não confere.' });
    const f = A.validarForcaSenha(nova);
    if (f) return res.status(400).json({ erro: f });
    if (nova === atual) return res.status(400).json({ erro: 'A nova senha precisa ser diferente da atual.' });
    db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE usuario_id = ?', A.gerarHash(nova), u.usuario_id);
    trilha.registrar(db, { usuario: u.login, tabela: 'usuarios', registro: u.login, campo: 'senha', valor_novo: 'alterada' });
    res.json({ ok: true });
  });
  return r;
};
