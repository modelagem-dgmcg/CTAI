'use strict';
// Fluxo do envio da unidade: consolidar → fotografia (snapshot) → PDF → gravar de forma imutável → receber na CTAI.
// Receber = recalcular de forma independente, guardar divergências e rodar o Analista no texto do relatório.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const U = require('../core/util');
const R = require('../core/regras');
const F = require('../core/formularios');
const recalculo = require('../core/recalculo');
const D = require('./dominio');
const UC = require('./unidade-calculo');
const trilha = require('./trilha');
const achadosDb = require('./achados');
const { erro } = require('./auth');
const relatorio = require('./pdf/relatorio');
const render = require('./pdf/render');

const agora = () => new Date().toISOString();

// ---------- Antes do envio ----------
function situacaoAntesDoEnvio(db, cid) {
  const comp = D.competenciaPorCid(db, cid);
  const { regras } = D.regrasDoContrato(db, comp.contrato_id, comp.regra_id);
  const fichas = D.fichasDaCompetencia(db, cid);
  const flat = D.achatarFichas(fichas);
  const linhas = D.linhasRascunho(db, cid, false);
  const pendentesApi = db.get("SELECT COUNT(*) AS n FROM linhas_rascunho WHERE cid = ? AND confirmada = 0", Number(cid)).n;
  const consolidado = UC.consolidarDeclarados(flat, linhas);
  const pontos = UC.pontosDeclarados(regras, consolidado);
  const avisos = UC.conferirAntesDoEnvio(flat, linhas, consolidado);
  const naoProntas = F.SETORES.filter((s) => fichas[s.id].status !== 'pronta').map((s) => s.id);
  const bloqueios = [];
  if (naoProntas.length) bloqueios.push('Falta marcar como pronta a ficha de: ' + naoProntas.map((id) => F.setor(id).nome).join('; ') + '.');
  if (pendentesApi) bloqueios.push(pendentesApi + ' linha(s) vindas da integração aguardam a confirmação do gestor.');
  const ult = D.ultimoEnvio(db, cid);
  return { comp, regras, fichas, flat, linhas, consolidado, pontos, avisos, bloqueios, naoProntas, ultimoEnvio: ult ? { versao: ult.versao, enviado_em: ult.enviado_em } : null };
}

function montarSnapshot(db, cid, usuario, motivo) {
  const s = situacaoAntesDoEnvio(db, cid);
  const ult = D.ultimoEnvio(db, cid);
  const versao = ult ? ult.versao + 1 : 1;
  const indicadores = {};
  for (const ind of s.regras.indicadores) {
    const c = s.consolidado[ind.id] || {};
    indicadores[ind.id] = { valor: c.valor === undefined ? null : c.valor, origem: c.origem || null, n: c.n || null, anexo: c.anexo || null, pontos: s.pontos.porIndicador[ind.id] || 0 };
  }
  const fichas = {};
  for (const [id, f] of Object.entries(s.fichas)) fichas[id] = { dados: f.dados, status: f.status, atualizado_por: f.atualizado_por, atualizado_em: f.atualizado_em };
  // Só as colunas do relatório; sem ids internos.
  const linhas = {};
  for (const [fonte, ls] of Object.entries(s.linhas)) linhas[fonte] = ls.map((l) => ({ protocolo: l.protocolo, data_inicio: l.data_inicio, hora_inicio: l.hora_inicio, data_fim: l.data_fim, hora_fim: l.hora_fim, minutos: l.minutos, categoria: l.categoria, dados: l.dados, origem: l.origem }));
  return {
    modelo: 'relatorio-v1', versao, motivo: motivo || null, geradoEm: agora(),
    contrato: { contrato_id: s.comp.contrato_id, unidade: s.comp.unidade, oss: s.comp.oss, numero_cg: s.comp.numero_cg, demo: s.comp.demo },
    competencia: { competencia_id: s.comp.competencia_id, processo_sei: s.comp.processo_sei, mes_implantacao: s.comp.mes_implantacao },
    regra: { versao: s.regras.versao },
    fichas, indicadores, igqDeclarado: s.pontos.total, linhas, resumoLinhas: UC.resumoPorFonte(linhas),
    avisos: s.avisos.filter((a) => a.nivel === 'atencao'),
    enviadoPor: { nome: usuario.nome, login: usuario.login },
  };
}

