'use strict';
// Minuta do parecer trimestral e mesa de conferência.
// Fluxo: o criador monta e congela uma versão → colegas conferem item a item, em paralelo → a superintendente confere e autoriza →
// o criador anexa no SEI (fora do sistema) e registra o número. O "OK" é controle interno, não é assinatura.
// Ninguém aprova o próprio trabalho. Qualquer mudança depois do congelamento exige nova versão.
const U = require('../core/util');
const R = require('../core/regras');
const D = require('./dominio');
const E = require('./envios');
const trilha = require('./trilha');
const SEI = require('./sei');
const achadosDb = require('./achados');
const { erro } = require('./auth');

const ITENS = [
  { id: 'identificacao', titulo: 'Identificação do parecer', ajuda: 'Unidade, trimestre, competências, regra usada e número do parecer.' },
  { id: 'sei', titulo: 'Documento no SEI confere com a versão recebida no sistema', ajuda: 'Abra o documento no SEI e compare o código no rodapé do PDF (versão e código curto) com os dados de apoio abaixo. Sem a API do SEI, o número é registrado à mão pela unidade.' },
  { id: 'indicadores', titulo: 'Indicadores e pontos', ajuda: 'Valor declarado × recalculado e os pontos adotados, com a justificativa dos ajustes.' },
  { id: 'divergencias', titulo: 'Divergências', ajuda: 'O que a unidade declarou e o que as linhas mostram, com o que foi decidido.' },
  { id: 'desconto', titulo: 'Desconto', ajuda: 'Cenários de desconto e o valor adotado. Veja se as dúvidas de regra estão decididas.' },
  { id: 'alertas', titulo: 'Alertas do recálculo', ajuda: 'Amostras pequenas, valores perto do limite, cobertura baixa, regras pendentes.' },
  { id: 'texto', titulo: 'Texto do parecer', ajuda: 'Abertura, análise e conclusão. Confira números e meses citados.' },
  { id: 'achados', titulo: 'Achados do Analista fixados', ajuda: 'Pontos que a equipe fixou a partir da leitura do Analista.' },
];

const agora = () => new Date().toISOString();
const ehMesa = (u) => u && (u.perfil === 'colega' || u.perfil === 'superintendente');

// ---------- Parecer ----------
function obter(db, id) {
  const p = db.get('SELECT * FROM pareceres WHERE parecer_id = ?', Number(id));
  if (!p) throw erro(404, 'Parecer não encontrado.');
  p.competencias = D.json(p.competencias, []);
  p.blocos = D.json(p.blocos, {});
  return p;
}

function listar(db) {
  return db.all('SELECT p.*, c.unidade, c.demo, u.nome AS criador_nome FROM pareceres p JOIN contratos c ON c.contrato_id = p.contrato_id JOIN usuarios u ON u.usuario_id = p.criador_id ORDER BY p.parecer_id DESC').map((p) => {
    const v = db.get('SELECT numero, status FROM versoes_minuta WHERE parecer_id = ? ORDER BY numero DESC LIMIT 1', p.parecer_id);
    return Object.assign(p, { competencias: D.json(p.competencias, []), blocos: undefined, ultimaVersao: v || null, demo: !!p.demo });
  });
}

