'use strict';
// Regras por unidade. Uma unidade nova herda o MODELO do seu tipo (hoje só o IGQ das UPAs, baseado na UPA Olinda),
// marcado como "modelo a conferir" até alguém da CTAI conferir contra o contrato e os TAs e marcar como conferido.
const fs = require('fs');
const path = require('path');
const trilha = require('./trilha');
const { erro } = require('./auth');

const MODELOS = { igq_v1: { arquivo: path.join(__dirname, '..', 'regras', 'igq_v1.json'), tipos: ['UPA'], rotulo: 'IGQ das UPAs (baseado na UPA Olinda)' } };
const agora = () => new Date().toISOString();
const tipoDe = (c) => String(c.contrato_id).split('-')[c.demo ? 1 : 0].toUpperCase();
const podeGerir = (u) => ['criador', 'superintendente', 'admin'].includes(u.perfil);

function estado(db, contratoId) {
  const l = db.get('SELECT regra_id, versao, aprovada_por, data_aprovacao, pendencias, vigente_de FROM regras WHERE contrato_id = ? ORDER BY vigente_de DESC, regra_id DESC', contratoId);
  if (!l) return { tem: false };
  return { tem: true, regra_id: l.regra_id, versao: l.versao, conferida: !!l.aprovada_por, conferida_por: l.aprovada_por || null, conferida_em: l.data_aprovacao || null, nota: l.pendencias || null };
}

function aplicarModelo(db, usuario, contratoId, modelo) {
  if (!podeGerir(usuario)) throw erro(403, 'Só quem cria o parecer, a superintendência ou o administrador cadastra regras.');
  const m = MODELOS[modelo || 'igq_v1'];
  if (!m) throw erro(400, 'Modelo desconhecido.');
  const c = db.get('SELECT * FROM contratos WHERE contrato_id = ?', contratoId);
  if (!c) throw erro(404, 'Unidade não encontrada.');
  if (estado(db, contratoId).tem) throw erro(409, 'Esta unidade já tem regras cadastradas.');
  const conteudo = JSON.parse(fs.readFileSync(m.arquivo, 'utf8'));
  const nome = modelo || 'igq_v1';
  conteudo.contrato = c.unidade + ' — modelo ' + nome + ' (a conferir)';
  conteudo.base_legal = 'Modelo do tipo ' + tipoDe(c) + ' (baseado na UPA Olinda). Conferir no contrato e nos TAs desta unidade.';
  if (conteudo.implantacao) conteudo.implantacao.competencias = [];
  const regraId = contratoId + ':' + nome;
  db.run('INSERT INTO regras (regra_id, versao, contrato_id, vigente_de, vigente_ate, arquivo_json, conteudo, pendencias, aprovada_por, data_aprovacao) VALUES (?,?,?,?,?,?,?,?,?,?)',
    regraId, nome, contratoId, c.vigencia_inicio || null, null, null, JSON.stringify(conteudo), 'Modelo do tipo ' + tipoDe(c) + ': conferir metas, pesos e valores no contrato e nos TAs.', null, null);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'regras', registro: regraId, campo: 'modelo_aplicado', valor_novo: { contrato: contratoId, modelo: nome } });
  return estado(db, contratoId);
}

function aplicarEmLote(db, usuario, tipo, modelo) {
  if (!['superintendente', 'admin'].includes(usuario.perfil)) throw erro(403, 'Aplicar o modelo em lote é da superintendência ou do administrador.');
  const nome = modelo || 'igq_v1';
  const m = MODELOS[nome];
  if (!m) throw erro(400, 'Modelo desconhecido.');
  const t = String(tipo || '').toUpperCase();
  if (!m.tipos.includes(t)) throw erro(400, 'O modelo ' + nome + ' é para: ' + m.tipos.join(', ') + '.');
  const alvo = db.all('SELECT * FROM contratos WHERE demo = 0 ORDER BY contrato_id').filter((c) => tipoDe(c) === t && !estado(db, c.contrato_id).tem);
  for (const c of alvo) aplicarModelo(db, usuario, c.contrato_id, nome);
  return { aplicadas: alvo.length, unidades: alvo.map((c) => c.unidade) };
}

function marcarConferida(db, usuario, contratoId) {
  if (!podeGerir(usuario)) throw erro(403, 'Só quem cria o parecer, a superintendência ou o administrador confere regras.');
  const e = estado(db, contratoId);
  if (!e.tem) throw erro(409, 'Esta unidade ainda não tem regras.');
  db.run('UPDATE regras SET aprovada_por = ?, data_aprovacao = ?, pendencias = NULL WHERE regra_id = ?', usuario.login, agora(), e.regra_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'regras', registro: e.regra_id, campo: 'conferida', valor_novo: { por: usuario.login } });
  return estado(db, contratoId);
}

module.exports = { estado, aplicarModelo, aplicarEmLote, marcarConferida, MODELOS, tipoDe };
