'use strict';
// Conferência do recálculo da CTAI contra o acervo (fonte opcional). Gera divergências de origem "acervo".
// Convenção das colunas: declarado = valor no sistema da CTAI (recálculo); recalculado = valor no acervo.
const E = require('./envios');
const D = require('./dominio');
const U = require('../core/util');
const trilha = require('./trilha');
const config = require('./config');
const acervo = require('../adapters/acervo');
const { erro } = require('./auth');

function integracaoDoContrato(db, contratoId) {
  const i = db.get("SELECT * FROM integracoes WHERE contrato_id = ? AND tipo = 'acervo' ORDER BY integracao_id LIMIT 1", contratoId);
  return i ? Object.assign(i, { config: D.json(i.config, {}) }) : null;
}

function gravidade(rel) { return rel > 0.1 ? 'alta' : (rel > 0.03 ? 'média' : 'baixa'); }

function conferir(db, cid, usuario) {
  const comp = D.competenciaPorCid(db, cid);
  const integ = integracaoDoContrato(db, comp.contrato_id);
  if (!integ || !integ.ativo) throw erro(409, 'O acervo não está configurado para esta unidade. Ative a fonte em Integrações.');
  const rec = E.recalcularCompetencia(db, comp.cid);
  if (!rec) throw erro(409, 'Esta competência ainda não tem envio da unidade para conferir.');
  const sistema = {};
  for (const [id, r] of Object.entries(rec.indicadores)) if (r && typeof r.valor === 'number') sistema[id] = r.valor;
  let lido;
  try { lido = acervo.ler({ config: integ.config, competencia: comp.competencia_id, recalculados: sistema, dataDir: config.dataDir }); } catch (e) { throw erro(502, e.message); }
  if (!lido) throw erro(404, 'O acervo não tem dados da competência ' + comp.competencia_id + '.');
  const resultado = [];
  for (const [id, valorAcervo] of Object.entries(lido.valores)) {
    if (sistema[id] === undefined) continue;
    const a = sistema[id], dif = Math.round((valorAcervo - a) * 100) / 100;
    const rel = a === 0 ? (valorAcervo === 0 ? 0 : 1) : Math.abs(dif) / Math.abs(a);
    resultado.push({ indicador_id: id, sistema: a, acervo: valorAcervo, diferenca: dif, relativa: rel, confere: rel <= 0.005 });
  }
  const agora = new Date().toISOString();
  db.tx(() => {
    const atuais = new Map(db.all("SELECT * FROM divergencias WHERE cid = ? AND origem = 'acervo'", comp.cid).map((d) => [d.chave, d]));
    const vistas = new Set();
    for (const x of resultado.filter((y) => !y.confere)) {
      const chave = U.sha256('acervo|' + x.indicador_id).slice(0, 16);
      vistas.add(chave);
      const obs = 'Fonte: ' + lido.fonte + '. Sistema da CTAI (recálculo): ' + x.sistema + '; acervo: ' + x.acervo + '.';
      const ex = atuais.get(chave);
      if (ex) db.run("UPDATE divergencias SET declarado = ?, recalculado = ?, diferenca = ?, gravidade = ?, observacao = CASE WHEN status = 'aberta' THEN ? ELSE observacao END WHERE divergencia_id = ?", String(x.sistema), String(x.acervo), x.diferenca, gravidade(x.relativa), obs, ex.divergencia_id);
      else db.run("INSERT INTO divergencias (cid, indicador_id, tema, declarado, recalculado, diferenca, gravidade, status, observacao, origem, chave) VALUES (?,?,?,?,?,?,?,'aberta',?,'acervo',?)",
        comp.cid, x.indicador_id, 'Acervo × sistema da CTAI', String(x.sistema), String(x.acervo), x.diferenca, gravidade(x.relativa), obs, chave);
    }
    for (const [chave, ex] of atuais) if (!vistas.has(chave) && ex.status === 'aberta') db.run('DELETE FROM divergencias WHERE divergencia_id = ?', ex.divergencia_id);
    db.run('UPDATE integracoes SET ultima_sync = ?, estado = ?, ultimo_erro = NULL WHERE integracao_id = ?', agora, 'conferido', integ.integracao_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'competencias', registro: comp.cid, campo: 'conferencia_acervo', valor_novo: { fonte: lido.fonte, comparados: resultado.length, divergentes: resultado.filter((y) => !y.confere).length } });
  });
  return { fonte: lido.fonte, em: agora, comparados: resultado.length, divergentes: resultado.filter((y) => !y.confere).length, itens: resultado };
}

module.exports = { conferir, integracaoDoContrato };