function criar(db, usuario, dados) {
  if (!['criador', 'admin'].includes(usuario.perfil)) throw erro(403, 'Só quem cria o parecer (perfil criador) pode abrir uma minuta.');
  const c = db.get('SELECT * FROM contratos WHERE contrato_id = ?', dados.contrato_id);
  if (!c) throw erro(400, 'Contrato não encontrado.');
  const comps = (dados.competencias || []).map(String);
  if (!comps.length) throw erro(400, 'Escolha ao menos uma competência.');
  for (const id of comps) if (!db.get('SELECT 1 FROM competencias WHERE contrato_id = ? AND competencia_id = ?', c.contrato_id, id)) throw erro(400, 'A competência ' + id + ' não existe neste contrato.');
  const trimestre = String(dados.trimestre || '').trim();
  if (!trimestre) throw erro(400, 'Informe o trimestre (ex.: 2026-T2).');
  if (db.get('SELECT 1 FROM pareceres WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, trimestre)) throw erro(409, 'Já existe parecer deste contrato para ' + trimestre + '.');
  const r = db.run('INSERT INTO pareceres (contrato_id, trimestre, competencias, numero_parecer, titulo, criador_id, status, blocos, criado_em, atualizado_em, atualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    c.contrato_id, trimestre, JSON.stringify(comps), dados.numero_parecer || null, dados.titulo || ('Parecer ' + c.unidade + ' – ' + trimestre), usuario.usuario_id, 'rascunho', JSON.stringify({ texto: {} }), agora(), agora(), usuario.login);
  const id = Number(r.lastInsertRowid);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: id, campo: 'criacao', valor_novo: { contrato: c.contrato_id, trimestre, competencias: comps } });
  return id;
}

function exigirCriador(p, usuario) {
  if (usuario.usuario_id !== p.criador_id) throw erro(403, 'Só quem criou o parecer pode alterá-lo.');
  if (p.status === 'anexado ao SEI') throw erro(409, 'O parecer já foi anexado ao SEI. Correções agora são feitas no SEI.');
}

function salvarTexto(db, parecerId, usuario, texto, extra) {
  const p = obter(db, parecerId);
  exigirCriador(p, usuario);
  const ant = JSON.stringify(p.blocos.texto || {});
  const novo = Object.assign({}, p.blocos.texto || {});
  for (const k of ['abertura', 'analise', 'conclusao']) if (texto && texto[k] !== undefined) novo[k] = String(texto[k]);
  p.blocos.texto = novo;
  db.run('UPDATE pareceres SET blocos = ?, numero_parecer = COALESCE(?, numero_parecer), titulo = COALESCE(?, titulo), atualizado_em = ?, atualizado_por = ? WHERE parecer_id = ?',
    JSON.stringify(p.blocos), extra && extra.numero_parecer !== undefined ? extra.numero_parecer : null, extra && extra.titulo ? extra.titulo : null, agora(), usuario.login, p.parecer_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'texto', valor_anterior: ant, valor_novo: JSON.stringify(novo) });
}

// ---------- Pontos adotados ----------
function adotar(db, parecerId, usuario, cid, indicadorId, dados) {
  const p = obter(db, parecerId);
  exigirCriador(p, usuario);
  const k = D.competenciaPorCid(db, cid);
  if (k.contrato_id !== p.contrato_id) throw erro(400, 'A competência não pertence ao contrato do parecer.');
  const { regras } = D.regrasDoContrato(db, k.contrato_id, k.regra_id);
  const ind = regras.indicadores.find((i) => i.id === indicadorId);
  if (!ind) throw erro(400, 'Indicador desconhecido.');
  const origem = dados.origem || 'ajuste manual';
  if (!['recalculo', 'declarado', 'ajuste manual', 'parecer'].includes(origem)) throw erro(400, 'Origem inválida.');
  if (origem === 'recalculo') {
    const ant = db.get('SELECT * FROM indicadores_ctai WHERE cid = ? AND indicador_id = ?', Number(cid), indicadorId);
    db.run('DELETE FROM indicadores_ctai WHERE cid = ? AND indicador_id = ?', Number(cid), indicadorId);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'indicadores_ctai', registro: cid + '/' + indicadorId, campo: 'pontos_adotados', valor_anterior: ant ? ant.pontos_adotados : null, valor_novo: 'volta ao recalculado', motivo: dados.justificativa });
    return;
  }
  const pontos = Number(dados.pontos);
  if (!Number.isFinite(pontos) || pontos < 0) throw erro(400, 'Informe os pontos (número maior ou igual a zero).');
  if (pontos > ind.max) throw erro(400, 'O indicador ' + indicadorId + ' vale no máximo ' + ind.max + ' pontos.');
  if ((origem === 'ajuste manual' || origem === 'parecer') && !String(dados.justificativa || '').trim()) throw erro(400, 'Explique o motivo do ajuste (justificativa).');
  if (pontos === 0 && !String(dados.motivo_do_zero || '').trim() && D.decisoes(db, k.contrato_id).motivo_zero.valor !== 'nao') throw erro(400, 'Zero ponto precisa de motivo registrado.');
  const ant = db.get('SELECT * FROM indicadores_ctai WHERE cid = ? AND indicador_id = ?', Number(cid), indicadorId);
  db.run('INSERT INTO indicadores_ctai (cid, indicador_id, valor_adotado, pontos_adotados, motivo_do_zero, origem, justificativa, responsavel, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(cid, indicador_id) DO UPDATE SET valor_adotado = excluded.valor_adotado, pontos_adotados = excluded.pontos_adotados, motivo_do_zero = excluded.motivo_do_zero, origem = excluded.origem, justificativa = excluded.justificativa, responsavel = excluded.responsavel, atualizado_em = excluded.atualizado_em',
    Number(cid), indicadorId, dados.valor_adotado === undefined || dados.valor_adotado === null ? null : String(dados.valor_adotado), pontos, dados.motivo_do_zero || null, origem, dados.justificativa || null, usuario.login, agora());
  trilha.registrar(db, { usuario: usuario.login, tabela: 'indicadores_ctai', registro: cid + '/' + indicadorId, campo: 'pontos_adotados', valor_anterior: ant ? ant.pontos_adotados : 'recalculado', valor_novo: pontos, motivo: dados.justificativa || dados.motivo_do_zero || origem });
}

