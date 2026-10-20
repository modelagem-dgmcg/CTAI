'use strict';
// Sincronização com a API: busca → valida (recusa dado pessoal) → grava como LOTE PENDENTE.
// Linhas da API só entram no cálculo depois que o gestor da unidade confirma o lote.
const mv = require('./index');
const L = require('../../core/linhas');
const D = require('../../server/dominio');
const trilha = require('../../server/trilha');
const { erro } = require('../../server/auth');

const agora = () => new Date().toISOString();

function periodoDe(competencia) {
  const [a, m] = competencia.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { inicio: competencia + '-01', fim: competencia + '-' + String(ultimo).padStart(2, '0') };
}

function integracaoPorId(db, id) {
  const i = db.get('SELECT * FROM integracoes WHERE integracao_id = ?', Number(id));
  if (!i) throw erro(404, 'Integração não encontrada.');
  i.config = D.json(i.config, {});
  return i;
}

function registrarLog(db, integracaoId) {
  return (e) => db.run('INSERT INTO integracao_log (integracao_id, data_hora, acao, endpoint, status, ms, registros, erro) VALUES (?,?,?,?,?,?,?,?)', integracaoId, agora(), e.acao, e.endpoint, e.status, e.ms || 0, e.registros || 0, e.erro || null);
}

async function testar(db, integracaoId) {
  const i = integracaoPorId(db, integracaoId);
  const ad = mv.criar(i.config, registrarLog(db, i.integracao_id));
  try {
    const r = await ad.testar();
    db.run("UPDATE integracoes SET estado = 'conectada', ultimo_erro = NULL WHERE integracao_id = ?", i.integracao_id);
    return r;
  } catch (e) {
    registrarLog(db, i.integracao_id)({ acao: 'testar', endpoint: '', status: 'erro', ms: e.ms || 0, registros: 0, erro: e.message });
    db.run("UPDATE integracoes SET estado = 'com erro', ultimo_erro = ? WHERE integracao_id = ?", e.message, i.integracao_id);
    throw erro(502, 'Não foi possível conectar: ' + e.message);
  }
}

