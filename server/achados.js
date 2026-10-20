'use strict';
// Persistência dos achados do Analista. O módulo do Analista só devolve dados; quem grava é o sistema.
const trilha = require('./trilha');
const { erro } = require('./auth');

function salvar(db, { origem_tipo, origem_id, cid, achados, provedor, usuario }) {
  // Substitui os achados ainda "novos" da mesma origem. Os fixados ou descartados ficam como estão.
  db.run("DELETE FROM achados WHERE origem_tipo = ? AND origem_id = ? AND status = 'novo'", origem_tipo, origem_id);
  const agora = new Date().toISOString();
  let n = 0;
  for (const a of achados) {
    db.run('INSERT INTO achados (origem_tipo, origem_id, cid, gravidade, tipo, trecho, risco, sugestao, setor_sugerido, provedor, status, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      origem_tipo, origem_id, cid || null, a.gravidade, a.tipo || null, a.trecho || null, a.risco || null, a.sugestao || null, a.setor_sugerido || null, provedor || null, 'novo', agora, agora);
    n++;
  }
  trilha.registrar(db, { usuario: usuario || 'sistema', tabela: 'achados', registro: origem_tipo + '/' + origem_id, campo: 'analise', valor_novo: n + ' achado(s) pelo provedor ' + (provedor || '—') });
  return n;
}

function listar(db, filtro) {
  const where = [], args = [];
  if (filtro.origem_tipo) { where.push('origem_tipo = ?'); args.push(filtro.origem_tipo); }
  if (filtro.origem_id) { where.push('origem_id = ?'); args.push(Number(filtro.origem_id)); }
  if (filtro.cid) { where.push('cid = ?'); args.push(Number(filtro.cid)); }
  if (filtro.status) { where.push('status = ?'); args.push(filtro.status); }
  return db.all('SELECT * FROM achados' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + " ORDER BY CASE gravidade WHEN 'ALTA' THEN 0 WHEN 'MÉDIA' THEN 1 ELSE 2 END, achado_id", ...args);
}

// Quem fixa é a pessoa da CTAI. Fixado entra na mesa; descartado exige motivo.
function mudarStatus(db, achadoId, status, usuario, motivo) {
  const a = db.get('SELECT * FROM achados WHERE achado_id = ?', Number(achadoId));
  if (!a) throw erro(404, 'Achado não encontrado.');
  if (!['novo', 'fixado', 'descartado'].includes(status)) throw erro(400, 'Status inválido.');
  if (status === 'descartado' && !String(motivo || '').trim()) throw erro(400, 'Informe o motivo para descartar o achado.');
  db.run('UPDATE achados SET status = ?, fixado_por = ?, atualizado_em = ? WHERE achado_id = ?', status, usuario.login, new Date().toISOString(), a.achado_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'achados', registro: a.achado_id, campo: 'status', valor_anterior: a.status, valor_novo: status, motivo });
}

module.exports = { salvar, listar, mudarStatus };