// ---------- Conteúdo ----------
function meses(lista, chave) {
  if (lista.some((m) => m[chave] === null || m[chave] === undefined)) return null;
  return lista.map((m) => ({ competencia: m.competencia, igq: m[chave], implantacao: m.implantacao }));
}

// Dados de apoio do item "Documento no SEI confere": versão e código curto recebidos no sistema e o SEI registrado pela unidade.
// Entram no conteúdo congelado: se a unidade mudar o registro depois, a minuta passa a mostrar "alterada" e pede nova versão.
function canaisParaMinuta(db, cid) {
  const c = SEI.canais(db, cid);
  const u = c.ultima;
  return {
    sistema: u ? { versao: u.versao, recebido_em: u.recebido_em || u.enviado_em, hash_curto: u.hash_curto } : null,
    sei: u && u.sei ? { numero: u.sei.numero, registrado_por: u.sei.registrado_por, registrado_em: u.sei.registrado_em, versao: u.versao } : (c.registrada ? { numero: c.registrada.numero, versao: c.registrada.versao, de_versao_anterior: true } : null),
    alertas: c.alertas.map((a) => a.codigo),
  };
}

function conteudoAtual(db, parecerId) {
  const p = obter(db, parecerId);
  const contrato = db.get('SELECT * FROM contratos WHERE contrato_id = ?', p.contrato_id);
  const criador = db.get('SELECT nome, login FROM usuarios WHERE usuario_id = ?', p.criador_id);
  const dec = D.decisoes(db, p.contrato_id);
  let regrasUsadas = null;
  const comps = [];
  const divs = [];
  const alertas = [];
  const pinned = [];
  for (const competencia_id of p.competencias) {
    const k = db.get('SELECT * FROM competencias WHERE contrato_id = ? AND competencia_id = ?', p.contrato_id, competencia_id);
    if (!k) continue;
    const { regras } = D.regrasDoContrato(db, k.contrato_id, k.regra_id);
    regrasUsadas = regrasUsadas || regras;
    const envio = D.ultimoEnvio(db, k.cid);
    const rec = envio ? E.recalcularCompetencia(db, k.cid) : null;
    const oss = db.all('SELECT * FROM indicadores_oss WHERE cid = ? AND ' + (envio ? 'envio_id = ?' : 'envio_id IS NULL'), ...(envio ? [k.cid, envio.envio_id] : [k.cid]));
    const ossPor = Object.fromEntries(oss.map((o) => [o.indicador_id, o]));
    const ctai = Object.fromEntries(db.all('SELECT * FROM indicadores_ctai WHERE cid = ?', k.cid).map((c) => [c.indicador_id, c]));
    const tot = db.get('SELECT * FROM totais_igq WHERE cid = ?', k.cid) || {};
    const indicadores = regras.indicadores.map((ind) => {
      const o = ossPor[ind.id];
      const r = rec && rec.indicadores[ind.id];
      const c = ctai[ind.id];
      const pontosRec = r ? r.pontos : null;
      let adotado = c ? c.pontos_adotados : pontosRec;
      let origem = c ? c.origem : (r ? 'recalculo' : null);
      return {
        id: ind.id, nome: ind.nome, max: ind.max,
        valor_oss: o ? o.valor_declarado : null, pontos_oss: o ? o.pontos_declarados : null,
        valor_ctai: r ? (r.valor === undefined ? null : r.valor) : null, pontos_recalculados: pontosRec,
        base_calculo: r ? r.fonteCalculo : null,
        pontos_adotados: adotado === undefined ? null : adotado, origem, justificativa: c ? c.justificativa : null, motivo_do_zero: c ? c.motivo_do_zero : null,
      };
    });
    const soma = (campo) => indicadores.every((i) => i[campo] !== null && i[campo] !== undefined) ? indicadores.reduce((s, i) => s + Math.min(i[campo], i.max), 0) : null;
    const igq = {
      oss: soma('pontos_oss') ?? (tot.igq_oss ?? null),
      recalculado: rec ? rec.igqRecalculado : (tot.igq_pagina3_faixas ?? null),
      adotado: soma('pontos_adotados') ?? (tot.igq_parecer ?? null),
    };
    comps.push({ cid: k.cid, competencia: competencia_id, implantacao: !!k.mes_implantacao, processo_sei: k.processo_sei, envio: envio ? { versao: envio.versao, enviado_em: envio.enviado_em, hash: SEI.hashCurto(envio.hash_snapshot) } : null, canais: canaisParaMinuta(db, k.cid), indicadores, igq, observacao_totais: tot.observacao || null });
    for (const d of db.all('SELECT * FROM divergencias WHERE cid = ? ORDER BY divergencia_id', k.cid)) {
      divs.push({ competencia: competencia_id, indicador_id: d.indicador_id, tema: d.tema, declarado: d.declarado, recalculado: d.recalculado, gravidade: d.gravidade, status: d.status, origem: d.origem, observacao: d.observacao });
    }
    if (rec) for (const a of rec.alertas) alertas.push({ competencia: competencia_id, indicador_id: a.indicador_id || null, codigo: a.codigo, gravidade: a.gravidade, mensagem: a.mensagem });
    for (const a of db.all("SELECT * FROM achados WHERE cid = ? AND status = 'fixado' ORDER BY achado_id", k.cid)) pinned.push({ competencia: competencia_id, achado_id: a.achado_id, gravidade: a.gravidade, tipo: a.tipo, trecho: a.trecho, risco: a.risco, sugestao: a.sugestao });
  }
  regrasUsadas = regrasUsadas || D.regrasDoContrato(db, p.contrato_id).regras;
  // Desconto
  const base = contrato.base_desconto_mensal;
  const listaMeses = (campo) => comps.map((c) => ({ competencia: c.competencia, implantacao: c.implantacao, oss: c.igq.oss, recalculado: c.igq.recalculado, adotado: c.igq.adotado }));
  const mm = listaMeses();
  const fontes = {};
  const mo = meses(mm, 'oss'); if (mo) fontes['Declarado pela OSS'] = mo;
  const mr = meses(mm, 'recalculado'); if (mr) fontes['Recalculado pela CTAI'] = mr;
  const ma = meses(mm, 'adotado'); if (ma) fontes['Adotado no parecer'] = ma;
  const cenarios = R.cenariosDesconto(regrasUsadas, fontes, base);
  const modo = dec.desconto_modo.valor;
  let adotadoDesconto = null;
  if (ma) adotadoDesconto = modo ? Object.assign({ modo }, R.descontoPeriodo(regrasUsadas, ma, modo, base)) : { modo: null, pendente: true };
  const integridade = [];
  if (dec.motivo_zero.valor !== 'nao') for (const c of comps) {
    const lin = c.indicadores.filter((i) => i.pontos_adotados !== null).map((i) => ({ indicador_id: i.id, pontos_adotados: i.pontos_adotados, motivo_do_zero: i.motivo_do_zero, origem: i.origem === 'ajuste manual' ? 'ajuste manual' : i.origem, justificativa: i.justificativa }));
    for (const e of R.validarIntegridade(regrasUsadas, { mes_implantacao: c.implantacao }, lin, null)) {
      if (e.codigo === 'ZERO_SEM_MOTIVO' && dec.motivo_zero.valor !== 'sim') {
        // Sem a decisão "sim", só cobra motivo de zero que a pessoa ajustou à mão.
        const id = e.mensagem.split(' ')[1];
        const i = c.indicadores.find((x) => x.id === id);
        if (!i || i.origem === 'recalculo') continue;
      }
      integridade.push(Object.assign({ competencia: c.competencia }, e));
    }
  }
  const regraPend = D.pendenciasDeRegra(db, p.contrato_id, regrasUsadas);
  return {
    identificacao: { contrato_id: contrato.contrato_id, unidade: contrato.unidade, oss: contrato.oss, numero_cg: contrato.numero_cg, demo: !!contrato.demo, trimestre: p.trimestre, competencias: p.competencias, numero_parecer: p.numero_parecer, titulo: p.titulo, criador: criador ? criador.nome : null, regra: regrasUsadas.versao },
    indicadores: { competencias: comps },
    divergencias: divs,
    desconto: { base, base_nota: regrasUsadas.base_desconto_mensal && regrasUsadas.base_desconto_mensal.pendente ? regrasUsadas.base_desconto_mensal.pendente : null, modo_decidido: modo, cenarios: cenarios.linhas, valoresDistintos: cenarios.valoresDistintos, adotado: adotadoDesconto, decisoesAbertas: regraPend.abertas.map((a) => a.chave), decisoes: Object.values(dec).filter((d) => d.valor).map((d) => ({ chave: d.chave, valor: d.valor, justificativa: d.justificativa })) },
    alertas: { recalculo: alertas, integridade },
    texto: Object.assign({ abertura: '', analise: '', conclusao: '' }, p.blocos.texto || {}),
    achados: pinned,
  };
}

