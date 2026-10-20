'use strict';
// Funções de domínio compartilhadas: contexto da competência, fichas, linhas, permissões e decisões de regra.
const F = require('../core/formularios');
const R = require('../core/regras');
const A = require('./auth');
const trilha = require('./trilha');

const erro = A.erro;

function json(v, padrao) {
  if (v === null || v === undefined || v === '') return padrao;
  try { return JSON.parse(v); } catch (_) { return padrao; }
}

function competenciaPorCid(db, cid) {
  const c = db.get('SELECT k.*, c.unidade, c.oss, c.numero_cg, c.demo, c.base_desconto_mensal, c.valor_mensal_global FROM competencias k JOIN contratos c ON c.contrato_id = k.contrato_id WHERE k.cid = ?', Number(cid));
  if (!c) throw erro(404, 'Competência não encontrada.');
  c.mes_implantacao = !!c.mes_implantacao;
  c.demo = !!c.demo;
  return c;
}

function regrasDoContrato(db, contratoId, regraId) {
  let linha = regraId ? db.get('SELECT * FROM regras WHERE regra_id = ?', regraId) : null;
  if (!linha) linha = db.get('SELECT * FROM regras WHERE contrato_id = ? ORDER BY vigente_de DESC, regra_id DESC', contratoId);
  if (!linha) throw erro(500, 'O contrato ainda não tem regras cadastradas.');
  const conteudo = JSON.parse(linha.conteudo);
  return { regra: linha, regras: conteudo };
}

function regrasDaCompetencia(db, cid) {
  const c = competenciaPorCid(db, cid);
  return regrasDoContrato(db, c.contrato_id, c.regra_id).regras;
}

// Permissão: perfis da CTAI veem tudo; perfis de unidade só o próprio contrato.
function exigirContrato(usuario, contratoId) {
  if (A.PERFIS_CTAI.includes(usuario.perfil)) return;
  if (usuario.contrato_id !== contratoId) throw erro(403, 'Você não tem acesso a esta unidade.');
}

function exigirSetor(usuario, setorId) {
  if (usuario.perfil === 'gestor_unidade' || usuario.perfil === 'admin') return;
  if (usuario.perfil === 'setor_unidade' && usuario.setor === setorId) return;
  throw erro(403, 'Você só pode preencher a ficha do seu setor.');
}

function fichasDaCompetencia(db, cid) {
  const out = {};
  for (const s of F.SETORES) out[s.id] = { setor: s.id, dados: {}, status: 'rascunho', atualizado_por: null, atualizado_em: null };
  for (const f of db.all('SELECT * FROM fichas WHERE cid = ?', Number(cid))) {
    out[f.setor] = { setor: f.setor, dados: json(f.dados, {}), status: f.status, atualizado_por: f.atualizado_por, atualizado_em: f.atualizado_em };
  }
  return out;
}

function achatarFichas(fichas) {
  const flat = {};
  for (const f of Object.values(fichas)) Object.assign(flat, f.dados);
  return flat;
}

function linhaDoBanco(l) {
  return {
    protocolo: l.protocolo, data_inicio: l.data_inicio, hora_inicio: l.hora_inicio, data_fim: l.data_fim, hora_fim: l.hora_fim,
    minutos: l.minutos, categoria: l.categoria, dados: json(l.dados, {}), origem: l.origem,
  };
}

// Linhas de trabalho da unidade (rascunho). Só as confirmadas entram no cálculo e no envio.
function linhasRascunho(db, cid, incluirPendentes) {
  const rows = db.all('SELECT * FROM linhas_rascunho WHERE cid = ?' + (incluirPendentes ? '' : ' AND confirmada = 1') + ' ORDER BY id', Number(cid));
  const out = {};
  for (const l of rows) (out[l.fonte] = out[l.fonte] || []).push(Object.assign(linhaDoBanco(l), { id: l.id }));
  return out;
}

function linhasDoEnvio(db, envioId) {
  const out = {};
  for (const l of db.all('SELECT * FROM linhas_brutas WHERE envio_id = ? ORDER BY linha_id', Number(envioId))) (out[l.fonte] = out[l.fonte] || []).push(linhaDoBanco(l));
  return out;
}

function ultimoEnvio(db, cid) {
  return db.get('SELECT * FROM envios WHERE cid = ? ORDER BY versao DESC LIMIT 1', Number(cid));
}

