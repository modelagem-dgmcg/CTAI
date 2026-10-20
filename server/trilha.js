'use strict';
// Trilha de auditoria append-only com encadeamento de hash.
// Cada evento guarda o hash do evento anterior. Alterar ou apagar uma linha quebra a cadeia, e verificar() mostra onde.
const U = require('../core/util');

function agora() { return new Date().toISOString(); }

function calcularHash(e, anterior) {
  return U.sha256([anterior || '', e.data_hora, e.usuario || '', e.tabela || '', e.registro || '', e.campo || '', e.valor_anterior ?? '', e.valor_novo ?? '', e.motivo || ''].join('␟'));
}

function texto(v) {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function registrar(db, ev) {
  const e = {
    data_hora: agora(), usuario: ev.usuario || 'sistema', tabela: ev.tabela, registro: String(ev.registro ?? ''), campo: ev.campo || null,
    valor_anterior: texto(ev.valor_anterior), valor_novo: texto(ev.valor_novo), motivo: ev.motivo || null,
  };
  const ult = db.get('SELECT hash FROM trilha_auditoria ORDER BY evento_id DESC LIMIT 1');
  const hash = calcularHash(e, ult ? ult.hash : '');
  db.run('INSERT INTO trilha_auditoria (data_hora, usuario, tabela, registro, campo, valor_anterior, valor_novo, motivo, hash_anterior, hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
    e.data_hora, e.usuario, e.tabela, e.registro, e.campo, e.valor_anterior, e.valor_novo, e.motivo, ult ? ult.hash : '', hash);
  return hash;
}

// Percorre a cadeia. Devolve { ok, total, falhas: [{evento_id, problema}] }
function verificar(db) {
  const linhas = db.all('SELECT * FROM trilha_auditoria ORDER BY evento_id');
  const falhas = [];
  let anterior = '';
  let idAnterior = null;
  for (const l of linhas) {
    if (l.hash_anterior !== anterior) falhas.push({ evento_id: l.evento_id, problema: idAnterior === null ? 'O primeiro evento não deveria apontar para outro.' : 'O vínculo com o evento anterior (' + idAnterior + ') foi quebrado: pode haver evento apagado ou alterado.' });
    const esperado = calcularHash(l, l.hash_anterior);
    if (esperado !== l.hash) falhas.push({ evento_id: l.evento_id, problema: 'O conteúdo do evento foi alterado depois de gravado.' });
    anterior = l.hash;
    idAnterior = l.evento_id;
  }
  return { ok: falhas.length === 0, total: linhas.length, falhas };
}

module.exports = { registrar, verificar, calcularHash, agora };
