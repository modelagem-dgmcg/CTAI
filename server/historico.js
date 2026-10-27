'use strict';
// Histórico dos relatórios e pareceres anteriores, por unidade e trimestre.
// Regras: (1) tudo nasce como 'rascunho'; só vira 'confirmado' quando a pessoa da carteira confere; (2) quem importa é quem tem a unidade na carteira
// (administração e superintendência veem e fazem tudo); (3) a IA só propõe; (4) cada passo vai para a trilha de auditoria.
const U = require('../core/util');
const trilha = require('./trilha');
const CART = require('./carteira');
const X = require('./extrair-texto');
const CRUZ = require('./historico-cruzamentos');
const ESPELHO = require('./espelho-drive');
const { erro } = require('./auth');

const TRI = /^\d{4}-T[1-4]$/;
const TIPOS_DOC = ['parecer', 'relatório da OSS', 'outro'];
const SITUACOES = ['aberta', 'atendida', 'repetida'];
const GRAVIDADES = ['ALTA', 'MÉDIA', 'BAIXA'];
const agora = () => new Date().toISOString();
const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
const numero = (v, nome) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw erro(400, 'O valor de "' + nome + '" não é um número.');
  return n;
};

function exigirUnidade(db, usuario, contratoId) {
  const c = db.get('SELECT contrato_id, unidade, oss, demo FROM contratos WHERE contrato_id = ?', String(contratoId || ''));
  if (!c) throw erro(404, 'Unidade não encontrada.');
  CART.exigir(db, usuario, c.contrato_id);
  return c;
}
function relatorio(db, usuario, id) {
  const r = db.get('SELECT * FROM hist_relatorios WHERE hist_id = ?', Number(id));
  if (!r) throw erro(404, 'Relatório do histórico não encontrado.');
  CART.exigir(db, usuario, r.contrato_id);
  return r;
}
const filhos = (db, id) => ({
  indicadores: db.all('SELECT * FROM hist_indicadores WHERE hist_id = ? ORDER BY id', id).map((x) => Object.assign(x, { verificada: !!x.verificada })),
  achados: db.all('SELECT * FROM hist_achados WHERE hist_id = ? ORDER BY id', id).map((x) => Object.assign(x, { verificada: !!x.verificada })),
  recomendacoes: db.all('SELECT * FROM hist_recomendacoes WHERE hist_id = ? ORDER BY id', id).map((x) => Object.assign(x, { verificada: !!x.verificada })),
});
const cabeca = (r) => { const { texto, ...resto } = r; return Object.assign(resto, { tem_texto: !!texto }); };

function gravarFilhos(db, id, d) {
  db.run('DELETE FROM hist_indicadores WHERE hist_id = ?', id); db.run('DELETE FROM hist_achados WHERE hist_id = ?', id);
  // Recomendações já existentes mantêm a situação ao regravar o rascunho (rascunho: tudo recomeça como 'aberta').
  db.run('DELETE FROM hist_recomendacoes WHERE hist_id = ?', id);
  const vistos = new Set();
  for (const i of Array.isArray(d.indicadores) ? d.indicadores.slice(0, 80) : []) {
    const ind = txt(i.indicador_id, 20); if (!ind) continue;
    if (vistos.has(ind)) throw erro(400, 'O indicador ' + ind + ' aparece duas vezes na lista.');
    vistos.add(ind);
    db.run('INSERT INTO hist_indicadores (hist_id, indicador_id, nome, valor, pontos, max, trecho, verificada) VALUES (?,?,?,?,?,?,?,?)', id, ind, txt(i.nome, 200), txt(i.valor, 80), numero(i.pontos, 'pontos do indicador ' + ind), numero(i.max, 'máximo do indicador ' + ind), txt(i.trecho, 400), i.verificada ? 1 : 0);
  }
  for (const a of Array.isArray(d.achados) ? d.achados.slice(0, 80) : []) {
    const desc = txt(a.descricao, 600); if (!desc) continue;
    const g = GRAVIDADES.includes(a.gravidade) ? a.gravidade : 'MÉDIA';
    db.run('INSERT INTO hist_achados (hist_id, tipo, descricao, gravidade, trecho, verificada) VALUES (?,?,?,?,?,?)', id, txt(a.tipo, 120), desc, g, txt(a.trecho, 400), a.verificada ? 1 : 0);
  }
  for (const c of Array.isArray(d.recomendacoes) ? d.recomendacoes.slice(0, 80) : []) {
    const t = txt(c.texto, 600); if (!t) continue;
    db.run('INSERT INTO hist_recomendacoes (hist_id, texto, tema, situacao, trecho, verificada) VALUES (?,?,?,?,?,?)', id, t, txt(c.tema, 120), SITUACOES.includes(c.situacao) ? c.situacao : 'aberta', txt(c.trecho, 400), c.verificada ? 1 : 0);
  }
}
function validarCabeca(d) {
  const trimestre = txt(d.trimestre, 10);
  if (!TRI.test(trimestre)) throw erro(400, 'Informe o trimestre no formato 2026-T2 (ano, T e o número do trimestre).');
  const documento_tipo = TIPOS_DOC.includes(d.documento_tipo) ? d.documento_tipo : 'parecer';
  const pct = numero(d.desconto_pct, 'desconto (%)');
  if (pct !== null && (pct < 0 || pct > 100)) throw erro(400, 'O desconto em % precisa estar entre 0 e 100.');
  const igq = numero(d.igq, 'nota total (IGQ)');
  if (igq !== null && (igq < 0 || igq > 100)) throw erro(400, 'A nota total (IGQ) precisa estar entre 0 e 100.');
  return { trimestre, documento_tipo, igq, desconto_pct: pct, desconto_valor: numero(d.desconto_valor, 'desconto (R$)'), numero_parecer: txt(d.numero_parecer, 40) || null, observacao: txt(d.observacao, 500) || null };
}