function hashDe(conteudo) { return U.sha256(U.jsonCanonico(conteudo)); }

// Sugestão de texto com os números do conteúdo. A pessoa edita e responde por ele.
function rascunhoDeTexto(c) {
  const id = c.identificacao;
  const comps = c.indicadores.competencias;
  const fmt = (v) => (v === null || v === undefined ? 'sem valor' : String(v));
  const linhasIgq = comps.map((x) => x.competencia + ': ' + fmt(x.igq.oss) + ' pela unidade, ' + fmt(x.igq.recalculado) + ' no recálculo e ' + fmt(x.igq.adotado) + ' adotado' + (x.implantacao ? ' (mês de implantação, sem desconto)' : '')).join('; ');
  const altas = c.divergencias.filter((d) => d.gravidade === 'alta').length;
  return {
    abertura: 'Trata-se do acompanhamento do Contrato de Gestão nº ' + (id.numero_cg || '—') + ', firmado com ' + (id.oss || '—') + ' para a gestão da unidade ' + id.unidade + ', referente ao trimestre ' + id.trimestre + ' (competências ' + id.competencias.join(', ') + '). A análise usa a regra de pontuação ' + id.regra + ' e os relatórios enviados pela unidade.',
    analise: 'Pontuação do IGQ por competência – ' + linhasIgq + '. Foram registradas ' + c.divergencias.length + ' divergência(s) entre o declarado e o recalculado, sendo ' + altas + ' de gravidade alta. Os pontos adotados seguem o recálculo da CTAI, exceto onde a justificativa do ajuste está registrada na tabela de indicadores.',
    conclusao: c.desconto.adotado && c.desconto.adotado.total !== undefined ? 'Aplicando a regra de desconto decidida (' + (c.desconto.adotado.modo === 'fixo' ? '10% fixo abaixo de 90 pontos' : 'tabela de faixas do IGQ') + ') sobre a base de R$ ' + U.formatarNumero(c.desconto.base) + ' por mês, o desconto do trimestre é de ' + U.formatarMoeda(c.desconto.adotado.total) + '.' : 'O valor do desconto depende de decisões de regra ainda em aberto: ' + (c.desconto.decisoesAbertas.join(', ') || '—') + '. Os cenários estão na seção de desconto.',
  };
}

