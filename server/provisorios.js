'use strict';
// Acessos provisórios: o gestor da unidade cadastra uma pessoa com setor e formulário digitados à mão e explica o motivo.
// O analista da carteira recebe um aviso (Caixa de entrada) e decide: concorda (o acesso fica permanente) ou discorda com justificativa
// (a resposta volta para o gestor). Sem concordância, o acesso é apagado em 7 dias corridos.
const express = require('express');
const A = require('./auth');
const CART = require('./carteira');
const CAIXA = require('./caixa');
const trilha = require('./trilha');
const { erro } = A;
const DIAS = 7;
const agora = () => new Date().toISOString();

function avisarAnalista(db, gestor, u) {
  const un = (db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', gestor.contrato_id) || {}).unidade || gestor.contrato_id;
  CAIXA.criar(db, { chave: 'acessoprov:' + u.usuario_id, tipo: 'acesso_provisorio', contrato_id: gestor.contrato_id, titulo: 'Acesso provisório pedido: ' + un,
    texto: 'O gestor cadastrou ' + u.nome + ' (' + (u.prov_setor || 'setor') + ' · ' + (u.prov_formulario || 'formulário') + '). Leia a justificativa e concorde ou não em até ' + DIAS + ' dias; sem concordância o acesso é apagado.',
    link: '#/u/' + encodeURIComponent(gestor.contrato_id), destinos: CAIXA.destinosDaUnidade(db, gestor.contrato_id) }, gestor.login);
}
function fecharAviso(db, id, quem, obs) {
  db.run('UPDATE caixa_itens SET tratado_por = ?, tratado_em = ?, tratado_obs = ? WHERE chave = ? AND tratado_por IS NULL', quem, agora(), obs || null, 'acessoprov:' + id);
}
function varrer(db) {
  for (const u of db.all("SELECT * FROM usuarios WHERE prov_status IN ('pendente','discordado') AND prov_expira_em < ?", agora())) { A.apagarProvisorio(db, u); fecharAviso(db, u.usuario_id, 'sistema', 'Expirou sem concordância'); }
}
const forma = (u) => ({ usuario_id: u.usuario_id, login: u.login, nome: u.nome, setor: u.prov_setor, formulario: u.prov_formulario, justificativa: u.prov_justificativa, status: u.prov_status,
  expira_em: u.prov_expira_em, resposta: u.prov_resposta, decidido_por: u.prov_decidido_por, decidido_em: u.prov_decidido_em });

function listar(db, usuario, contrato) {
  varrer(db);
  const p = CART.permitidos(db, usuario);
  if (contrato && p && !p.has(String(contrato))) throw erro(403, 'Esta unidade não está na sua carteira.');
  const l = db.all("SELECT * FROM usuarios WHERE prov_status IN ('pendente','discordado') AND contrato_id = ? ORDER BY prov_expira_em", String(contrato));
  return l.map(forma);
}
function decidir(db, usuario, id, b) {
  const u = db.get("SELECT * FROM usuarios WHERE usuario_id = ? AND prov_status IN ('pendente','discordado')", Number(id));
  if (!u) throw erro(404, 'Pedido de acesso não encontrado (talvez já tenha sido decidido ou tenha expirado).');
  const p = CART.permitidos(db, usuario);
  if (p && !p.has(u.contrato_id)) throw erro(403, 'Esta unidade não está na sua carteira.');
  const just = String(b.justificativa || '').trim().slice(0, 1000);
  if (b.concordo) {
    db.run("UPDATE usuarios SET prov_status = 'permanente', prov_expira_em = NULL, prov_decidido_por = ?, prov_decidido_em = ?, prov_resposta = NULL WHERE usuario_id = ?", usuario.login, agora(), u.usuario_id);
    fecharAviso(db, u.usuario_id, usuario.login, 'Concordou: acesso permanente');
    trilha.registrar(db, { usuario: usuario.login, tabela: 'usuarios', registro: u.login, campo: 'acesso_provisorio', valor_novo: 'permanente' });
  } else {
    if (!just) throw erro(400, 'Escreva a justificativa para o gestor da unidade.');
    db.run("UPDATE usuarios SET prov_status = 'discordado', prov_resposta = ?, prov_decidido_por = ?, prov_decidido_em = ? WHERE usuario_id = ?", just, usuario.login, agora(), u.usuario_id);
    fecharAviso(db, u.usuario_id, usuario.login, 'Não concordou: ' + just);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'usuarios', registro: u.login, campo: 'acesso_provisorio', valor_novo: 'não mantido', motivo: just });
  }
}

const rotas = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  r.get('/', (req, res) => res.json({ pedidos: listar(db, req.usuario, req.query.contrato) }));
  r.post('/:id/decidir', (req, res) => { decidir(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });
  return r;
};
module.exports = rotas;
module.exports.avisarAnalista = avisarAnalista;
module.exports.varrer = varrer;
module.exports.DIAS = DIAS;
module.exports.forma = forma;
