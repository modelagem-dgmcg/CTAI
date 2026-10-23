'use strict';
// Autenticação por senha (scrypt), sessão em cookie httpOnly e controle de perfil.
// O sistema NUNCA guarda senha ou credencial do SEI. A assinatura no SEI é feita pela pessoa, no próprio SEI.
const crypto = require('crypto');
const config = require('./config');
const U = require('../core/util');
const trilha = require('./trilha');

const PERFIS = {
  admin: 'Administrador',
  criador: 'Analista CTAI (cria e confere)',
  colega: 'Colega conferente (CTAI)',
  superintendente: 'Superintendente (CTAI)',
  gestor_unidade: 'Administrador da unidade',
  setor_unidade: 'Responsável de setor da unidade',
};
const PERFIS_CTAI = ['admin', 'criador', 'colega', 'superintendente'];
const PERFIS_UNIDADE = ['gestor_unidade', 'setor_unidade'];

function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const N = 16384;
  const chave = crypto.scryptSync(senha, sal, 64, { N, r: 8, p: 1 }).toString('hex');
  return 'scrypt$' + N + '$' + sal + '$' + chave;
}

function conferirSenha(senha, armazenado) {
  const [alg, N, sal, chave] = String(armazenado).split('$');
  if (alg !== 'scrypt') return false;
  const calc = crypto.scryptSync(senha, sal, 64, { N: Number(N), r: 8, p: 1 });
  const orig = Buffer.from(chave, 'hex');
  return calc.length === orig.length && crypto.timingSafeEqual(calc, orig);
}

function validarForcaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
  return null;
}

function lerCookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expira = new Date(agora.getTime() + config.sessaoHoras * 3600 * 1000);
  db.run('INSERT INTO sessoes (token_hash, usuario_id, criada_em, expira_em) VALUES (?,?,?,?)', U.sha256(token), usuarioId, agora.toISOString(), expira.toISOString());
  return { token, expira };
}

function cookieDe(token, expira) {
  return 'ctai_sid=' + token + '; Path=/; HttpOnly; SameSite=Lax; Expires=' + expira.toUTCString() + (config.cookieSeguro ? '; Secure' : '');
}

const VISTO = new Map();
function usuarioDaSessao(db, req) {
  const token = lerCookies(req).ctai_sid;
  if (!token) return null;
  const s = db.get('SELECT * FROM sessoes WHERE token_hash = ?', U.sha256(token));
  if (!s) return null;
  if (new Date(s.expira_em) < new Date()) { db.run('DELETE FROM sessoes WHERE token_hash = ?', s.token_hash); return null; }
  const u = db.get('SELECT usuario_id, login, nome, perfil, funcao, contrato_id, setor, setores, trocar_senha, ativo FROM usuarios WHERE usuario_id = ?', s.usuario_id);
  if (!u || !u.ativo) return null;
  const t = Date.now(); // "visto por último": no máximo uma gravação por minuto por pessoa
  if (t - (VISTO.get(u.usuario_id) || 0) > 60000) { VISTO.set(u.usuario_id, t); try { db.run('UPDATE usuarios SET visto_em = ? WHERE usuario_id = ?', new Date(t).toISOString(), u.usuario_id); } catch (_) { /* sem presença */ } }
  return u;
}

// Tentativas de login: 5 erros bloqueiam por 10 minutos.
function entrar(db, login, senha) {
  const u = db.get('SELECT * FROM usuarios WHERE login = ?', String(login || '').trim().toLowerCase());
  if (!u || !u.ativo) { conferirSenha(senha || '', 'scrypt$16384$00$00'); return { erro: 'Usuário ou senha incorretos.', motivo: u ? 'usuário desativado' : 'usuário inexistente', conhecido: u || null }; }
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) return { erro: 'Acesso bloqueado por tentativas erradas. Tente de novo em alguns minutos.', motivo: 'acesso bloqueado', conhecido: u };
  if (!conferirSenha(senha || '', u.senha_hash)) {
    const t = u.tentativas + 1;
    if (t >= 5) db.run('UPDATE usuarios SET tentativas = 0, bloqueado_ate = ? WHERE usuario_id = ?', new Date(Date.now() + 10 * 60000).toISOString(), u.usuario_id);
    else db.run('UPDATE usuarios SET tentativas = ? WHERE usuario_id = ?', t, u.usuario_id);
    return { erro: 'Usuário ou senha incorretos.', motivo: 'senha incorreta (tentativa ' + Math.min(t, 5) + ' de 5)', bloqueou: t >= 5, conhecido: u };
  }
  db.run('UPDATE usuarios SET tentativas = 0, bloqueado_ate = NULL, ultimo_login = ? WHERE usuario_id = ?', new Date().toISOString(), u.usuario_id);
  return { usuario: u };
}

function criarUsuario(db, dados, quem) {
  const login = String(dados.login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw erro(400, 'O login deve ter de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado.');
  if (!PERFIS[dados.perfil]) throw erro(400, 'Perfil inválido.');
  if (PERFIS_UNIDADE.includes(dados.perfil) && !dados.contrato_id) throw erro(400, 'Usuário de unidade precisa de contrato.');
  if (db.get('SELECT 1 FROM usuarios WHERE login = ?', login)) throw erro(409, 'Já existe usuário com esse login.');
  const senha = dados.senha || config.senhaTemporaria;
  const setores = Array.isArray(dados.setores) ? dados.setores : (dados.setor ? [dados.setor] : []);
  const r = db.run('INSERT INTO usuarios (login, nome, perfil, contrato_id, setor, setores, senha_hash, trocar_senha, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,1,?)',
    login, dados.nome, dados.perfil, dados.contrato_id || null, setores[0] || null, setores.length ? JSON.stringify(setores) : null, gerarHash(senha), config.trocaSenhaObrigatoria ? 1 : 0, new Date().toISOString());
  trilha.registrar(db, { usuario: quem || 'sistema', tabela: 'usuarios', registro: login, campo: 'perfil', valor_novo: dados.perfil, motivo: 'Usuário criado' });
  return Number(r.lastInsertRowid);
}

// Setores (fichas) que a pessoa preenche: lista nova (setores) ou o setor único antigo.
function setoresDe(u) {
  if (!u) return [];
  if (u.setores) { try { const l = JSON.parse(u.setores); if (Array.isArray(l)) return l; } catch (_) { /* usa o antigo */ } }
  return u.setor ? [u.setor] : [];
}

function erro(status, mensagem) { const e = new Error(mensagem); e.status = status; return e; }

// Middleware: exige login e, opcionalmente, perfis.
function exigir(db, perfis) {
  return (req, res, next) => {
    const u = usuarioDaSessao(db, req);
    if (!u) return res.status(401).json({ erro: 'Entre com seu usuário e senha.' });
    if (!require('./exposicao').perfilPermitido(req, u.perfil, u.login)) return res.status(404).json({ erro: 'Rota não encontrada.' });
    if (u.trocar_senha && !String(req.originalUrl || '').startsWith('/api/auth/')) return res.status(403).json({ erro: 'Troque a senha temporária antes de continuar.', trocarSenha: true });
    if (perfis && !perfis.includes(u.perfil) && u.perfil !== 'admin') return res.status(403).json({ erro: 'Seu perfil não tem acesso a esta área.' });
    req.usuario = u;
    next();
  };
}

module.exports = { setoresDe, PERFIS, PERFIS_CTAI, PERFIS_UNIDADE, gerarHash, conferirSenha, validarForcaSenha, lerCookies, criarSessao, cookieDe, usuarioDaSessao, entrar, criarUsuario, exigir, erro };