// ---------- Versões e mesa ----------
function ultimaVersao(db, parecerId) { return db.get('SELECT * FROM versoes_minuta WHERE parecer_id = ? ORDER BY numero DESC LIMIT 1', Number(parecerId)); }

function congelar(db, parecerId, usuario, dados) {
  const p = obter(db, parecerId);
  exigirCriador(p, usuario);
  const convocados = (dados.convocados || []).map(Number);
  if (!convocados.length) throw erro(400, 'Escolha ao menos um colega para conferir.');
  for (const uid of convocados) {
    const u = db.get('SELECT * FROM usuarios WHERE usuario_id = ? AND ativo = 1', uid);
    if (!u || u.perfil !== 'colega') throw erro(400, 'Só colegas conferentes (perfil colega) podem ser convocados.');
    if (u.usuario_id === p.criador_id) throw erro(400, 'Quem cria o parecer não confere a própria versão.');
  }
  const ult = ultimaVersao(db, p.parecer_id);
  if (ult && !String(dados.motivo || '').trim()) throw erro(400, 'Informe o motivo da nova versão (o que mudou).');
  const conteudo = conteudoAtual(db, p.parecer_id);
  const hash = hashDe(conteudo);
  if (ult && ult.hash === hash) throw erro(409, 'Nada mudou desde a versão ' + ult.numero + '. Não há o que congelar.');
  const numero = ult ? ult.numero + 1 : 1;
  return db.tx(() => {
    if (ult) db.run("UPDATE versoes_minuta SET status = 'substituída' WHERE versao_id = ?", ult.versao_id);
    const r = db.run('INSERT INTO versoes_minuta (parecer_id, numero, conteudo, hash, criada_por, criada_em, status, convocados, motivo) VALUES (?,?,?,?,?,?,?,?,?)',
      p.parecer_id, numero, JSON.stringify(conteudo), hash, usuario.usuario_id, agora(), 'em conferência', JSON.stringify(convocados), dados.motivo || null);
    db.run("UPDATE pareceres SET status = 'em conferência', versao_alterada = 0, atualizado_em = ? WHERE parecer_id = ?", agora(), p.parecer_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'versoes_minuta', registro: p.parecer_id + '/v' + numero, campo: 'congelamento', valor_novo: { hash, convocados }, motivo: dados.motivo || 'Primeira versão' });
    return Number(r.lastInsertRowid);
  });
}

