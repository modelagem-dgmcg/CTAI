'use strict';
// Recálculo INDEPENDENTE dos indicadores, a partir das linhas brutas.
// Este módulo não importa nada do lado da unidade (portal, PDF, fichas). Quem lança não confere o próprio trabalho.
// Entrada: regras, competência, linhas por fonte (colunas genéricas), valores declarados pela unidade.
// Saída: valores e pontos recalculados, alertas e divergências (declarado × recalculado).
const R = require('./regras');
const U = require('./util');

const GRAV = { alta: 'alta', media: 'média', baixa: 'baixa' };

function tempos(linhas) {
  const xs = [];
  let invalidas = 0;
  for (const l of linhas) {
    let m = l.minutos;
    if (m === null || m === undefined || Number.isNaN(Number(m))) m = U.minutosEntre(l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim);
    if (m === null || m === undefined || m < 0) { invalidas++; continue; }
    xs.push(Number(m));
  }
  return { xs, invalidas };
}

function resumoTempos(xs) {
  return {
    n: xs.length,
    media: U.arred(U.media(xs), 2),
    mediana: U.arred(U.mediana(xs), 2),
    maximo: U.arred(U.maximo(xs), 2),
    minimo: U.arred(U.minimo(xs), 2),
  };
}

function pctAcima(xs, limite) {
  if (!xs.length) return { n: 0, pct: null };
  const n = xs.filter((x) => x > limite).length;
  return { n, pct: U.arred((n / xs.length) * 100, 1) };
}

// Média a menos de 5% de algum limite de faixa.
function pertoDoLimite(ind, valor) {
  if (valor === null || valor === undefined) return null;
  const limites = (ind.faixas || []).map((f) => f.ate !== undefined ? f.ate : f.de).filter((x) => typeof x === 'number');
  for (const lim of limites) {
    if (lim > 0 && Math.abs(valor - lim) / lim <= 0.05) return lim;
  }
  return null;
}

function pegar(decl, id) {
  const v = decl[id];
  return v === undefined || v === '' ? null : v;
}

function divergencia(indId, tema, declarado, recalculado, grav, obs, extra) {
  const dif = (typeof declarado === 'number' && typeof recalculado === 'number') ? U.arred(recalculado - declarado, 2) : null;
  return Object.assign({ indicador_id: indId, tema, declarado, recalculado, diferenca: dif, gravidade: grav, status: 'aberta', observacao: obs || '' }, extra || {});
}

function grauPorDiferenca(declarado, recalculado, pontosDif) {
  if (pontosDif) return 'alta';
  if (typeof declarado !== 'number' || typeof recalculado !== 'number') return null;
  const base = Math.max(Math.abs(declarado), 1e-9);
  const rel = Math.abs(recalculado - declarado) / base;
  if (rel > 0.10) return 'média';
  if (rel > 0.005) return 'baixa';
  return null;
}

