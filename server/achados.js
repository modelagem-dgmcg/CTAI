'use strict';
// Persistência e fluxo dos achados do Analista.
// Ciclo: novo → (fixar na mesa | descartar com motivo | encaminhar à unidade) → a unidade responde → a CTAI fixa, descarta ou reabre.
// O módulo do Analista só devolve dados; quem grava é o sistema.
const trilha = require('./trilha');
const { erro } = require('./auth');

const SETORES = ['assistencia', 'qualidade', 'ouvidoria', 'educacao', 'bid', 'rh'];
const STATUS = ['novo', 'fixado', 'descartado', 'encaminhado', 'respondido'];

function salvar(db, { origem_tipo, origem_id, cid, achados, provedor, usuario }) {
  // Substitui os achados ainda "novos" da mesma origem. Fixados, descartados, encaminhados e respondidos ficam como estão.
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
  if (filtro.origem_tipo) { where.push('a.origem_tipo = ?'); args.push(filtro.origem_tipo); }
  if (filtro.origem_id) { where.push('a.origem_id = ?'); args.push(Number(filtro.origem_id)); }
  if (filtro.cid) { where.push('a.cid = ?'); args.push(Number(filtro.cid)); }
  if (filtro.status) { where.push('a.status = ?'); args.push(filtro.status); }
  if (filtro.contrato_id) { where.push('k.contrato_id = ?'); args.push(filtro.contrato_id); }
  return db.all('SELECT a.*, k.competencia_id, k.contrato_id, c.unidade FROM achados a LEFT JOIN competencias k ON k.cid = a.cid LEFT JOIN contratos c ON c.contrato_id = k.contrato_id'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + " ORDER BY CASE a.gravidade WHEN 'ALTA' THEN 0 WHEN 'MÉDIA' THEN 1 ELSE 2 END, a.achado_id", ...args);
}

function obter(db, id) {
  const a = db.get('SELECT a.*, k.contrato_id FROM achados a LEFT JOIN competencias k ON k.cid = a.cid WHERE a.achado_id = ?', Number(id));
  if (!a) throw erro(404, 'Achado não encontrado.');
  return a;
}

// Quem fixa é a pessoa da CTAI. Fixado entra na mesa; descartado exige motivo.
function mudarStatus(db, achadoId, status, usuario, motivo) {
  const a = obter(db, achadoId);
  if (!['novo', 'fixado', 'descartado'].includes(status)) throw erro(400, 'Status inválido.');
  if (status === 'descartado' && !String(motivo || '').trim()) throw erro(400, 'Informe o motivo para descartar o achado.');
  db.run('UPDATE achados SET status = ?, fixado_por = ?, atualizado_em = ? WHERE achado_id = ?', status, usuario.login, new Date().toISOString(), a.achado_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'achados', registro: a.achado_id, campo: 'status', valor_anterior: a.status, valor_novo: status, motivo });
}

// A CTAI pede esclarecimento à unidade. O achado precisa estar ligado a uma competência (é ela que diz de qual unidade se trata).
function encaminhar(db, achadoId, usuario, dados) {
  const a = obter(db, achadoId);
  if (!a.cid) throw erro(400, 'Este achado não está ligado a uma competência. Guarde-o numa competência antes de encaminhar à unidade.');
  const mensagem = String((dados && dados.mensagem) || '').trim();
  if (!mensagem) throw erro(400, 'Escreva o que a unidade deve esclarecer.');
  if (mensagem.length > 1500) throw erro(400, 'Mensagem longa demais (máximo de 1.500 caracteres).');
  const setor = dados && dados.setor ? String(dados.setor) : null;
  if (setor && !SETORES.includes(setor)) throw erro(400, 'Setor inválido.');
  const prazo = dados && dados.prazo ? String(dados.prazo) : null;
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) throw erro(400, 'Prazo inválido (use dia/mês/ano).');
  if (a.status === 'encaminhado') throw erro(409, 'Este achado já está encaminhado e aguarda resposta.');
  const agora = new Date().toISOString();
  db.run("UPDATE achados SET status = 'encaminhado', encaminhado_a = ?, encaminhado_por = ?, encaminhado_em = ?, mensagem = ?, prazo = ?, resposta = NULL, respondido_por = NULL, respondido_em = NULL, atualizado_em = ? WHERE achado_id = ?",
    setor, usuario.login, agora, mensagem, prazo, agora, a.achado_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'achados', registro: a.achado_id, campo: 'encaminhado', valor_anterior: a.status, valor_novo: { setor, prazo }, motivo: mensagem });
}

// A unidade responde. Gestor responde qualquer um da sua unidade; o responsável de setor, só os do seu setor (ou sem setor definido).
function responder(db, achadoId, usuario, texto) {
  const a = obter(db, achadoId);
  if (a.status !== 'encaminhado') throw erro(409, 'Este achado não está aguardando resposta.');
  if (!['gestor_unidade', 'setor_unidade', 'admin'].includes(usuario.perfil)) throw erro(403, 'Só a unidade responde.');
  if (usuario.perfil !== 'admin' && usuario.contrato_id !== a.contrato_id) throw erro(403, 'Este achado é de outra unidade.');
  if (usuario.perfil === 'setor_unidade' && a.encaminhado_a && a.encaminhado_a !== usuario.setor) throw erro(403, 'Este achado foi encaminhado a outro setor. Peça ao gestor da unidade.');
  const resposta = String(texto || '').trim();
  if (!resposta) throw erro(400, 'Escreva a resposta.');
  if (resposta.length > 3000) throw erro(400, 'Resposta longa demais (máximo de 3.000 caracteres).');
  const agora = new Date().toISOString();
  db.run("UPDATE achados SET status = 'respondido', resposta = ?, respondido_por = ?, respondido_em = ?, atualizado_em = ? WHERE achado_id = ?", resposta, usuario.login, agora, agora, a.achado_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'achados', registro: a.achado_id, campo: 'resposta', valor_anterior: 'encaminhado', valor_novo: 'respondido', motivo: resposta });
}

// Visão da unidade: só o que foi encaminhado a ela (nunca os achados internos da CTAI).
function daUnidade(db, usuario) {
  const lista = listar(db, { contrato_id: usuario.contrato_id }).filter((a) => ['encaminhado', 'respondido'].includes(a.status) || (a.status === 'fixado' && a.encaminhado_em));
  return lista
    .filter((a) => usuario.perfil !== 'setor_unidade' || !a.encaminhado_a || a.encaminhado_a === usuario.setor)
    .map((a) => ({ achado_id: a.achado_id, cid: a.cid, competencia_id: a.competencia_id, status: a.status, gravidade: a.gravidade, tipo: a.tipo, trecho: a.trecho, mensagem: a.mensagem,
      setor: a.encaminhado_a, prazo: a.prazo, encaminhado_em: a.encaminhado_em, resposta: a.resposta, respondido_por: a.respondido_por, respondido_em: a.respondido_em }));
}

function contagens(db) {
  const o = { novo: 0, fixado: 0, descartado: 0, encaminhado: 0, respondido: 0, vencidos: 0 };
  for (const r of db.all('SELECT status, COUNT(*) AS n FROM achados GROUP BY status')) o[r.status] = r.n;
  const hoje = new Date().toISOString().slice(0, 10);
  o.vencidos = db.get("SELECT COUNT(*) AS n FROM achados WHERE status = 'encaminhado' AND prazo IS NOT NULL AND prazo < ?", hoje).n;
  return o;
}

module.exports = { salvar, listar, obter, mudarStatus, encaminhar, responder, daUnidade, contagens, SETORES, STATUS };