function estadoDaVersao(db, versaoId) {
  const v = db.get('SELECT * FROM versoes_minuta WHERE versao_id = ?', Number(versaoId));
  if (!v) throw erro(404, 'Versão não encontrada.');
  const convocados = D.json(v.convocados, []);
  const nomes = Object.fromEntries(db.all('SELECT usuario_id, nome, perfil FROM usuarios').map((u) => [u.usuario_id, u]));
  const regs = db.all('SELECT * FROM conferencias WHERE versao_id = ? ORDER BY conf_id', v.versao_id);
  // Vale o último registro de cada pessoa em cada item.
  const ultimo = {};
  for (const r of regs) ultimo[r.usuario_id + '|' + r.item_id] = r;
  const itens = ITENS.map((it) => {
    const porPessoa = Object.values(ultimo).filter((r) => r.item_id === it.id).map((r) => ({ usuario_id: r.usuario_id, nome: nomes[r.usuario_id] ? nomes[r.usuario_id].nome : '?', papel: r.papel, status: r.status, comentario: r.comentario, data_hora: r.data_hora }));
    const colegasOk = convocados.filter((uid) => porPessoa.some((x) => x.usuario_id === uid && x.status === 'ok'));
    const reparo = porPessoa.some((x) => x.status === 'reparo');
    return { id: it.id, titulo: it.titulo, ajuda: it.ajuda, registros: porPessoa, colegasOk: colegasOk.length, colegasTotal: convocados.length, reparo, conferido: !reparo && colegasOk.length === convocados.length };
  });
  let status = v.status;
  if (!['autorizada', 'substituída'].includes(v.status)) {
    if (itens.some((i) => i.reparo)) status = 'com reparo';
    else if (itens.every((i) => i.conferido)) status = 'conferida';
    else status = 'em conferência';
    if (status !== v.status) db.run('UPDATE versoes_minuta SET status = ? WHERE versao_id = ?', status, v.versao_id);
  }
  return { versao: { versao_id: v.versao_id, parecer_id: v.parecer_id, numero: v.numero, hash: v.hash, criada_por: v.criada_por, criada_por_nome: nomes[v.criada_por] ? nomes[v.criada_por].nome : null, criada_em: v.criada_em, status, motivo: v.motivo, autorizada_por: v.autorizada_por, autorizada_por_nome: v.autorizada_por && nomes[v.autorizada_por] ? nomes[v.autorizada_por].nome : null, autorizada_em: v.autorizada_em, convocados: convocados.map((id) => ({ usuario_id: id, nome: nomes[id] ? nomes[id].nome : '?' })) }, itens };
}

