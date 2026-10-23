'use strict';
// Equipe da unidade, cuidada pelo próprio gestor da unidade (no Portal da Unidade).
// O gestor só alcança usuários "setor_unidade" do SEU contrato. Gestor da unidade, usuários da CTAI e de outras unidades ficam fora do alcance (404).
const A = require('./auth');
const F = require('../core/formularios');
const trilha = require('./trilha');
const acessos = require('./acessos');
const config = require('./config');

const { erro } = A;
const SETORES_IDS = F.SETORES.map((s) => s.id);

function setoresValidos(lista) {
  if (!Array.isArray(lista) || !lista.length) throw erro(400, 'Escolha ao menos uma ficha para a pessoa preencher.');
  const out = [...new Set(lista.map(String))];
  for (const s of out) if (!SETORES_IDS.includes(s)) throw erro(400, 'Ficha inválida: ' + s + '.');
  return out;
}

function doGestor(db, gestor, id) {
  const u = db.get("SELECT * FROM usuarios WHERE usuario_id = ? AND perfil = 'setor_unidade' AND contrato_id = ?", Number(id), gestor.contrato_id);
  if (!u) throw erro(404, 'Pessoa não encontrada na sua unidade.');
  return u;
}

function listar(db, gestor) {
  try { require('./provisorios').varrer(db); } catch (_) { /* segue */ }
  const todos = db.all("SELECT usuario_id, login, nome, perfil, funcao, setor, setores, ativo, trocar_senha, ultimo_login, prov_status, prov_setor, prov_formulario, prov_justificativa, prov_expira_em, prov_resposta, prov_decidido_por FROM usuarios WHERE apagado_em IS NULL AND contrato_id = ? AND perfil IN ('setor_unidade','gestor_unidade') ORDER BY perfil DESC, nome", gestor.contrato_id)
    .map((u) => ({ usuario_id: u.usuario_id, login: u.login, nome: u.nome, perfil: u.perfil, perfilNome: (u.perfil === 'superintendente' && u.funcao) || A.PERFIS[u.perfil], funcao: u.funcao || null, setores: A.setoresDe(u), ativo: !!u.ativo, trocar_senha: !!u.trocar_senha, ultimo_login: u.ultimo_login, provisorio: u.prov_status && u.prov_status !== 'permanente' ? { status: u.prov_status, setor: u.prov_setor, formulario: u.prov_formulario, justificativa: u.prov_justificativa, expira_em: u.prov_expira_em, resposta: u.prov_resposta, por: u.prov_decidido_por } : null, somenteLeitura: u.perfil !== 'setor_unidade' }));
  const fichas = F.SETORES.map((s) => ({ id: s.id, nome: s.nome, responsaveis: todos.filter((u) => u.perfil === 'setor_unidade' && u.ativo && u.setores.includes(s.id)).map((u) => ({ usuario_id: u.usuario_id, nome: u.nome })) }));
  return { usuarios: todos, fichas, setores: F.SETORES.map((s) => ({ id: s.id, nome: s.nome })) };
}

const legivel = (v) => (Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => k + ': ' + (Array.isArray(x) ? x.join(', ') : x)).join('; ') : String(v)));
function trilhar(db, req, gestor, alvoLogin, campo, anterior, novo, motivo) {
  const hash = trilha.registrar(db, { usuario: gestor.login, tabela: 'usuarios', registro: alvoLogin, campo, valor_anterior: anterior, valor_novo: novo, motivo: motivo || 'Feito pelo gestor da unidade' });
  acessos.registrar(db, req, { evento: 'cadastro', usuario: gestor, detalhe: alvoLogin + ': ' + campo + (novo !== undefined && novo !== null && campo !== 'senha' ? ' → ' + legivel(novo) : ''), hash_trilha: hash });
}

function criar(db, req, gestor, b) {
  const nome = String(b.nome || '').trim();
  if (!nome) throw erro(400, 'Informe o nome.');
  const setorLivre = String(b.setor_livre || '').trim().slice(0, 80), formLivre = String(b.formulario_livre || '').trim().slice(0, 80), just = String(b.justificativa || '').trim().slice(0, 1000);
  const provisorio = !!(setorLivre || formLivre);
  if (provisorio) {
    if (!setorLivre || !formLivre) throw erro(400, 'Digite o setor e o nome do formulário.');
    if (just.length < 10) throw erro(400, 'Explique por que essa pessoa precisa do acesso (a analista vai ler).');
  }
  const setores = provisorio && (!Array.isArray(b.setores) || !b.setores.length) ? [] : setoresValidos(b.setores);
  if (b.senha) { const e = A.validarForcaSenha(b.senha); if (e) throw erro(400, e); }
  const id = A.criarUsuario(db, { login: b.login, nome, perfil: 'setor_unidade', contrato_id: gestor.contrato_id, setores, senha: b.senha }, gestor.login);
  const u = db.get('SELECT login FROM usuarios WHERE usuario_id = ?', id);
  trilhar(db, req, gestor, u.login, 'criacao', null, { perfil: 'setor_unidade', fichas: setores });
  if (provisorio) {
    const prazo = new Date(Date.now() + require('./provisorios').DIAS * 86400000).toISOString();
    db.run("UPDATE usuarios SET prov_status = 'pendente', prov_setor = ?, prov_formulario = ?, prov_justificativa = ?, prov_expira_em = ? WHERE usuario_id = ?", setorLivre, formLivre, just, prazo, id);
    trilhar(db, req, gestor, u.login, 'acesso_provisorio', null, { setor: setorLivre, formulario: formLivre, expira_em: prazo }, just);
    require('./provisorios').avisarAnalista(db, gestor, Object.assign(db.get('SELECT * FROM usuarios WHERE usuario_id = ?', id)));
  }
  return { usuario_id: id, provisorio, senhaTemporaria: b.senha ? undefined : config.senhaTemporaria };
}

