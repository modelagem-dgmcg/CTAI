'use strict';
// Gestão CTAI: produção da equipe e painel da superintendente.
// A produção sai só do que já está registrado (trilha e tabelas do fluxo). Não há medição de digitação, tela aberta ou tempo online.
const D = require('./dominio');
const E = require('./envios');
const CART = require('./carteira');
const CL = require('./checklist');
const PZ = require('./prazos');
const R = require('../core/regras');
const achadosDb = require('./achados');
const trilha = require('./trilha');

const pad = (n) => String(n).padStart(2, '0');

// ---------- Trimestres ----------
function trimestreDe(competenciaId) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competenciaId));
  return m ? m[1] + '-T' + (Math.floor((Number(m[2]) - 1) / 3) + 1) : null;
}
function mesesDe(tri) {
  const m = /^(\d{4})-T([1-4])$/.exec(String(tri));
  if (!m) return null;
  return [0, 1, 2].map((i) => m[1] + '-' + pad((Number(m[2]) - 1) * 3 + 1 + i));
}
function anterior(tri) {
  const m = /^(\d{4})-T([1-4])$/.exec(String(tri));
  if (!m) return null;
  return Number(m[2]) === 1 ? (Number(m[1]) - 1) + '-T4' : m[1] + '-T' + (Number(m[2]) - 1);
}
function trimestreAtual() { return trimestreDe(PZ.dataLocal().slice(0, 7)); }
function limitesDoTrimestre(tri) {
  const meses = mesesDe(tri);
  if (!meses) return null;
  const [a, m] = meses[2].split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: meses[0] + '-01', ate: meses[2] + '-' + pad(ultimo) };
}
// Trimestre padrão do painel: o atual, se já tiver envios; senão o mais recente com envios; senão o mais recente com competências.
function trimestrePadrao(db) {
  const de = (sql) => [...new Set(db.all(sql).map((c) => trimestreDe(c.competencia_id)).filter(Boolean))].sort().reverse();
  const comEnvio = de('SELECT DISTINCT k.competencia_id FROM envios e JOIN competencias k ON k.cid = e.cid');
  const comDados = de('SELECT competencia_id FROM competencias');
  const atual = trimestreAtual();
  if (comEnvio.includes(atual)) return atual;
  if (comEnvio.length) return comEnvio.find((t) => t <= atual) || comEnvio[0];
  if (comDados.includes(atual) || !comDados.length) return atual;
  return comDados.find((t) => t <= atual) || comDados[0];
}
function trimestresDisponiveis(db) {
  const set = new Set(db.all('SELECT competencia_id FROM competencias').map((c) => trimestreDe(c.competencia_id)).filter(Boolean));
  set.add(trimestreAtual());
  return [...set].sort().reverse();
}