function conferir(db, versaoId, usuario, itemId, status, comentario) {
  const v = db.get('SELECT * FROM versoes_minuta WHERE versao_id = ?', Number(versaoId));
  if (!v) throw erro(404, 'Versão não encontrada.');
  const p = obter(db, v.parecer_id);
  if (!ehMesa(usuario)) throw erro(403, 'Só colegas conferentes e a superintendente conferem a minuta.');
  if (usuario.usuario_id === v.criada_por || usuario.usuario_id === p.criador_id) throw erro(403, 'Quem criou a versão não confere o próprio trabalho.');
  if (v.status === 'substituída') throw erro(409, 'Esta versão foi substituída por outra. Confira a versão mais recente.');
  if (v.status === 'autorizada') throw erro(409, 'Esta versão já foi autorizada.');
  const convocados = D.json(v.convocados, []);
  if (usuario.perfil === 'colega' && !convocados.includes(usuario.usuario_id)) throw erro(403, 'Você não foi convocado para conferir esta versão.');
  if (!ITENS.some((i) => i.id === itemId)) throw erro(400, 'Item desconhecido.');
  if (!['ok', 'reparo'].includes(status)) throw erro(400, 'Marque "ok" ou "reparo".');
  if (status === 'reparo' && !String(comentario || '').trim()) throw erro(400, 'Explique o reparo para quem criou o parecer.');
  db.run('INSERT INTO conferencias (versao_id, usuario_id, papel, item_id, status, comentario, data_hora) VALUES (?,?,?,?,?,?,?)', v.versao_id, usuario.usuario_id, usuario.perfil, itemId, status, comentario || null, agora());
  trilha.registrar(db, { usuario: usuario.login, tabela: 'conferencias', registro: p.parecer_id + '/v' + v.numero + '/' + itemId, campo: 'conferencia', valor_novo: status, motivo: comentario });
  return estadoDaVersao(db, v.versao_id);
}

