'use strict';
// Carteira: quais unidades (contratos) cada funcionário da CTAI acompanha. Guarda o histórico (quem entrou, quem saiu, quando e por quê).
// Regras de visibilidade (função permitidos):
//  - admin e superintendente veem todas as unidades;
//  - criador e colega com carteira veem só as unidades da carteira (leitura e escrita);
//  - criador e colega SEM nenhuma unidade na carteira veem tudo (modo compatível, como era antes da carteira),
//    a menos que a superintendência ligue o "modo estrito" (então veem nada até receberem unidades).
const trilha = require('./trilha');
const { erro } = require('./auth');

const ELEGIVEIS = ['criador', 'colega'];

function cfg(db, chave, padrao) {
  const r = db.get('SELECT valor FROM gestao_config WHERE chave = ?', chave);
  return r && r.valor !== null ? r.valor : padrao;
}
function definirCfg(db, quem, chave, valor) {
  const ant = cfg(db, chave, null);
  db.run('INSERT INTO gestao_config (chave, valor, atualizado_por, atualizado_em) VALUES (?,?,?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em',
    chave, String(valor), quem, new Date().toISOString());
  trilha.registrar(db, { usuario: quem, tabela: 'gestao_config', registro: chave, campo: 'valor', valor_anterior: ant, valor_novo: valor });
}
const estrita = (db) => cfg(db, 'carteira_estrita', 'nao') === 'sim';

function doUsuario(db, usuarioId) {
  return db.all('SELECT contrato_id FROM carteira WHERE usuario_id = ? AND ate IS NULL', Number(usuarioId)).map((r) => r.contrato_id);
}

// null = vê tudo; senão, Set com os contratos permitidos.
function permitidos(db, u) {
  if (!u || ['admin', 'superintendente'].includes(u.perfil)) return null;
  if (!ELEGIVEIS.includes(u.perfil)) return null;
  const meus = doUsuario(db, u.usuario_id);
  if (!meus.length && !estrita(db)) return null;
  // Quem substitui alguém (caixa de entrada redirecionada por período) enxerga também as unidades dessa pessoa enquanto durar a substituição.
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const subs = db.all('SELECT de_usuario_id FROM caixa_substituicoes WHERE para_usuario_id = ? AND cancelado_em IS NULL AND desde <= ? AND ate >= ?', u.usuario_id, hoje, hoje);
  const extra = subs.flatMap((x) => doUsuario(db, x.de_usuario_id));
  return new Set(meus.concat(extra));
}

function exigir(db, u, contratoId) {
  const p = permitidos(db, u);
  if (p && contratoId && !p.has(contratoId)) throw erro(403, 'Esta unidade não está na sua carteira. Peça à superintendente para incluí-la.');
}

// Define o conjunto de unidades de um funcionário. Registra entradas e saídas no histórico e na trilha.
function definir(db, quem, usuarioId, contratos, motivo) {
  const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', Number(usuarioId));
  if (!u) throw erro(404, 'Funcionário não encontrado.');
  if (!ELEGIVEIS.includes(u.perfil)) throw erro(400, 'Só criador e colega têm carteira (a superintendente e o administrador veem todas as unidades).');
  const novos = [...new Set((contratos || []).map(String))];
  for (const c of novos) if (!db.get('SELECT 1 FROM contratos WHERE contrato_id = ?', c)) throw erro(400, 'Unidade não encontrada: ' + c);
  const atuais = doUsuario(db, u.usuario_id);
  const sairam = atuais.filter((c) => !novos.includes(c));
  const entraram = novos.filter((c) => !atuais.includes(c));
  const agora = new Date().toISOString();
  db.tx(() => {
    for (const c of sairam) {
      db.run('UPDATE carteira SET ate = ?, removido_por = ?, motivo = ? WHERE usuario_id = ? AND contrato_id = ? AND ate IS NULL', agora, quem, motivo || null, u.usuario_id, c);
      trilha.registrar(db, { usuario: quem, tabela: 'carteira', registro: u.login, campo: 'unidade_removida', valor_anterior: c, motivo });
    }
    for (const c of entraram) {
      db.run('INSERT INTO carteira (usuario_id, contrato_id, desde, atribuido_por, motivo) VALUES (?,?,?,?,?)', u.usuario_id, c, agora, quem, motivo || null);
      trilha.registrar(db, { usuario: quem, tabela: 'carteira', registro: u.login, campo: 'unidade_atribuida', valor_novo: c, motivo });
    }
  });
  return { entraram, sairam };
}

// Encerra toda a carteira de alguém (ex.: mudou de perfil ou foi desligado).
function limpar(db, quem, usuarioId, motivo) {
  const u = db.get('SELECT login FROM usuarios WHERE usuario_id = ?', Number(usuarioId));
  const agora = new Date().toISOString();
  for (const c of doUsuario(db, usuarioId)) {
    db.run('UPDATE carteira SET ate = ?, removido_por = ?, motivo = ? WHERE usuario_id = ? AND contrato_id = ? AND ate IS NULL', agora, quem, motivo || null, Number(usuarioId), c);
    trilha.registrar(db, { usuario: quem, tabela: 'carteira', registro: u ? u.login : usuarioId, campo: 'unidade_removida', valor_anterior: c, motivo });
  }
}

