'use strict';
// Registro de acessos: entrada, falha, bloqueio, saída e cadastros feitos por gestores de unidade.
// Só se acrescenta (gatilhos no banco). Cada linha guarda o hash do evento correspondente na trilha encadeada.
// O IP vem mascarado por padrão (último trecho oculto); veja exposicao.ipDe.
const EX = require('./exposicao');

const EVENTOS = ['entrada', 'falha', 'bloqueio', 'saida', 'cadastro'];

function registrar(db, req, d) {
  const u = d.usuario || {};
  db.run('INSERT INTO acessos (data_hora, evento, login, usuario_id, perfil, contrato_id, origem, ip, agente, detalhe, hash_trilha) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    new Date().toISOString(), d.evento, String(d.login || u.login || '').slice(0, 40) || null, u.usuario_id || null, u.perfil || null, d.contrato_id || u.contrato_id || null,
    req ? EX.origemDe(req).tipo : null, req ? EX.ipDe(req) : null, req ? EX.agenteDe(req) : null, d.detalhe || null, d.hash_trilha || null);
}

function filtrar(db, f) {
  const where = [], args = [];
  if (f.de) { where.push('a.data_hora >= ?'); args.push(f.de + 'T00:00:00.000Z'); }
  if (f.ate) { where.push('a.data_hora <= ?'); args.push(f.ate + 'T23:59:59.999Z'); }
  if (f.contrato) { where.push('a.contrato_id = ?'); args.push(f.contrato); }
  if (f.usuario) { where.push('a.login LIKE ?'); args.push('%' + String(f.usuario).toLowerCase().replace(/[%_]/g, '') + '%'); }
  if (f.evento) { where.push('a.evento = ?'); args.push(f.evento); }
  if (f.origem) { where.push('a.origem = ?'); args.push(f.origem); }
  return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', args };
}

function listar(db, f, limite) {
  const w = filtrar(db, f || {});
  const linhas = db.all('SELECT a.*, c.unidade FROM acessos a LEFT JOIN contratos c ON c.contrato_id = a.contrato_id' + w.sql + ' ORDER BY a.acesso_id DESC LIMIT ?', ...w.args, Math.min(Number(limite) || 200, 5000));
  const cont = { entrada: 0, falha: 0, bloqueio: 0, saida: 0, cadastro: 0, externas: 0 };
  for (const r of db.all('SELECT a.evento, a.origem, COUNT(*) AS n FROM acessos a' + w.sql + ' GROUP BY a.evento, a.origem', ...w.args)) {
    cont[r.evento] = (cont[r.evento] || 0) + r.n;
    if (r.origem === 'externa') cont.externas += r.n;
  }
  const falhasPorLogin = db.all("SELECT a.login, COUNT(*) AS n FROM acessos a" + (w.sql ? w.sql + " AND" : ' WHERE') + " a.evento IN ('falha','bloqueio') GROUP BY a.login ORDER BY n DESC LIMIT 5", ...w.args);
  return { linhas, contagens: cont, falhasPorLogin };
}

const csvCel = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function csv(linhas) {
  const cab = ['data_hora', 'evento', 'login', 'perfil', 'unidade', 'origem', 'ip', 'agente', 'detalhe', 'hash_trilha'];
  return '﻿' + cab.join(';') + '\r\n' + linhas.map((l) => [l.data_hora, l.evento, l.login, l.perfil, l.unidade || l.contrato_id, l.origem, l.ip, l.agente, l.detalhe, l.hash_trilha].map(csvCel).join(';')).join('\r\n') + '\r\n';
}

module.exports = { EVENTOS, registrar, listar, csv };