// opcoes: { cid, fontes?: [..], dryRun?: bool, usuario }
async function sincronizar(db, integracaoId, opcoes) {
  const i = integracaoPorId(db, integracaoId);
  const comp = D.competenciaPorCid(db, opcoes.cid);
  if (comp.contrato_id !== i.contrato_id) throw erro(400, 'A competência não é deste contrato.');
  const ad = mv.criar(i.config, registrarLog(db, i.integracao_id));
  const { inicio, fim } = periodoDe(comp.competencia_id);
  const fontes = (opcoes.fontes && opcoes.fontes.length ? opcoes.fontes : Object.keys(ad.mapa.fontes));
  const resumo = [];
  for (const fonte of fontes) {
    const item = { fonte, buscados: 0, validos: 0, recusados: 0, motivoRecusa: null, erros: [], previa: [], lote_id: null };
    try {
      const { registros } = await ad.buscar(fonte, inicio, fim);
      item.buscados = registros.length;
      const cab = registros.length ? Object.keys(registros[0]) : [];
      const v = L.validarLinhas(fonte, cab, registros, { competencia: comp.competencia_id });
      if (v.recusado) { item.motivoRecusa = v.motivoRecusa; resumo.push(item); continue; }
      item.validos = v.linhas.length;
      item.recusados = registros.length - v.linhas.length;
      item.erros = v.erros.slice(0, 5);
      item.previa = v.linhas.slice(0, 5).map((l) => ({ protocolo: l.protocolo, categoria: l.categoria, minutos: l.minutos }));
      if (!opcoes.dryRun && v.linhas.length) {
        db.tx(() => {
          // Lote pendente anterior da mesma fonte é substituído; o que já foi confirmado não é tocado.
          db.run("DELETE FROM linhas_rascunho WHERE cid = ? AND fonte = ? AND origem = 'api_mv' AND confirmada = 0", Number(opcoes.cid), fonte);
          db.run("UPDATE lotes_api SET status = 'substituido' WHERE cid = ? AND fonte = ? AND status = 'pendente'", Number(opcoes.cid), fonte);
          const r = db.run('INSERT INTO lotes_api (integracao_id, cid, fonte, criado_em, registros, recusados, status) VALUES (?,?,?,?,?,?,?)', i.integracao_id, Number(opcoes.cid), fonte, agora(), v.linhas.length, item.recusados, 'pendente');
          item.lote_id = Number(r.lastInsertRowid);
          for (const l of v.linhas) db.run("INSERT INTO linhas_rascunho (cid, fonte, protocolo, data_inicio, hora_inicio, data_fim, hora_fim, minutos, categoria, dados, origem, lote_id, confirmada, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,'api_mv',?,0,?,?)",
            Number(opcoes.cid), fonte, l.protocolo, l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim, l.minutos, l.categoria, JSON.stringify(l.dados || {}), item.lote_id, (opcoes.usuario && opcoes.usuario.login) || 'integracao', agora());
          trilha.registrar(db, { usuario: (opcoes.usuario && opcoes.usuario.login) || 'integracao', tabela: 'lotes_api', registro: item.lote_id, campo: 'sincronizacao', valor_novo: { fonte, registros: v.linhas.length, recusados: item.recusados }, motivo: 'Lote da API aguardando confirmação do gestor' });
        });
      }
    } catch (e) { item.erro = e.message; }
    resumo.push(item);
  }
  if (!opcoes.dryRun) db.run("UPDATE integracoes SET ultima_sync = ?, estado = ?, ultimo_erro = ? WHERE integracao_id = ?", agora(), resumo.some((r) => r.erro) ? 'com erro' : 'conectada', resumo.find((r) => r.erro) ? resumo.find((r) => r.erro).erro : null, i.integracao_id);
  return { dryRun: !!opcoes.dryRun, periodo: { inicio, fim }, resumo };
}

function confirmarLote(db, loteId, usuario, substituirManual) {
  const lote = db.get('SELECT * FROM lotes_api WHERE lote_id = ?', Number(loteId));
  if (!lote) throw erro(404, 'Lote não encontrado.');
  if (lote.status !== 'pendente') throw erro(409, 'Este lote já foi tratado (' + lote.status + ').');
  db.tx(() => {
    if (substituirManual) db.run("DELETE FROM linhas_rascunho WHERE cid = ? AND fonte = ? AND origem <> 'api_mv'", lote.cid, lote.fonte);
    db.run('UPDATE linhas_rascunho SET confirmada = 1 WHERE lote_id = ?', lote.lote_id);
    db.run("UPDATE lotes_api SET status = 'confirmado' WHERE lote_id = ?", lote.lote_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'lotes_api', registro: lote.lote_id, campo: 'status', valor_anterior: 'pendente', valor_novo: 'confirmado', motivo: substituirManual ? 'Substituiu as linhas digitadas desta fonte' : 'Somou às linhas existentes' });
  });
}

function descartarLote(db, loteId, usuario) {
  const lote = db.get('SELECT * FROM lotes_api WHERE lote_id = ?', Number(loteId));
  if (!lote) throw erro(404, 'Lote não encontrado.');
  if (lote.status !== 'pendente') throw erro(409, 'Este lote já foi tratado (' + lote.status + ').');
  db.tx(() => {
    db.run('DELETE FROM linhas_rascunho WHERE lote_id = ? AND confirmada = 0', lote.lote_id);
    db.run("UPDATE lotes_api SET status = 'descartado' WHERE lote_id = ?", lote.lote_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'lotes_api', registro: lote.lote_id, campo: 'status', valor_anterior: 'pendente', valor_novo: 'descartado' });
  });
}

module.exports = { sincronizar, testar, confirmarLote, descartarLote, integracaoPorId, periodoDe };
