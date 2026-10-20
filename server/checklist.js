'use strict';
// Checklist de recebimento da Secretaria: por competência e por item obrigatório da UPA.
// Campos: competência, data de recebimento, status do item (recebido, pendente, incompleto, não aplicável), responsável pelo envio,
// validação (divergências e inconsistências) e observações. O sistema sugere o status pelo que a unidade informou; a pessoa da CTAI decide.
const O = require('../core/obrigatorios');
const D = require('./dominio');
const trilha = require('./trilha');
const P = require('./prazos');
const { erro } = require('./auth');

const agora = () => new Date().toISOString();
const itemPor = (id) => O.ITENS.find((i) => i.id === id);

function contextoDoEnvio(envio) {
  const snap = JSON.parse(envio.snapshot);
  const flat = {};
  for (const f of Object.values(snap.fichas)) Object.assign(flat, f.dados);
  return { snap, flat };
}

// Cria as linhas que faltam e reavalia as que ninguém decidiu à mão. Chamada na recepção de cada envio.
function sincronizar(db, cid) {
  const envio = D.ultimoEnvio(db, cid);
  if (!envio) return 0;
  const { snap, flat } = contextoDoEnvio(envio);
  const dataRec = P.dataLocal(envio.recebido_em || envio.enviado_em);
  const resp = (snap.enviadoPor && snap.enviadoPor.nome) || envio.enviado_por;
  let n = 0;
  for (const item of O.ITENS) {
    const sugerido = O.situacaoSugerida(item, flat, snap.indicadores, snap.resumoLinhas);
    const ex = db.get('SELECT * FROM checklist_itens WHERE cid = ? AND item_id = ?', Number(cid), item.id);
    if (!ex) {
      db.run('INSERT INTO checklist_itens (cid, item_id, status, status_manual, data_recebimento, responsavel, atualizado_por, atualizado_em) VALUES (?,?,?,?,?,?,?,?)', Number(cid), item.id, sugerido, 0, dataRec, resp, 'sistema', agora());
      n++;
    } else if (!ex.status_manual) {
      db.run('UPDATE checklist_itens SET status = ?, data_recebimento = ?, responsavel = ?, atualizado_por = ?, atualizado_em = ? WHERE cid = ? AND item_id = ?', sugerido, dataRec, resp, 'sistema', agora(), Number(cid), item.id);
    }
  }
  if (n) trilha.registrar(db, { usuario: 'sistema', tabela: 'checklist_itens', registro: cid, campo: 'criacao', valor_novo: n + ' item(ns) do checklist de recebimento' });
  return n;
}

function listar(db, cid) {
  const comp = D.competenciaPorCid(db, cid);
  const envio = D.ultimoEnvio(db, comp.cid);
  const linhas = Object.fromEntries(db.all('SELECT * FROM checklist_itens WHERE cid = ?', comp.cid).map((l) => [l.item_id, l]));
  let ctx = null;
  if (envio) ctx = contextoDoEnvio(envio);
  const divs = db.all("SELECT indicador_id, COUNT(*) AS n FROM divergencias WHERE cid = ? AND status IN ('aberta','em apuração') AND indicador_id IS NOT NULL GROUP BY indicador_id", comp.cid);
  const divPor = Object.fromEntries(divs.map((d) => [d.indicador_id, d.n]));
  const itens = O.ITENS.map((item) => {
    const l = linhas[item.id];
    const abertas = item.indicadores.reduce((s, id) => s + (divPor[id] || 0), 0);
    return {
      item_id: item.id, titulo: item.titulo, grupo: item.grupo, complementar: !!item.complementar, indicadores: item.indicadores,
      status: l ? l.status : null, status_manual: !!(l && l.status_manual), data_recebimento: l ? l.data_recebimento : null, responsavel: l ? l.responsavel : null,
      validacao: l ? l.validacao || '' : '', observacao: l ? l.observacao || '' : '', atualizado_por: l ? l.atualizado_por : null, atualizado_em: l ? l.atualizado_em : null,
      divergencias_abertas: abertas, faltas: ctx ? O.faltas(item, ctx.flat, ctx.snap.indicadores, ctx.snap.resumoLinhas) : [],
      sugestao: ctx ? O.situacaoSugerida(item, ctx.flat, ctx.snap.indicadores, ctx.snap.resumoLinhas) : null,
    };
  });
  const resumo = { recebido: 0, pendente: 0, incompleto: 0, 'não aplicável': 0 };
  for (const i of itens.filter((x) => !x.complementar && x.status)) resumo[i.status]++;
  return {
    competencia: comp.competencia_id, data_recebimento: envio ? P.dataLocal(envio.recebido_em || envio.enviado_em) : null,
    responsavel_envio: ctx ? ((ctx.snap.enviadoPor && ctx.snap.enviadoPor.nome) || envio.enviado_por) : null, versao: envio ? envio.versao : null,
    itens, resumo, iniciado: Object.values(linhas).length > 0,
  };
}