function porFuncionario(db) {
  const ativos = db.all("SELECT usuario_id, login, nome, perfil, ativo FROM usuarios WHERE perfil IN ('criador','colega') ORDER BY nome");
  return ativos.map((u) => Object.assign(u, { ativo: !!u.ativo, unidades: doUsuario(db, u.usuario_id) }));
}

function semCarteira(db) {
  return db.all('SELECT c.contrato_id, c.unidade, c.demo FROM contratos c WHERE NOT EXISTS (SELECT 1 FROM carteira w WHERE w.contrato_id = c.contrato_id AND w.ate IS NULL) ORDER BY c.demo, c.unidade')
    .map((c) => Object.assign(c, { demo: !!c.demo }));
}

function responsaveis(db, contratoId) {
  return db.all('SELECT u.usuario_id, u.nome, u.login, u.perfil FROM carteira w JOIN usuarios u ON u.usuario_id = w.usuario_id WHERE w.contrato_id = ? AND w.ate IS NULL ORDER BY u.nome', contratoId);
}

function historico(db, filtro) {
  const where = [], args = [];
  if (filtro.usuario_id) { where.push('w.usuario_id = ?'); args.push(Number(filtro.usuario_id)); }
  if (filtro.contrato_id) { where.push('w.contrato_id = ?'); args.push(filtro.contrato_id); }
  return db.all('SELECT w.*, u.nome, u.login, c.unidade FROM carteira w JOIN usuarios u ON u.usuario_id = w.usuario_id LEFT JOIN contratos c ON c.contrato_id = w.contrato_id'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY w.carteira_id DESC LIMIT 300', ...args);
}

// ---- Barreira nas rotas do console: confere a unidade de qualquer recurso citado na URL ou no corpo ----
function contratoDe(db, tipo, id) {
  const n = Number(id);
  switch (tipo) {
    case 'cid': { const r = db.get('SELECT contrato_id FROM competencias WHERE cid = ?', n); return r ? r.contrato_id : null; }
    case 'envio': { const r = db.get('SELECT k.contrato_id FROM envios e JOIN competencias k ON k.cid = e.cid WHERE e.envio_id = ?', n); return r ? r.contrato_id : null; }
    case 'parecer': { const r = db.get('SELECT contrato_id FROM pareceres WHERE parecer_id = ?', n); return r ? r.contrato_id : null; }
    case 'versao': { const r = db.get('SELECT p.contrato_id FROM versoes_minuta v JOIN pareceres p ON p.parecer_id = v.parecer_id WHERE v.versao_id = ?', n); return r ? r.contrato_id : null; }
    case 'achado': { const r = db.get('SELECT k.contrato_id FROM achados a LEFT JOIN competencias k ON k.cid = a.cid WHERE a.achado_id = ?', n); return r ? r.contrato_id : null; }
    case 'divergencia': { const r = db.get('SELECT k.contrato_id FROM divergencias d JOIN competencias k ON k.cid = d.cid WHERE d.divergencia_id = ?', n); return r ? r.contrato_id : null; }
    default: return null;
  }
}
const PADROES = [
  [/^\/competencias\/(\d+)/, 'cid'], [/^\/envios\/(\d+)/, 'envio'], [/^\/pareceres\/(\d+)/, 'parecer'], [/^\/versoes\/(\d+)/, 'versao'],
  [/^\/achados\/(\d+)/, 'achado'], [/^\/divergencias\/(\d+)/, 'divergencia'],
];

function guarda(db) {
  return (req, res, next) => {
    try {
      const p = permitidos(db, req.usuario);
      req.escopo = p;
      if (!p) return next();
      const ver = (c) => { if (c && !p.has(c)) throw erro(403, 'Esta unidade não está na sua carteira. Peça à superintendente para incluí-la.'); };
      for (const [re, tipo] of PADROES) { const m = re.exec(req.path); if (m) ver(contratoDe(db, tipo, m[1])); }
      const m2 = /^\/contratos\/([^/]+)/.exec(req.path);
      if (m2) ver(decodeURIComponent(m2[1]));
      const b = req.body || {};
      if (b.contrato_id) ver(String(b.contrato_id));
      if (b.cid) ver(contratoDe(db, 'cid', b.cid));
      if (req.query && req.query.contrato) ver(String(req.query.contrato));
      if (req.query && req.query.cid) ver(contratoDe(db, 'cid', req.query.cid));
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { limpar, ELEGIVEIS, cfg, definirCfg, estrita, doUsuario, permitidos, exigir, definir, porFuncionario, semCarteira, responsaveis, historico, guarda };
