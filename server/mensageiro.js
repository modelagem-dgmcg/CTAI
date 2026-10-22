'use strict';
// Mensageiro interno da CTAI: texto e anexos entre pessoas da equipe. Cada pessoa vê só as conversas em que participa.
// Não leva dado de unidade por padrão; o anexo fica no banco (limite de tamanho e tipos permitidos).
const A = require('./auth');
const trilha = require('./trilha');
const { erro } = A;
const MAX = 4 * 1024 * 1024;
const TIPOS = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const agora = () => new Date().toISOString();

function contatos(db, eu) {
  const lista = db.all(`SELECT usuario_id, nome, login, perfil FROM usuarios WHERE ativo = 1 AND perfil IN ('admin','criador','colega','superintendente') AND usuario_id <> ? ORDER BY nome`, eu.usuario_id);
  return lista.map((u) => {
    const n = db.get('SELECT COUNT(*) AS n FROM msg WHERE de_id = ? AND para_id = ? AND lido_em IS NULL', u.usuario_id, eu.usuario_id).n;
    const ult = db.get('SELECT criado_em FROM msg WHERE (de_id = ? AND para_id = ?) OR (de_id = ? AND para_id = ?) ORDER BY msg_id DESC LIMIT 1', u.usuario_id, eu.usuario_id, eu.usuario_id, u.usuario_id);
    return Object.assign(u, { naoLidas: n, ultima: ult ? ult.criado_em : null, origem: 'CTAI' });
  }).sort((a, b) => (b.naoLidas - a.naoLidas) || String(b.ultima || '').localeCompare(String(a.ultima || '')) || a.nome.localeCompare(b.nome));
}
const contador = (db, eu) => ({ naoLidas: db.get('SELECT COUNT(*) AS n FROM msg WHERE para_id = ? AND lido_em IS NULL', eu.usuario_id).n });

function par(db, eu, login) {
  const o = db.get("SELECT usuario_id, nome, login FROM usuarios WHERE login = ? AND ativo = 1 AND perfil IN ('admin','criador','colega','superintendente')", String(login || ''));
  if (!o || o.usuario_id === eu.usuario_id) throw erro(404, 'Contato não encontrado.');
  return o;
}

function conversa(db, eu, login) {
  const o = par(db, eu, login);
  db.run('UPDATE msg SET lido_em = ? WHERE de_id = ? AND para_id = ? AND lido_em IS NULL', agora(), o.usuario_id, eu.usuario_id);
  const msgs = db.all('SELECT m.msg_id, m.de_id, m.texto, m.criado_em, m.anexo_id, a.nome AS anexo_nome, a.tamanho AS anexo_tamanho FROM msg m LEFT JOIN msg_anexos a ON a.anexo_id = m.anexo_id WHERE (m.de_id = ? AND m.para_id = ?) OR (m.de_id = ? AND m.para_id = ?) ORDER BY m.msg_id DESC LIMIT 200', eu.usuario_id, o.usuario_id, o.usuario_id, eu.usuario_id).reverse();
  return { contato: o, mensagens: msgs.map((m) => ({ id: m.msg_id, meu: m.de_id === eu.usuario_id, texto: m.texto, criado_em: m.criado_em, anexo: m.anexo_id ? { id: m.anexo_id, nome: m.anexo_nome, tamanho: m.anexo_tamanho } : null })) };
}

function enviar(db, eu, dados) {
  const o = par(db, eu, dados.para);
  const texto = String(dados.texto || '').trim().slice(0, 4000);
  let anexoId = null;
  const a = dados.anexo;
  if (a && a.base64) {
    const nome = String(a.nome || 'arquivo').replace(/[\\/\r\n"]/g, '_').slice(0, 120);
    const ext = (nome.split('.').pop() || '').toLowerCase();
    if (!TIPOS[ext]) throw erro(400, 'Tipo de arquivo não permitido. Use: ' + Object.keys(TIPOS).join(', ') + '.');
    const buf = Buffer.from(String(a.base64), 'base64');
    if (!buf.length) throw erro(400, 'Arquivo vazio.');
    if (buf.length > MAX) throw erro(413, 'Arquivo acima de 4 MB.');
    anexoId = Number(db.run('INSERT INTO msg_anexos (nome, mime, tamanho, dados, criado_em) VALUES (?,?,?,?,?)', nome, TIPOS[ext], buf.length, buf, agora()).lastInsertRowid);
  }
  if (!texto && !anexoId) throw erro(400, 'Escreva uma mensagem ou anexe um arquivo.');
  const id = Number(db.run('INSERT INTO msg (de_id, para_id, texto, anexo_id, criado_em) VALUES (?,?,?,?,?)', eu.usuario_id, o.usuario_id, texto, anexoId, agora()).lastInsertRowid);
  if (anexoId) trilha.registrar(db, { usuario: eu.login, tabela: 'msg', registro: id, campo: 'anexo', valor_novo: 'enviado a ' + o.login });
  return id;
}

function anexo(db, eu, id) {
  const a = db.get('SELECT a.* FROM msg_anexos a JOIN msg m ON m.anexo_id = a.anexo_id WHERE a.anexo_id = ? AND (m.de_id = ? OR m.para_id = ?)', Number(id), eu.usuario_id, eu.usuario_id);
  if (!a) throw erro(404, 'Anexo não encontrado.');
  return a;
}

module.exports = { contatos, contador, conversa, enviar, anexo, TIPOS, MAX };
