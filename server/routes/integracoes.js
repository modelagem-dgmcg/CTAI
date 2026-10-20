'use strict';
// Rack da API do sistema da unidade: configuração (sem segredos), teste, prévia, sincronização e registro de chamadas.
const express = require('express');
const A = require('../auth');
const D = require('../dominio');
const adapters = require('../../adapters');
const sync = require('../../adapters/mv/sync');
const mv = require('../../adapters/mv');
const trilha = require('../trilha');

const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, ['admin', 'gestor_unidade', 'criador', 'colega', 'superintendente']));

  const podeVer = (u, i) => { if (A.PERFIS_CTAI.includes(u.perfil)) return; if (u.contrato_id !== i.contrato_id) throw erro(403, 'Sem acesso a esta integração.'); };
  const podeOperar = (u, i) => { if (u.perfil === 'admin') return; if (u.perfil === 'gestor_unidade' && u.contrato_id === i.contrato_id) return; throw erro(403, 'Só o administrador ou o gestor da unidade operam a integração.'); };

  r.get('/', (req, res) => {
    const todas = db.all('SELECT * FROM integracoes ORDER BY integracao_id').filter((i) => A.PERFIS_CTAI.includes(req.usuario.perfil) || i.contrato_id === req.usuario.contrato_id);
    const itens = todas.map((i) => {
      const cfg = D.json(i.config, {});
      const envDefinida = cfg.auth && (cfg.auth.tokenEnv || cfg.auth.chaveEnv || cfg.auth.usuarioEnv) ? !!require('../config').env(cfg.auth.tokenEnv || cfg.auth.chaveEnv || cfg.auth.usuarioEnv, '') : false;
      return Object.assign({}, i, { config: cfg, credencialDefinida: envDefinida, log: db.all('SELECT * FROM integracao_log WHERE integracao_id = ? ORDER BY log_id DESC LIMIT 15', i.integracao_id), lotes: db.all("SELECT * FROM lotes_api WHERE integracao_id = ? AND status = 'pendente'", i.integracao_id) });
    });
    let mapa = null;
    try { const m = mv.carregarMapeamento({}); mapa = { versao: m.versao, aviso: m.aviso, fontes: Object.entries(m.fontes).map(([f, d]) => ({ fonte: f, endpoint: d.endpoint, campos: Object.keys(d.campos).length })) }; } catch (_) { /* sem mapeamento */ }
    res.json({ integracoes: itens, tipos: adapters.descrever(), mapeamento: mapa });
  });

  r.put('/:id', (req, res) => {
    const i = sync.integracaoPorId(db, req.params.id);
    podeOperar(req.usuario, i);
    if (req.usuario.perfil !== 'admin') throw erro(403, 'Só o administrador altera a configuração.');
    const b = req.body || {};
    const cfg = Object.assign({}, i.config);
    if (typeof b.baseUrl === 'string') {
      if (b.baseUrl && !/^https?:\/\//i.test(b.baseUrl)) throw erro(400, 'O endereço deve começar com http:// ou https://.');
      cfg.baseUrl = b.baseUrl.trim();
    }
    if (b.auth) {
      const a = b.auth;
      if (!['bearer', 'basic', 'apikey', 'nenhuma'].includes(a.tipo)) throw erro(400, 'Tipo de autenticação inválido.');
      // Só nomes de variáveis do .env. Nunca o segredo em si.
      for (const k of ['tokenEnv', 'usuarioEnv', 'senhaEnv', 'chaveEnv']) if (a[k] && !/^[A-Z][A-Z0-9_]{2,60}$/.test(a[k])) throw erro(400, 'O campo ' + k + ' deve ser o NOME de uma variável do .env (ex.: MV_API_TOKEN), não a senha.');
      cfg.auth = { tipo: a.tipo, tokenEnv: a.tokenEnv, usuarioEnv: a.usuarioEnv, senhaEnv: a.senhaEnv, chaveEnv: a.chaveEnv, cabecalho: a.cabecalho };
    }
    if (b.timeoutMs) cfg.timeoutMs = Math.min(Math.max(Number(b.timeoutMs) || 30000, 2000), 120000);
    db.run('UPDATE integracoes SET config = ?, ativo = ?, estado = CASE WHEN ? = 1 THEN estado ELSE ? END WHERE integracao_id = ?', JSON.stringify(cfg), b.ativo ? 1 : 0, b.ativo ? 1 : 0, 'desativada', i.integracao_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'integracoes', registro: i.integracao_id, campo: 'config', valor_novo: { baseUrl: cfg.baseUrl, auth: cfg.auth && cfg.auth.tipo, ativo: !!b.ativo } });
    res.json({ ok: true });
  });

  r.post('/:id/testar', async (req, res) => {
    const i = sync.integracaoPorId(db, req.params.id);
    podeOperar(req.usuario, i);
    res.json(await sync.testar(db, i.integracao_id));
  });

  r.post('/:id/sincronizar', async (req, res) => {
    const i = sync.integracaoPorId(db, req.params.id);
    podeOperar(req.usuario, i);
    if (!i.ativo && !(req.body && req.body.dryRun)) throw erro(409, 'A integração está desativada. Ative-a, ou rode a prévia (sem gravar).');
    const b = req.body || {};
    res.json(await sync.sincronizar(db, i.integracao_id, { cid: b.cid, fontes: b.fontes, dryRun: !!b.dryRun, usuario: req.usuario }));
  });

  r.get('/:id/log', (req, res) => {
    const i = sync.integracaoPorId(db, req.params.id);
    podeVer(req.usuario, i);
    res.json({ log: db.all('SELECT * FROM integracao_log WHERE integracao_id = ? ORDER BY log_id DESC LIMIT 100', i.integracao_id) });
  });
  void podeVer;
  return r;
};