function caminhoPdf(cid, versao) { return path.join(config.dataDir, 'envios', 'cid' + cid + '_v' + versao + '.pdf'); }

async function pdfDoSnapshot(snapshot, regras) {
  const { pdf } = await relatorio.gerarRelatorioPdf(snapshot, regras);
  return pdf;
}

// ---------- Envio ----------
async function enviar(db, cid, usuario, motivo) {
  const s = situacaoAntesDoEnvio(db, cid);
  if (s.bloqueios.length) throw erro(409, s.bloqueios.join(' '));
  const ult = D.ultimoEnvio(db, cid);
  if (ult && !String(motivo || '').trim()) throw erro(400, 'Este é um novo envio. Informe o motivo da correção.');
  const snapshot = montarSnapshot(db, cid, usuario, motivo);
  const hash = U.sha256(U.jsonCanonico(snapshot));
  // 1) O PDF nasce primeiro. Se falhar, nada é gravado.
  const pdf = await pdfDoSnapshot(Object.assign({}, snapshot, { hash }), s.regras);
  const arquivo = caminhoPdf(cid, snapshot.versao);
  fs.writeFileSync(arquivo, pdf);
  const pdfHash = U.sha256(pdf.toString('latin1'));
  // 2) Grava tudo ou nada.
  const envioId = db.tx(() => {
    const r = db.run('INSERT INTO envios (cid, versao, motivo, enviado_por, enviado_em, snapshot, hash_snapshot, pdf_arquivo, pdf_hash) VALUES (?,?,?,?,?,?,?,?,?)',
      Number(cid), snapshot.versao, motivo || null, usuario.login, snapshot.geradoEm, JSON.stringify(snapshot), hash, path.basename(arquivo), pdfHash);
    const id = Number(r.lastInsertRowid);
    for (const [fonte, ls] of Object.entries(snapshot.linhas)) {
      for (const l of ls) db.run('INSERT INTO linhas_brutas (cid, envio_id, fonte, protocolo, data_inicio, hora_inicio, data_fim, hora_fim, minutos, categoria, dados, origem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        Number(cid), id, fonte, l.protocolo, l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim, l.minutos, l.categoria, JSON.stringify(l.dados || {}), l.origem || 'portal');
    }
    for (const ind of s.regras.indicadores) {
      const c = snapshot.indicadores[ind.id];
      db.run('INSERT INTO indicadores_oss (cid, indicador_id, valor_declarado, pontos_declarados, texto_analise, documento_id, envio_id) VALUES (?,?,?,?,?,?,?)',
        Number(cid), ind.id, c.valor === null ? null : String(c.valor), c.pontos, c.origem ? 'Origem do valor: ' + c.origem + (c.n ? ' (' + c.n + ' casos)' : '') : null, c.anexo, id);
      if (c.anexo) db.run('INSERT INTO evidencias (cid, indicador_id, documento_id, tipo) VALUES (?,?,?,?) ON CONFLICT(cid, indicador_id) DO UPDATE SET documento_id = excluded.documento_id WHERE lido_por IS NULL', Number(cid), ind.id, c.anexo, 'anexo informado pela unidade');
    }
    db.run("UPDATE competencias SET status = 'enviada' WHERE cid = ? AND status IN ('aberta','enviada','recebida')", Number(cid));
    trilha.registrar(db, { usuario: usuario.login, tabela: 'envios', registro: cid + '/v' + snapshot.versao, campo: 'envio', valor_novo: { hash, pdf: pdfHash, linhas: Object.values(snapshot.linhas).reduce((n, l) => n + l.length, 0) }, motivo: motivo || 'Primeiro envio' });
    return id;
  });
  // 3) Recepção automática na CTAI.
  const recepcao = await receber(db, envioId, { usuario: 'sistema' });
  return { envio_id: envioId, versao: snapshot.versao, hash, pdf_hash: pdfHash, recepcao };
}

// ---------- Recepção e recálculo ----------
function declaradosDoEnvio(snapshot) {
  const flat = {};
  for (const f of Object.values(snapshot.fichas)) Object.assign(flat, f.dados);
  // O que a unidade declarou (digitado ou calculado por ela) vira o "declarado" que a CTAI confronta.
  for (const [id, s] of Object.entries(UC.SPEC)) {
    const c = snapshot.indicadores[id];
    if (c && c.valor !== null && c.valor !== undefined) flat[s.campo] = c.valor;
  }
  return flat;
}

function avaliacoesDaCompetencia(db, cid) {
  const out = {};
  for (const a of db.all('SELECT * FROM avaliacoes_linha WHERE cid = ?', Number(cid))) {
    (out[a.fonte] = out[a.fonte] || {})[a.protocolo] = a.valor === 'sim' || a.valor === '1' || a.valor === 'true';
  }
  return out;
}

function recalcularCompetencia(db, cid, envioId) {
  const comp = D.competenciaPorCid(db, cid);
  const envio = envioId ? db.get('SELECT * FROM envios WHERE envio_id = ?', Number(envioId)) : D.ultimoEnvio(db, cid);
  if (!envio) return null;
  const { regras } = D.regrasDoContrato(db, comp.contrato_id, comp.regra_id);
  const snapshot = JSON.parse(envio.snapshot);
  const linhas = D.linhasDoEnvio(db, envio.envio_id);
  const dec = D.decisoes(db, comp.contrato_id);
  const resultado = recalculo.recalcular({
    regras, competencia: { competencia_id: comp.competencia_id }, linhas, declarados: declaradosDoEnvio(snapshot),
    avaliacoes: avaliacoesDaCompetencia(db, cid), opcoes: D.opcoesDeDecisoes(dec),
  });
  resultado.envio = { envio_id: envio.envio_id, versao: envio.versao, enviado_em: envio.enviado_em };
  resultado.decisoesAbertas = Object.values(dec).filter((d) => !d.valor).map((d) => d.chave);
  return resultado;
}

function chaveDivergencia(d) { return U.sha256((d.indicador_id || '') + '|' + d.tema).slice(0, 16); }

// Mantém as divergências do recálculo em dia sem apagar a decisão que a CTAI já tomou sobre cada uma.
function sincronizarDivergencias(db, cid, resultado, envioId) {
  const atuais = db.all("SELECT * FROM divergencias WHERE cid = ? AND origem = 'recalculo'", Number(cid));
  const porChave = new Map(atuais.map((d) => [d.chave, d]));
  const vistas = new Set();
  for (const d of resultado.divergencias) {
    const chave = chaveDivergencia(d);
    vistas.add(chave);
    const dec = d.declarado === null || d.declarado === undefined ? null : String(d.declarado);
    const rec = d.recalculado === null || d.recalculado === undefined ? null : String(d.recalculado);
    const ex = porChave.get(chave);
    if (ex) db.run('UPDATE divergencias SET declarado = ?, recalculado = ?, diferenca = ?, gravidade = ?, envio_id = ?, observacao = CASE WHEN status = ? THEN ? ELSE observacao END WHERE divergencia_id = ?', dec, rec, d.diferenca, d.gravidade, envioId, 'aberta', d.observacao, ex.divergencia_id);
    else db.run("INSERT INTO divergencias (cid, indicador_id, tema, declarado, recalculado, diferenca, gravidade, status, observacao, origem, envio_id, chave) VALUES (?,?,?,?,?,?,?,'aberta',?,'recalculo',?,?)", Number(cid), d.indicador_id, d.tema, dec, rec, d.diferenca, d.gravidade, d.observacao, envioId, chave);
  }
  for (const ex of atuais) if (!vistas.has(ex.chave) && ex.status === 'aberta') db.run('DELETE FROM divergencias WHERE divergencia_id = ?', ex.divergencia_id);
}

async function receber(db, envioId, opcoes) {
  const envio = db.get('SELECT * FROM envios WHERE envio_id = ?', Number(envioId));
  if (!envio) throw erro(404, 'Envio não encontrado.');
  const resultado = recalcularCompetencia(db, envio.cid, envio.envio_id);
  db.tx(() => {
    sincronizarDivergencias(db, envio.cid, resultado, envio.envio_id);
    require('./checklist').sincronizar(db, envio.cid);
    db.run('UPDATE envios SET recebido_em = ?, recebido_por = ? WHERE envio_id = ?', agora(), (opcoes && opcoes.usuario) || 'sistema', envio.envio_id);
    db.run("UPDATE competencias SET status = 'recebida' WHERE cid = ? AND status IN ('aberta','enviada','recebida')", envio.cid);
    trilha.registrar(db, { usuario: (opcoes && opcoes.usuario) || 'sistema', tabela: 'envios', registro: envio.cid + '/v' + envio.versao, campo: 'recepcao', valor_novo: { igqRecalculado: resultado.igqRecalculado, igqDeclarado: resultado.igqDeclarado, divergencias: resultado.divergencias.length, alertas: resultado.alertas.length } });
  });
  // Analista sobre o texto do relatório (não bloqueia se não houver provedor).
  let analise = null;
  try { analise = await analisarEnvio(db, envio.envio_id, 'sistema'); } catch (e) { analise = { erro: e.message }; }
  return { igqRecalculado: resultado.igqRecalculado, igqDeclarado: resultado.igqDeclarado, divergencias: resultado.divergencias.length, alertas: resultado.alertas.length, analise };
}

function textoDoEnvio(db, envio) {
  const comp = D.competenciaPorCid(db, envio.cid);
  const { regras } = D.regrasDoContrato(db, comp.contrato_id, comp.regra_id);
  const snapshot = JSON.parse(envio.snapshot);
  const modelo = relatorio.construirRelatorio(Object.assign({}, snapshot, { hash: envio.hash_snapshot }), regras);
  return { modelo, texto: render.textoDoModelo(modelo), tabelas: render.tabelasDoModelo(modelo), comp, snapshot };
}

// Contexto para o Analista: valores por cor, nível de transparência e textos livres de outros meses (para achar cópia).
function contextoDoEnvio(db, envio, t) {
  const ind = t.snapshot.indicadores;
  const outros = [];
  for (const o of db.all('SELECT e.envio_id, e.cid, e.snapshot, k.competencia_id FROM envios e JOIN competencias k ON k.cid = e.cid WHERE k.contrato_id = ? AND e.cid <> ? ORDER BY e.envio_id', t.comp.contrato_id, envio.cid)) {
    const s = JSON.parse(o.snapshot);
    const txt = Object.values(s.fichas).map((f) => Object.entries(f.dados).filter(([k]) => k.endsWith('_obs')).map(([, v]) => v).join('\n')).join('\n');
    if (txt.trim()) outros.push({ id: 'o envio de ' + o.competencia_id, texto: txt });
  }
  return {
    competencia: t.comp.competencia_id, unidade: t.comp.unidade, mesImplantacao: t.comp.mes_implantacao,
    valores: { verde: ind['2.1'] && ind['2.1'].valor, amarelo: ind['2.2'] && ind['2.2'].valor, vermelho: ind['2.3'] && ind['2.3'].valor },
    transparencia: ind['2.13'] && ind['2.13'].valor, outrosTextos: outros,
  };
}

async function analisarEnvio(db, envioId, usuarioLogin) {
  const analista = require('../modules/analista');
  const envio = db.get('SELECT * FROM envios WHERE envio_id = ?', Number(envioId));
  const t = textoDoEnvio(db, envio);
  const res = await analista.analisar({
    texto: t.texto, tabelas: t.tabelas, tipo: 'relatorio_unidade',
    contexto: contextoDoEnvio(db, envio, t),
  });
  const n = achadosDb.salvar(db, { origem_tipo: 'envio', origem_id: envio.envio_id, cid: envio.cid, achados: res.achados, provedor: res.provedor, usuario: usuarioLogin });
  return { provedor: res.provedor, achados: n, tentativas: res.tentativas };
}

function lerPdf(db, envioId) {
  const e = db.get('SELECT * FROM envios WHERE envio_id = ?', Number(envioId));
  if (!e) throw erro(404, 'Envio não encontrado.');
  const arq = path.join(config.dataDir, 'envios', path.basename(e.pdf_arquivo));
  if (!fs.existsSync(arq)) throw erro(404, 'O arquivo PDF não foi encontrado no servidor.');
  const buf = fs.readFileSync(arq);
  return { envio: e, buffer: buf, integro: U.sha256(buf.toString('latin1')) === e.pdf_hash };
}

module.exports = { contextoDoEnvio, situacaoAntesDoEnvio, montarSnapshot, enviar, receber, recalcularCompetencia, sincronizarDivergencias, analisarEnvio, textoDoEnvio, lerPdf, declaradosDoEnvio, avaliacoesDaCompetencia };