// Decisões de regra por contrato (as dúvidas pendentes).
const QUESTOES_REGRA = [
  { chave: 'desconto_modo', pergunta: 'O desconto é 10% fixo abaixo de 90 pontos ou segue a tabela de faixas do IGQ? Onde está escrito (Anexo II do contrato)?', opcoes: [{ valor: 'fixo', rotulo: '10% fixo' }, { valor: 'faixa', rotulo: 'Tabela de faixas' }] },
  { chave: 'vermelho', pergunta: 'O tempo da classificação vermelha pontua por faixa (5, 6 e 10 min) ou só vale a meta (cumpre ou não cumpre)?', opcoes: [{ valor: 'faixa', rotulo: 'Por faixa' }, { valor: 'binario', rotulo: 'Só a meta' }] },
  { chave: 'iam_meta', pergunta: 'A meta do porta-saída do IAMCSST é até 30 min ou menos de 120 min a partir de junho?', opcoes: [{ valor: '30', rotulo: 'Até 30 min' }, { valor: '120', rotulo: 'Menos de 120 min' }] },
  { chave: 'obitos', pergunta: 'O que o BID chama de óbito e como identificar os de 24 horas ou mais? (texto da CTAI)', opcoes: null },
  { chave: 'educacao_pessoas', pergunta: 'A adesão à educação conta pessoas únicas? Qual o denominador oficial (ativos do mês ou esperados)?', opcoes: [{ valor: 'unicas_ativos', rotulo: 'Pessoas únicas ÷ ativos' }, { valor: 'unicas_esperados', rotulo: 'Pessoas únicas ÷ esperados' }] },
  { chave: 'base_desconto', pergunta: 'O 17º TA e o piso da enfermagem entram na base do desconto?', opcoes: [{ valor: 'sem', rotulo: 'Não entram' }, { valor: 'com', rotulo: 'Entram' }] },
  { chave: 'satisfacao_denominador', pergunta: 'Qual o denominador oficial da cobertura da satisfação em abril (13.922 do parecer ou 11.454 do relatório)?', opcoes: [{ valor: '13922', rotulo: '13.922 (parecer)' }, { valor: '11454', rotulo: '11.454 (relatório)' }] },
  { chave: 'motivo_zero', pergunta: 'A CTAI deve registrar o motivo de cada zero no parecer?', opcoes: [{ valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Não' }] },
];

function decisoes(db, contratoId) {
  const out = {};
  for (const q of QUESTOES_REGRA) out[q.chave] = { chave: q.chave, pergunta: q.pergunta, opcoes: q.opcoes, valor: null, justificativa: null, decidido_por: null, decidido_em: null };
  for (const d of db.all('SELECT * FROM decisoes_regra WHERE contrato_id = ?', contratoId)) if (out[d.chave]) Object.assign(out[d.chave], { valor: d.valor, justificativa: d.justificativa, decidido_por: d.decidido_por, decidido_em: d.decidido_em });
  return out;
}

function decidir(db, contratoId, chave, valor, justificativa, usuario) {
  const q = QUESTOES_REGRA.find((x) => x.chave === chave);
  if (!q) throw erro(400, 'Questão de regra desconhecida.');
  if (q.opcoes && valor !== null && valor !== '' && !q.opcoes.some((o) => o.valor === String(valor))) throw erro(400, 'Opção inválida.');
  if (!String(justificativa || '').trim()) throw erro(400, 'Informe onde a regra está escrita ou quem decidiu (justificativa).');
  const ant = db.get('SELECT valor FROM decisoes_regra WHERE contrato_id = ? AND chave = ?', contratoId, chave);
  db.run('INSERT INTO decisoes_regra (contrato_id, chave, valor, justificativa, decidido_por, decidido_em) VALUES (?,?,?,?,?,?) ON CONFLICT(contrato_id, chave) DO UPDATE SET valor = excluded.valor, justificativa = excluded.justificativa, decidido_por = excluded.decidido_por, decidido_em = excluded.decidido_em',
    contratoId, chave, valor === '' ? null : valor, justificativa, usuario.login, new Date().toISOString());
  trilha.registrar(db, { usuario: usuario.login, tabela: 'decisoes_regra', registro: contratoId + '/' + chave, campo: 'valor', valor_anterior: ant ? ant.valor : null, valor_novo: valor, motivo: justificativa });
}

// Opções de pontuação a partir das decisões (vazio = padrão da ficha do contrato).
function opcoesDeDecisoes(dec) {
  const o = {};
  if (dec.vermelho && dec.vermelho.valor) o.vermelho = dec.vermelho.valor;
  if (dec.iam_meta && dec.iam_meta.valor) o.iamMeta = Number(dec.iam_meta.valor);
  return o;
}

function pendenciasDeRegra(db, contratoId, regras) {
  const dec = decisoes(db, contratoId);
  const abertas = Object.values(dec).filter((d) => !d.valor).map((d) => ({ chave: d.chave, pergunta: d.pergunta }));
  return { abertas, decididas: Object.values(dec).filter((d) => d.valor), regraPendencias: R.pendencias(regras) };
}

module.exports = {
  json, competenciaPorCid, regrasDoContrato, regrasDaCompetencia, exigirContrato, exigirSetor, fichasDaCompetencia, achatarFichas,
  linhasRascunho, linhasDoEnvio, linhaDoBanco, ultimoEnvio, QUESTOES_REGRA, decisoes, decidir, opcoesDeDecisoes, pendenciasDeRegra,
};