// Lançamento à mão (também é o caminho quando a IA não está configurada).
function criarManual(db, usuario, d) {
  const c = exigirUnidade(db, usuario, d.contrato_id);
  const cab = validarCabeca(d);
  return db.tx(() => {
    const id = Number(db.run('INSERT INTO hist_relatorios (contrato_id, trimestre, documento_tipo, numero_parecer, igq, desconto_pct, desconto_valor, estado, origem, observacao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.contrato_id, cab.trimestre, cab.documento_tipo, cab.numero_parecer, cab.igq, cab.desconto_pct, cab.desconto_valor, 'rascunho', 'manual', cab.observacao, usuario.login, agora(), agora()).lastInsertRowid);
    gravarFilhos(db, id, d);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'hist_relatorios', registro: id, campo: 'rascunho_criado', valor_novo: { contrato: c.contrato_id, trimestre: cab.trimestre, origem: 'manual' } });
    return { hist_id: id };
  });
}

// Importação: lê o arquivo (já mascarado), propõe com IA (se houver) e deixa em rascunho para conferência.
async function importar(db, usuario, d) {
  const c = exigirUnidade(db, usuario, d.contrato_id);
  validarCabeca(d);
  const nome = txt(String(d.nome || 'relatorio').replace(/[\\/\r\n"]/g, '_'), 120);
  const buf = Buffer.from(String(d.base64 || ''), 'base64');
  const ex = await X.extrair(nome, buf);
  return importarTexto(db, usuario, Object.assign({}, d, { contrato_id: c.contrato_id, nome, texto: ex.texto, paginas: ex.paginas, mascarados: ex.mascarados }));
}

// Mesmo caminho, a partir de texto que já foi lido e mascarado (usado também pela tela "Alimentar o Analista").
async function importarTexto(db, usuario, d) {
  const c = exigirUnidade(db, usuario, d.contrato_id);
  const cab = validarCabeca(d);
  const nome = txt(String(d.nome || 'relatorio').replace(/[\\/\r\n"]/g, '_'), 120);
  const ex = { texto: String(d.texto || ''), paginas: d.paginas || null, mascarados: d.mascarados || {} };
  const hash = U.sha256(ex.texto);
  const igual = db.get('SELECT hist_id, trimestre FROM hist_relatorios WHERE contrato_id = ? AND hash = ?', c.contrato_id, hash);
  if (igual) { const e = erro(409, 'Este arquivo já foi importado para esta unidade (trimestre ' + igual.trimestre + ').'); e.hist_id = igual.hist_id; throw e; }
  const propor = d.semIA ? { ok: false, motivo: 'Leitura por IA não usada. Preencha à mão.' } : await require('../modules/analista/propor-historico').propor({ texto: ex.texto, unidade: c.unidade, trimestre: cab.trimestre });
  const id = db.tx(() => {
    const id2 = Number(db.run('INSERT INTO hist_relatorios (contrato_id, trimestre, documento_tipo, numero_parecer, nome_arquivo, hash, paginas, texto, igq, desconto_pct, desconto_valor, estado, origem, provedor, observacao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.contrato_id, cab.trimestre, cab.documento_tipo, cab.numero_parecer, nome, hash, ex.paginas, ex.texto, propor.ok ? propor.igq : null, propor.ok ? propor.desconto_pct : null, propor.ok ? propor.desconto_valor : null, 'rascunho', propor.ok ? 'ia' : 'manual', propor.ok ? propor.provedor : null, cab.observacao, usuario.login, agora(), agora()).lastInsertRowid);
    if (propor.ok) gravarFilhos(db, id2, propor);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'hist_relatorios', registro: id2, campo: 'importacao', valor_novo: { contrato: c.contrato_id, trimestre: cab.trimestre, arquivo: nome, caracteres: ex.texto.length, leitura: propor.ok ? propor.provedor : 'sem IA', mascarados: ex.mascarados || {} } });
    return id2;
  });
  return { hist_id: id, ia: { ok: !!propor.ok, provedor: propor.ok ? propor.provedor : null, motivo: propor.ok ? null : propor.motivo, truncado: !!propor.truncado } };
}

function obter(db, usuario, id, comTexto) {
  const r = relatorio(db, usuario, id);
  const out = Object.assign(cabeca(r), filhos(db, r.hist_id));
  if (comTexto) out.texto = r.texto || '';
  return out;
}

function salvar(db, usuario, id, d) {
  const r = relatorio(db, usuario, id);
  if (r.estado !== 'rascunho') throw erro(409, 'Este relatório já foi confirmado e não pode mais ser editado. Só a situação das recomendações muda.');
  const cab = validarCabeca(Object.assign({}, d, { trimestre: d.trimestre || r.trimestre }));
  db.tx(() => {
    db.run('UPDATE hist_relatorios SET trimestre = ?, documento_tipo = ?, numero_parecer = ?, igq = ?, desconto_pct = ?, desconto_valor = ?, observacao = ?, atualizado_em = ? WHERE hist_id = ?',
      cab.trimestre, cab.documento_tipo, cab.numero_parecer, cab.igq, cab.desconto_pct, cab.desconto_valor, cab.observacao, agora(), r.hist_id);
    gravarFilhos(db, r.hist_id, d);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'hist_relatorios', registro: r.hist_id, campo: 'rascunho_salvo', valor_novo: { igq: cab.igq, indicadores: (d.indicadores || []).length, achados: (d.achados || []).length, recomendacoes: (d.recomendacoes || []).length } });
  });
  return obter(db, usuario, r.hist_id);
}

function confirmar(db, usuario, id) {
  const r = relatorio(db, usuario, id);
  if (r.estado === 'confirmado') throw erro(409, 'Este relatório já está confirmado.');
  const f = filhos(db, r.hist_id);
  if (r.igq === null && !f.indicadores.length && !f.achados.length && !f.recomendacoes.length) throw erro(400, 'Não há nada para confirmar: preencha ao menos a nota total, um indicador, um achado ou uma recomendação.');
  db.tx(() => {
    db.run("UPDATE hist_relatorios SET estado = 'confirmado', confirmado_por = ?, confirmado_em = ?, atualizado_em = ?, texto = NULL WHERE hist_id = ?", usuario.login, agora(), agora(), r.hist_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'hist_relatorios', registro: r.hist_id, campo: 'confirmado', valor_novo: { contrato: r.contrato_id, trimestre: r.trimestre, igq: r.igq, origem: r.origem } });
  });
  espelhar(db);
  return obter(db, usuario, r.hist_id);
}

function excluirRascunho(db, usuario, id) {
  const r = relatorio(db, usuario, id);
  if (r.estado !== 'rascunho') throw erro(409, 'Só rascunho pode ser descartado. O histórico confirmado não se apaga.');
  db.tx(() => {
    db.run('DELETE FROM hist_indicadores WHERE hist_id = ?', r.hist_id); db.run('DELETE FROM hist_achados WHERE hist_id = ?', r.hist_id); db.run('DELETE FROM hist_recomendacoes WHERE hist_id = ?', r.hist_id);
    db.run('DELETE FROM hist_relatorios WHERE hist_id = ?', r.hist_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'hist_relatorios', registro: r.hist_id, campo: 'rascunho_descartado', valor_anterior: { contrato: r.contrato_id, trimestre: r.trimestre, arquivo: r.nome_arquivo } });
  });
}

// A situação de uma recomendação confirmada muda com o tempo (atendida, repetida). Só isso se altera depois de confirmar, e fica na trilha.
function mudarSituacao(db, usuario, recId, situacao, nota) {
  const c = db.get('SELECT c.*, r.contrato_id, r.estado FROM hist_recomendacoes c JOIN hist_relatorios r ON r.hist_id = c.hist_id WHERE c.id = ?', Number(recId));
  if (!c) throw erro(404, 'Recomendação não encontrada.');
  CART.exigir(db, usuario, c.contrato_id);
  if (c.estado !== 'confirmado') throw erro(409, 'Confirme o relatório antes de marcar a situação da recomendação.');
  if (!SITUACOES.includes(situacao)) throw erro(400, 'Situação inválida. Use aberta, atendida ou repetida.');
  db.tx(() => {
    db.run('UPDATE hist_recomendacoes SET situacao = ?, situacao_por = ?, situacao_em = ?, situacao_nota = ? WHERE id = ?', situacao, usuario.login, agora(), txt(nota, 300) || null, c.id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'hist_recomendacoes', registro: c.id, campo: 'situacao', valor_anterior: c.situacao, valor_novo: situacao, motivo: txt(nota, 300) || null });
  });
  espelhar(db);
  return { ok: true };
}

// ---------- leitura para as telas ----------
function confirmadosDe(db, contratoId) {
  const rels = db.all("SELECT hist_id, trimestre, documento_tipo, igq, numero_parecer FROM hist_relatorios WHERE contrato_id = ? AND estado = 'confirmado' ORDER BY trimestre, hist_id", contratoId);
  return rels.map((r) => Object.assign(r, filhos(db, r.hist_id)));
}
function unidade(db, usuario, contratoId) {
  const c = exigirUnidade(db, usuario, contratoId);
  const todos = db.all('SELECT hist_id, trimestre, documento_tipo, numero_parecer, nome_arquivo, igq, desconto_pct, desconto_valor, estado, origem, provedor, criado_por, criado_em, confirmado_por, confirmado_em FROM hist_relatorios WHERE contrato_id = ? ORDER BY trimestre DESC, hist_id DESC', c.contrato_id);
  const conf = confirmadosDe(db, c.contrato_id);
  const avisos = CRUZ.cruzar(conf);
  const linhaDoTempo = CRUZ.porTrimestre(conf).map((r) => ({
    trimestre: r.trimestre, hist_id: r.hist_id, documento_tipo: r.documento_tipo, igq: r.igq, numero_parecer: r.numero_parecer, achados: r.achados.length, recomendacoes: r.recomendacoes,
    abertas: r.recomendacoes.filter((x) => x.situacao === 'aberta').length, desconto_pct: db.get('SELECT desconto_pct FROM hist_relatorios WHERE hist_id = ?', r.hist_id).desconto_pct,
  }));
  return { contrato: c, relatorios: todos, avisos, tendencia: CRUZ.tendencia(conf), linhaDoTempo };
}
function carteira(db, usuario) {
  const escopo = CART.permitidos(db, usuario);
  const contratos = db.all('SELECT contrato_id, unidade, oss, demo FROM contratos ORDER BY demo, unidade').filter((c) => !escopo || escopo.has(c.contrato_id));
  return contratos.map((c) => {
    const conf = confirmadosDe(db, c.contrato_id), avisos = CRUZ.cruzar(conf);
    const rasc = db.get("SELECT COUNT(*) AS n FROM hist_relatorios WHERE contrato_id = ? AND estado = 'rascunho'", c.contrato_id).n;
    return { contrato_id: c.contrato_id, unidade: c.unidade, oss: c.oss, demo: !!c.demo, confirmados: conf.length, rascunhos: rasc, tendencia: CRUZ.tendencia(conf), avisos: avisos.length, avisosAltos: avisos.filter((a) => a.gravidade === 'ALTA').length };
  });
}
// Bloco "Do histórico desta unidade" na tela do parecer.
function avisosDaUnidade(db, usuario, contratoId) {
  const c = exigirUnidade(db, usuario, contratoId);
  const conf = confirmadosDe(db, c.contrato_id);
  return { unidade: c.unidade, confirmados: conf.length, avisos: CRUZ.cruzar(conf), tendencia: CRUZ.tendencia(conf), ultimo: conf.length ? CRUZ.porTrimestre(conf).slice(-1)[0].trimestre : null };
}

// ---------- espelho no Drive (cópia; nunca derruba a operação) ----------
let espelhando = false;
function espelhar(db) {
  if (!ESPELHO.estado().ligado || espelhando) return;
  espelhando = true;
  setImmediate(async () => {
    try { const r = await ESPELHO.enviar(ESPELHO.registrosConfirmados(db)); trilha.registrar(db, { usuario: 'sistema', tabela: 'espelho_drive', registro: 'historico', campo: 'envio', valor_novo: r.ok ? 'ok' : (r.motivo || 'falhou') }); }
    catch (_) { /* a cópia é um reforço */ } finally { espelhando = false; }
  });
}
async function espelharAgora(db, usuario) {
  const r = await ESPELHO.enviar(ESPELHO.registrosConfirmados(db));
  trilha.registrar(db, { usuario: usuario.login, tabela: 'espelho_drive', registro: 'historico', campo: 'envio_manual', valor_novo: r.ok ? 'ok' : (r.motivo || 'falhou') });
  return r;
}
// Restaura do espelho SÓ se o histórico confirmado do sistema estiver vazio (nunca sobrescreve o que existe).
async function restaurarDoEspelho(db, usuario) {
  if (db.get("SELECT 1 AS x FROM hist_relatorios WHERE estado = 'confirmado' LIMIT 1")) throw erro(409, 'O histórico do sistema não está vazio. A restauração só vale para um banco vazio.');
  const r = await ESPELHO.restaurar();
  if (!r.ok) return r;
  const abas = r.abas || {}; let n = 0;
  db.tx(() => {
    for (const x of abas.hist_relatorios || []) {
      if (!db.get('SELECT 1 AS x FROM contratos WHERE contrato_id = ?', String(x.contrato_id))) continue;
      db.run("INSERT INTO hist_relatorios (hist_id, contrato_id, trimestre, documento_tipo, numero_parecer, nome_arquivo, hash, paginas, igq, desconto_pct, desconto_valor, estado, origem, observacao, criado_por, criado_em, confirmado_por, confirmado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,'confirmado',?,?,?,?,?,?)",
        Number(x.hist_id), x.contrato_id, x.trimestre, x.documento_tipo || 'parecer', x.numero_parecer || null, x.nome_arquivo || null, x.hash || null, x.paginas === '' ? null : x.paginas, x.igq === '' ? null : x.igq, x.desconto_pct === '' ? null : x.desconto_pct, x.desconto_valor === '' ? null : x.desconto_valor, x.origem || 'manual', x.observacao || null, x.criado_por || 'restauração', x.criado_em || agora(), x.confirmado_por || null, x.confirmado_em || null);
      n++;
    }
    const ok = new Set((abas.hist_relatorios || []).map((x) => Number(x.hist_id)));
    for (const x of abas.hist_indicadores || []) if (ok.has(Number(x.hist_id))) db.run('INSERT INTO hist_indicadores (hist_id, indicador_id, nome, valor, pontos, max, trecho, verificada) VALUES (?,?,?,?,?,?,?,?)', Number(x.hist_id), x.indicador_id, x.nome || '', x.valor === undefined ? '' : String(x.valor), x.pontos === '' ? null : x.pontos, x.max === '' ? null : x.max, x.trecho || '', Number(x.verificada) ? 1 : 0);
    for (const x of abas.hist_achados || []) if (ok.has(Number(x.hist_id))) db.run('INSERT INTO hist_achados (hist_id, tipo, descricao, gravidade, trecho, verificada) VALUES (?,?,?,?,?,?)', Number(x.hist_id), x.tipo || '', x.descricao || '', GRAVIDADES.includes(x.gravidade) ? x.gravidade : 'MÉDIA', x.trecho || '', Number(x.verificada) ? 1 : 0);
    for (const x of abas.hist_recomendacoes || []) if (ok.has(Number(x.hist_id))) db.run('INSERT INTO hist_recomendacoes (hist_id, texto, tema, situacao, trecho, verificada, situacao_por, situacao_em, situacao_nota) VALUES (?,?,?,?,?,?,?,?,?)', Number(x.hist_id), x.texto || '', x.tema || '', SITUACOES.includes(x.situacao) ? x.situacao : 'aberta', x.trecho || '', Number(x.verificada) ? 1 : 0, x.situacao_por || null, x.situacao_em || null, x.situacao_nota || null);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'espelho_drive', registro: 'historico', campo: 'restauracao', valor_novo: n + ' relatório(s) restaurado(s) da planilha' });
  });
  return { ok: true, relatorios: n };
}

module.exports = { criarManual, importar, importarTexto, exigirUnidade, filhos, obter, salvar, confirmar, excluirRascunho, mudarSituacao, unidade, carteira, avisosDaUnidade, confirmadosDe, espelharAgora, restaurarDoEspelho, TRI, TIPOS_DOC, SITUACOES };