function atualizar(db, usuario, cid, itemId, dados) {
  const item = itemPor(itemId);
  if (!item) throw erro(404, 'Item do checklist não encontrado.');
  if (!['criador', 'colega', 'admin', 'superintendente'].includes(usuario.perfil)) throw erro(403, 'Só a equipe da CTAI altera o checklist de recebimento.');
  const comp = D.competenciaPorCid(db, cid);
  sincronizar(db, comp.cid);
  const ex = db.get('SELECT * FROM checklist_itens WHERE cid = ? AND item_id = ?', comp.cid, item.id);
  if (!ex) throw erro(409, 'Esta competência ainda não recebeu envio da unidade.');
  const d = dados || {};
  const novo = { status: ex.status, data_recebimento: ex.data_recebimento, responsavel: ex.responsavel, validacao: ex.validacao, observacao: ex.observacao };
  if (d.status !== undefined) { if (!O.STATUS.includes(d.status)) throw erro(400, 'Status inválido. Use: ' + O.STATUS.join(', ') + '.'); novo.status = d.status; }
  if (d.data_recebimento !== undefined) {
    const v = String(d.data_recebimento || '').trim();
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')))) throw erro(400, 'Data de recebimento inválida.');
    novo.data_recebimento = v || null;
  }
  if (d.responsavel !== undefined) { const v = String(d.responsavel || '').trim(); if (v.length > 120) throw erro(400, 'Responsável longo demais.'); novo.responsavel = v || null; }
  if (d.validacao !== undefined) { if (!O.VALIDACOES.includes(d.validacao || '')) throw erro(400, 'Validação inválida.'); novo.validacao = d.validacao || null; }
  if (d.observacao !== undefined) { const v = String(d.observacao || '').trim(); if (v.length > 1000) throw erro(400, 'Observação longa demais (máximo de 1.000 caracteres).'); novo.observacao = v || null; }
  if (novo.status === 'não aplicável' && !String(novo.observacao || '').trim()) throw erro(400, 'Para marcar "não aplicável", explique o motivo nas observações.');
  const mudou = Object.keys(novo).filter((k) => String(novo[k] || '') !== String(ex[k] || ''));
  if (!mudou.length) return;
  db.tx(() => {
    db.run('UPDATE checklist_itens SET status = ?, status_manual = 1, data_recebimento = ?, responsavel = ?, validacao = ?, observacao = ?, atualizado_por = ?, atualizado_em = ? WHERE cid = ? AND item_id = ?',
      novo.status, novo.data_recebimento, novo.responsavel, novo.validacao, novo.observacao, usuario.login, agora(), comp.cid, item.id);
    for (const k of mudou) trilha.registrar(db, { usuario: usuario.login, tabela: 'checklist_itens', registro: comp.cid + '/' + item.id, campo: k, valor_anterior: ex[k], valor_novo: novo[k], motivo: d.motivo || null });
  });
}

// Devolve ao cálculo do sistema (tira a marca de decisão manual).
function restaurarSugestao(db, usuario, cid, itemId) {
  const item = itemPor(itemId);
  if (!item) throw erro(404, 'Item do checklist não encontrado.');
  if (!['criador', 'colega', 'admin', 'superintendente'].includes(usuario.perfil)) throw erro(403, 'Só a equipe da CTAI altera o checklist de recebimento.');
  db.run('UPDATE checklist_itens SET status_manual = 0 WHERE cid = ? AND item_id = ?', Number(cid), item.id);
  sincronizar(db, cid);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'checklist_itens', registro: cid + '/' + item.id, campo: 'status', valor_novo: 'volta ao cálculo do sistema' });
}

module.exports = { sincronizar, listar, atualizar, restaurarSugestao };