function recalcular(entrada) {
  const regras = entrada.regras;
  const comp = entrada.competencia || {};
  const linhas = entrada.linhas || {};
  const decl = entrada.declarados || {};
  const aval = entrada.avaliacoes || {};
  const op = entrada.opcoes || {};
  const opcoesPontos = { vermelho: op.vermelho || 'faixa', iamMeta: op.iamMeta || null };
  const porId = Object.fromEntries(regras.indicadores.map((i) => [i.id, i]));
  const ind = {};
  const alertasGerais = [];
  const divergencias = [];
  const cruzamentos = [];

  const L = (fonte) => linhas[fonte] || [];
  const temLinhas = (fonte) => L(fonte).length > 0;

  function registrar(id, r) {
    const def = porId[id];
    r.id = id; r.nome = def.nome; r.max = def.max; r.unidade = def.unidade || null;
    r.alertas = r.alertas || [];
    const pontos = r.pontos === undefined ? R.pontosIndicador(def, r.valor, opcoesPontos) : r.pontos;
    r.pontos = pontos;
    // Declarado
    const dv = r.valorDeclarado;
    r.pontosDeclarados = (dv === null || dv === undefined) ? null : R.pontosIndicador(def, dv, opcoesPontos);
    ind[id] = r;
    if (r.valorDeclarado !== null && r.valorDeclarado !== undefined && r.valor !== null && r.valor !== undefined) {
      const pdif = r.pontosDeclarados !== pontos;
      let grav = null;
      if (typeof r.valor === 'number' && typeof r.valorDeclarado === 'number') grav = grauPorDiferenca(r.valorDeclarado, r.valor, pdif);
      else if (r.valor !== r.valorDeclarado) grav = pdif ? 'alta' : 'média';
      else if (pdif) grav = 'alta';
      if (grav) {
        divergencias.push(divergencia(id, def.nome, r.valorDeclarado, r.valor, grav,
          pdif ? 'Os pontos mudam de ' + r.pontosDeclarados + ' para ' + pontos + '. Fonte: ' + r.fonteCalculo + '.' : 'O valor muda, mas a faixa de pontos é a mesma. Fonte: ' + r.fonteCalculo + '.',
          { pontos_declarados: r.pontosDeclarados, pontos_recalculados: pontos }));
      }
    }
  }

  // ---------- Indicadores de tempo a partir das linhas ----------
  const verdeGrupo = (l) => l.categoria === 'verde' || (op.verdeInclui && l.categoria === 'fast-track');
  const corLinhas = {
    verde: L('classificacao').filter(verdeGrupo),
    amarelo: L('classificacao').filter((l) => l.categoria === 'amarelo'),
    vermelho: L('classificacao').filter((l) => l.categoria === 'vermelho'),
  };
  const bidCor = { verde: pegar(decl, 'bid_verdes'), amarelo: pegar(decl, 'bid_amarelos'), vermelho: pegar(decl, 'bid_vermelhos') };

  function indicadorTempo(id, linhasDoIndicador, campo, extra) {
    const def = porId[id];
    const declarado = U.numero(pegar(decl, campo));
    const { xs, invalidas } = tempos(linhasDoIndicador);
    const r = { fonteCalculo: 'linhas', valorDeclarado: declarado, alertas: [] };
    if (xs.length) {
      Object.assign(r, resumoTempos(xs));
      r.valor = r.media;
      r.base = 'linhas';
      if (extra && extra.limiteAcima) r.acimaDaMeta = pctAcima(xs, extra.limiteAcima);
      if (xs.length < 10) r.alertas.push({ codigo: 'AMOSTRA_PEQUENA', gravidade: 'média', mensagem: 'Só ' + xs.length + ' caso(s) com horário. Com menos de 10 casos a média não é confiável.' });
      const lim = pertoDoLimite(def, r.valor);
      if (lim !== null) r.alertas.push({ codigo: 'PERTO_DO_LIMITE', gravidade: 'média', mensagem: 'A média (' + U.formatarNumero(r.valor) + ') está a menos de 5% do limite de ' + lim + '. Confira mediana e extremos.' });
      if (invalidas) r.alertas.push({ codigo: 'LINHAS_INVALIDAS', gravidade: 'baixa', mensagem: invalidas + ' linha(s) sem tempo válido foram deixadas de fora.' });
    } else {
      r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado (sem linhas)';
      r.n = 0;
      r.alertas.push({ codigo: 'SEM_LINHAS', gravidade: 'média', mensagem: 'Sem linhas brutas: o valor declarado não pôde ser recalculado.' });
    }
    return r;
  }

  // 2.1 a 2.3
  for (const [id, cor, campo] of [['2.1', 'verde', 'i2_1_valor'], ['2.2', 'amarelo', 'i2_2_valor'], ['2.3', 'vermelho', 'i2_3_valor']]) {
    const r = indicadorTempo(id, corLinhas[cor], campo);
    // cobertura: casos com horário ÷ casos do BID
    const bid = U.numero(bidCor[cor]);
    if (bid && bid > 0 && r.n !== undefined) {
      r.cobertura = U.arred((r.n / bid) * 100, 1);
      r.casosBID = bid;
      if (r.cobertura < 90) r.alertas.push({ codigo: 'COBERTURA_BAIXA', gravidade: 'alta', mensagem: 'Cobertura de ' + U.formatarNumero(r.cobertura, 1) + '%: ' + r.n + ' casos com horário contra ' + bid + ' no BID. Abaixo de 90%.' });
    }
    registrar(id, r);
  }

  // 2.4 retorno em 24h
  {
    const declarado = U.numero(pegar(decl, 'i2_4_valor'));
    const r = { fonteCalculo: 'linhas', valorDeclarado: declarado, alertas: [] };
    const ls = L('retorno');
    if (ls.length) {
      const ret = ls.filter((l) => l.categoria === 'sim').length;
      r.n = ls.length; r.retornos = ret; r.valor = U.arred((ret / ls.length) * 100, 2); r.base = 'linhas';
      const lim = pertoDoLimite(porId['2.4'], r.valor);
      if (lim !== null) r.alertas.push({ codigo: 'PERTO_DO_LIMITE', gravidade: 'média', mensagem: 'A taxa (' + U.formatarNumero(r.valor) + '%) está a menos de 5% do limite de ' + lim + '%.' });
    } else {
      r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado (sem linhas)'; r.n = 0;
      r.alertas.push({ codigo: 'SEM_LINHAS', gravidade: 'média', mensagem: 'Sem linhas brutas: o valor declarado não pôde ser recalculado.' });
    }
    registrar('2.4', r);
  }

  // 2.5 PNSP
  {
    const decB = U.simNao(pegar(decl, 'i2_5_valor'));
    const abrangidos = U.numero(pegar(decl, 'pnsp_protocolos_abrangidos'));
    const r = { fonteCalculo: 'declaração e evidência', valorDeclarado: decB === null ? null : decB, alertas: [], base: 'declarado' };
    let atende = decB;
    if (decB === true && abrangidos !== null && abrangidos < 6) {
      atende = false;
      r.alertas.push({ codigo: 'PROTOCOLOS_INCOMPLETOS', gravidade: 'alta', mensagem: 'O relatório cobre ' + abrangidos + ' dos 6 protocolos básicos; o indicador exige comprovação dos protocolos básicos.' });
    }
    r.valor = atende;
    r.alertas.push({ codigo: 'DEPENDE_DE_EVIDENCIA', gravidade: 'baixa', mensagem: 'Ata de reunião não substitui o relatório comprobatório. Confira a evidência na mesa.' });
    registrar('2.5', r);
  }

  // 2.6 a 2.9 protocolos clínicos
  {
    const r6 = indicadorTempo('2.6', L('dor_toracica'), 'i2_6_valor', { limiteAcima: 10 });
    registrar('2.6', r6);
    const r7 = indicadorTempo('2.7', L('iamcsst'), 'i2_7_valor');
    const casosDecl = U.numero(pegar(decl, 'iam_casos'));
    if (r7.n && casosDecl !== null && casosDecl !== r7.n) r7.alertas.push({ codigo: 'CASOS_DIVERGENTES', gravidade: 'média', mensagem: 'A ficha diz ' + casosDecl + ' caso(s); as linhas têm ' + r7.n + '.' });
    if (r7.n) {
      const ok30 = R.pontosIndicador(porId['2.7'], r7.valor, { iamMeta: 30 });
      const ok120 = R.pontosIndicador(porId['2.7'], r7.valor, { iamMeta: 120 });
      r7.cenarioMeta = { 'até 30 min': ok30, 'menos de 120 min': ok120 };
      if (ok30 !== ok120) r7.alertas.push({ codigo: 'META_PENDENTE', gravidade: 'alta', mensagem: 'A meta do porta-saída é ≤ 30 min ou < 120 min? Com 30 min vale ' + ok30 + ' ponto(s); com 120 min vale ' + ok120 + '. Regra pendente de confirmação.' });
    }
    registrar('2.7', r7);
    registrar('2.8', indicadorTempo('2.8', L('ave'), 'i2_8_valor', { limiteAcima: 10 }));
    registrar('2.9', indicadorTempo('2.9', L('sepse'), 'i2_9_valor', { limiteAcima: 60 }));
  }

  // 2.10 óbitos
  {
    const declarado = U.numero(pegar(decl, 'i2_10_valor'));
    const r = { fonteCalculo: 'linhas', valorDeclarado: declarado, alertas: [] };
    const ls = L('obitos');
    if (ls.length) {
      let semHora = 0;
      const elegiveis = ls.filter((l) => {
        if (!l.hora_inicio || !l.hora_fim) semHora++;
        const m = U.minutosEntre(l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim);
        return m !== null && m / 60 >= 24;
      });
      const rev = elegiveis.filter((l) => l.categoria === 'sim').length;
      r.n = ls.length; r.elegiveis24h = elegiveis.length; r.revisados = rev; r.base = 'linhas';
      r.valor = elegiveis.length ? U.arred((rev / elegiveis.length) * 100, 1) : null;
      if (!elegiveis.length) r.alertas.push({ codigo: 'SEM_OBITOS_24H', gravidade: 'média', mensagem: 'Nenhum óbito com 24 h ou mais identificado nas linhas. Confira como o BID define óbito e se há data de admissão.' });
      if (semHora) r.alertas.push({ codigo: 'HORAS_AUSENTES', gravidade: 'baixa', mensagem: semHora + ' óbito(s) sem hora: o cálculo de 24 h usou 00:00.' });
      const bid = U.numero(pegar(decl, 'bid_obitos'));
      if (bid !== null && bid !== ls.length) {
        cruzamentos.push({ tema: 'Óbitos: BID × linhas', valores: { BID: bid, 'lista de óbitos': ls.length } });
        divergencias.push(divergencia('2.10', 'Óbitos: BID × lista de óbitos', bid, ls.length, Math.abs(bid - ls.length) / Math.max(bid, 1) > 0.2 ? 'alta' : 'média', 'O BID e a lista de óbitos têm números diferentes. Defina o que o BID chama de óbito.'));
      }
    } else {
      const eleg = U.numero(pegar(decl, 'obitos_24h')), rev = U.numero(pegar(decl, 'obitos_24h_revisados'));
      if (eleg !== null && rev !== null && eleg > 0) { r.valor = U.arred((rev / eleg) * 100, 1); r.base = 'apoio'; r.fonteCalculo = 'contagens da ficha (sem lista de óbitos)'; } else { r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado (sem lista)'; }
      r.n = 0;
      r.alertas.push({ codigo: 'SEM_LINHAS', gravidade: 'média', mensagem: 'Sem lista de óbitos: não foi possível identificar os de 24 h ou mais.' });
    }
    registrar('2.10', r);
  }

  // 2.11 satisfação
  {
    const resp = U.numero(pegar(decl, 'satisfacao_respondentes')), sat = U.numero(pegar(decl, 'satisfacao_satisfeitos')), den = U.numero(pegar(decl, 'satisfacao_denominador'));
    const declarado = U.numero(pegar(decl, 'i2_11_valor'));
    const r = { fonteCalculo: 'contagens da ficha', valorDeclarado: declarado, alertas: [], base: 'apoio' };
    if (resp && sat !== null) {
      r.valor = U.arred((sat / resp) * 100, 2); r.respondentes = resp; r.satisfeitos = sat;
      if (den) {
        r.cobertura = U.arred((resp / den) * 100, 2); r.denominador = den;
        if (r.cobertura < 10) { r.pontos = 0; r.alertas.push({ codigo: 'COBERTURA_BAIXA', gravidade: 'alta', mensagem: 'Cobertura da pesquisa de ' + U.formatarNumero(r.cobertura) + '% dos atendimentos; o mínimo é 10%. O indicador não pontua.' }); }
      } else r.alertas.push({ codigo: 'SEM_DENOMINADOR', gravidade: 'média', mensagem: 'Sem o total de atendimentos, a cobertura mínima de 10% não pôde ser conferida.' });
      if (resp >= 50 && resp % 5 === 0 && sat % 5 === 0) r.alertas.push({ codigo: 'NUMEROS_REDONDOS', gravidade: 'baixa', mensagem: 'Respondentes e satisfeitos são múltiplos de 5. Peça os questionários ou a planilha por respondente.' });
    } else { r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado'; r.alertas.push({ codigo: 'SEM_DADOS', gravidade: 'média', mensagem: 'Sem contagens de respondentes e satisfeitos.' }); }
    registrar('2.11', r);
  }

  // 2.12 queixas
  {
    const declarado = U.numero(pegar(decl, 'i2_12_valor'));
    const r = { fonteCalculo: 'linhas', valorDeclarado: declarado, alertas: [] };
    const ls = L('queixas');
    const prazo = op.prazoQueixaDiasUteis || regras.queixas_prazo_dias_uteis || 10;
    if (ls.length) {
      const [ano, mes] = String(comp.competencia_id || comp.competencia || '').split('-').map(Number);
      const doMes = [], fora = [];
      for (const l of ls) {
        const [a, m] = String(l.data_inicio || '').split('-').map(Number);
        if (ano && (a !== ano || m !== mes)) fora.push(l); else doMes.push(l);
      }
      if (fora.length) r.alertas.push({ codigo: 'QUEIXA_FORA_DO_MES', gravidade: 'média', mensagem: fora.length + ' queixa(s) recebida(s) fora do mês (' + fora.map((l) => l.protocolo).join(', ') + '). Foram deixadas de fora desta competência.' });
      const ident = doMes.filter((l) => l.categoria === 'sim');
      const avalQ = aval.queixas || {};
      let estimadas = 0;
      const detalhe = ident.map((l) => {
        const du = U.diasUteisEntre(l.data_inicio, l.data_fim);
        const noPrazo = du !== null && du <= prazo;
        let aceita;
        if (Object.prototype.hasOwnProperty.call(avalQ, l.protocolo)) aceita = !!avalQ[l.protocolo];
        else { aceita = noPrazo && l.dados && l.dados.resposta_propria === 'sim'; estimadas++; }
        return { protocolo: l.protocolo, diasUteis: du, noPrazo, respostaPropria: l.dados && l.dados.resposta_propria, aceita };
      });
      r.n = doMes.length; r.identificadas = ident.length; r.aceitas = detalhe.filter((d) => d.aceita).length; r.detalhe = detalhe; r.base = 'linhas';
      r.valor = ident.length ? U.arred((r.aceitas / ident.length) * 100, 1) : null;
      if (estimadas) r.alertas.push({ codigo: 'ACEITE_ESTIMADO', gravidade: 'baixa', mensagem: 'Aceite estimado por prazo (' + prazo + ' dias úteis) e resposta própria em ' + estimadas + ' queixa(s); falta o aceite da CTAI.' });
      if (detalhe.some((d) => d.respostaPropria === 'não')) r.alertas.push({ codigo: 'RESPOSTA_COPIADA', gravidade: 'alta', mensagem: 'Há resposta sem texto próprio (cópia de outra queixa). Não deve ser aceita.' });
      const decRec = U.numero(pegar(decl, 'queixas_recebidas'));
      if (decRec !== null && decRec !== ls.length) r.alertas.push({ codigo: 'CONTAGEM_DIVERGENTE', gravidade: 'média', mensagem: 'A ficha diz ' + decRec + ' queixa(s) recebida(s); a lista tem ' + ls.length + '.' });
    } else {
      const ident = U.numero(pegar(decl, 'queixas_identificadas')), ace = U.numero(pegar(decl, 'queixas_aceitas'));
      if (ident && ace !== null) { r.valor = U.arred((ace / ident) * 100, 1); r.base = 'apoio'; r.fonteCalculo = 'contagens da ficha (sem lista)'; } else { r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado (sem lista)'; }
      r.n = 0;
      r.alertas.push({ codigo: 'SEM_LINHAS', gravidade: 'média', mensagem: 'Sem lista de queixas: protocolo, data, prazo e resposta não puderam ser validados.' });
    }
    registrar('2.12', r);
  }

  // 2.13 transparência
  {
    const v = pegar(decl, 'i2_13_valor');
    registrar('2.13', { fonteCalculo: 'valor declarado (Ficha de Avaliação de Transparência)', valorDeclarado: v, valor: v, base: 'declarado', alertas: [{ codigo: 'DEPENDE_DE_FICHA', gravidade: 'baixa', mensagem: 'Nível vem da ficha de avaliação; a CTAI confere o documento.' }] });
  }

  // 2.14 execução do plano
  {
    const prev = U.numero(pegar(decl, 'educ_previstas')), real = U.numero(pegar(decl, 'educ_realizadas'));
    const declarado = U.numero(pegar(decl, 'i2_14_valor'));
    const r = { fonteCalculo: 'contagens da ficha', valorDeclarado: declarado, alertas: [], base: 'apoio' };
    if (prev && real !== null) { r.valor = U.arred((real / prev) * 100, 1); r.previstas = prev; r.realizadas = real; } else { r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado'; r.alertas.push({ codigo: 'SEM_DADOS', gravidade: 'média', mensagem: 'Sem atividades previstas e realizadas para recalcular.' }); }
    registrar('2.14', r);
  }

  // 2.15 e 2.16 adesão por pessoas únicas
  for (const [id, area, campoCap, campoAtv, campoRh, campoVal] of [
    ['2.15', 'assistencial', 'educ_capacitados_assist', 'educ_ativos_assist', 'quadro_assist_ativos', 'i2_15_valor'],
    ['2.16', 'administrativa', 'educ_capacitados_adm', 'educ_ativos_adm', 'quadro_adm_ativos', 'i2_16_valor'],
  ]) {
    const declarado = U.numero(pegar(decl, campoVal));
    const r = { fonteCalculo: 'linhas (pessoas únicas)', valorDeclarado: declarado, alertas: [] };
    const part = L('educacao_participacao').filter((l) => l.categoria === area);
    const quadro = L('quadro_pessoal').filter((l) => l.categoria === area && l.dados && l.dados.ativo === 'sim');
    const capacitadosLinhas = new Set(part.filter((l) => l.dados && l.dados.participou === 'sim').map((l) => l.protocolo));
    const participacoes = part.filter((l) => l.dados && l.dados.participou === 'sim').length;
    const ativosQuadro = new Set(quadro.map((l) => l.protocolo)).size;
    const capDecl = U.numero(pegar(decl, campoCap));
    const atvDecl = U.numero(pegar(decl, campoAtv)) ?? U.numero(pegar(decl, campoRh));
    let cap = null, atv = null;
    if (part.length) { cap = capacitadosLinhas.size; r.participacoes = participacoes; r.base = 'linhas'; }
    else if (capDecl !== null) { cap = capDecl; r.base = 'apoio'; r.fonteCalculo = 'contagens da ficha (sem linhas)'; }
    if (ativosQuadro) atv = ativosQuadro; else if (atvDecl !== null) atv = atvDecl;
    if (ativosQuadro && atvDecl !== null && Math.abs(ativosQuadro - atvDecl) / Math.max(atvDecl, 1) > 0.05) {
      r.alertas.push({ codigo: 'DENOMINADOR_DIVERGENTE', gravidade: 'média', mensagem: 'O quadro de pessoal tem ' + ativosQuadro + ' pessoa(s) ativa(s) nesta área; a ficha usa ' + atvDecl + '.' });
    }
    if (cap !== null && atv) {
      r.capacitados = cap; r.ativos = atv;
      r.valor = U.arred((cap / atv) * 100, 1);
      if (participacoes && atv) r.pctPorParticipacoes = U.arred((participacoes / atv) * 100, 1);
      if (r.pctPorParticipacoes !== undefined && r.pctPorParticipacoes > r.valor + 0.5) r.alertas.push({ codigo: 'SOMA_DE_PARTICIPACOES', gravidade: 'média', mensagem: 'Somar participações daria ' + U.formatarNumero(r.pctPorParticipacoes, 1) + '%; por pessoas únicas dá ' + U.formatarNumero(r.valor, 1) + '%. A regra adotada é pessoas únicas (a confirmar com a CTAI).' });
    } else {
      r.valor = declarado; r.base = 'declarado'; r.fonteCalculo = 'valor declarado'; r.alertas.push({ codigo: 'SEM_DADOS', gravidade: 'média', mensagem: 'Sem pessoas capacitadas e ativas para recalcular.' });
    }
    r.alertas.push({ codigo: 'REGRA_PENDENTE', gravidade: 'baixa', mensagem: 'Regra de pessoas únicas e denominador (ativos ou esperados) pendente de confirmação da CTAI.' });
    registrar(id, r);
  }

  // ---------- Transferências ----------
  const transferencias = {};
  {
    const { xs } = tempos(L('transferencias'));
    const bid = U.numero(pegar(decl, 'bid_remocoes'));
    const declarada = U.numero(pegar(decl, 'transf_media_declarada'));
    if (xs.length) {
      Object.assign(transferencias, resumoTempos(xs));
      transferencias.acima24h = pctAcima(xs, 1440);
      transferencias.somaMinutos = U.arred(xs.reduce((s, x) => s + x, 0), 0);
      if (bid) {
        transferencias.cobertura = U.arred((xs.length / bid) * 100, 1);
        if (xs.length < bid) alertasGerais.push({ codigo: 'LISTA_INCOMPLETA', gravidade: 'alta', mensagem: 'A lista de transferências tem ' + xs.length + ' linha(s) e o BID registra ' + bid + ' remoções. Exija a lista completa.' });
        cruzamentos.push({ tema: 'Remoções: BID × lista', valores: { BID: bid, 'lista de transferências': xs.length } });
      }
      if (declarada !== null) {
        transferencias.declarada = declarada;
        const g = grauPorDiferenca(declarada, transferencias.media, false);
        if (g) divergencias.push(divergencia(null, 'Tempo médio até a transferência', declarada, transferencias.media, Math.abs(transferencias.media - declarada) / Math.max(declarada, 1) > 0.25 ? 'alta' : g, 'Média recalculada pelas linhas contra o valor declarado. A mediana é ' + U.formatarNumero(transferencias.mediana) + ' min.'));
      }
    } else if (bid) {
      alertasGerais.push({ codigo: 'SEM_LISTA_TRANSFERENCIAS', gravidade: 'média', mensagem: 'O BID registra ' + bid + ' remoções, mas não há lista de transferências.' });
    }
  }

  // ---------- Cruzamentos de contagens ----------
  function cruzar(tema, valores, tolerancia) {
    const vs = Object.entries(valores).filter(([, v]) => v !== null && v !== undefined);
    if (vs.length < 2) return;
    const nums = vs.map(([, v]) => v);
    const max = Math.max(...nums), min = Math.min(...nums);
    cruzamentos.push({ tema, valores: Object.fromEntries(vs) });
    if (max > 0 && (max - min) / max > (tolerancia || 0.02)) {
      const rel = (max - min) / max;
      divergencias.push(divergencia(null, tema, null, null, rel > 0.2 ? 'alta' : 'média', Object.entries(valores).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => k + ': ' + v).join(' · ') + '. Diferença de ' + U.formatarNumero(rel * 100, 1) + '% entre a maior e a menor.'));
    }
  }
  for (const cor of ['vermelho', 'amarelo', 'verde']) {
    const plural = { vermelho: 'vermelhos', amarelo: 'amarelos', verde: 'verdes' }[cor];
    cruzar('Classificação ' + cor + ': BID × turno × linhas de tempo', {
      BID: U.numero(bidCor[cor]),
      'relatório por turno': U.numero(pegar(decl, 'turno_' + plural)),
      'linhas de tempo': corLinhas[cor].length || null,
    });
  }

  // ---------- Outros alertas ----------
  const gasto = U.numero(pegar(decl, 'gasto_pessoal_pct'));
  if (gasto !== null && gasto > 80) alertasGerais.push({ codigo: 'GASTO_PESSOAL_ACIMA', gravidade: 'alta', mensagem: 'Gasto com pessoal de ' + U.formatarNumero(gasto) + '%, acima do limite de 80% (Cláusula Oitava, § 2).' });
  const am = U.numero(pegar(decl, 'prontuarios_amostra')), tot = U.numero(pegar(decl, 'prontuarios_total')), amDecl = U.numero(pegar(decl, 'prontuarios_amostra_pct_declarada'));
  if (am !== null && tot) {
    const real = U.arred((am / tot) * 100, 1);
    if (amDecl !== null && Math.abs(real - amDecl) > 1) {
      divergencias.push(divergencia(null, 'Amostra de prontuários', amDecl, real, (real > amDecl * 2 || real < amDecl / 2) ? 'alta' : 'média', 'O relatório declara ' + amDecl + '%; a conta (' + am + ' de ' + tot + ') dá ' + real + '%.'));
    }
  }

  // ---------- Totais ----------
  const igqRecalculado = regras.indicadores.reduce((s, i) => s + (ind[i.id] ? Math.min(ind[i.id].pontos, i.max) : 0), 0);
  const igqDeclarado = regras.indicadores.reduce((s, i) => s + (ind[i.id] && ind[i.id].pontosDeclarados !== null ? Math.min(ind[i.id].pontosDeclarados, i.max) : 0), 0);
  const todosAlertas = [];
  for (const i of regras.indicadores) if (ind[i.id]) for (const a of ind[i.id].alertas) todosAlertas.push(Object.assign({ indicador_id: i.id }, a));
  for (const a of alertasGerais) todosAlertas.push(a);

  return {
    versaoRegra: regras.versao,
    opcoes: opcoesPontos,
    indicadores: ind,
    igqRecalculado,
    igqDeclarado,
    transferencias,
    cruzamentos,
    divergencias,
    alertas: todosAlertas,
  };
}

module.exports = { recalcular, tempos, resumoTempos };