function atualizar(db, req, gestor, id, b) {
  const u = doGestor(db, gestor, id);
  const mud = [];
  if (b.nome !== undefined && String(b.nome).trim() && String(b.nome).trim() !== u.nome) mud.push(['nome', u.nome, String(b.nome).trim()]);
  if (b.setores !== undefined) {
    const novos = setoresValidos(b.setores);
    const ant = A.setoresDe(u);
    if (JSON.stringify(ant) !== JSON.stringify(novos)) mud.push(['fichas', ant, novos]);
  }
  if (!mud.length) throw erro(400, 'Nada para alterar.');
  db.tx(() => {
    for (const [c, , n] of mud) {
      if (c === 'nome') db.run('UPDATE usuarios SET nome = ? WHERE usuario_id = ?', n, u.usuario_id);
      else db.run('UPDATE usuarios SET setor = ?, setores = ? WHERE usuario_id = ?', n[0], JSON.stringify(n), u.usuario_id);
      trilhar(db, req, gestor, u.login, c, mud.find((m) => m[0] === c)[1], n);
    }
  });
}

function ativar(db, req, gestor, id, ativo) {
  const u = doGestor(db, gestor, id);
  db.run('UPDATE usuarios SET ativo = ? WHERE usuario_id = ?', ativo ? 1 : 0, u.usuario_id);
  if (!ativo) db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
  trilhar(db, req, gestor, u.login, 'ativo', u.ativo, ativo ? 1 : 0);
}

function senhaTemporaria(db, req, gestor, id, senha) {
  const u = doGestor(db, gestor, id);
  const nova = senha || config.senhaTemporaria;
  if (senha) { const e = A.validarForcaSenha(senha); if (e) throw erro(400, e); }
  db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = ?, tentativas = 0, bloqueado_ate = NULL WHERE usuario_id = ?', A.gerarHash(nova), config.trocaSenhaObrigatoria ? 1 : 0, u.usuario_id);
  db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.usuario_id);
  trilhar(db, req, gestor, u.login, 'senha', null, 'redefinida', 'Senha temporária definida pelo gestor da unidade');
  return { senhaTemporaria: senha ? undefined : config.senhaTemporaria };
}

// Troca o responsável de uma ficha: a pessoa escolhida passa a ser a única responsável pela ficha na unidade.
function trocarResponsavel(db, req, gestor, setor, usuarioId) {
  if (!SETORES_IDS.includes(setor)) throw erro(404, 'Ficha desconhecida.');
  const novo = doGestor(db, gestor, usuarioId);
  if (!novo.ativo) throw erro(400, 'A pessoa escolhida está desativada.');
  db.tx(() => {
    for (const o of db.all("SELECT * FROM usuarios WHERE contrato_id = ? AND perfil = 'setor_unidade'", gestor.contrato_id)) {
      const ant = A.setoresDe(o);
      const tem = ant.includes(setor);
      if (o.usuario_id === novo.usuario_id && !tem) {
        const n = ant.concat([setor]);
        db.run('UPDATE usuarios SET setor = ?, setores = ? WHERE usuario_id = ?', n[0], JSON.stringify(n), o.usuario_id);
        trilhar(db, req, gestor, o.login, 'ficha_assumida', ant, n, 'Responsável pela ficha de ' + setor);
      } else if (o.usuario_id !== novo.usuario_id && tem) {
        const n = ant.filter((x) => x !== setor);
        db.run('UPDATE usuarios SET setor = ?, setores = ? WHERE usuario_id = ?', n[0] || null, n.length ? JSON.stringify(n) : null, o.usuario_id);
        trilhar(db, req, gestor, o.login, 'ficha_cedida', ant, n, 'Responsável pela ficha de ' + setor + ' passou para ' + novo.login);
      }
    }
  });
}

module.exports = { listar, criar, atualizar, ativar, senhaTemporaria, trocarResponsavel };