function autorizar(db, versaoId, usuario) {
  const v = db.get('SELECT * FROM versoes_minuta WHERE versao_id = ?', Number(versaoId));
  if (!v) throw erro(404, 'Versão não encontrada.');
  const p = obter(db, v.parecer_id);
  if (usuario.perfil !== 'superintendente') throw erro(403, 'Só a superintendente autoriza.');
  if (usuario.usuario_id === v.criada_por || usuario.usuario_id === p.criador_id) throw erro(403, 'Ninguém autoriza o próprio trabalho.');
  const ult = ultimaVersao(db, p.parecer_id);
  if (ult.versao_id !== v.versao_id) throw erro(409, 'Há uma versão mais nova. Autorize a mais recente.');
  const est = estadoDaVersao(db, v.versao_id);
  if (est.versao.status !== 'conferida') throw erro(409, 'A versão ainda não está conferida por todos os colegas convocados (ou tem reparo aberto).');
  const faltam = est.itens.filter((i) => !i.registros.some((r) => r.usuario_id === usuario.usuario_id && r.status === 'ok')).map((i) => i.titulo);
  if (faltam.length) throw erro(409, 'Antes de autorizar, confira você mesma estes itens: ' + faltam.join('; ') + '.');
  db.tx(() => {
    db.run("UPDATE versoes_minuta SET status = 'autorizada', autorizada_por = ?, autorizada_em = ? WHERE versao_id = ?", usuario.usuario_id, agora(), v.versao_id);
    db.run("UPDATE pareceres SET status = 'autorizado', atualizado_em = ? WHERE parecer_id = ?", agora(), p.parecer_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'versoes_minuta', registro: p.parecer_id + '/v' + v.numero, campo: 'autorizacao', valor_novo: v.hash, motivo: 'Controle interno. A assinatura é feita no SEI.' });
  });
  return estadoDaVersao(db, v.versao_id);
}

function registrarSEI(db, parecerId, usuario, numeroSei) {
  const p = obter(db, parecerId);
  if (usuario.usuario_id !== p.criador_id) throw erro(403, 'Quem anexa no SEI é quem criou o parecer.');
  const v = ultimaVersao(db, p.parecer_id);
  if (!v || v.status !== 'autorizada') throw erro(409, 'Só é possível registrar o SEI de uma versão autorizada pela superintendente.');
  const n = String(numeroSei || '').trim();
  if (n.length < 3) throw erro(400, 'Informe o número do documento no SEI.');
  db.tx(() => {
    db.run("UPDATE pareceres SET status = 'anexado ao SEI', sei_numero = ?, sei_anexado_em = ?, sei_anexado_por = ?, atualizado_em = ? WHERE parecer_id = ?", n, agora(), usuario.login, agora(), p.parecer_id);
    for (const id of p.competencias) db.run("UPDATE competencias SET status = 'parecer emitido', parecer_numero = COALESCE(?, parecer_numero) WHERE contrato_id = ? AND competencia_id = ?", p.numero_parecer, p.contrato_id, id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'sei_numero', valor_novo: n, motivo: 'Versão ' + v.numero + ' anexada no SEI fora do sistema (a assinatura é feita lá).' });
  });
}

function detalhe(db, parecerId, usuario) {
  const p = obter(db, parecerId);
  const contrato = db.get('SELECT contrato_id, unidade, oss, demo FROM contratos WHERE contrato_id = ?', p.contrato_id);
  const versoes = db.all('SELECT versao_id, numero, hash, criada_em, status, motivo FROM versoes_minuta WHERE parecer_id = ? ORDER BY numero DESC', p.parecer_id);
  const ult = versoes[0] || null;
  const estado = ult ? estadoDaVersao(db, ult.versao_id) : null;
  const atual = conteudoAtual(db, p.parecer_id);
  const alterado = ult ? hashDe(atual) !== ult.hash : true;
  const colegas = db.all("SELECT usuario_id, nome FROM usuarios WHERE perfil = 'colega' AND ativo = 1 AND usuario_id <> ?", p.criador_id);
  return { parecer: Object.assign({}, p, { demo: !!contrato.demo, unidade: contrato.unidade }), conteudoAtual: atual, alteradoDesdeCongelamento: alterado, versoes, ultima: estado, colegasDisponiveis: colegas,
    voce: { eCriador: usuario.usuario_id === p.criador_id, perfil: usuario.perfil } };
}

module.exports = { ITENS, obter, listar, criar, salvarTexto, adotar, conteudoAtual, hashDe, rascunhoDeTexto, ultimaVersao, congelar, estadoDaVersao, conferir, autorizar, registrarSEI, detalhe };
