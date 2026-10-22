(function () {
  'use strict';
  const { h, api, fmt, toast, janela, perguntar, confirmar, selo, seloGrav, aviso, tabela, rotear, montar, troca, casca } = window.CTAI;
  let EU = null, META = null;
  const eh = (...p) => p.includes(EU.perfil);
  const ehAdmin = () => EU.perfil === 'admin';
  const migalha = (...p) => h('div', { class: 'migalha' }, p.map((x, i) => [i ? ' › ' : '', x]));
  const demo = (c) => (c ? h('div', { class: 'faixa-demo' }, h('strong', null, 'DEMONSTRAÇÃO – dados fictícios. '), 'Nada daqui vale como documento oficial.') : null);
  const SITU = { 'parecer emitido': 'ok', recebida: 'atencao', enviada: 'atencao', aberta: '' };
  const kpi = (r, v, nota) => h('div', { class: 'kpi' }, h('div', { class: 'r' }, r), h('div', { class: 'num-grande' }, v), nota ? h('div', { class: 'r' }, nota) : null);
  const pdfLink = (url, rotulo) => h('a', { href: url, target: '_blank', rel: 'noopener' }, rotulo || 'Abrir PDF');

  // ---------- Painel ----------
  async function painel() {
    const r = await api('GET', '/api/ctai/contratos');
    const pareceres = await api('GET', '/api/ctai/pareceres');
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Painel da CTAI'), h('p', null, 'Envios recebidos, divergências abertas e pareceres em andamento.'))),
      r.contratos.map((c) => h('div', { class: 'cartao' },
        h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, c.unidade, ' ', c.demo ? selo('demonstração', 'demo') : null), c.decisoesAbertas ? h('a', { href: '#/regras/' + c.contrato_id }, selo(c.decisoesAbertas + ' dúvida(s) de regra em aberto', 'atencao')) : selo('regras decididas', 'ok')),
        h('p', { class: 'mudo peq' }, c.oss + ' · ' + (c.numero_cg || '')),
        tabela([{ t: 'Mês' }, { t: 'Situação' }, { t: 'Envio' }, { t: 'Recebido em' }, { t: 'Prazos' }, { t: 'Divergências abertas', n: true }, { t: '' }],
          c.competencias.map((k) => [fmt.comp(k.competencia_id) + (k.mes_implantacao ? ' (implantação)' : ''), selo(k.status, SITU[k.status] || ''), k.versaoEnvio ? h('span', null, 'v' + k.versaoEnvio, k.seiAlertas ? [' ', h('a', { href: '#/c/' + k.cid + '/envios', title: 'Alerta entre o sistema e o SEI' }, selo('SEI: ' + k.seiAlertas + ' alerta(s)', 'atencao'))] : null) : '—', fmt.data(k.recebido_em), k.prazos ? selo(k.prazos.texto, k.prazos.nivel === 'alta' ? 'alta' : (k.prazos.nivel === 'atencao' ? 'atencao' : (k.prazos.nivel === 'ok' ? 'ok' : ''))) : '—', String(k.divergenciasAbertas), h('a', { href: '#/c/' + k.cid }, 'Abrir')])))),
      h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Pareceres'), h('a', { class: 'btn sec', href: '#/pareceres' }, 'Ver todos')),
        tabela([{ t: 'Parecer' }, { t: 'Trimestre' }, { t: 'Criado por' }, { t: 'Situação' }], pareceres.pareceres.slice(0, 5).map((p) => [h('a', { href: '#/p/' + p.parecer_id }, p.titulo), p.trimestre, p.criador_nome, selo(p.status + (p.ultimaVersao ? ' (v' + p.ultimaVersao.numero + ')' : ''), p.status === 'anexado ao SEI' || p.status === 'autorizado' ? 'ok' : 'atencao')]), { vazio: 'Nenhum parecer aberto.' })));
  }

  // ---------- Prazos e checklist de recebimento ----------
  const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const seloPrazo = (pz, canal) => selo(canal + ': ' + pz.situacao + (['vencido', 'entregue com atraso', 'a vencer'].includes(pz.situacao) ? ' (' + pz.dias + ' d)' : ''), pz.nivel === 'alta' ? 'alta' : (pz.nivel === 'atencao' ? 'atencao' : (pz.nivel === 'ok' ? 'ok' : '')));
  function cartaoPrazos(pz) {
    if (!pz) return null;
    const linha = (canal, x, dia) => h('div', { class: 'linha espaco', style: 'padding:4px 0' }, h('span', null, h('strong', null, 'Prazo no ' + canal), ' · até ' + dataBr(x.prazo) + ' (dia ' + dia + ' do mês seguinte)'), h('span', null, seloPrazo(x, canal), ' ', h('span', { class: 'mudo peq' }, x.mensagem)));
    return h('div', { class: 'cartao' }, h('h3', null, 'Prazos de entrega'), linha('SEI', pz.sei, 20), linha('SIMAS', pz.simas, 25),
      h('p', { class: 'mudo peq', style: 'margin:6px 0 0' }, 'SEI: vale a data em que a unidade registrou o número do documento no sistema. SIMAS: vale a data que o gestor da unidade informou.' + (pz.tem_envio ? '' : ' Sem envio pelo portal: o prazo corre normalmente.')));
  }
  const avisoPrazos = (pz) => (pz ? [['SEI', pz.sei], ['SIMAS', pz.simas]].filter(([, x]) => ['alta', 'atencao'].includes(x.nivel)).map(([c, x]) => aviso(x.nivel === 'alta' ? 'erro' : 'atencao', h('strong', null, 'Prazo no ' + c + ': '), x.mensagem + ' (prazo ' + dataBr(x.prazo) + ').')) : null);
  const STATUS_CK = { recebido: 'ok', pendente: 'alta', incompleto: 'atencao', 'não aplicável': '' };

  async function editarItem(it, recarregar, cid) {
    const st = h('select', { id: 'ck-s' }, ['recebido', 'pendente', 'incompleto', 'não aplicável'].map((x) => h('option', { value: x, selected: x === it.status }, x)));
    const dt = h('input', { type: 'date', id: 'ck-d', value: it.data_recebimento || '' });
    const rs = h('input', { type: 'text', id: 'ck-r', maxlength: 120, value: it.responsavel || '' });
    const vl = h('select', { id: 'ck-v' }, [['', 'não registrada'], ['validado', 'validado'], ['com divergências', 'com divergências'], ['com inconsistências', 'com inconsistências']].map(([v, r]) => h('option', { value: v, selected: v === (it.validacao || '') }, r)));
    const ob = h('textarea', { id: 'ck-o', rows: 3, maxlength: 1000 }); ob.value = it.observacao || '';
    const msg = h('div', { class: 'msg-erro' });
    const corpo = h('div', null, h('p', { class: 'peq mudo' }, it.titulo), it.faltas.length ? h('p', { class: 'peq' }, h('strong', null, 'O sistema notou: '), it.faltas.join('; ') + '. Sugestão: ' + it.sugestao + '.') : (it.sugestao ? h('p', { class: 'peq' }, 'Sugestão do sistema: ' + it.sugestao + '.') : null),
      it.divergencias_abertas ? h('p', { class: 'peq' }, h('strong', null, it.divergencias_abertas + ' divergência(s) aberta(s) '), 'ligada(s) a este item.') : null,
      h('div', { class: 'campo' }, h('label', { for: 'ck-s' }, 'Status'), st), h('div', { class: 'campo' }, h('label', { for: 'ck-d' }, 'Data de recebimento'), dt), h('div', { class: 'campo' }, h('label', { for: 'ck-r' }, 'Responsável pelo envio'), rs),
      h('div', { class: 'campo' }, h('label', { for: 'ck-v' }, 'Validação (divergências e inconsistências)'), vl), h('div', { class: 'campo' }, h('label', { for: 'ck-o' }, 'Observações (obrigatórias para "não aplicável")'), ob), msg);
    for (;;) {
      const r = await janela('Checklist · ' + it.titulo.split(':')[0], corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, it.status_manual ? { rotulo: 'Voltar ao cálculo do sistema', valor: 'auto', sec: true } : null, { rotulo: 'Salvar', valor: 'ok' }].filter(Boolean));
      if (r === 'auto') { try { await api('POST', '/api/ctai/competencias/' + cid + '/checklist/' + it.item_id + '/restaurar', {}); toast('Voltou ao cálculo do sistema.'); recarregar(); return; } catch (e) { msg.textContent = e.message; continue; } }
      if (r !== 'ok') return;
      try { await api('PUT', '/api/ctai/competencias/' + cid + '/checklist/' + it.item_id, { status: st.value, data_recebimento: dt.value || '', responsavel: rs.value, validacao: vl.value, observacao: ob.value }); toast('Checklist atualizado.'); recarregar(); return; } catch (e) { msg.textContent = e.message; }
    }
  }

  function abaChecklist(d, p) {
    const ck = d.checklist;
    if (!ck.iniciado) return [avisoPrazos(d.prazos), aviso('info', h('strong', null, 'Sem envio pelo portal. '), 'O checklist de recebimento é montado quando a unidade envia o relatório.'), cartaoPrazos(d.prazos)];
    const r = ck.resumo;
    const recarregar = () => competencia(p);
    const linhas = (compl) => ck.itens.filter((i) => i.complementar === compl).map((i) => [
      h('div', null, h('strong', null, i.titulo), i.faltas.length && i.status !== 'recebido' ? h('div', { class: 'peq mudo' }, i.faltas.join('; ')) : null),
      selo(i.status, STATUS_CK[i.status] || '') , i.status_manual ? h('span', { class: 'peq mudo', title: 'Status decidido por ' + i.atualizado_por }, 'decidido por ' + i.atualizado_por) : h('span', { class: 'peq mudo' }, 'sugerido pelo sistema'),
      dataBr(i.data_recebimento), i.responsavel || '—',
      i.validacao ? selo(i.validacao, i.validacao === 'validado' ? 'ok' : 'atencao') : h('span', { class: 'mudo peq' }, i.divergencias_abertas ? i.divergencias_abertas + ' divergência(s) aberta(s)' : 'não registrada'),
      i.observacao || '', h('button', { class: 'sec', onclick: () => editarItem(i, recarregar, p.cid) }, 'Editar')]);
    const cols = [{ t: 'Item' }, { t: 'Status' }, { t: 'Origem' }, { t: 'Recebido em' }, { t: 'Responsável' }, { t: 'Validação' }, { t: 'Observações' }, { t: '' }];
    return [avisoPrazos(d.prazos),
      h('p', { style: 'margin:0 0 10px' }, h('strong', null, 'Competência: '), fmt.comp(d.competencia.competencia_id), ' · ', h('strong', null, 'Responsável pelo envio: '), ck.responsavel_envio || '—', ' · versão v' + ck.versao),
      h('div', { class: 'kpis' }, kpi('Data de recebimento', dataBr(ck.data_recebimento)), kpi('Recebidos', String(r.recebido), 'de ' + (r.recebido + r.pendente + r.incompleto + r['não aplicável'])), kpi('Incompletos', String(r.incompleto)), kpi('Pendentes', String(r.pendente)), kpi('Não aplicáveis', String(r['não aplicável']))),
      h('div', { class: 'cartao' }, h('h3', null, 'Documentos e relatórios obrigatórios da UPA'), h('p', { class: 'mudo peq' }, 'O sistema sugere o status pelo que a unidade informou. A decisão é de quem confere: ao editar, o item deixa de ser recalculado a cada novo envio.'), tabela(cols, linhas(false))),
      h('div', { class: 'cartao' }, h('h3', null, 'Complementares (mantidos por decisão)'), tabela(cols, linhas(true))),
      cartaoPrazos(d.prazos)];
  }

  // ---------- Competência ----------
  const ABAS = [['recalculo', 'Recálculo'], ['divergencias', 'Divergências'], ['evidencias', 'Evidências'], ['achados', 'Achados do Analista'], ['checklist', 'Checklist de recebimento'], ['envios', 'Envios']];
  async function competencia(p) {
    const aba = p.aba || 'recalculo';
    const d = await api('GET', '/api/ctai/competencias/' + p.cid);
    const c = d.competencia;
    const topo = [demo(c.demo), migalha(h('a', { href: '#/' }, 'Painel'), c.unidade, fmt.comp(c.competencia_id)),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, c.unidade + ' · ' + fmt.comp(c.competencia_id)), h('p', null, (c.mes_implantacao ? 'Mês de implantação, sem desconto · ' : '') + 'Situação: ' + c.status + ' · Regra ' + d.regras.versao)),
        d.envios.length ? h('button', { class: 'sec', onclick: async () => { try { await api('POST', '/api/ctai/envios/' + d.envios[0].envio_id + '/reprocessar', {}); toast('Recalculado e relido.'); competencia(p); } catch (e) { toast(e.message, true); } } }, 'Recalcular e reler') : null),
      h('div', { class: 'abas' }, ABAS.map(([k, r]) => h('a', { href: '#/c/' + p.cid + '/' + k, class: aba === k ? 'ativo' : '' }, r))),
      aba !== 'envios' && d.canais.alertas.length ? d.canais.alertas.map((a) => aviso(a.gravidade === 'alta' ? 'erro' : 'atencao', h('strong', null, 'Sistema × SEI: '), a.mensagem, ' ', h('a', { href: '#/c/' + p.cid + '/envios' }, 'Ver os dois canais'))) : null];
    const corpo = { recalculo: abaRecalculo, divergencias: abaDivergencias, evidencias: abaEvidencias, achados: abaAchados, checklist: abaChecklist, envios: abaEnvios }[aba](d, p);
    montar(topo, corpo);
  }

  function abaRecalculo(d, p) {
    const rec = d.recalculo;
    const prazosTopo = [avisoPrazos(d.prazos)];
    const decAbertas = d.decisoes.filter((x) => !x.valor);
    if (!rec) {
      const oss = Object.fromEntries(d.indicadores_oss.map((o) => [o.indicador_id, o]));
      return [prazosTopo, aviso('info', h('strong', null, 'Sem envio pelo portal. '), 'Este mês veio da carga dos documentos já lidos. Os valores abaixo são o que a unidade declarou; não há linhas para recalcular.'),
        d.totais ? h('div', { class: 'kpis' }, kpi('IGQ declarado pela OSS', d.totais.igq_oss), kpi('IGQ no parecer', d.totais.igq_parecer), kpi('IGQ pelas faixas (Página 3)', d.totais.igq_pagina3_faixas)) : null,
        d.totais && d.totais.observacao ? h('p', { class: 'mudo' }, d.totais.observacao) : null,
        h('div', { class: 'cartao' }, tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Valor da OSS', n: true }, { t: 'Pontos', n: true }, { t: 'Texto' }], d.regras.indicadores.map((i) => { const o = oss[i.id]; return [i.id, i.nome, o ? fmt.valor(o.valor_declarado) : '—', o ? String(o.pontos_declarados) : '—', o ? o.texto_analise || '' : '']; }), { vazio: 'Sem indicadores.' }))];
    }
    const dif = rec.igqRecalculado - rec.igqDeclarado;
    const tr = rec.transferencias || {};
    return [
      prazosTopo,
      decAbertas.length ? aviso('atencao', h('strong', null, decAbertas.length + ' dúvida(s) de regra ainda sem decisão. '), 'O recálculo usa a ficha do contrato enquanto isso. ', h('a', { href: '#/regras/' + d.competencia.contrato_id }, 'Decidir agora')) : null,
      h('div', { class: 'kpis' }, kpi('Versão recebida', 'v' + rec.envio.versao, fmt.data(rec.envio.enviado_em)), kpi('IGQ declarado', rec.igqDeclarado, 'pelos valores da unidade'), kpi('IGQ recalculado', rec.igqRecalculado, 'pelas linhas e contagens'), kpi('Diferença', (dif > 0 ? '+' : '') + dif, dif === 0 ? 'sem diferença' : 'pontos'), kpi('Alertas', String(rec.alertas.length), rec.divergencias.length + ' divergência(s)')),
      h('div', { class: 'cartao' }, h('h3', null, 'Indicador a indicador'),
        tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Declarado', n: true }, { t: 'Recalculado', n: true }, { t: 'Base' }, { t: 'Pts decl.', n: true }, { t: 'Pts recalc.', n: true }, { t: 'Alertas' }],
          d.regras.indicadores.map((i) => { const r = rec.indicadores[i.id]; if (!r) return [i.id, i.nome, '—', '—', '—', '—', '—', '']; const mudou = r.pontosDeclarados !== null && r.pontosDeclarados !== r.pontos;
            return [i.id, h('span', { title: i.faixasTexto }, i.nome), fmt.valor(r.valorDeclarado), fmt.valor(r.valor), r.fonteCalculo + (r.n ? ' (' + r.n + ')' : ''), r.pontosDeclarados === null ? '—' : String(r.pontosDeclarados), h('span', { class: 'pontos', style: mudou ? 'color:var(--verm)' : '' }, r.pontos + ' / ' + i.max), r.alertas.filter((a) => a.gravidade !== 'baixa').length ? selo(String(r.alertas.filter((a) => a.gravidade !== 'baixa').length), 'atencao') : '']; }))),
      h('div', { class: 'cartao' }, h('h3', null, 'Alertas do recálculo'), rec.alertas.length ? h('ul', null, rec.alertas.map((a) => h('li', null, seloGrav(a.gravidade), ' ', a.indicador_id ? h('strong', null, 'Item ' + a.indicador_id + ': ') : null, a.mensagem))) : h('p', { class: 'mudo' }, 'Nenhum alerta.')),
      tr.n ? h('div', { class: 'cartao' }, h('h3', null, 'Transferências'), h('div', { class: 'kpis' }, kpi('Linhas', String(tr.n)), kpi('Média (min)', fmt.num(tr.media)), kpi('Mediana (min)', fmt.num(tr.mediana)), kpi('Máximo (min)', fmt.num(tr.maximo)), kpi('Declarada (min)', tr.declarada === undefined ? '—' : fmt.num(tr.declarada)))) : null,
      rec.cruzamentos.length ? h('div', { class: 'cartao' }, h('h3', null, 'Cruzamentos de contagens'), tabela([{ t: 'Tema' }, { t: 'Valores' }], rec.cruzamentos.map((c) => [c.tema, Object.entries(c.valores).map(([k, v]) => k + ': ' + v).join(' · ')]))) : null,
      queixas(rec, p)];
  }

  function queixas(rec, p) {
    const q = rec.indicadores['2.12'];
    if (!q || !q.detalhe || !q.detalhe.length) return null;
    return h('div', { class: 'cartao' }, h('h3', null, 'Queixas: aceite da resposta'), h('p', { class: 'mudo peq' }, 'Sem o seu aceite, o sistema estima por prazo e por resposta com texto próprio. Sua marcação muda o recálculo.'),
      tabela([{ t: 'Protocolo' }, { t: 'Dias úteis', n: true }, { t: 'No prazo' }, { t: 'Texto próprio' }, { t: 'Aceita?' }], q.detalhe.map((x) => [x.protocolo, x.diasUteis === null ? '—' : String(x.diasUteis), x.noPrazo ? 'sim' : 'não', x.respostaPropria || '—',
        h('select', { 'aria-label': 'Aceite da queixa ' + x.protocolo, onchange: async (e) => { try { await api('POST', '/api/ctai/competencias/' + p.cid + '/avaliacoes', { fonte: 'queixas', protocolo: x.protocolo, campo: 'aceite', valor: e.target.value === 'sim' }); toast('Aceite registrado.'); competencia(p); } catch (er) { toast(er.message, true); } } }, [['sim', 'sim'], ['nao', 'não']].map(([v, r]) => h('option', { value: v, selected: (v === 'sim') === x.aceita }, r)))])));
  }

  const STATUS_DIV = ['aberta', 'em apuração', 'resolvida', 'aceita', 'descartada'];
  function abaDivergencias(d, p) {
    if (!d.divergencias.length) return h('p', { class: 'vazio' }, 'Nenhuma divergência registrada.');
    return h('div', null, h('p', { class: 'mudo' }, d.divergencias.length + ' divergência(s). Decidir uma divergência exige uma observação, que fica na trilha.'),
      d.divergencias.map((x) => h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('strong', null, x.tema), h('div', { class: 'linha' }, seloGrav(x.gravidade), selo(x.origem === 'leitura' ? 'lida nos documentos' : (x.origem === 'acervo' ? 'conferência com o acervo' : 'recálculo')))),
        h('div', { class: 'duas peq', style: 'margin-top:6px' }, h('div', null, h('span', { class: 'mudo' }, x.origem === 'acervo' ? 'No sistema da CTAI: ' : 'Declarado: '), x.declarado ?? '—'), h('div', null, h('span', { class: 'mudo' }, x.origem === 'acervo' ? 'No acervo: ' : 'Recalculado: '), x.recalculado ?? '—')),
        x.observacao ? h('p', { class: 'peq' }, x.observacao) : null,
        h('div', { class: 'linha', style: 'margin-top:8px' }, h('label', { style: 'margin:0;font-weight:400' }, 'Situação '), h('select', { 'aria-label': 'Situação da divergência', id: 'dv' + x.divergencia_id }, STATUS_DIV.map((s) => h('option', { value: s, selected: s === x.status }, s))),
          h('button', { class: 'sec', onclick: async () => {
            const st = document.getElementById('dv' + x.divergencia_id).value; let obs = x.observacao;
            if (st !== 'aberta') { obs = await perguntar('Decisão sobre a divergência', 'Explique a decisão', { longo: true, texto: x.tema }); if (!obs) return; }
            try { await api('PATCH', '/api/ctai/divergencias/' + x.divergencia_id, { status: st, observacao: obs }); toast('Registrado.'); competencia(p); } catch (e) { toast(e.message, true); } } }, 'Registrar')))));
  }

  function abaEvidencias(d, p) {
    const ev = Object.fromEntries(d.evidencias.map((e) => [e.indicador_id, e]));
    const sn = (v) => (v === 1 ? 'sim' : (v === 0 ? 'não' : '—'));
    return [h('p', { class: 'mudo' }, 'Para cada indicador, registre se o documento comprova o que a unidade declarou: período certo, assinatura, tipo de documento certo e se a CTAI aceita.'),
      h('div', { class: 'cartao' }, tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Documento' }, { t: 'Período' }, { t: 'Assinado' }, { t: 'Tipo certo' }, { t: 'Aceita' }, { t: 'Lido por' }, { t: '' }],
        d.regras.indicadores.map((i) => { const e = ev[i.id] || {}; return [i.id, i.nome, e.documento_id || '—', sn(e.periodo_ok), sn(e.assinado_ok), sn(e.tipo_correto_ok), sn(e.aceita), e.lido_por ? e.lido_por + ' · ' + fmt.data(e.data_leitura) : '—', h('button', { class: 'leve', onclick: () => leituraEvidencia(i, e, p) }, 'Registrar leitura')]; })))];
  }
  async function leituraEvidencia(i, e, p) {
    const campos = { periodo_ok: 'O período do documento é o da competência', assinado_ok: 'O documento está assinado', tipo_correto_ok: 'É o tipo de documento exigido (ex.: relatório, não ata)', aceita: 'A CTAI aceita como comprovação' };
    const caixas = Object.fromEntries(Object.keys(campos).map((k) => [k, h('input', { type: 'checkbox', id: 'ev-' + k, checked: e[k] === 1 })]));
    const obs = h('textarea', { id: 'ev-obs', rows: 2 }, e.observacao || '');
    const doc = h('input', { type: 'text', id: 'ev-doc', value: e.documento_id || '' });
    const ok = await janela('Evidência do item ' + i.id, h('div', null, h('div', { class: 'campo' }, h('label', { for: 'ev-doc' }, 'Documento (nº SEI)'), doc),
      Object.entries(campos).map(([k, r]) => h('div', { class: 'campo' }, h('label', { for: 'ev-' + k, style: 'font-weight:400' }, caixas[k], ' ', r))), h('div', { class: 'campo' }, h('label', { for: 'ev-obs' }, 'Observação'), obs)),
      [{ rotulo: 'Cancelar', valor: false, sec: true }, { rotulo: 'Salvar', valor: true }]);
    if (!ok) return;
    try { await api('PUT', '/api/ctai/competencias/' + p.cid + '/evidencias/' + i.id, Object.assign({ documento_id: doc.value, observacao: obs.value }, Object.fromEntries(Object.keys(campos).map((k) => [k, caixas[k].checked])))); toast('Leitura registrada.'); competencia(p); } catch (er) { toast(er.message, true); }
  }

  const SETOR_NOME = { assistencia: 'Assistência', qualidade: 'Qualidade', ouvidoria: 'Ouvidoria', educacao: 'Educação permanente', bid: 'BID / transferências', rh: 'Recursos humanos' };
  const STATUS_TIPO = { fixado: 'ok', encaminhado: 'atencao', respondido: 'ok' };
  async function encaminhar(a, recarregar) {
    const setor = h('select', { id: 'en-s' }, [h('option', { value: '' }, 'Gestor da unidade (qualquer setor)')].concat(Object.entries(SETOR_NOME).map(([k, v]) => h('option', { value: k, selected: a.setor_sugerido === k }, v))));
    const prazo = h('input', { type: 'date', id: 'en-p' });
    const msg = h('textarea', { id: 'en-m', rows: 5, maxlength: 1500 });
    msg.value = a.sugestao ? 'Esclarecer: ' + a.sugestao : '';
    const erroMsg = h('div', { class: 'msg-erro' });
    const corpo = h('div', null, h('p', { class: 'peq mudo' }, 'A unidade verá o tipo do achado, o trecho e a sua mensagem. Não escreva dado de paciente.'),
      h('div', { class: 'campo' }, h('label', { for: 'en-s' }, 'Quem responde'), setor), h('div', { class: 'campo' }, h('label', { for: 'en-p' }, 'Prazo (opcional)'), prazo),
      h('div', { class: 'campo' }, h('label', { for: 'en-m' }, 'O que a unidade deve esclarecer'), msg), erroMsg);
    for (;;) {
      const r = await janela('Encaminhar à unidade', corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Encaminhar', valor: 'ok' }]);
      if (r !== 'ok') return;
      try { await api('POST', '/api/analista/achados/' + a.achado_id + '/encaminhar', { setor: setor.value || null, prazo: prazo.value || null, mensagem: msg.value }); toast('Encaminhado à unidade.'); recarregar(); return; } catch (e) { erroMsg.textContent = e.message; }
    }
  }
  function achadoCard(a, recarregar) {
    const mudar = async (status) => { let motivo = null; if (status === 'descartado') { motivo = await perguntar('Descartar o achado', 'Por que descartar?', { longo: true }); if (!motivo) return; } try { await api('PATCH', '/api/analista/achados/' + a.achado_id, { status, motivo }); recarregar(); } catch (e) { toast(e.message, true); } };
    const podeEncaminhar = recarregar && a.cid && ['novo', 'fixado', 'respondido'].includes(a.status) && ['criador', 'admin', 'superintendente'].includes(EU.perfil);
    const hoje = new Date().toISOString().slice(0, 10);
    return h('div', { class: 'item-mesa ' + (a.status === 'fixado' || a.status === 'respondido' ? 'ok' : '') },
      h('div', { class: 'linha espaco' }, h('strong', null, a.tipo || 'Ponto a conferir'), h('div', { class: 'linha' }, seloGrav(a.gravidade), a.status && a.status !== 'novo' ? selo(a.status, STATUS_TIPO[a.status] || '') : null, a.setor_sugerido ? selo('setor: ' + a.setor_sugerido) : null)),
      a.unidade ? h('p', { class: 'peq mudo', style: 'margin:2px 0' }, a.unidade + (a.competencia_id ? ' · ' + fmt.comp(a.competencia_id) : '')) : null,
      a.trecho ? h('blockquote', { style: 'margin:8px 0;padding:6px 12px;border-left:3px solid var(--borda);color:var(--cinza)' }, a.trecho) : null,
      a.risco ? h('p', { class: 'peq', style: 'margin:4px 0' }, h('strong', null, 'Por que importa: '), a.risco) : null,
      a.sugestao ? h('p', { class: 'peq', style: 'margin:4px 0' }, h('strong', null, 'O que pedir: '), a.sugestao) : null,
      a.normas && a.normas.length ? h('p', { class: 'peq', style: 'margin:4px 0' }, h('strong', null, 'Normas ligadas: '), a.normas.map((n, i) => [i ? '; ' : '', h('a', { href: '#/analista/normas' }, n.titulo + (n.referencia ? ' (' + n.referencia + ')' : ''))])) : null,
      a.mensagem ? h('div', { class: 'aviso info', style: 'margin:8px 0' }, h('strong', null, 'Pedido à unidade' + (a.encaminhado_a ? ' (' + (SETOR_NOME[a.encaminhado_a] || a.encaminhado_a) + ')' : '') + ': '), a.mensagem,
        h('div', { class: 'peq mudo' }, 'por ' + a.encaminhado_por + ' em ' + fmt.data(a.encaminhado_em) + (a.prazo ? ' · prazo ' + fmt.data(a.prazo) : ''), a.status === 'encaminhado' && a.prazo && a.prazo < hoje ? [' ', selo('prazo vencido', 'alta')] : null)) : null,
      a.resposta ? h('div', { class: 'aviso ok', style: 'margin:8px 0' }, h('strong', null, 'Resposta da unidade: '), a.resposta, h('div', { class: 'peq mudo' }, 'por ' + a.respondido_por + ' em ' + fmt.data(a.respondido_em))) : null,
      recarregar ? h('div', { class: 'linha', style: 'margin-top:6px' },
        a.status === 'encaminhado' ? h('span', { class: 'mudo peq' }, 'Aguardando a resposta da unidade.') : [
          a.status !== 'fixado' ? h('button', { class: 'sec', onclick: () => mudar('fixado') }, a.status === 'respondido' ? 'Aceitar e fixar na mesa' : 'Fixar na mesa') : h('button', { class: 'sec', onclick: () => mudar('novo') }, 'Desafixar'),
          podeEncaminhar ? h('button', { class: 'sec', onclick: () => encaminhar(a, recarregar) }, a.status === 'respondido' ? 'Pedir novo esclarecimento' : 'Encaminhar à unidade') : null,
          a.status !== 'descartado' ? h('button', { class: 'leve', onclick: () => mudar('descartado') }, 'Descartar') : h('button', { class: 'leve', onclick: () => mudar('novo') }, 'Reabrir')],
        h('span', { class: 'mudo peq' }, 'lido por: ' + (a.provedor || '—'))) : null);
  }

  function abaAchados(d, p) {
    const ult = d.envios[0];
    return [h('div', { class: 'linha espaco' }, h('p', { class: 'mudo', style: 'margin:0' }, 'O Analista lê o texto do relatório enviado e aponta o que merece conferência. Quem decide é a equipe: fixe o que vale para a mesa.'),
      ult ? h('button', { class: 'sec', onclick: async () => { try { const o = await api('POST', '/api/analista/envios/' + ult.envio_id + '/analisar', {}); toast(o.achados + ' achado(s) · ' + o.provedor); competencia(p); } catch (e) { toast(e.message, true); } } }, 'Analisar o último envio') : null),
      h('div', { style: 'margin-top:12px' }, d.achados.length ? d.achados.map((a) => achadoCard(a, () => competencia(p))) : h('p', { class: 'vazio' }, 'Nenhum achado ainda.')),
      h('p', { class: 'peq' }, h('a', { href: '#/analista/ler' }, 'Analisar outro texto (relatório da OSS colado)')) ];
  }

  // Os dois canais lado a lado: o que chegou ao sistema e o que a unidade registrou como documento no SEI.
  function abaEnvios(d, p) {
    const cn = d.canais;
    const alertas = cn.alertas.map((a) => aviso(a.gravidade === 'alta' ? 'erro' : 'atencao', h('strong', null, 'Sistema × SEI: '), a.mensagem));
    const tabelaCanais = h('div', { class: 'cartao' }, h('h3', null, 'Os dois canais, versão por versão'),
      h('p', { class: 'mudo peq' }, 'Enquanto não há API do SEI, o elo é o número do documento que o gestor da unidade registra depois de anexar e assinar. O código curto é o mesmo que aparece no rodapé do PDF.'),
      tabela([{ t: 'Versão', n: true }, { t: 'No sistema da CTAI' }, { t: 'No SEI (registrado pela unidade)' }, { t: 'Situação' }, { t: 'PDF' }],
        cn.versoes.map((v) => ['v' + v.versao,
          h('div', null, h('div', null, 'Recebido em ' + fmt.data(v.recebido_em || v.enviado_em)), h('div', { class: 'peq mudo' }, 'por ' + v.enviado_por + ' · ' + (v.motivo || 'primeiro envio')), h('div', { class: 'peq' }, 'Rodapé: Versão v' + v.versao + ' · ', h('code', null, v.hash_curto))),
          v.sei ? h('div', null, h('div', null, 'SEI nº ', h('strong', null, v.sei.numero)), h('div', { class: 'peq mudo' }, 'registrado por ' + v.sei.registrado_por + ' em ' + fmt.data(v.sei.registrado_em) + (v.sei.correcoes ? ' · corrigido ' + v.sei.correcoes + ' vez(es): ' + v.sei.motivo_ultima_correcao : '')))
            : h('span', { class: 'mudo' }, 'sem registro'),
          selo(v.situacao, v.sei ? 'ok' : 'atencao'),
          pdfLink('/api/ctai/envios/' + v.envio_id + '/pdf')]), { vazio: 'Sem envio pelo portal.' }));
    return [alertas, tabelaCanais, cn.versoes.length ? cartaoComparacao(cn.versoes) : null];
  }

  // Comparação OPCIONAL com o PDF baixado do SEI. Não é exigida e não bloqueia nada.
  function cartaoComparacao(versoes) {
    const sel = h('select', { id: 'cmp-v', 'aria-label': 'Versão a comparar' }, versoes.map((v) => h('option', { value: v.envio_id }, 'v' + v.versao)));
    const arq = h('input', { type: 'file', id: 'cmp-arq', accept: 'application/pdf,.pdf', 'aria-label': 'PDF baixado do SEI' });
    const res = h('div', { id: 'cmp-res', style: 'margin-top:10px' });
    const comparar = async () => {
      const f = arq.files && arq.files[0];
      if (!f) { troca(res, aviso('erro', 'Escolha o PDF baixado do SEI.')); return; }
      try {
        const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        const o = await api('POST', '/api/ctai/envios/' + sel.value + '/comparar-sei', { arquivo: btoa(bin) });
        troca(res, aviso(o.igual ? 'ok' : 'atencao', h('strong', null, o.igual ? 'Arquivo idêntico. ' : 'Arquivo diferente. '), o.aviso, h('div', { class: 'peq' }, 'Código do arquivo: ', h('code', null, o.hash_arquivo), ' · código do PDF do sistema (v' + o.versao + '): ', h('code', null, o.hash_sistema))));
      } catch (e) { troca(res, aviso('erro', e.message)); }
    };
    return h('div', { class: 'cartao' }, h('h3', null, 'Comparar com o PDF que está no SEI (opcional)'),
      aviso('info', h('strong', null, 'Isto não é exigido e não bloqueia nada. '), 'O SEI pode alterar o arquivo (carimbo de assinatura, metadados), então o código pode ser diferente mesmo com o mesmo conteúdo. A conferência de rotina é olhar o código no rodapé do PDF. O arquivo enviado aqui não é guardado.'),
      h('div', { class: 'linha' }, h('label', { for: 'cmp-v', style: 'margin:0;font-weight:400' }, 'Versão'), sel, arq, h('button', { class: 'sec', onclick: comparar }, 'Comparar')), res);
  }

  // ---------- Regras e decisões ----------
  async function regras(p) {
    const cs = (await api('GET', '/api/ctai/contratos')).contratos;
    const id = p.contrato || (cs.find((c) => !c.demo) || cs[0]).contrato_id;
    const r = await api('GET', '/api/ctai/contratos/' + id + '/decisoes');
    const tabelaRegra = await api('GET', '/api/regras/' + id);
    const pode = eh('criador', 'superintendente');
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Regras e decisões'), h('p', null, 'Dúvidas sobre a regra que mudam o resultado. Cada decisão precisa dizer onde está escrito ou quem decidiu.'))),
      h('div', { class: 'campo', style: 'max-width:420px' }, h('label', { for: 'sel-c' }, 'Contrato'), h('select', { id: 'sel-c', onchange: (e) => { location.hash = '#/regras/' + e.target.value; } }, cs.map((c) => h('option', { value: c.contrato_id, selected: c.contrato_id === id }, c.unidade)))),
      r.decisoes.map((q) => {
        const sel = q.opcoes ? h('select', { id: 'q-' + q.chave }, [h('option', { value: '' }, '— sem decisão —')].concat(q.opcoes.map((o) => h('option', { value: o.valor, selected: o.valor === q.valor }, o.rotulo)))) : h('textarea', { id: 'q-' + q.chave, rows: 2 }, q.valor || '');
        const just = h('input', { type: 'text', id: 'j-' + q.chave, value: q.justificativa || '', placeholder: 'Onde está escrito ou quem decidiu' });
        return h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('strong', null, q.pergunta), q.valor ? selo('decidida', 'ok') : selo('em aberto', 'atencao')),
          h('div', { class: 'duas', style: 'margin-top:10px' }, h('div', { class: 'campo' }, h('label', { for: 'q-' + q.chave }, 'Decisão'), sel), h('div', { class: 'campo' }, h('label', { for: 'j-' + q.chave }, 'Justificativa'), just)),
          q.decidido_por ? h('p', { class: 'peq mudo' }, 'Decidido por ' + q.decidido_por + ' em ' + fmt.data(q.decidido_em)) : null,
          pode ? h('button', { onclick: async () => { try { await api('PUT', '/api/ctai/contratos/' + id + '/decisoes/' + q.chave, { valor: sel.value, justificativa: just.value }); toast('Decisão registrada.'); regras(p); } catch (e) { toast(e.message, true); } } }, 'Registrar decisão') : null);
      }),
      h('div', { class: 'cartao' }, h('h3', null, 'Pontos em aberto na própria regra'), r.regraPendencias.length ? h('ul', null, r.regraPendencias.map((x) => h('li', null, h('strong', null, x.onde + ': '), x.texto))) : h('p', { class: 'mudo' }, 'Nenhum.')),
      h('div', { class: 'cartao' }, h('h3', null, 'Regra ' + tabelaRegra.versao), tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Faixas' }, { t: 'Máx.', n: true }], tabelaRegra.indicadores.map((i) => [i.id, i.nome, i.faixas, String(i.max)]))));
  }

  // ---------- Conteúdo da minuta (usado no parecer e na mesa) ----------
  const ROT_ALERTA = { sem_registro_sei: 'recebido no sistema sem registro de SEI', sei_versao_antiga: 'registro de SEI aponta versão antiga e existe versão mais nova no sistema', nova_versao_depois_sei: 'nova versão no sistema depois do SEI' };
  function renderSecao(id, c) {
    if (id === 'identificacao') { const i = c.identificacao; return h('div', { class: 'duas peq' }, [['Unidade', i.unidade], ['Organização social', i.oss], ['Contrato de Gestão', i.numero_cg], ['Trimestre', i.trimestre], ['Competências', i.competencias.join(', ')], ['Parecer nº', i.numero_parecer || 'a definir'], ['Regra', i.regra], ['Criado por', i.criador]].map(([k, v]) => h('div', null, h('span', { class: 'mudo' }, k + ': '), v || '—')), c.indicadores.competencias.filter((k) => k.checklist || k.prazos).map((k) => h('div', { style: 'grid-column:1/-1;margin-top:10px' }, h('strong', null, 'Checklist de recebimento · ' + fmt.comp(k.competencia)),
        k.prazos ? h('div', { class: 'peq' }, 'Prazos: ', seloPrazo(k.prazos.sei, 'SEI'), ' ', seloPrazo(k.prazos.simas, 'SIMAS')) : null,
        k.checklist ? [h('div', { class: 'peq mudo' }, 'Recebido em ' + dataBr(k.checklist.data_recebimento) + ' · responsável pelo envio: ' + (k.checklist.responsavel_envio || '—') + ' · ' + k.checklist.resumo.recebido + ' recebido(s), ' + k.checklist.resumo.incompleto + ' incompleto(s), ' + k.checklist.resumo.pendente + ' pendente(s)'),
          tabela([{ t: 'Item' }, { t: 'Status' }, { t: 'Validação' }, { t: 'Observações' }], k.checklist.itens.map((it) => [it.titulo, selo(it.status, STATUS_CK[it.status] || ''), it.validacao || 'não registrada', it.observacao || '']))] : null))); }
    if (id === 'sei') {
      const ms = c.indicadores.competencias;
      if (!ms.some((k) => k.canais)) return aviso('atencao', 'Esta versão foi congelada antes do vínculo com o SEI e não guardou os dados de apoio. Veja a aba Envios da competência.');
      return h('div', null, h('p', { class: 'peq' }, 'No SEI, abra o documento e veja o rodapé do PDF: deve estar escrito ', h('strong', null, 'Versão vN · código de integridade'), ' seguido do código curto abaixo. Se for outro, a unidade registrou a versão errada ou há versão mais nova.'),
        tabela([{ t: 'Mês' }, { t: 'Versão no sistema' }, { t: 'Código curto (rodapé do PDF)' }, { t: 'SEI registrado' }, { t: 'Alertas' }],
          ms.map((k) => { const cn = k.canais; if (!cn) return [k.competencia, '—', '—', '—', '—']; const s = cn.sistema, e = cn.sei;
            return [k.competencia, s ? 'v' + s.versao + ' · recebida em ' + fmt.data(s.recebido_em) : 'sem envio', s ? h('code', null, s.hash_curto) : '—',
              e ? h('span', null, 'nº ', h('strong', null, e.numero), e.de_versao_anterior ? ' (da v' + e.versao + ')' : '', e.registrado_por ? ' · por ' + e.registrado_por + ' em ' + fmt.data(e.registrado_em) : '') : h('span', { class: 'mudo' }, 'sem registro'),
              cn.alertas.length ? cn.alertas.map((a) => ROT_ALERTA[a] || a).join('; ') : 'nenhum']; }), { vazio: 'Sem competências.' }));
    }
    if (id === 'indicadores') return c.indicadores.competencias.map((k) => h('div', null, h('h3', null, fmt.comp(k.competencia) + (k.implantacao ? ' · implantação' : '') + ' · IGQ OSS ' + fmt.valor(k.igq.oss) + ' · recalculado ' + fmt.valor(k.igq.recalculado) + ' · adotado ' + fmt.valor(k.igq.adotado)),
      tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Valor OSS', n: true }, { t: 'Pts OSS', n: true }, { t: 'Valor CTAI', n: true }, { t: 'Pts CTAI', n: true }, { t: 'Adotado', n: true }, { t: 'Origem / justificativa' }],
        k.indicadores.map((i) => [i.id, i.nome, fmt.valor(i.valor_oss), fmt.valor(i.pontos_oss), fmt.valor(i.valor_ctai), fmt.valor(i.pontos_recalculados), h('strong', null, i.pontos_adotados === null ? '—' : i.pontos_adotados + ' / ' + i.max), (i.origem && i.origem !== 'recalculo' ? i.origem + ': ' : '') + (i.justificativa || '') + (i.motivo_do_zero ? ' · zero: ' + i.motivo_do_zero : '')]))));
    if (id === 'divergencias') return tabela([{ t: 'Mês' }, { t: 'Tema' }, { t: 'Declarado' }, { t: 'Recalculado' }, { t: 'Grav.' }, { t: 'Situação' }], c.divergencias.map((d) => [d.competencia, d.tema, d.declarado ?? '—', d.recalculado ?? '—', seloGrav(d.gravidade), d.status]), { vazio: 'Nenhuma divergência.' });
    if (id === 'desconto') { const d = c.desconto; return h('div', null, h('p', { class: 'peq' }, 'Base mensal ' + fmt.moeda(d.base) + ' · regra decidida: ' + (d.modo_decidido === 'fixo' ? '10% fixo abaixo de 90' : d.modo_decidido === 'faixa' ? 'tabela de faixas' : 'ainda não decidida')),
      d.base_nota ? aviso('atencao', 'Base a confirmar: ' + d.base_nota) : null,
      tabela([{ t: 'IGQ usado' }, { t: 'IGQ por mês' }, { t: '10% fixo', n: true }, { t: 'Tabela de faixas', n: true }], d.cenarios.map((x) => [x.origem, x.igqs.map((i) => i.igq).join(' / '), fmt.moeda(x.fixo.total), fmt.moeda(x.faixa.total)]), { vazio: 'Sem IGQ para calcular cenários.' }),
      d.adotado && d.adotado.total !== undefined ? h('p', null, h('strong', null, 'Desconto adotado: ' + fmt.moeda(d.adotado.total))) : aviso('atencao', 'O valor do desconto depende de decisões em aberto: ' + (d.decisoesAbertas.join(', ') || '—') + '.')); }
    if (id === 'alertas') { const a = c.alertas.recalculo.concat(c.alertas.integridade.map((e) => ({ competencia: e.competencia, gravidade: e.gravidade, mensagem: e.mensagem }))); return a.length ? h('ul', { class: 'peq' }, a.map((x) => h('li', null, seloGrav(x.gravidade), ' ', x.competencia + (x.indicador_id ? ' · item ' + x.indicador_id : '') + ': ' + x.mensagem))) : h('p', { class: 'mudo' }, 'Sem alertas.'); }
    if (id === 'texto') return ['abertura', 'analise', 'conclusao'].map((k) => h('div', null, h('h3', null, { abertura: 'Abertura', analise: 'Análise', conclusao: 'Conclusão' }[k]), h('p', { style: 'white-space:pre-wrap' }, c.texto[k] || '(sem texto)')));
    if (id === 'achados') return c.achados.length ? c.achados.map((a) => achadoCard(a)) : h('p', { class: 'mudo' }, 'Nenhum achado fixado.');
    return null;
  }

  // ---------- Pareceres ----------

  // Modelo do Parecer CTAI: seções numeradas, quadros e a revisão completa.
  function cartaoModelo(P, c, editavel, recarregar, def) {
    const base = '/api/ctai/pareceres/' + P.parecer_id;
    const M = c.modelo;
    if (!M) return h('div', { class: 'cartao', id: 'md-escolha' }, h('h2', null, '3. Parecer CTAI'), h('p', { class: 'peq mudo' }, 'Escolha como começar. O modelo padrão traz o texto-padrão com os dados da unidade e do período; a opção em branco deixa tudo para preencher à mão.'),
      editavel ? h('div', { class: 'linha' }, h('button', { id: 'md-padrao', onclick: async () => { try { await api('POST', base + '/modelo', { modo: 'padrao' }); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Modelo padrão com os dados'), h('button', { class: 'sec', id: 'md-branco', onclick: async () => { try { await api('POST', base + '/modelo', { modo: 'branco' }); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Em branco')) : null);
    const SEC = def.secoes;
    const areas = {}, tabs = {};
    const quadros = JSON.parse(JSON.stringify(M.quadros));
    const caixaRev = h('div', { id: 'md-revisao' });
    const lerTudo = () => ({ secoes: Object.fromEntries(Object.entries(areas).map(([k, el]) => [k, el.value])), quadros });
    const gravar = async () => { try { await api('PUT', base + '/modelo', lerTudo()); toast('Parecer salvo.'); recarregar(); } catch (e) { toast(e.message, true); } };
    const quadro = (q) => {
      const corpo = h('div');
      const av = q.id !== 'q3' ? h('div', { class: 'aviso-conexao', id: 'md-conectar-' + q.id }, aviso('atencao', 'Dados de produção não conectados. Este quadro será preenchido automaticamente quando a produção da unidade for conectada ou enviada; até lá, preencha à mão (opcional).')) : null;
      const pintar = () => { if (av) av.style.display = quadros[q.id].length ? 'none' : ''; corpo.replaceChildren(h('table', { class: 'tabela peq' }, h('thead', null, h('tr', null, q.colunas.map((x) => h('th', null, x)), editavel ? h('th') : null)),
        h('tbody', null, quadros[q.id].map((lin, i) => h('tr', null, q.colunas.map((_, j) => h('td', null, editavel ? h('input', { type: 'text', value: lin[j] || '', style: 'width:100%', oninput: (ev) => { lin[j] = ev.target.value; } }) : (lin[j] || ''))), editavel ? h('td', null, h('button', { class: 'leve', onclick: () => { quadros[q.id].splice(i, 1); pintar(); } }, 'Remover')) : null)))),
        editavel ? h('button', { class: 'sec', onclick: () => { quadros[q.id].push(q.colunas.map(() => '')); pintar(); } }, 'Adicionar linha') : null); };
      pintar();
      return h('div', { style: 'margin:12px 0' }, h('h4', null, q.titulo), av, corpo);
    };
    const preencherGaocg = async () => {
      troca(caixaRev, h('p', { class: 'mudo' }, 'Consultando o GAOCG…'));
      try {
        const o = await api('POST', base + '/modelo/gaocg', {});
        if (!o.encontrada) { troca(caixaRev, aviso('atencao', 'GAOCG conectado, mas não achei esta unidade/contrato no cadastro de lá (conferi pelo número do contrato e pelo nome).')); return; }
        troca(caixaRev, aviso('ok', 'GAOCG conectado · ' + (o.da_copia ? 'cópia de ' : 'lido agora, ') + new Date(o.lido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '. ' + (o.preenchidos.length ? 'Preenchi na seção 3: ' + o.preenchidos.join(', ') + '.' : 'Nada a atualizar na seção 3.')));
        if (o.preenchidos.length) setTimeout(recarregar, 1500);
      } catch (e) { troca(caixaRev, aviso('erro', e.message)); }
    };
    const revisar = async () => {
      troca(caixaRev, h('p', { class: 'mudo' }, 'Revisando: conferências locais, Analista, normas da unidade e busca externa… pode levar alguns segundos.'));
      try {
        await api('PUT', base + '/modelo', lerTudo());
        const o = await api('POST', '/api/analista/pareceres/' + P.parecer_id + '/revisao-completa', {});
        const ex = o.externa || {};
        troca(caixaRev, h('p', { class: 'peq mudo' }, o.achados.length + ' achado(s) · ' + o.provedor + (o.gaocg && o.gaocg.usado ? ' · conferido com o GAOCG (' + (o.gaocg.da_copia ? 'cópia de ' : 'lido às ') + new Date(o.gaocg.lido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ')' : '') + (o.normasDaUnidade ? ' · ' + o.normasDaUnidade + ' norma(s) da unidade consideradas' : '')),
          o.achados.length ? o.achados.map((a) => achadoCard(a)) : aviso('ok', 'Nenhum achado nas conferências locais e no Analista.'),
          h('h4', null, 'Busca externa (normas e jurisprudência)'),
          ex.ok ? [ex.aviso ? h('p', { class: 'peq mudo' }, ex.aviso) : h('p', { class: 'peq', style: 'white-space:pre-wrap' }, ex.resposta || ''), ex.fontes && ex.fontes.length ? h('ul', { class: 'peq' }, ex.fontes.map((f) => h('li', null, h('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, f.titulo)))) : null]
            : aviso('atencao', ex.motivo || 'Busca externa indisponível.'),
          h('p', { class: 'peq mudo' }, 'Para a busca externa só saem as citações de lei/decreto e os nomes dos indicadores; o texto do parecer não é enviado.'));
      } catch (e) { troca(caixaRev, aviso('erro', e.message)); }
    };
    return h('div', { class: 'cartao', id: 'md-cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, '3. Parecer CTAI' + (M.modo === 'branco' ? ' · em branco' : ' · modelo padrão')),
        editavel ? h('div', { class: 'linha' }, h('button', { class: 'sec', onclick: async () => { if (!(await confirmar('Refazer o texto', 'Isto substitui as seções pelo texto-padrão atual (com os dados do período). Edições feitas serão perdidas.', 'Refazer'))) return; try { await api('POST', base + '/modelo', { modo: 'padrao' }); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Refazer com os dados'), h('button', { class: 'sec', onclick: async () => { if (!(await confirmar('Esvaziar o parecer', 'Todas as seções ficam em branco.', 'Esvaziar'))) return; try { await api('POST', base + '/modelo', { modo: 'branco' }); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Deixar em branco')) : null),
      h('p', { class: 'peq mudo' }, 'Título: ' + def.titulo.replace('{numero}', c.identificacao.numero_parecer || 'xxx') + '. Edite cada seção; os quadros entram no PDF depois da seção 5.'),
      SEC.map((sc) => { areas[sc.id] = h('textarea', { id: 'md-' + sc.id, rows: Math.min(14, Math.max(3, Math.ceil((M.secoes[sc.id] || '').length / 90))) }, M.secoes[sc.id] || ''); if (!editavel) areas[sc.id].setAttribute('disabled', ''); return h('div', { class: 'campo' }, h('label', { for: 'md-' + sc.id }, sc.titulo), areas[sc.id], sc.id === 'analise' ? def.quadros.map(quadro) : null); }),
      editavel ? h('div', { class: 'linha' }, h('button', { id: 'md-salvar', onclick: gravar }, 'Salvar o parecer'), h('button', { class: 'sec', id: 'md-gaocg', onclick: preencherGaocg }, 'Preencher identificação pelo GAOCG'), h('button', { class: 'sec', id: 'md-revisar', onclick: revisar }, 'Revisão completa')) : h('button', { class: 'sec', onclick: revisar }, 'Revisão completa'),
      caixaRev);
  }

  async function pareceres() {
    const [lista, cs] = await Promise.all([api('GET', '/api/ctai/pareceres'), api('GET', '/api/ctai/contratos')]);
    const podeCriar = eh('criador');
    const formNovo = () => {
      const sel = h('select', { id: 'np-c' }, cs.contratos.map((c) => h('option', { value: c.contrato_id }, c.unidade)));
      const comps = h('div', { class: 'linha' });
      const pintar = () => { const c = cs.contratos.find((x) => x.contrato_id === sel.value); comps.replaceChildren(...c.competencias.map((k) => h('label', { style: 'font-weight:400;margin:0' }, h('input', { type: 'checkbox', value: k.competencia_id, checked: true }), ' ' + k.competencia_id))); };
      const tri = h('input', { type: 'text', id: 'np-t', placeholder: '2026-T2' });
      const sugerirTri = () => { const m = comps.querySelector('input:checked'); if (m && !tri.dataset.manual) { const [a, mm] = m.value.split('-'); tri.value = a + '-T' + Math.ceil(Number(mm) / 3); } };
      tri.addEventListener('input', () => { tri.dataset.manual = '1'; });
      sel.addEventListener('change', () => { pintar(); sugerirTri(); }); pintar(); sugerirTri();
      const branco = h('input', { type: 'checkbox', id: 'np-b' });
      const num = h('input', { type: 'text', id: 'np-n', placeholder: 'ex.: 204/2026' });
      return h('div', { class: 'cartao' }, h('h3', null, 'Novo parecer'), h('div', { class: 'duas' }, h('div', { class: 'campo' }, h('label', { for: 'np-c' }, 'Contrato'), sel), h('div', { class: 'campo' }, h('label', { for: 'np-t' }, 'Trimestre'), tri), h('div', { class: 'campo' }, h('label', null, 'Competências'), comps), h('div', { class: 'campo' }, h('label', { for: 'np-n' }, 'Número do parecer (se já tiver)'), num)),
        h('p', { class: 'peq mudo' }, 'Documento: Parecer Técnico CTAI. O texto-padrão já vem preenchido com os dados da unidade e do período.'), h('label', { style: 'font-weight:400' }, branco, ' Começar em branco (preenchimento manual)'),
        h('button', { onclick: async () => { try { const o = await api('POST', '/api/ctai/pareceres', { contrato_id: sel.value, trimestre: tri.value, numero_parecer: num.value, competencias: [...comps.querySelectorAll('input:checked')].map((x) => x.value) }); await api('POST', '/api/ctai/pareceres/' + o.parecer_id + '/modelo', { modo: branco.checked ? 'branco' : 'padrao' }); location.hash = '#/p/' + o.parecer_id; } catch (e) { toast(e.message, true); } } }, 'Criar a minuta'));
    };
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Pareceres'), h('p', null, 'Quem cria monta e congela; os colegas conferem; a superintendente autoriza; quem criou anexa no SEI.'))),
      podeCriar || ehAdmin() ? formNovo() : aviso('info', 'Só o perfil criador abre uma minuta nova.'),
      h('div', { class: 'cartao' }, tabela([{ t: 'Parecer' }, { t: 'Unidade' }, { t: 'Trimestre' }, { t: 'Criado por' }, { t: 'Versão' }, { t: 'Situação' }], lista.pareceres.map((p) => [h('a', { href: '#/p/' + p.parecer_id }, p.titulo), p.unidade + (p.demo ? ' (demo)' : ''), p.trimestre, p.criador_nome, p.ultimaVersao ? 'v' + p.ultimaVersao.numero + ' · ' + p.ultimaVersao.status : '—', selo(p.status, p.status === 'anexado ao SEI' ? 'ok' : 'atencao')]), { vazio: 'Nenhum parecer ainda.' })));
  }

  async function parecer(p) {
    const d = await api('GET', '/api/ctai/pareceres/' + p.id);
    const P = d.parecer, c = d.conteudoAtual, eCriador = d.voce.eCriador;
    const travado = P.status === 'anexado ao SEI';
    const ult = d.ultima ? d.ultima.versao : null;
    const textos = {};
    const area = (k, rotulo) => { textos[k] = h('textarea', { id: 't-' + k, rows: 5 }, c.texto[k] || ''); if (!eCriador || travado) textos[k].setAttribute('disabled', ''); return h('div', { class: 'campo' }, h('label', { for: 't-' + k }, rotulo), textos[k]); };
    const salvarTexto = async () => { try { await api('PUT', '/api/ctai/pareceres/' + P.parecer_id + '/texto', { texto: Object.fromEntries(Object.entries(textos).map(([k, el]) => [k, el.value])) }); toast('Texto salvo.'); parecer(p); } catch (e) { toast(e.message, true); } };
    const nCol = d.colegasDisponiveis;
    const marcados = nCol.map((u) => h('input', { type: 'checkbox', value: u.usuario_id, checked: true, id: 'cv-' + u.usuario_id }));
    const motivo = h('textarea', { id: 'cv-motivo', rows: 2, placeholder: ult ? 'O que mudou desde a versão ' + ult.numero + '?' : 'Opcional na primeira versão' });
    const achadosMin = h('div');
    montar(demo(P.demo), migalha(h('a', { href: '#/pareceres' }, 'Pareceres'), P.titulo),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, P.titulo), h('p', null, P.unidade + ' · ' + P.trimestre + (P.numero_parecer ? ' · parecer ' + P.numero_parecer : ''))), h('div', { class: 'linha' }, selo(P.status, P.status === 'anexado ao SEI' || P.status === 'autorizado' ? 'ok' : 'atencao'), ult ? h('a', { class: 'btn', href: '#/v/' + ult.versao_id }, 'Abrir a mesa (v' + ult.numero + ')') : null)),
      d.alteradoDesdeCongelamento && ult && !travado ? aviso('atencao', h('strong', null, 'A minuta mudou desde a versão ' + ult.numero + '. '), 'Para os colegas conferirem a mudança, congele uma nova versão com o motivo.') : null,
      !eCriador ? aviso('info', 'Você vê esta minuta, mas só quem a criou altera. Para conferir, abra a mesa.') : null,
      h('div', { class: 'cartao' }, h('h2', null, '1. Indicadores e pontos'), h('p', { class: 'mudo peq' }, 'O ponto adotado começa igual ao recálculo. Para mudar, use "Ajustar" e explique: o motivo fica na trilha e na mesa.'), c.indicadores.competencias.map((k) => h('div', { style: 'margin-bottom:14px' },
        h('h3', null, fmt.comp(k.competencia) + (k.implantacao ? ' · implantação' : '') + ' · IGQ OSS ' + fmt.valor(k.igq.oss) + ' · recalculado ' + fmt.valor(k.igq.recalculado) + ' · adotado ' + fmt.valor(k.igq.adotado)),
        tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Pts OSS', n: true }, { t: 'Pts CTAI', n: true }, { t: 'Adotado', n: true }, { t: 'Origem / justificativa' }, { t: '' }],
          k.indicadores.map((i) => [i.id, i.nome, fmt.valor(i.pontos_oss), fmt.valor(i.pontos_recalculados), h('strong', null, i.pontos_adotados === null ? '—' : i.pontos_adotados + ' / ' + i.max), (i.origem && i.origem !== 'recalculo' ? i.origem + ': ' : '') + (i.justificativa || '') + (i.motivo_do_zero ? ' · zero: ' + i.motivo_do_zero : ''),
            eCriador && !travado && k.envio ? h('button', { class: 'leve', onclick: () => ajustar(P, k, i, p) }, 'Ajustar') : null])))),
        c.indicadores.competencias.some((k) => !k.envio) ? h('p', { class: 'mudo peq' }, 'Meses sem envio pelo portal usam os totais da carga (somente leitura).') : null),
      h('div', { class: 'cartao' }, h('h2', null, '2. Divergências, desconto e alertas'), h('p', { class: 'peq' }, c.divergencias.length + ' divergência(s) (' + c.divergencias.filter((x) => x.status === 'aberta').length + ' abertas) · ' + c.alertas.recalculo.length + ' alerta(s) do recálculo'), renderSecao('desconto', c),
        c.desconto.decisoesAbertas.length ? h('p', { class: 'peq' }, h('a', { href: '#/regras/' + P.contrato_id }, 'Decidir as dúvidas de regra')) : null),
      cartaoModelo(P, c, eCriador && !travado, () => parecer(p), d.modeloDef),
      c.modelo ? null : h('div', { class: 'cartao' }, h('h2', null, '3b. Texto livre (formato antigo)'),
        area('abertura', 'Abertura'), area('analise', 'Análise'), area('conclusao', 'Conclusão'),
        eCriador && !travado ? h('div', { class: 'linha' }, h('button', { onclick: salvarTexto }, 'Salvar o texto'), h('button', { class: 'sec', onclick: async () => { const s = await api('POST', '/api/ctai/pareceres/' + P.parecer_id + '/rascunho-texto', { aplicar: true }); toast('Sugestão aplicada nos campos vazios.'); void s; parecer(p); } }, 'Sugerir texto a partir dos números'),
          h('button', { class: 'sec', onclick: async () => { try { troca(achadosMin, h('p', { class: 'mudo' }, 'Lendo…')); const o = await api('POST', '/api/analista/pareceres/' + P.parecer_id + '/analisar', {}); troca(achadosMin, h('p', { class: 'peq mudo' }, o.achados.length + ' ponto(s) · ' + o.provedor), o.achados.length ? o.achados.map((a) => achadoCard(a)) : aviso('ok', 'O Analista não apontou nada no texto.')); } catch (e) { troca(achadosMin, aviso('erro', e.message)); } } }, 'Pedir ao Analista que leia o texto')) : null, achadosMin),
      c.achados.length ? h('div', { class: 'cartao' }, h('h2', null, '4. Achados do Analista fixados (' + c.achados.length + ')'), c.achados.map((a) => achadoCard(a))) : null,
      eCriador && !travado ? h('div', { class: 'cartao' }, h('h2', null, ult ? 'Congelar nova versão' : 'Congelar a primeira versão'),
        h('p', { class: 'peq mudo' }, 'Ao congelar, a versão não muda mais: os colegas conferem exatamente o que está aqui. Escolha quem confere (a superintendente confere por último, na mesa).'),
        nCol.length ? h('div', { class: 'linha' }, nCol.map((u, i) => h('label', { style: 'font-weight:400;margin:0' }, marcados[i], ' ' + u.nome))) : aviso('erro', 'Não há colegas conferentes cadastrados.'),
        h('div', { class: 'campo', style: 'margin-top:10px' }, h('label', { for: 'cv-motivo' }, 'Motivo da versão'), motivo),
        h('button', { disabled: !nCol.length, onclick: async () => { try { const o = await api('POST', '/api/ctai/pareceres/' + P.parecer_id + '/congelar', { convocados: marcados.filter((x) => x.checked).map((x) => Number(x.value)), motivo: motivo.value }); toast('Versão congelada.'); location.hash = '#/v/' + o.versao_id; } catch (e) { toast(e.message, true); } } }, 'Congelar e enviar para conferência')) : null,
      ult && ult.status === 'autorizada' && eCriador && !travado ? h('div', { class: 'cartao' }, h('h2', null, 'Anexar no SEI'), aviso('info', 'Baixe o PDF da versão autorizada, anexe e assine no SEI (fora deste sistema, com a sua própria senha do SEI). Depois registre aqui o número do documento.'),
        h('div', { class: 'linha' }, pdfLink('/api/ctai/versoes/' + ult.versao_id + '/pdf', 'Abrir o PDF da versão autorizada'), h('button', { onclick: async () => { const n = await perguntar('Registrar o número no SEI', 'Número do documento no SEI', { dica: 'ex.: 12345678', botao: 'Registrar' }); if (!n) return; try { await api('POST', '/api/ctai/pareceres/' + P.parecer_id + '/sei', { numero: n }); toast('Registrado.'); parecer(p); } catch (e) { toast(e.message, true); } } }, 'Registrar o número do SEI'))) : null,
      P.sei_numero ? aviso('ok', 'Anexado ao SEI: documento ' + P.sei_numero + ' em ' + fmt.data(P.sei_anexado_em) + ' por ' + P.sei_anexado_por + '.') : null,
      h('div', { class: 'cartao' }, h('h3', null, 'Versões'), tabela([{ t: 'Versão', n: true }, { t: 'Congelada em' }, { t: 'Situação' }, { t: 'Motivo' }, { t: 'Código' }, { t: '' }], d.versoes.map((v) => ['v' + v.numero, fmt.data(v.criada_em), selo(v.status, v.status === 'autorizada' ? 'ok' : ''), v.motivo || '—', v.hash.slice(0, 12), h('a', { href: '#/v/' + v.versao_id }, 'Abrir')]), { vazio: 'Nenhuma versão congelada.' })));
  }

  async function ajustar(P, k, i, p) {
    const pontos = h('input', { type: 'number', id: 'aj-p', min: 0, max: i.max, step: 1, value: i.pontos_adotados ?? '' });
    const origem = h('select', { id: 'aj-o' }, [['ajuste manual', 'Ajuste manual (explique)'], ['parecer', 'Valor do parecer (explique)'], ['declarado', 'Aceitar o que a unidade declarou'], ['recalculo', 'Voltar ao recálculo']].map(([v, r]) => h('option', { value: v, selected: v === (i.origem && i.origem !== 'recalculo' ? i.origem : 'ajuste manual') }, r)));
    const just = h('textarea', { id: 'aj-j', rows: 2 }, i.justificativa || ''), zero = h('input', { type: 'text', id: 'aj-z', value: i.motivo_do_zero || '' });
    const ok = await janela('Item ' + i.id + ' · ' + fmt.comp(k.competencia), h('div', null, h('p', { class: 'peq' }, i.nome + '. Recalculado: ' + fmt.valor(i.pontos_recalculados) + ' · máximo ' + i.max + '.'),
      h('div', { class: 'campo' }, h('label', { for: 'aj-o' }, 'Origem do ponto'), origem), h('div', { class: 'campo' }, h('label', { for: 'aj-p' }, 'Pontos adotados'), pontos),
      h('div', { class: 'campo' }, h('label', { for: 'aj-j' }, 'Justificativa'), just), h('div', { class: 'campo' }, h('label', { for: 'aj-z' }, 'Motivo do zero (se for zero)'), zero)), [{ rotulo: 'Cancelar', valor: false, sec: true }, { rotulo: 'Salvar', valor: true }]);
    if (!ok) return;
    try { await api('POST', '/api/ctai/pareceres/' + P.parecer_id + '/adotar', { cid: k.cid, indicador_id: i.id, pontos: pontos.value, origem: origem.value === 'declarado' ? 'declarado' : origem.value, justificativa: just.value, motivo_do_zero: zero.value }); toast('Ponto adotado atualizado.'); parecer(p); } catch (e) { toast(e.message, true); }
  }

  // ---------- Mesa de conferência ----------
  async function mesa(p) {
    const v = await api('GET', '/api/ctai/versoes/' + p.id);
    const V = v.versao, c = v.conteudo;
    const ativo = !['autorizada', 'substituída'].includes(V.status);
    const euCriador = V.criada_por === EU.usuario_id;
    const euConvocado = V.convocados.some((x) => x.usuario_id === EU.usuario_id);
    const posso = ativo && !euCriador && ((['colega', 'criador'].includes(EU.perfil) && euConvocado) || EU.perfil === 'superintendente');
    const minhas = (it) => it.registros.find((r) => r.usuario_id === EU.usuario_id);
    const marcar = async (item, status) => { let comentario = null; if (status === 'reparo') { comentario = await perguntar('Reparo: ' + item.titulo, 'O que precisa mudar?', { longo: true, botao: 'Registrar reparo' }); if (!comentario) return; } try { await api('POST', '/api/ctai/versoes/' + V.versao_id + '/conferir', { item: item.id, status, comentario }); mesa(p); } catch (e) { toast(e.message, true); } };
    const todosOkMeus = v.itens.every((i) => { const m = minhas(i); return m && m.status === 'ok'; });
    montar(demo(c.identificacao.demo), migalha(h('a', { href: '#/pareceres' }, 'Pareceres'), h('a', { href: '#/p/' + V.parecer_id }, c.identificacao.titulo), 'Mesa v' + V.numero),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Mesa de conferência · versão ' + V.numero), h('p', null, c.identificacao.unidade + ' · ' + c.identificacao.trimestre + ' · criada por ' + V.criada_por_nome + ' em ' + fmt.data(V.criada_em))), selo(V.status, V.status === 'autorizada' ? 'ok' : (V.status === 'com reparo' ? 'alta' : 'atencao'))),
      aviso('info', h('strong', null, 'O OK da mesa é controle interno, não é assinatura. '), 'A assinatura é feita no SEI. Ninguém confere nem autoriza o próprio trabalho. Código de integridade desta versão: ', h('code', null, V.hash.slice(0, 16))),
      V.motivo ? h('p', { class: 'peq' }, h('strong', null, 'Motivo desta versão: '), V.motivo) : null,
      h('p', { class: 'peq' }, h('strong', null, 'Convocados: '), V.convocados.map((x) => x.nome).join(', '), ' · superintendente: confere por último e autoriza.'),
      V.status === 'substituída' ? aviso('erro', 'Esta versão foi substituída. Confira a mais recente na página do parecer.') : null,
      !posso && ativo ? aviso('info', euCriador ? 'Você criou esta versão e por isso não confere.' : 'Você não está entre os convocados para esta versão.') : null,
      v.itens.map((it) => { const m = minhas(it); return h('div', { class: 'item-mesa ' + (it.reparo ? 'reparo' : (it.conferido ? 'ok' : '')) },
        h('div', { class: 'linha espaco' }, h('strong', null, it.titulo), h('div', { class: 'linha' }, selo(it.colegasOk + ' de ' + it.colegasTotal + ' colegas', it.conferido ? 'ok' : ''), it.reparo ? selo('reparo', 'alta') : null)),
        h('p', { class: 'mudo peq', style: 'margin:2px 0 8px' }, it.ajuda),
        h('details', { open: it.id === 'sei' }, h('summary', { style: 'cursor:pointer;color:var(--acento);font-weight:500' }, it.id === 'sei' ? 'Dados de apoio: versão, código e número do SEI' : 'Ver o conteúdo desta versão'), h('div', { style: 'margin-top:10px' }, renderSecao(it.id, c))),
        it.registros.length ? h('ul', { class: 'peq' }, it.registros.map((r) => h('li', null, h('strong', null, r.nome), ' (' + r.papel + '): ', selo(r.status, r.status === 'ok' ? 'ok' : 'alta'), r.comentario ? ' ' + r.comentario : '', h('span', { class: 'mudo' }, ' · ' + fmt.data(r.data_hora))))) : null,
        posso ? h('div', { class: 'linha', style: 'margin-top:8px' }, h('button', { disabled: m && m.status === 'ok', onclick: () => marcar(it, 'ok') }, m && m.status === 'ok' ? 'Você deu OK' : 'OK'), h('button', { class: 'sec', onclick: () => marcar(it, 'reparo') }, 'Pedir reparo')) : null); }),
      h('div', { class: 'cartao' }, h('h3', null, 'Autorização e documento'),
        h('div', { class: 'linha' }, pdfLink('/api/ctai/versoes/' + V.versao_id + '/pdf', 'Abrir o PDF desta versão'),
          EU.perfil === 'superintendente' && ativo && !euCriador ? h('button', { disabled: V.status !== 'conferida' || !todosOkMeus, onclick: async () => { if (!(await confirmar('Autorizar a versão ' + V.numero + '?', 'Isto é o seu OK interno. Depois, a assinatura é feita no SEI. A versão fica congelada.', 'Autorizar'))) return; try { await api('POST', '/api/ctai/versoes/' + V.versao_id + '/autorizar', {}); toast('Versão autorizada.'); mesa(p); } catch (e) { toast(e.message, true); } } }, 'Autorizar esta versão') : null),
        EU.perfil === 'superintendente' && ativo && (V.status !== 'conferida' || !todosOkMeus) ? h('p', { class: 'peq mudo' }, V.status !== 'conferida' ? 'Falta a conferência dos colegas convocados (ou há reparo aberto).' : 'Confira você mesma todos os itens (OK em cada um) antes de autorizar.') : null,
        V.status === 'autorizada' ? aviso('ok', 'Autorizada por ' + V.autorizada_por_nome + ' em ' + fmt.data(V.autorizada_em) + '. Quem criou o parecer anexa e assina no SEI e registra o número na página do parecer.') : null));
  }

  // ---------- Analista ----------
  const ABAS_AN = [['', 'Fila'], ['relatorio', 'Relatório trimestral'], ['conferencia', 'Conferência com o acervo'], ['ler', 'Ler um texto'], ['normas', 'Normas por unidade']];
  async function analista(p) {
    const aba = (p && p.aba) || '';
    const topo = [h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Analista CTAI'), h('p', null, 'Lê o que a unidade enviou, confere contra o recálculo e o acervo, aponta o que merece esclarecimento e monta o relatório trimestral. Quem decide é a equipe.'))),
      h('div', { class: 'abas' }, ABAS_AN.map(([k, r]) => h('a', { href: '#/analista' + (k ? '/' + k : ''), class: aba === k ? 'ativo' : '' }, r)))];
    const corpo = { '': anFila, relatorio: anRelatorio, conferencia: anConferencia, ler: anLer, normas: anNormas }[aba];
    if (!corpo) throw new Error('Página não encontrada.');
    montar(topo, await corpo());
  }

  async function anFila() {
    const pn = await api('GET', '/api/analista/painel');
    const c = pn.contagens;
    const recarregar = () => analista({ aba: '' });
    return [
      h('div', { class: 'kpis' }, kpi('Novos', String(c.novo), 'a decidir'), kpi('Aguardando a unidade', String(c.encaminhado), c.vencidos ? c.vencidos + ' com prazo vencido' : 'dentro do prazo'), kpi('Respondidos', String(c.respondido), 'a avaliar'), kpi('Fixados na mesa', String(c.fixado)), kpi('Normas vigentes', String(pn.normas))),
      h('div', { class: 'cartao' }, h('h3', null, 'O que pede ação'),
        pn.fila.length ? pn.fila.map((a) => achadoCard(a, recarregar)) : h('p', { class: 'vazio' }, 'Nada pendente. Os achados aparecem aqui quando a unidade envia um relatório ou quando você lê um texto e o guarda numa competência.'))];
  }

  async function anRelatorio() {
    const pn = await api('GET', '/api/analista/painel');
    const un = h('select', { id: 'rt-u' }, pn.contratos.map((c) => h('option', { value: c.contrato_id }, c.unidade)));
    const ano = new Date().getFullYear();
    const tri = h('select', { id: 'rt-t' }, [1, 2, 3, 4].map((t) => h('option', { value: ano + '-T' + t, selected: t === Math.ceil((new Date().getMonth() + 1) / 3) }, ano + ' · ' + t + 'º trimestre')));
    const num = h('input', { id: 'rt-n', placeholder: 'Ex.: 204/2026 (opcional)' });
    const out = h('div');
    const montarRel = async () => {
      try {
        const o = await api('POST', '/api/analista/relatorio-trimestral', { contrato_id: un.value, trimestre: tri.value, numero_parecer: num.value || null });
        troca(out, aviso('ok', (o.jaExistia ? 'Já existia uma minuta deste trimestre; completei só os trechos vazios. ' : 'Minuta aberta com as competências ' + o.competencias.join(', ') + '. '), o.faltam.length ? 'Sem competência cadastrada em: ' + o.faltam.join(', ') + '. ' : '', h('a', { href: '#/p/' + o.parecer_id }, 'Abrir para editar e congelar')));
      } catch (e) { troca(out, aviso('erro', e.message)); }
    };
    return [h('div', { class: 'cartao' }, h('h3', null, 'Montar o relatório trimestral da unidade'),
      h('p', { class: 'peq mudo' }, 'O Analista reúne as competências do trimestre, traz os números conferidos (declarado × recalculado × adotado), as divergências, o desconto e os achados fixados, e escreve uma primeira versão do texto. Você edita à vontade. Ao congelar, a versão fica imutável, passa pela mesa de conferência e sai em PDF.'),
      h('div', { class: 'grade' }, h('div', { class: 'campo' }, h('label', { for: 'rt-u' }, 'Unidade'), un), h('div', { class: 'campo' }, h('label', { for: 'rt-t' }, 'Trimestre'), tri), h('div', { class: 'campo' }, h('label', { for: 'rt-n' }, 'Número do parecer'), num)),
      EU.perfil === 'criador' || EU.perfil === 'admin' ? h('button', { onclick: montarRel }, 'Montar a minuta') : aviso('info', 'Só quem cria o parecer (perfil criador) monta a minuta.'), out)];
  }

  async function anConferencia() {
    const pn = await api('GET', '/api/analista/painel');
    const saida = h('div');
    const conferir = async (cid) => {
      troca(saida, h('p', { class: 'mudo' }, 'Comparando com o acervo…'));
      try {
        const o = await api('POST', '/api/analista/competencias/' + cid + '/acervo/conferir', {});
        troca(saida, h('div', { class: 'cartao' }, h('h3', null, 'Resultado'), h('p', { class: 'peq mudo' }, 'Fonte: ' + o.fonte + ' · ' + o.comparados + ' indicador(es) comparado(s) · ' + o.divergentes + ' divergente(s). As divergências foram para a aba Divergências da competência.'),
          tabela([{ t: 'Item' }, { t: 'No sistema da CTAI', n: true }, { t: 'No acervo', n: true }, { t: 'Diferença', n: true }, { t: 'Situação' }], o.itens.map((x) => [x.indicador_id, fmt.valor(x.sistema), fmt.valor(x.acervo), fmt.valor(x.diferenca), x.confere ? selo('confere', 'ok') : selo('divergente', 'atencao')]), { vazio: 'Nenhum indicador em comum.' })));
      } catch (e) { troca(saida, aviso('erro', e.message)); }
    };
    return [aviso('info', 'O acervo é uma fonte ', h('strong', null, 'opcional'), ' de conferência (SIMAS ou outro banco da SES), só leitura. O sistema compara o que a unidade enviou, já recalculado pela CTAI, com o que o acervo tem do mesmo mês.'),
      pn.contratos.map((c) => h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, c.unidade, ' ', c.demo ? selo('demonstração', 'demo') : null),
        c.acervo && c.acervo.ativo ? selo('acervo ativo' + (c.acervo.ultima_sync ? ' · última conferência ' + fmt.data(c.acervo.ultima_sync) : ''), 'ok') : selo('acervo não configurado')),
        c.competencias.length ? tabela([{ t: 'Mês' }, { t: 'Situação' }, { t: '' }], c.competencias.map((k) => [fmt.comp(k.competencia_id), k.status, k.temEnvio && c.acervo && c.acervo.ativo && EU.perfil !== 'colega' ? h('button', { class: 'sec', onclick: () => conferir(k.cid) }, 'Conferir com o acervo') : h('span', { class: 'mudo peq' }, k.temEnvio ? 'sem acervo ativo' : 'sem envio')])) : h('p', { class: 'vazio' }, 'Sem competências.'))),
      saida];
  }

  async function anLer() {
    const cs = await api('GET', '/api/ctai/contratos');
    const comp = h('select', { id: 'an-c' }, [h('option', { value: '' }, '— sem competência (só o texto) —')].concat(cs.contratos.flatMap((c) => c.competencias.map((k) => h('option', { value: k.cid }, c.unidade + ' · ' + k.competencia_id)))));
    const texto = h('textarea', { id: 'an-t', rows: 12, placeholder: 'Cole aqui o texto do relatório da OSS (copiado do PDF ou do Word).' });
    const guardar = h('input', { type: 'checkbox', id: 'an-g' });
    const saida = h('div');
    const analisar = async () => {
      troca(saida, h('p', { class: 'mudo' }, 'Lendo o documento…'));
      try {
        const o = await api('POST', '/api/analista/analisar', { texto: texto.value, cid: comp.value || null, salvar: guardar.checked });
        troca(saida, h('p', { class: 'mudo peq' }, o.achados.length + ' ponto(s) a conferir · lido por: ' + o.provedor + (o.salvos ? ' · ' + o.salvos + ' guardado(s) na competência' : '')),
          o.tentativas.length ? h('p', { class: 'mudo peq' }, 'Provedores tentados: ' + o.tentativas.map((t) => t.provedor + (t.ok ? ' (ok)' : ' (' + t.erro + ')')).join(' · ')) : null,
          o.achados.length ? o.achados.map((a) => achadoCard(a)) : aviso('ok', 'O Analista não encontrou inconsistências neste texto. Isso não substitui a conferência humana.'));
      } catch (e) { troca(saida, aviso('erro', e.message)); }
    };
    return [h('div', { class: 'cartao' }, h('h3', null, 'Analisar um texto'), aviso('atencao', 'Não cole dados de paciente. Se colar por engano, CPF, cartão SUS, e-mail e telefone são mascarados antes de qualquer envio à nuvem.'),
      h('div', { class: 'campo' }, h('label', { for: 'an-c' }, 'Competência (dá o contexto: mês, valores por cor, transparência)'), comp), h('div', { class: 'campo' }, h('label', { for: 'an-t' }, 'Texto do documento'), texto),
      h('div', { class: 'linha' }, h('button', { onclick: analisar }, 'Analisar'), h('label', { style: 'font-weight:400;margin:0' }, guardar, ' Guardar os achados na competência (para fixar na mesa ou encaminhar à unidade)')), saida)];
  }

  async function anNormas() {
    const [cs, rn] = await Promise.all([api('GET', '/api/ctai/contratos'), api('GET', '/api/analista/normas')]);
    const nomeContrato = Object.fromEntries(cs.contratos.map((c) => [c.contrato_id, c.unidade]));
    const podeEditar = ['criador', 'admin', 'superintendente'].includes(EU.perfil);
    const busca = h('input', { type: 'search', id: 'nb', placeholder: 'Buscar por palavra (ex.: transparência, prazo, transferência)', 'aria-label': 'Buscar normas' });
    const lista = h('div');
    const desenhar = async () => {
      const r = await api('GET', '/api/analista/normas?q=' + encodeURIComponent(busca.value));
      troca(lista, tabela([{ t: 'Norma' }, { t: 'Vale para' }, { t: 'Tema' }, { t: 'Situação' }, { t: '' }], r.normas.map((n) => [
        h('div', null, h('strong', null, n.titulo), n.referencia ? h('div', { class: 'peq mudo' }, n.referencia) : null, h('div', { class: 'peq' }, n.texto.length > 220 ? n.texto.slice(0, 220) + '…' : n.texto)),
        n.contrato_id ? nomeContrato[n.contrato_id] || n.contrato_id : 'todas as unidades', n.tema || '—', n.vigente ? selo('vigente', 'ok') : selo('revogada'),
        podeEditar ? h('button', { class: 'leve', onclick: async () => { try { await api('PATCH', '/api/analista/normas/' + n.norma_id, { vigente: !n.vigente, motivo: n.vigente ? 'Marcada como revogada' : 'Marcada como vigente' }); desenhar(); } catch (e) { toast(e.message, true); } } }, n.vigente ? 'Marcar como revogada' : 'Marcar como vigente') : '']), { vazio: 'Nenhuma norma encontrada.' }));
    };
    busca.addEventListener('input', () => { clearTimeout(busca._t); busca._t = setTimeout(desenhar, 250); });
    const nova = async () => {
      const un = h('select', { id: 'nn-u' }, [h('option', { value: '' }, 'Todas as unidades')].concat(cs.contratos.map((c) => h('option', { value: c.contrato_id }, c.unidade))));
      const tit = h('input', { id: 'nn-t' }), ref = h('input', { id: 'nn-r', placeholder: 'Ex.: cláusula, portaria, item da regra' }), tema = h('input', { id: 'nn-m' }), txt = h('textarea', { id: 'nn-x', rows: 6 }), msg = h('div', { class: 'msg-erro' });
      const corpo = h('div', null, h('div', { class: 'campo' }, h('label', { for: 'nn-u' }, 'Vale para'), un), h('div', { class: 'campo' }, h('label', { for: 'nn-t' }, 'Título'), tit), h('div', { class: 'campo' }, h('label', { for: 'nn-r' }, 'Referência'), ref),
        h('div', { class: 'campo' }, h('label', { for: 'nn-m' }, 'Tema'), tema), h('div', { class: 'campo' }, h('label', { for: 'nn-x' }, 'Texto ou resumo'), txt), msg);
      for (;;) {
        const r = await janela('Nova norma', corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Guardar', valor: 'ok' }]);
        if (r !== 'ok') return;
        try { await api('POST', '/api/analista/normas', { contrato_id: un.value || null, titulo: tit.value, referencia: ref.value, tema: tema.value, texto: txt.value }); toast('Norma guardada.'); desenhar(); return; } catch (e) { msg.textContent = e.message; }
      }
    };
    await desenhar();
    return [h('div', { class: 'linha espaco' }, h('p', { class: 'mudo', style: 'margin:0' }, 'O que vale para cada unidade. O Analista sugere as normas mais ligadas a cada achado; é apoio de consulta, não parecer jurídico. Cole o texto vigente do contrato.'), podeEditar ? h('button', { onclick: nova }, 'Nova norma') : null),
      h('div', { class: 'campo', style: 'margin-top:12px' }, h('label', { for: 'nb' }, 'Buscar'), busca), h('div', { class: 'cartao' }, lista)];
  }

  // ---------- Integrações ----------
  async function integracoes() {
    const r = await api('GET', '/api/integracoes');
    const cs = (await api('GET', '/api/ctai/contratos')).contratos;
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Integrações'), h('p', null, 'Rack para ligar o sistema da unidade (MV). Aguardando acesso e dicionário de campos.'))),
      aviso('info', h('strong', null, 'Como funciona: '), 'o sistema busca as linhas pela API, confere cada uma (dado pessoal é recusado), e guarda como lote pendente. O gestor da unidade confirma. Só então entram no cálculo. As credenciais ficam no .env do servidor, nunca no banco.'),
      await cartaoGaocg(),
      r.tipos.map((t) => h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('strong', null, t.nome), selo(t.estado, t.estado === 'ativa' ? 'ok' : 'atencao')), h('p', { class: 'mudo peq', style: 'margin:4px 0 0' }, t.descricao))),
      r.integracoes.map((i) => cartaoIntegracao(i, cs)),
      r.mapeamento ? h('div', { class: 'cartao' }, h('h3', null, 'Mapeamento de campos (versão ' + r.mapeamento.versao + ')'), r.mapeamento.aviso ? aviso('atencao', r.mapeamento.aviso) : null, tabela([{ t: 'Fonte' }, { t: 'Endereço' }, { t: 'Campos', n: true }], r.mapeamento.fontes.map((f) => [f.fonte, f.endpoint, String(f.campos)])), h('p', { class: 'peq mudo' }, 'Arquivo: adapters/mv/mapeamento.json. Cada campo diz de qual campo da API vem e como converter (data, hora, segundos para minutos, sim/não, tabela de valores).')) : null);
  }

  // GAOCG: só leitura, só a CTAI. O estado aparece aqui e, de forma discreta, nas telas que usam o GAOCG.
  async function cartaoGaocg() {
    const est = await api('GET', '/api/gaocg/estado').catch(() => null);
    if (!est) return null;
    const saida = h('div', { id: 'gc-saida' });
    const recarregar = () => integracoes();
    const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
    const t = est.teste;
    const situ = !est.configurada ? ['Não configurado', 'atencao'] : t ? (t.ok ? ['Conectado', 'ok'] : ['Falhou no último teste', 'alta']) : ['Configurado, ainda não testado', 'atencao'];
    const agir = async (rotulo, fn) => { troca(saida, h('p', { class: 'mudo' }, rotulo + '…')); try { await fn(); } catch (e) { troca(saida, aviso('erro', e.message)); } };
    return h('div', { class: 'cartao', id: 'gc-cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, 'GAOCG · leitura de unidades, SOF, empenhos e recibos'), selo(situ[0], situ[1])),
      h('p', { class: 'mudo peq' }, 'Só leitura e só para a equipe CTAI: a unidade nunca acessa. A chave fica nas variáveis do servidor (GAOCG_API_URL e GAOCG_API_CHAVE) e não aparece em tela nem em log.'),
      t ? h('p', { class: 'peq' }, 'Último teste: ' + quando(t.em) + (t.ok ? ' · ' + t.ms + ' ms' : '') + ' · ' + t.mensagem) : null,
      est.ultimo_uso ? h('p', { class: 'peq mudo' }, 'Última leitura: ' + quando(est.ultimo_uso.em) + ' por ' + (est.ultimo_uso.por || '—')) : null,
      est.copias.length ? h('p', { class: 'peq mudo' }, 'Cópia local: ' + est.copias.map((c) => c.endpoint.replace('api_', '') + ' (' + c.total + ' linhas, ' + quando(c.lido_em) + ')').join(' · ')) : null,
      est.configurada ? h('div', { class: 'linha' },
        h('button', { class: 'sec', id: 'gc-testar', onclick: () => agir('Testando', async () => { const o = await api('POST', '/api/gaocg/testar', {}); troca(saida, aviso(o.ok ? 'ok' : 'erro', o.mensagem)); setTimeout(recarregar, 1200); }) }, 'Testar a conexão'),
        h('button', { class: 'sec', id: 'gc-atualizar', onclick: () => agir('Atualizando', async () => { const o = await api('POST', '/api/gaocg/atualizar', {}); troca(saida, aviso('ok', o.total + ' unidade(s) lidas do GAOCG.')); setTimeout(recarregar, 1200); }) }, 'Atualizar cadastro de unidades'),
        ehAdmin() ? h('button', { class: 'sec', onclick: () => agir('Lendo os campos', async () => { const o = await api('GET', '/api/gaocg/campos/api_unidades'); troca(saida, h('p', { class: 'peq' }, 'Campos que o GAOCG devolve em unidades: ' + (o.campos.join(', ') || '(nenhum)'))); }) }, 'Ver campos recebidos') : null) : aviso('info', 'Para ligar: coloque GAOCG_API_URL e GAOCG_API_CHAVE nas variáveis da hospedagem e reinicie.'),
      saida);
  }
  function cartaoIntegracao(i, cs) {
    const cfg = i.config, a = cfg.auth || {};
    const url = h('input', { type: 'text', id: 'in-u' + i.integracao_id, value: cfg.baseUrl || '', placeholder: 'https://…' });
    const tipo = h('select', { id: 'in-t' + i.integracao_id }, ['bearer', 'basic', 'apikey', 'nenhuma'].map((t) => h('option', { value: t, selected: t === (a.tipo || 'bearer') }, t)));
    const env = h('input', { type: 'text', id: 'in-e' + i.integracao_id, value: a.tokenEnv || a.chaveEnv || a.usuarioEnv || '', placeholder: 'MV_API_TOKEN' });
    const ativo = h('input', { type: 'checkbox', id: 'in-a' + i.integracao_id, checked: !!i.ativo });
    const contrato = cs.find((c) => c.contrato_id === i.contrato_id);
    const sel = h('select', { id: 'in-c' + i.integracao_id }, (contrato ? contrato.competencias : []).map((k) => h('option', { value: k.cid }, k.competencia_id)));
    const saida = h('div');
    const exec = async (acao, corpo) => { troca(saida, h('p', { class: 'mudo' }, 'Aguarde…')); try { const o = await api('POST', '/api/integracoes/' + i.integracao_id + '/' + acao, corpo || {}); if (acao === 'testar') { troca(saida, aviso('ok', 'Conectou em ' + o.ms + ' ms.')); } else troca(saida, aviso(o.dryRun ? 'info' : 'ok', o.dryRun ? 'Prévia: nada foi gravado.' : 'Lote(s) pendente(s) criados; o gestor confirma.'), tabela([{ t: 'Fonte' }, { t: 'Buscadas', n: true }, { t: 'Válidas', n: true }, { t: 'Recusadas', n: true }, { t: 'Situação' }], o.resumo.map((x) => [x.fonte, String(x.buscados), String(x.validos), String(x.recusados), x.erro ? 'erro: ' + x.erro : (x.motivoRecusa ? 'recusada: ' + x.motivoRecusa : 'ok')]))); } catch (e) { troca(saida, aviso('erro', e.message)); } };
    return h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, i.nome + ' · ' + (contrato ? contrato.unidade : i.contrato_id)), h('div', { class: 'linha' }, selo(i.estado, i.estado === 'conectada' ? 'ok' : 'atencao'), i.ativo ? selo('ativa', 'ok') : selo('desativada'))),
      i.ultimo_erro ? aviso('erro', 'Último erro: ' + i.ultimo_erro) : null,
      ehAdmin() ? h('div', null, h('div', { class: 'duas', style: 'margin-top:10px' }, h('div', { class: 'campo' }, h('label', { for: url.id }, 'Endereço da API'), url), h('div', { class: 'campo' }, h('label', { for: tipo.id }, 'Tipo de acesso'), tipo)),
        h('div', { class: 'campo' }, h('label', { for: env.id }, 'Nome da variável do .env com a credencial'), env, h('div', { class: 'ajuda' }, 'Escreva só o NOME (ex.: MV_API_TOKEN). A senha ou o token vai no arquivo .env do servidor ' + (i.credencialDefinida ? '(variável encontrada).' : '(variável ainda não definida).'))),
        h('div', { class: 'linha' }, h('label', { style: 'font-weight:400;margin:0' }, ativo, ' Integração ativa'), h('button', { class: 'sec', onclick: async () => { const t = tipo.value; const auth = { tipo: t }; if (t === 'bearer') auth.tokenEnv = env.value; else if (t === 'apikey') auth.chaveEnv = env.value; else if (t === 'basic') { auth.usuarioEnv = env.value; auth.senhaEnv = env.value.replace(/USUARIO|USER/, 'SENHA'); } try { await api('PUT', '/api/integracoes/' + i.integracao_id, { baseUrl: url.value, auth, ativo: ativo.checked }); toast('Configuração salva.'); integracoes(); } catch (e) { toast(e.message, true); } } }, 'Salvar a configuração'))) : h('p', { class: 'peq mudo' }, 'Endereço: ' + (cfg.baseUrl || 'não definido') + ' (a configuração é do administrador).'),
      ehAdmin() ? h('div', { class: 'linha', style: 'margin-top:12px' }, h('button', { class: 'sec', onclick: () => exec('testar') }, 'Testar a conexão'), h('select', { 'aria-label': 'Competência', id: sel.id }, [...sel.children]), h('button', { class: 'sec', onclick: () => exec('sincronizar', { cid: Number(document.getElementById(sel.id).value), dryRun: true }) }, 'Prévia (não grava)'), h('button', { onclick: () => exec('sincronizar', { cid: Number(document.getElementById(sel.id).value) }) }, 'Buscar agora')) : null,
      saida, i.lotes.length ? aviso('atencao', i.lotes.length + ' lote(s) aguardando confirmação do gestor da unidade.') : null,
      h('details', { style: 'margin-top:12px' }, h('summary', { style: 'cursor:pointer;color:var(--acento);font-weight:500' }, 'Registro das últimas chamadas'), tabela([{ t: 'Quando' }, { t: 'Ação' }, { t: 'Endereço' }, { t: 'Status' }, { t: 'ms', n: true }, { t: 'Registros', n: true }, { t: 'Erro' }], i.log.map((l) => [fmt.data(l.data_hora), l.acao, l.endpoint, l.status, String(l.ms), String(l.registros), l.erro || '']), { vazio: 'Nenhuma chamada ainda.' })));
  }

  // ---------- Trilha e administração ----------
  async function trilha() {
    const [t, v] = await Promise.all([api('GET', '/api/ctai/trilha?limite=200'), api('GET', '/api/ctai/trilha/verificar')]);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Trilha de auditoria'), h('p', null, 'Registro que só cresce: cada evento guarda o código do anterior. Alterar ou apagar um evento quebra a cadeia.'))),
      v.ok ? aviso('ok', h('strong', null, 'Cadeia íntegra. '), v.total + ' eventos conferidos.') : aviso('erro', h('strong', null, 'A cadeia foi quebrada. '), h('ul', null, v.falhas.slice(0, 10).map((f) => h('li', null, 'Evento ' + f.evento_id + ': ' + f.problema)))),
      h('div', { class: 'cartao' }, tabela([{ t: '#', n: true }, { t: 'Quando' }, { t: 'Quem' }, { t: 'Onde' }, { t: 'Campo' }, { t: 'Antes' }, { t: 'Depois' }, { t: 'Motivo' }], t.eventos.map((e) => [String(e.evento_id), fmt.data(e.data_hora), e.usuario, e.tabela + ' ' + e.registro, e.campo || '', (e.valor_anterior || '').slice(0, 60), (e.valor_novo || '').slice(0, 80), e.motivo || '']))));
  }

  async function admin() {
    const [u, s] = await Promise.all([api('GET', '/api/admin/usuarios'), api('GET', '/api/admin/saude')]);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Administração'), h('p', null, 'Usuários, dados de demonstração e saúde do sistema.'))),
      s.senhaTemporariaPadrao ? aviso('atencao', h('strong', null, 'A senha temporária ainda é a padrão. '), 'Defina CTAI_SENHA_TEMPORARIA no .env antes de dar acesso a outras pessoas.') : null,
      h('div', { class: 'kpis' }, kpi('Trilha', s.trilha.ok ? 'íntegra' : 'QUEBRADA', s.trilha.eventos + ' eventos'), kpi('Contratos', String(s.contratos)), kpi('Envios', String(s.envios)), kpi('Node', s.node)),
      h('div', { class: 'cartao' }, h('h3', null, 'Usuários'), tabela([{ t: 'Login' }, { t: 'Nome' }, { t: 'Perfil' }, { t: 'Contrato' }, { t: 'Setor' }, { t: 'Situação' }, { t: '' }], u.usuarios.map((x) => [x.login, x.nome, u.perfis[x.perfil], x.contrato_id || '—', x.setor || '—', x.ativo ? (x.trocar_senha ? 'senha temporária' : 'ativo') : 'desativado',
        h('div', { class: 'linha' }, h('button', { class: 'leve', onclick: async () => { if (await confirmar('Redefinir a senha de ' + x.login + '?', 'Volta para a senha temporária e a pessoa precisa trocar no próximo acesso.', 'Redefinir')) { await api('POST', '/api/admin/usuarios/' + x.usuario_id + '/redefinir-senha', {}); toast('Senha redefinida.'); } } }, 'Redefinir senha'), h('button', { class: 'leve', onclick: async () => { try { await api('POST', '/api/admin/usuarios/' + x.usuario_id + '/ativo', { ativo: !x.ativo }); admin(); } catch (e) { toast(e.message, true); } } }, x.ativo ? 'Desativar' : 'Ativar'))]))),
      window.CTAI_USUARIO_FORM({ perfis: u.perfis, contratos: u.contratos, setores: META.setores, endpoint: '/api/admin/usuarios', aoCriar: admin }),
      window.CTAI_RACK_IA(),
      h('div', { class: 'cartao' }, h('h3', null, 'Backup do banco'), h('p', { class: 'peq mudo' }, 'Baixa uma cópia consistente do banco (usuários, envios, pareceres, trilha). Os PDFs gerados ficam no disco do servidor. Guarde o arquivo em local seguro.'), h('a', { class: 'btn sec', id: 'bk-baixar', href: '/api/admin/backup' }, 'Baixar backup do banco')),
      h('div', { class: 'cartao' }, h('h3', null, 'Dados de demonstração'), h('p', { class: 'peq mudo' }, 'O contrato "UPA Demonstração" tem dados fictícios (marcados na tela e no PDF). Você pode recriá-los ou apagá-los por completo; o contrato real não é tocado.'),
        h('div', { class: 'linha' }, h('button', { class: 'sec', onclick: async () => { if (await confirmar('Recriar os dados fictícios?', 'Apaga o que foi feito no contrato de demonstração e recria do zero.', 'Recriar', true)) { await api('POST', '/api/admin/demo/recarregar', {}); toast('Demonstração recriada.'); } } }, 'Recriar a demonstração'),
          h('button', { class: 'perigo', onclick: async () => { const t = await perguntar('Apagar a demonstração', 'Digite APAGAR para confirmar', { texto: 'Apaga o contrato de demonstração e desativa os usuários dele.' }); if (t === 'APAGAR') { await api('POST', '/api/admin/demo/apagar', { confirmar: 'APAGAR' }); toast('Demonstração apagada.'); admin(); } else if (t) toast('Texto diferente de APAGAR.', true); } }, 'Apagar a demonstração'))));
  }

  async function iniciar() {
    const me0 = await api('GET', '/api/auth/me').catch(() => null);
    const meta0 = await api('GET', '/api/meta').catch(() => null);
    window.__semPainel = !!(me0 && ['criador', 'colega'].includes(me0.usuario.perfil) && meta0 && !meta0.painelAnalista);
    window.__soGestao = me0 && ['superintendente', 'admin'].includes(me0.usuario.perfil) ? [{ href: '#/gestao', rotulo: 'Gestão CTAI' }] : [];
    EU = await casca({ titulo: 'CTAI', subtitulo: 'Console da comissão', perfis: ['admin', 'criador', 'colega', 'superintendente'], itens: (window.__semPainel ? [] : [{ href: '#/', rotulo: 'Painel' }]).concat([{ href: '#/caixa', rotulo: 'Caixa de entrada' }, { href: '#/mensageiro', rotulo: 'Mensageiro' }, { href: '#/pareceres', rotulo: 'Pareceres' }, { href: '#/analista', rotulo: 'Analista CTAI' }, { href: '#/regras', rotulo: 'Regras e decisões' }, { href: '#/integracoes', rotulo: 'Integrações' }, { href: '#/trilha', rotulo: 'Trilha' }]).concat(window.__soGestao || []) });
    if (!EU) return;
    window.__eu = EU;
    window.CTAI_CAIXA.atualizarContador(); window.CTAI_MENSAGEIRO.atualizarContador(); setInterval(() => { window.CTAI_CAIXA.atualizarContador(); window.CTAI_MENSAGEIRO.atualizarContador(); }, 60000);
    if (ehAdmin()) { const nav = document.querySelector('.lateral .rodape'); nav.parentNode.insertBefore(h('a', { class: 'nav', href: '#/admin', 'data-h': '#/admin' }, 'Administração'), nav); }
    META = await api('GET', '/api/meta');
    rotear([['/', window.__semPainel ? () => { location.replace('#/caixa'); } : painel], ['/c/:cid', competencia], ['/c/:cid/:aba', competencia], ['/pareceres', pareceres], ['/p/:id', parecer], ['/v/:id', mesa], ['/analista', analista], ['/analista/:aba', analista], ['/regras', regras], ['/regras/:contrato', regras], ['/integracoes', integracoes], ['/trilha', trilha], ['/admin', admin]].concat(window.CTAI_CAIXA.rotas).concat(window.CTAI_MENSAGEIRO.rotas).concat(eh('superintendente', 'admin') ? window.CTAI_GESTAO.rotas : []), (hash) => window.__marcarMenu && window.__marcarMenu(hash));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  iniciar();
})();
