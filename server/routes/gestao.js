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
  r.get('/usuarios', (req, res) => res.json({ usuarios: listaUsuarios(), perfis: A.PERFIS, contratos: db.all('SELECT contrato_id, unidade, municipio, demo FROM contratos ORDER BY demo, unidade'), setores: require('../../core/formularios').SETORES }));

  // A superintendente não cria nem altera administradores; só o administrador mexe em administradores.
  const protegido = (req, perfil) => { if (perfil === 'admin' && req.usuario.perfil !== 'admin') throw erro(403, 'Só o administrador cria ou altera administradores.'); };

  r.post('/usuarios', (req, res) => {
    const b = req.body || {};
    if (!PERFIS_GERIDOS.includes(b.perfil)) throw erro(400, 'Perfil inválido.');
    protegido(req, b.perfil);
    if (!String(b.nome || '').trim()) throw erro(400, 'Informe o nome.');
    if (b.senha) { const e = A.validarForcaSenha(b.senha); if (e) throw erro(400, e); }
    const id = db.tx(() => {
      const novo = A.criarUsuario(db, { login: b.login, nome: String(b.nome).trim(), perfil: b.perfil, contrato_id: b.contrato_id, setor: b.setor, senha: b.senha }, req.usuario.login);
      if (Array.isArray(b.unidades) && b.unidades.length && CART.ELEGIVEIS.includes(b.perfil)) CART.definir(db, req.usuario.login, novo, b.unidades, 'Definida no cadastro do usuário');
      return novo;
    });
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
    db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = ?, tentativas = 0, bloqueado_ate = NULL WHERE usuario_id = ?', A.gerarHash(nova), config.trocaSenhaObrigatoria ? 1 : 0, u.usuario_id);
    db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'usuarios', registro: u.login, campo: 'senha', valor_novo: 'redefinida', motivo: 'Senha temporária definida pela Gestão CTAI' });
    res.json({ ok: true, senhaTemporaria: req.body && req.body.senha ? undefined : config.senhaTemporaria });
  });

  // ---------- Carteira ----------
  r.get('/carteira', (req, res) => res.json({
    funcionarios: CART.porFuncionario(db), unidades: db.all('SELECT contrato_id, unidade, demo, tipo, municipio FROM contratos ORDER BY demo, unidade').map((c) => Object.assign(c, { demo: !!c.demo, responsaveis: CART.responsaveis(db, c.contrato_id), sem_gestor: G.semGestor(db, c.contrato_id) })),
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

  // Importação em lote de unidades e carteira
  const IMP = require('../importacao');
  const entradaImp = (req) => {
    const b = req.body || {};
    if (typeof b.csv !== 'string' || !b.csv.trim()) throw erro(400, 'Envie o conteúdo do arquivo CSV.');
    return { csv: b.csv, modo: b.modo, decisoes: b.decisoes, ignorarErros: !!b.ignorarErros };
  };
  r.get('/carteira/importar/modelo.csv', (req, res) => { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-carteira.csv"'); res.send(IMP.modeloCsv()); });
  r.post('/carteira/importar/previa', (req, res) => res.json(IMP.previa(db, entradaImp(req))));
  r.post('/carteira/importar/gravar', (req, res) => res.json(IMP.gravar(db, req.usuario.login, entradaImp(req))));
  r.get('/carteira/importar/historico', (req, res) => res.json({ importacoes: IMP.historico(db) }));

  // ---------- IA ----------
  r.get('/ia', (req, res) => res.json(IA.listar(db)));
  r.post('/ia/chaves', (req, res) => { const id = IA.criar(db, req.usuario.login, req.body || {}); res.json(Object.assign({ chave_id: id }, IA.listar(db))); });
  r.put('/ia/chaves/:id', (req, res) => { IA.atualizar(db, req.usuario.login, req.params.id, req.body || {}); res.json(IA.listar(db)); });
  r.delete('/ia/chaves/:id', (req, res) => { IA.remover(db, req.usuario.login, req.params.id); res.json(IA.listar(db)); });
  r.post('/ia/chaves/:id/testar', async (req, res) => { const t = await IA.testar(db, req.usuario.login, req.params.id); res.json(Object.assign(t, { estado: IA.listar(db) })); });

  // ---------- Produção ----------
  r.get('/producao', (req, res) => res.json(G.producao(db, { trimestre: req.query.trimestre, de: req.query.de, ate: req.query.ate, contrato: req.query.contrato, usuario_id: req.query.usuario_id })));

  // ---------- Acessos (somente leitura) ----------
  const AC = require('../acessos');
  const filtroAc = (q) => ({ de: q.de, ate: q.ate, contrato: q.contrato, usuario: q.usuario, evento: q.evento, origem: q.origem });
  const validar = (f) => { for (const d of [f.de, f.ate]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw erro(400, 'Data inválida (use AAAA-MM-DD).'); if (f.evento && !AC.EVENTOS.includes(f.evento)) throw erro(400, 'Evento inválido.'); return f; };
  r.get('/acessos', (req, res) => {
    const f = validar(filtroAc(req.query));
    res.json(Object.assign(AC.listar(db, f, req.query.limite), { filtros: f, eventos: AC.EVENTOS, contratos: db.all('SELECT contrato_id, unidade FROM contratos ORDER BY unidade'), trilha: { ok: trilha.verificar(db).ok } }));
  });
  r.get('/acessos.csv', (req, res) => {
    const f = validar(filtroAc(req.query));
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'gestao', registro: 'acessos', campo: 'exportacao', valor_novo: 'csv' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="acessos-ctai.csv"');
    res.send(AC.csv(AC.listar(db, f, 5000).linhas));
  });
  r.get('/acessos.pdf', async (req, res) => {
    const f = validar(filtroAc(req.query));
    const buf = await require('../pdf/acessos').gerar(AC.listar(db, f, 400), f, trilha.verificar(db).ok, req.usuario.nome);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'gestao', registro: 'acessos', campo: 'exportacao', valor_novo: 'pdf' });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="acessos-ctai.pdf"');
    res.send(buf);
  });

  // ---------- Entregas por carteira (caixa de entrada) ----------
  const CX = require('../caixa');
  r.get('/entregas', (req, res) => { CX.sincronizar(db); res.json(CX.entregas(db, { contrato: req.query.contrato, usuario_id: req.query.usuario_id })); });
  r.get('/entregas.pdf', async (req, res) => {
    CX.sincronizar(db);
    const buf = await require('../pdf/entregas').gerar(CX.entregas(db, { contrato: req.query.contrato, usuario_id: req.query.usuario_id }), req.usuario.nome);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'gestao', registro: 'entregas', campo: 'exportacao', valor_novo: 'pdf' });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="entregas-por-carteira.pdf"'); res.send(buf);
  });
  r.put('/caixa-config', (req, res) => {
    const n = Number(req.body && req.body.dias_nao_lido);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw erro(400, 'Informe de 1 a 60 dias.');
    CART.definirCfg(db, req.usuario.login, 'caixa_dias_nao_lido', n);
    res.json({ dias_nao_lido: CX.diasNaoLido(db) });
  });

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