function periodo(q) {
  let de = q.de || null, ate = q.ate || null;
  if (q.trimestre) { const l = limitesDoTrimestre(q.trimestre); if (!l) return { erro: 'Trimestre inválido (use 2026-T2).' }; de = l.de; ate = l.ate; }
  for (const d of [de, ate]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { erro: 'Data inválida (use AAAA-MM-DD).' };
  return { de, ate, ini: de ? de + 'T00:00:00.000Z' : null, fim: ate ? ate + 'T23:59:59.999Z' : null };
}
// Condição SQL de período para uma coluna de data/hora ISO.
function sqlPeriodo(col, p, args) {
  let s = '';
  if (p.ini) { s += ' AND ' + col + ' >= ?'; args.push(p.ini); }
  if (p.fim) { s += ' AND ' + col + ' <= ?'; args.push(p.fim); }
  return s;
}

// ---------- Produção ----------
const horas = (ms) => Math.round((ms / 36e5) * 10) / 10;

function producao(db, filtro) {
  const p = periodo(filtro);
  if (p.erro) { const e = new Error(p.erro); e.status = 400; throw e; }
  const contrato = filtro.contrato || null;
  const quem = db.all("SELECT usuario_id, login, nome, perfil, ativo FROM usuarios WHERE perfil IN ('criador','colega','superintendente') " + (filtro.usuario_id ? 'AND usuario_id = ?' : '') + ' ORDER BY nome',
    ...(filtro.usuario_id ? [Number(filtro.usuario_id)] : []));
  const linhas = quem.map((u) => {
    // cada consulta junta o filtro de unidade quando houver
    const un = (col) => (contrato ? ' AND ' + col + ' = ?' : '');
    const comUn = (args) => (contrato ? args.concat([contrato]) : args);

    let a = [u.usuario_id]; let sql = 'SELECT COUNT(*) AS n FROM conferencias f JOIN versoes_minuta v ON v.versao_id = f.versao_id JOIN pareceres pa ON pa.parecer_id = v.parecer_id WHERE f.usuario_id = ?' + sqlPeriodo('f.data_hora', p, a) + un('pa.contrato_id');
    const itens = db.get(sql, ...comUn(a)).n;

    a = [u.login]; sql = "SELECT COUNT(*) AS n FROM trilha_auditoria t JOIN divergencias d ON d.divergencia_id = CAST(t.registro AS INTEGER) JOIN competencias k ON k.cid = d.cid WHERE t.tabela = 'divergencias' AND t.campo = 'status' AND t.valor_novo <> 'aberta' AND t.usuario = ?" + sqlPeriodo('t.data_hora', p, a) + un('k.contrato_id');
    const divergencias = db.get(sql, ...comUn(a)).n;

    const evAchado = (campo, extra) => {
      const args = [u.login];
      const s = "SELECT COUNT(*) AS n FROM trilha_auditoria t JOIN achados x ON x.achado_id = CAST(t.registro AS INTEGER) LEFT JOIN competencias k ON k.cid = x.cid WHERE t.tabela = 'achados' AND t.campo = ? AND t.usuario = ?" + extra + sqlPeriodo('t.data_hora', p, args) + un('k.contrato_id');
      return db.get(s, ...comUn([campo].concat(args))).n;
    };
    const encaminhados = evAchado('encaminhado', '');
    const descartados = evAchado('status', " AND t.valor_novo = 'descartado'");
    const fixados = evAchado('status', " AND t.valor_novo = 'fixado'");

    a = [u.login]; sql = "SELECT COUNT(*) AS n FROM achados x LEFT JOIN competencias k ON k.cid = x.cid WHERE x.encaminhado_por = ? AND x.respondido_em IS NOT NULL" + sqlPeriodo('x.respondido_em', p, a) + un('k.contrato_id');
    const respondidos = db.get(sql, ...comUn(a)).n;

    a = [u.usuario_id]; sql = 'SELECT COUNT(*) AS n FROM pareceres pa WHERE pa.criador_id = ?' + sqlPeriodo('pa.criado_em', p, a) + un('pa.contrato_id');
    const minutasCriadas = db.get(sql, ...comUn(a)).n;
    a = [u.usuario_id]; sql = 'SELECT COUNT(*) AS n FROM versoes_minuta v JOIN pareceres pa ON pa.parecer_id = v.parecer_id WHERE v.criada_por = ?' + sqlPeriodo('v.criada_em', p, a) + un('pa.contrato_id');
    const minutasCongeladas = db.get(sql, ...comUn(a)).n;

    // Tempo médio: do recebimento (primeiro envio recebido das competências do parecer) até a autorização da versão (conferência concluída).
    a = [u.usuario_id]; sql = "SELECT pa.parecer_id, pa.competencias, v.autorizada_em FROM pareceres pa JOIN versoes_minuta v ON v.parecer_id = pa.parecer_id AND v.status = 'autorizada' WHERE pa.criador_id = ? AND v.autorizada_em IS NOT NULL" + sqlPeriodo('v.autorizada_em', p, a) + un('pa.contrato_id');
    const tempos = [];
    for (const x of db.all(sql, ...comUn(a))) {
      const comps = D.json(x.competencias, []);
      if (!comps.length) continue;
      const ph = comps.map(() => '?').join(',');
      const rec = db.get('SELECT MIN(e.recebido_em) AS t FROM envios e JOIN competencias k ON k.cid = e.cid JOIN pareceres pa ON pa.contrato_id = k.contrato_id WHERE pa.parecer_id = ? AND k.competencia_id IN (' + ph + ') AND e.recebido_em IS NOT NULL', x.parecer_id, ...comps).t;
      if (rec) { const ms = Date.parse(x.autorizada_em) - Date.parse(rec); if (ms >= 0) tempos.push(ms); }
    }
    const tempoMedio = tempos.length ? { horas: horas(tempos.reduce((s, v) => s + v, 0) / tempos.length), dias: Math.round((tempos.reduce((s, v) => s + v, 0) / tempos.length / 864e5) * 10) / 10, amostra: tempos.length } : null;

    // Carga atual (foto de hoje, não depende do período): só o que está aberto nas unidades da carteira dela/dele e nas minutas dele(a).
    const carteira = CART.doUsuario(db, u.usuario_id);
    const ph = carteira.map(() => '?').join(',');
    const cargaUn = carteira.length ? {
      divergencias: db.get("SELECT COUNT(*) AS n FROM divergencias d JOIN competencias k ON k.cid = d.cid WHERE d.status = 'aberta' AND k.contrato_id IN (" + ph + ')', ...carteira).n,
      achados: db.get("SELECT COUNT(*) AS n FROM achados x JOIN competencias k ON k.cid = x.cid WHERE x.status IN ('novo','encaminhado','respondido') AND k.contrato_id IN (" + ph + ')', ...carteira).n,
    } : { divergencias: 0, achados: 0 };
    const minutasAbertas = db.get("SELECT COUNT(*) AS n FROM pareceres WHERE criador_id = ? AND status <> 'autorizado'", u.usuario_id).n;
    const conferenciasPendentes = db.all("SELECT versao_id, convocados FROM versoes_minuta WHERE status = 'em conferência'").filter((v) => D.json(v.convocados, []).map(Number).includes(u.usuario_id)).length;
    const acoes = db.get('SELECT COUNT(*) AS n FROM trilha_auditoria t WHERE t.usuario = ?' + sqlPeriodo('t.data_hora', p, (a = [u.login])), ...a).n;

    return {
      usuario_id: u.usuario_id, login: u.login, nome: u.nome, perfil: u.perfil, ativo: !!u.ativo,
      itens_conferidos: itens, divergencias_tratadas: divergencias,
      achados: { encaminhados, respondidos, descartados, fixados },
      minutas: { criadas: minutasCriadas, congeladas: minutasCongeladas },
      tempo_medio: tempoMedio,
      caixa: require('./caixa').tempos(db, u.usuario_id, p.ini, p.fim, contrato),
      carga: { unidades: carteira.length, divergencias_abertas: cargaUn.divergencias, achados_abertos: cargaUn.achados, minutas_abertas: minutasAbertas, conferencias_pendentes: conferenciasPendentes },
      acoes_registradas: acoes,
    };
  });
  const soma = (f) => linhas.reduce((s, l) => s + f(l), 0);
  return {
    periodo: { de: p.de, ate: p.ate, trimestre: filtro.trimestre || null }, contrato, funcionarios: linhas,
    totais: { itens_conferidos: soma((l) => l.itens_conferidos), divergencias_tratadas: soma((l) => l.divergencias_tratadas), achados_encaminhados: soma((l) => l.achados.encaminhados), achados_respondidos: soma((l) => l.achados.respondidos),
      minutas_criadas: soma((l) => l.minutas.criadas), minutas_congeladas: soma((l) => l.minutas.congeladas) },
    nota: 'Produção calculada só a partir de ações já registradas (conferências, divergências, achados, minutas). Não há monitoramento de digitação, tela aberta ou tempo online.',
  };
}

// ---------- Painel da superintendente ----------
function igqDaCompetencia(db, comp) {
  try {
    const rec = E.recalcularCompetencia(db, comp.cid);
    if (!rec) return null;
    const { regras } = D.regrasDoContrato(db, comp.contrato_id, comp.regra_id);
    const igq = rec.igqRecalculado;
    const pct = R.percentualPago(regras, igq);
    return { igq, soma_maxima: regras.soma_maxima, pct_pago: pct };
  } catch (_) { return null; }
}

// Unidade sem nenhum gestor ativo (cadastrada, mas ainda ninguém da unidade pode entrar no Portal da Unidade).
function semGestor(db, contratoId) {
  return !db.get("SELECT 1 FROM usuarios WHERE perfil = 'gestor_unidade' AND ativo = 1 AND contrato_id = ?", contratoId);
}
function listaSemGestor(db) {
  return db.all('SELECT contrato_id, unidade, tipo, municipio, demo FROM contratos ORDER BY demo, unidade').filter((c) => semGestor(db, c.contrato_id)).map((c) => Object.assign(c, { demo: !!c.demo }));
}

function faseDa(db, contratoId, tri, comps) {
  const par = db.get('SELECT * FROM pareceres WHERE contrato_id = ? AND trimestre = ?', contratoId, tri);
  const ver = par ? db.get('SELECT numero, status FROM versoes_minuta WHERE parecer_id = ? ORDER BY numero DESC LIMIT 1', par.parecer_id) : null;
  const temEnvio = comps.some((c) => c.envio.versao);
  const divAb = comps.reduce((s, c) => s + c.divergencias_abertas, 0);
  let fase;
  if (par && par.sei_numero) fase = 'Anexado no SEI';
  else if (par && par.status === 'autorizado') fase = 'Autorizado (aguarda o SEI)';
  else if (ver) fase = 'Mesa de conferência';
  else if (par) fase = 'Minuta em elaboração';
  else if (divAb > 0) fase = 'Tratando divergências';
  else if (temEnvio) fase = 'Recebido, em conferência';
  else fase = 'Aguardando envio da unidade';
  return { fase, parecer: par ? { parecer_id: par.parecer_id, status: par.status, congelado: !!ver, versao: ver ? ver.numero : null, versao_status: ver ? ver.status : null, sei_numero: par.sei_numero || null } : null };
}

const PIOR = { 'vencido': 4, 'entregue com atraso': 3, 'a vencer': 2, 'no prazo': 1, 'entregue no prazo': 0 };

function dadosDoTrimestre(db, contratoId, tri, hoje) {
  const meses = mesesDe(tri);
  const comps = db.all('SELECT * FROM competencias WHERE contrato_id = ? AND competencia_id IN (' + meses.map(() => '?').join(',') + ') ORDER BY competencia_id', contratoId, ...meses).map((k) => {
    const comp = D.competenciaPorCid(db, k.cid);
    const pz = PZ.daCompetencia(db, comp, hoje);
    const env = D.ultimoEnvio(db, k.cid);
    const cl = CL.listar(db, k.cid);
    const abertas = db.get("SELECT COUNT(*) AS n FROM divergencias WHERE cid = ? AND status = 'aberta'", k.cid).n;
    let estado = 'pendente';
    if (env && env.recebido_em) estado = (cl.resumo.pendente > 0 || cl.resumo.incompleto > 0) ? 'incompleto' : 'recebido';
    else if (env) estado = 'pendente';
    return {
      cid: k.cid, competencia_id: k.competencia_id, mes_implantacao: !!k.mes_implantacao,
      envio: { estado, versao: env ? env.versao : null, recebido_em: env ? env.recebido_em : null },
      checklist: cl.iniciado ? cl.resumo : null,
      prazos: pz ? { sei: { prazo: pz.sei.prazo, entregue_em: pz.sei.entregue_em, situacao: pz.sei.situacao, dias: pz.sei.dias }, simas: { prazo: pz.simas.prazo, entregue_em: pz.simas.entregue_em, situacao: pz.simas.situacao, dias: pz.simas.dias } } : null,
      divergencias_abertas: abertas, igq: env ? igqDaCompetencia(db, comp) : null,
    };
  });
  const comIgq = comps.filter((c) => c.igq);
  const igq = comIgq.length ? {
    medio: Math.round((comIgq.reduce((s, c) => s + c.igq.igq, 0) / comIgq.length) * 10) / 10,
    pct_pago_medio: Math.round((comIgq.reduce((s, c) => s + c.igq.pct_pago, 0) / comIgq.length) * 10) / 10,
    soma_maxima: comIgq[0].igq.soma_maxima, meses: comIgq.length,
  } : null;
  return { comps, igq };
}

function painel(db, filtro) {
  const hoje = PZ.dataLocal();
  const tri = filtro.trimestre || trimestrePadrao(db);
  if (!mesesDe(tri)) { const e = new Error('Trimestre inválido (use 2026-T2).'); e.status = 400; throw e; }
  const triAnt = anterior(tri);
  let contratos = db.all('SELECT contrato_id, unidade, oss, demo, tipo, municipio FROM contratos ORDER BY demo, unidade');
  if (filtro.contrato) contratos = contratos.filter((c) => c.contrato_id === filtro.contrato);
  if (filtro.usuario_id) { const meus = new Set(CART.doUsuario(db, Number(filtro.usuario_id))); contratos = contratos.filter((c) => meus.has(c.contrato_id)); }

  const unidades = contratos.map((c) => {
    const atual = dadosDoTrimestre(db, c.contrato_id, tri, hoje);
    const ant = dadosDoTrimestre(db, c.contrato_id, triAnt, hoje);
    const cidsTri = atual.comps.map((k) => k.cid);
    const ach = cidsTri.length ? db.all("SELECT x.* FROM achados x WHERE x.cid IN (" + cidsTri.map(() => '?').join(',') + ") AND x.status IN ('novo','encaminhado','respondido')", ...cidsTri) : [];
    const abertos = ach.length, vencidos = ach.filter((a) => a.status === 'encaminhado' && a.prazo && a.prazo < hoje).length;
    const f = faseDa(db, c.contrato_id, tri, atual.comps);
    let pior = null;
    for (const k of atual.comps) if (k.prazos) for (const canal of ['sei', 'simas']) {
      const s = k.prazos[canal].situacao;
      if (!pior || PIOR[s] > PIOR[pior.situacao]) pior = { canal: canal === 'sei' ? 'SEI' : 'SIMAS', situacao: s, competencia: k.competencia_id };
    }
    const delta = atual.igq && ant.igq ? Math.round((atual.igq.medio - ant.igq.medio) * 10) / 10 : null;
    return {
      contrato_id: c.contrato_id, unidade: c.unidade, oss: c.oss, demo: !!c.demo,
      responsaveis: CART.responsaveis(db, c.contrato_id), sem_carteira: CART.responsaveis(db, c.contrato_id).length === 0,
      tipo: c.tipo || null, municipio: c.municipio || null, sem_gestor: semGestor(db, c.contrato_id),
      competencias: atual.comps, fase: (semGestor(db, c.contrato_id) && f.fase === 'Aguardando envio da unidade') ? 'Aguardando gestor' : f.fase, parecer: f.parecer, pior_prazo: pior,
      achados: { abertos, vencidos }, igq: atual.igq, igq_anterior: ant.igq, igq_delta: delta,
    };
  });

  // Cartões
  const todasComps = unidades.flatMap((u) => u.competencias.map((k) => Object.assign({ contrato_id: u.contrato_id }, k)));
  const conta = (fn) => todasComps.filter(fn).length;
  const prazoCount = { no_prazo: 0, a_vencer: 0, vencido: 0, atraso: 0 };
  for (const k of todasComps) if (k.prazos) for (const canal of ['sei', 'simas']) {
    const s = k.prazos[canal].situacao;
    if (s === 'vencido') prazoCount.vencido++; else if (s === 'a vencer') prazoCount.a_vencer++; else if (s === 'entregue com atraso') prazoCount.atraso++; else prazoCount.no_prazo++;
  }
  const pareceres = unidades.map((u) => u.parecer).filter(Boolean);
  const cartoes = {
    unidades: unidades.length, competencias: todasComps.length,
    recebidos: conta((k) => k.envio.estado === 'recebido'), incompletos: conta((k) => k.envio.estado === 'incompleto'), pendentes: conta((k) => k.envio.estado === 'pendente'),
    prazos: prazoCount,
    achados_abertos: unidades.reduce((s, u) => s + u.achados.abertos, 0), achados_vencidos: unidades.reduce((s, u) => s + u.achados.vencidos, 0),
    pareceres_rascunho: pareceres.filter((p) => !p.congelado).length, pareceres_congelados: pareceres.filter((p) => p.congelado).length,
    sem_carteira: unidades.filter((u) => u.sem_carteira).length,
    sem_gestor: unidades.filter((u) => u.sem_gestor).length,
  };

  // Divergências recorrentes por indicador (no trimestre filtrado)
  const cids = todasComps.map((k) => k.cid);
  let recorrentes = [];
  if (cids.length) {
    const nomes = {};
    try { const { regras } = D.regrasDoContrato(db, contratos[0] ? contratos[0].contrato_id : 'UPA-OLINDA'); for (const i of regras.indicadores) nomes[i.id] = i.nome; } catch (_) { /* sem nomes */ }
    recorrentes = db.all('SELECT d.indicador_id, COUNT(*) AS divergencias, COUNT(DISTINCT d.cid) AS competencias, COUNT(DISTINCT k.contrato_id) AS unidades, SUM(CASE WHEN d.status = ' + "'aberta'" + ' THEN 1 ELSE 0 END) AS abertas FROM divergencias d JOIN competencias k ON k.cid = d.cid WHERE d.cid IN (' + cids.map(() => '?').join(',') + ') AND d.indicador_id IS NOT NULL GROUP BY d.indicador_id ORDER BY competencias DESC, divergencias DESC', ...cids)
      .map((r) => Object.assign(r, { nome: nomes[r.indicador_id] || null, recorrente: r.competencias >= 2 })).slice(0, 12);
  }

  // Alertas
  const alertas = [];
  for (const u of unidades) {
    if (u.sem_carteira) alertas.push({ nivel: 'atencao', tipo: 'sem carteira', unidade: u.unidade, texto: 'Sem funcionário responsável. Distribua em Gestão CTAI > Carteira.' });
    if (u.sem_gestor) alertas.push({ nivel: 'atencao', tipo: 'sem gestor', unidade: u.unidade, texto: 'Aguardando gestor: ninguém da unidade foi cadastrado para usar o Portal da Unidade. Cadastre em Gestão CTAI > Usuários.' });
    for (const k of u.competencias) if (k.prazos) for (const canal of ['sei', 'simas']) {
      const s = k.prazos[canal];
      if (s.situacao === 'vencido') alertas.push({ nivel: 'alta', tipo: 'prazo vencido', unidade: u.unidade, texto: (canal === 'sei' ? 'SEI' : 'SIMAS') + ' da competência ' + k.competencia_id + ' venceu há ' + s.dias + ' dia(s).' });
      else if (s.situacao === 'a vencer') alertas.push({ nivel: 'atencao', tipo: 'prazo a vencer', unidade: u.unidade, texto: (canal === 'sei' ? 'SEI' : 'SIMAS') + ' da competência ' + k.competencia_id + ' vence em ' + s.dias + ' dia(s).' });
      else if (s.situacao === 'entregue com atraso') alertas.push({ nivel: 'info', tipo: 'entrega com atraso', unidade: u.unidade, texto: (canal === 'sei' ? 'SEI' : 'SIMAS') + ' de ' + k.competencia_id + ' entregue com ' + s.dias + ' dia(s) de atraso.' });
    }
    for (const k of u.competencias) if (k.envio.estado === 'incompleto') alertas.push({ nivel: 'atencao', tipo: 'envio incompleto', unidade: u.unidade, texto: 'Envio de ' + k.competencia_id + ' com itens pendentes ou incompletos no checklist.' });
    if (u.achados.vencidos) alertas.push({ nivel: 'alta', tipo: 'achado vencido', unidade: u.unidade, texto: u.achados.vencidos + ' achado(s) encaminhado(s) sem resposta no prazo.' });
    if (u.igq_delta !== null && u.igq_delta <= -5) alertas.push({ nivel: 'alta', tipo: 'queda do IGQ', unidade: u.unidade, texto: 'IGQ médio caiu ' + Math.abs(u.igq_delta) + ' ponto(s) em relação a ' + triAnt + '.' });
  }
  const v = trilha.verificar(db);
  if (!v.ok) alertas.unshift({ nivel: 'alta', tipo: 'trilha', unidade: '—', texto: 'A verificação da trilha encontrou ' + v.falhas.length + ' problema(s).' });
  const peso = { alta: 0, atencao: 1, info: 2 };
  alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel]);

  return {
    gerado_em: new Date().toISOString(), hoje, trimestre: tri, trimestre_anterior: triAnt, trimestres: trimestresDisponiveis(db),
    filtros: { contrato: filtro.contrato || null, usuario_id: filtro.usuario_id ? Number(filtro.usuario_id) : null },
    cartoes, unidades, recorrentes, alertas, trilha: { ok: v.ok, eventos: v.total },
    sem_carteira: CART.semCarteira(db), sem_gestor: listaSemGestor(db),
  };
}

module.exports = { semGestor, trimestrePadrao, trimestreDe, mesesDe, anterior, trimestreAtual, trimestresDisponiveis, periodo, producao, painel };
