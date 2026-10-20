'use strict';
// Gestão CTAI: usuários da CTAI, carteira de unidades, IA, produção da equipe e painel da superintendente.
// Acesso: superintendente e administrador.
const express = require('express');
const A = require('../auth');
const trilha = require('../trilha');
const config = require('../config');
const CART = require('../carteira');
const IA = require('../ia-config');
const G = require('../gestao');
const painelPdf = require('../pdf/painel');

const { erro } = A;
const PERFIS_GERIDOS = ['admin', 'criador', 'colega', 'superintendente', 'gestor_unidade', 'setor_unidade'];

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, ['superintendente']));

  // ---------- Usuários ----------
  const listaUsuarios = () => db.all('SELECT usuario_id, login, nome, perfil, contrato_id, setor, ativo, trocar_senha, ultimo_login, criado_em FROM usuarios ORDER BY perfil, nome')
    .map((u) => Object.assign(u, { ativo: !!u.ativo, trocar_senha: !!u.trocar_senha, unidades: ['criador', 'colega'].includes(u.perfil) ? CART.doUsuario(db, u.usuario_id) : null }));
  r.get('/usuarios', (req, res) => res.json({ usuarios: listaUsuarios(), perfis: A.PERFIS, contratos: db.all('SELECT contrato_id, unidade, demo FROM contratos ORDER BY demo, unidade'), setores: require('../../core/formularios').SETORES }));

  // A superintendente não cria nem altera administradores; só o administrador mexe em administradores.
  const protegido = (req, perfil) => { if (perfil === 'admin' && req.usuario.perfil !== 'admin') throw erro(403, 'Só o administrador cria ou altera administradores.'); };

  r.post('/usuarios', (req, res) => {
    const b = req.body || {};
    if (!PERFIS_GERIDOS.includes(b.perfil)) throw erro(400, 'Perfil inválido.');
    protegido(req, b.perfil);
    if (!String(b.nome || '').trim()) throw erro(400, 'Informe o nome.');
    if (b.senha) { const e = A.validarForcaSenha(b.senha); if (e) throw erro(400, e); }
    const id = A.criarUsuario(db, { login: b.login, nome: String(b.nome).trim(), perfil: b.perfil, contrato_id: b.contrato_id, setor: b.setor, senha: b.senha }, req.usuario.login);
    res.json({ usuario_id: id, senhaTemporaria: b.senha ? undefined : config.senhaTemporaria, aviso: 'A pessoa troca a senha no primeiro acesso.' });
  });

  const alvo = (req) => {
    const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', Number(req.params.id));
    if (!u) throw erro(404, 'Usuário não encontrado.');
    protegido(req, u.perfil);
    return u;
  };

  r.patch('/usuarios/:id', (req, res) => {
    const u = alvo(req);
    const b = req.body || {};
    const mud = [];
    if (b.nome !== undefined && String(b.nome).trim() && b.nome !== u.nome) mud.push(['nome', u.nome, String(b.nome).trim()]);
    if (b.perfil !== undefined && b.perfil !== u.perfil) {
      if (!PERFIS_GERIDOS.includes(b.perfil)) throw erro(400, 'Perfil inválido.');
      protegido(req, b.perfil);
      if (u.usuario_id === req.usuario.usuario_id) throw erro(400, 'Você não pode mudar o próprio perfil.');
      if (A.PERFIS_UNIDADE.includes(b.perfil) && !(b.contrato_id || u.contrato_id)) throw erro(400, 'Usuário de unidade precisa de contrato.');
      mud.push(['perfil', u.perfil, b.perfil]);
    }
    if (b.contrato_id !== undefined && (b.contrato_id || null) !== u.contrato_id) mud.push(['contrato_id', u.contrato_id, b.contrato_id || null]);
    if (b.setor !== undefined && (b.setor || null) !== u.setor) mud.push(['setor', u.setor, b.setor || null]);
    if (!mud.length) throw erro(400, 'Nada para alterar.');
    db.tx(() => {
      for (const [campo, , novo] of mud) db.run('UPDATE usuarios SET ' + campo + ' = ? WHERE usuario_id = ?', novo, u.usuario_id);
      for (const [campo, ant, novo] of mud) trilha.registrar(db, { usuario: req.usuario.login, tabela: 'usuarios', registro: u.login, campo, valor_anterior: ant, valor_novo: novo, motivo: b.motivo || null });
      // Quem deixa de ser criador/colega perde a carteira.
      if (mud.some((m) => m[0] === 'perfil') && !CART.ELEGIVEIS.includes(b.perfil)) CART.limpar(db, req.usuario.login, u.usuario_id, 'Mudança de perfil');
    });
    res.json({ ok: true });
  });

  r.post('/usuarios/:id/ativo', (req, res) => {
    const u = alvo(req);
    if (u.usuario_id === req.usuario.usuario_id) throw erro(400, 'Você não pode desativar o próprio acesso.');
    const ativo = req.body && req.body.ativo ? 1 : 0;
    db.run('UPDATE usuarios SET ativo = ? WHERE usuario_id = ?', ativo, u.usuario_id);
    if (!ativo) db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'usuarios', registro: u.login, campo: 'ativo', valor_novo: ativo, motivo: req.body && req.body.motivo });
    res.json({ ok: true });
  });

  r.post('/usuarios/:id/senha', (req, res) => {
    const u = alvo(req);
    const nova = (req.body && req.body.senha) || config.senhaTemporaria;
    if (req.body && req.body.senha) { const e = A.validarForcaSenha(nova); if (e) throw erro(400, e); }
    db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas = 0, bloqueado_ate = NULL WHERE usuario_id = ?', A.gerarHash(nova), u.usuario_id);
    db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'usuarios', registro: u.login, campo: 'senha', valor_novo: 'redefinida', motivo: 'Senha temporária definida pela Gestão CTAI' });
    res.json({ ok: true, senhaTemporaria: req.body && req.body.senha ? undefined : config.senhaTemporaria });
  });

  // ---------- Carteira ----------
  r.get('/carteira', (req, res) => res.json({
    funcionarios: CART.porFuncionario(db), unidades: db.all('SELECT contrato_id, unidade, demo FROM contratos ORDER BY demo, unidade').map((c) => Object.assign(c, { demo: !!c.demo, responsaveis: CART.responsaveis(db, c.contrato_id) })),
    semCarteira: CART.semCarteira(db), estrita: CART.estrita(db),
    regra: 'Quem tem unidades na carteira vê só essas unidades. Quem ainda não tem nenhuma vê todas (modo compatível) — a menos que o modo estrito esteja ligado. Superintendente e administrador veem todas.',
  }));
  r.put('/carteira/:usuarioId', (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.unidades)) throw erro(400, 'Informe a lista de unidades.');
    res.json(CART.definir(db, req.usuario.login, req.params.usuarioId, b.unidades, b.motivo));
  });
  r.post('/carteira/atribuir', (req, res) => {
    const b = req.body || {};
    const atuais = CART.doUsuario(db, b.usuario_id);
    res.json(CART.definir(db, req.usuario.login, b.usuario_id, [...new Set(atuais.concat(b.contrato_id ? [b.contrato_id] : []))], b.motivo));
  });
  r.put('/carteira-modo', (req, res) => { CART.definirCfg(db, req.usuario.login, 'carteira_estrita', req.body && req.body.estrita ? 'sim' : 'nao'); res.json({ estrita: CART.estrita(db) }); });
  r.get('/carteira/historico', (req, res) => res.json({ historico: CART.historico(db, { usuario_id: req.query.usuario_id, contrato_id: req.query.contrato }) }));

  // ---------- IA ----------
  r.get('/ia', (req, res) => res.json(IA.estado(db)));
  r.put('/ia/:provedor', (req, res) => { IA.salvar(db, req.usuario.login, req.params.provedor, req.body || {}); res.json(IA.estado(db)); });
  r.post('/ia/:provedor/testar', async (req, res) => { const t = await IA.testar(db, req.usuario.login, req.params.provedor); res.json(Object.assign(t, { estado: IA.estado(db) })); });

  // ---------- Produção ----------
  r.get('/producao', (req, res) => res.json(G.producao(db, { trimestre: req.query.trimestre, de: req.query.de, ate: req.query.ate, contrato: req.query.contrato, usuario_id: req.query.usuario_id })));

  // ---------- Painel da superintendente ----------
  const filtroPainel = (q) => ({ trimestre: q.trimestre, contrato: q.contrato, usuario_id: q.usuario_id });
  r.get('/painel', (req, res) => res.json(G.painel(db, filtroPainel(req.query))));
  r.get('/painel/pdf', async (req, res) => {
    const p = G.painel(db, filtroPainel(req.query));
    const buf = await painelPdf.gerar(p, req.usuario.nome);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'gestao', registro: p.trimestre, campo: 'painel_pdf', valor_novo: 'exportado' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="painel-ctai-' + p.trimestre + '.pdf"');
    res.send(buf);
  });

  return r;
};
