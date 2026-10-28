(function () {
  'use strict';
  // Apuração do trimestre e texto do Parecer CTAI (etapa "Produzir"): quadros, descontos, textos a partir do modelo do trimestre anterior,
  // conferência número a número e lado a lado das fontes. Só número confirmado entra; pendente, ausente ou divergente aparece destacado.
  const { h, api, toast, aviso, selo } = window.CTAI;
  const nBR = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const rs = (c) => (c === null || c === undefined ? 'PENDENTE' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const base = (c, t) => '/api/importar/unidade/' + encodeURIComponent(c) + '/' + t + '/parecer';
  const trocar = (el, ...cs) => el.replaceChildren(...cs.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const celula = (txt) => h('td', { class: /PENDENTE|A DEFINIR|Impossibilitado/.test(txt) ? 'pt-pend' : '' }, txt);
  const tabela = (q) => h('table', { class: 'pt-tab' }, h('thead', null, h('tr', null, q.colunas.map((c) => h('th', null, c)))), h('tbody', null, q.linhas.map((l) => h('tr', { class: l[1] === 'Trimestre' ? 'pt-tri' : '' }, l.map(celula)))));
  const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  // parágrafo com destaque: trocado (novo, com o antigo riscado), revisar (amarelo), fixo (texto jurídico, cinza)
  const par = (p) => h('p', { class: 'pt-par' }, p.segs.map((s) => {
    if (s.k === 'trocado') return h('span', null, h('ins', { class: 'pt-novo', title: 'Trocado: ' + (s.motivo || '') }, s.t), ' ', h('del', { class: 'pt-velho' }, s.de || ''));
    if (s.k === 'revisar') return h('mark', { class: 'pt-rev', title: 'Revisar: ' + (s.motivo || '') }, s.t);
    if (s.k === 'fixo') return h('span', { class: 'pt-fixo' }, s.t);
    return s.t;
  }));

  // resumo somente leitura do que foi apurado (mesa de conferência e editor)
  function resumo(ap) {
    const d = ap.documento;
    return h('div', { class: 'pt-resumo', id: 'pt-resumo' },
      ap.pronto ? aviso('ok', 'Apuração pronta para conferência (hash ' + String(ap.hash).slice(0, 12) + ').') : aviso('atencao', 'Apuração com ' + ap.pendencias + ' pendência(s): números ou textos podem não valer.'),
      !ap.pronto && ap.bloqueios && ap.bloqueios.length ? h('ul', { class: 'peq' }, ap.bloqueios.slice(0, 12).map((b) => h('li', null, b))) : null,
      h('h4', null, d.quadro1.titulo), tabela(d.quadro1), h('h4', null, d.quadro2.titulo), tabela(d.quadro2), h('h4', null, d.quadro3.titulo), d.quadro3.linhas.length ? tabela(d.quadro3) : h('p', { class: 'peq mudo' }, 'Sem indicadores de qualidade apurados.'),
      d.descontos.map((t) => h('p', { class: 'peq' }, h('strong', null, t.titulo.replace(/^Tabela \d+ - Apontamento de Desconto - /, '')), ': ' + t.pct + ' de ' + t.repasse_total + ' = ', h('strong', null, t.valor))),
      h('p', null, 'Descontos: produção ', h('strong', null, d.total.linhas[0][1]), ' · qualidade ', h('strong', null, d.total.linhas[1][1]), ' · total ', h('strong', null, d.total.linhas[2][1])),
      h('details', null, h('summary', null, 'Textos do parecer (como vão para o documento)'), ['cab', '1', '2', '3', '4', '9', '10'].map((k) => h('div', null, k !== 'cab' && d.texto.titulos[k] ? h('h4', null, d.texto.titulos[k]) : null, (d.texto[k] || []).map((p) => h('p', { class: 'peq' }, p))))),
      h('details', null, h('summary', null, 'Lado a lado das fontes (' + (ap.lado_a_lado || []).length + ' indicadores)'), tabelaLado(ap.lado_a_lado || [])),
      h('details', null, h('summary', null, 'Conferência número a número (' + ap.conferencia.length + ')'), tabelaConf(ap.conferencia)));
  }
  function tabelaLado(lado) {
    return h('table', { class: 'pt-tab', id: 'pt-lado' }, h('thead', null, h('tr', null, ['Indicador', 'SIMAS (principal)', 'RM / planilha (conferência)', 'Vale', 'Situação'].map((c) => h('th', null, c)))),
      h('tbody', null, lado.map((x) => h('tr', { class: x.diverge ? 'pt-div' : '' }, h('td', null, x.indicador),
        h('td', null, x.simas ? (x.simas.varios ? x.simas.varios.map((v) => v.grupo + ': ' + nBR(v.realizado) + ' de ' + nBR(v.meta) + ' (' + v.estado + ')').join(' · ') : nBR(x.simas.realizado) + ' de ' + nBR(x.simas.meta) + ' (' + x.simas.estado + ')') : '—'),
        h('td', null, x.rm_planilha ? nBR(x.rm_planilha.realizado) + ' de ' + nBR(x.rm_planilha.meta) + ' (' + x.rm_planilha.fonte + ')' : 'pendente'),
        h('td', null, x.usado || 'pendente'), h('td', null, x.diverge ? selo('divergem', 'atencao') : (x.usado ? selo('confere / única fonte', 'ok') : selo('pendente', 'atencao')))))));
  }
  function tabelaConf(conf) {
    return h('table', { class: 'pt-tab', id: 'pt-conf' }, h('thead', null, h('tr', null, ['Número no parecer', 'Valor', 'Origem (arquivo e trecho)', 'Estado'].map((c) => h('th', null, c)))),
      h('tbody', null, conf.map((c) => h('tr', null, h('td', null, c.indicador + ' · ' + c.mes.slice(5) + '/' + c.mes.slice(0, 4) + ' · ' + c.campo), h('td', null, nBR(c.valor)), h('td', { class: 'peq' }, (c.arquivo ? c.arquivo + ' · ' : '') + c.origem + (c.trecho ? ' · "' + String(c.trecho).slice(0, 160) + '"' : '')), h('td', null, selo(c.estado, c.estado === 'confirmado' ? 'ok' : 'atencao'))))));
  }

  async function preencher(slot, { contratoId, tri }) {
    let v;
    const carregar = async () => { v = await api('GET', base(contratoId, tri)); };
    const salvar = async (corpo, msg) => { try { v = await api('PUT', base(contratoId, tri), corpo); toast(msg || 'Salvo.'); desenhar(); } catch (e) { toast(e.message, true); } };
    const desenhar = () => {
      const f = {};
      const ent = (id, valor, rot, ph) => { const i = h('input', { type: 'text', id, value: valor, inputmode: 'decimal', placeholder: ph || '', 'aria-label': rot }); f[id] = i; return i; };
      const txt = (id, valor, rot, linhas) => { const i = h('textarea', { id, rows: linhas || 3, 'aria-label': rot }, valor || ''); f[id] = i; return i; };
      const sel = (id, rot, opcoes, atual) => { const s = h('select', { id, 'aria-label': rot }, opcoes.map(([val, tx]) => h('option', Object.assign({ value: val }, val === atual ? { selected: true } : {}), tx))); f[id] = s; return s; };
      const rep = v.repasse.meses.map((r) => h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'Repasse ' + r.mes.slice(5) + '/' + r.mes.slice(0, 4)), ent('rep-' + r.mes, r.cent === null ? '' : num(r.cent / 100), 'Repasse ' + r.mes, '0,00')));
      const aplicaveis = v.descontos.filter((d) => d.aplicavel);
      const descs = aplicaveis.length ? aplicaveis.map((d) => h('div', { class: 'pt-desc' }, h('strong', null, d.nome), ' · ', d.faixa === 'abaixo_85' ? 'abaixo do mínimo de 85%' : 'entre 85% e 100%', d.peso_contrato_pct !== null ? h('span', { class: 'peq mudo' }, ' · peso no contrato: ' + nBR(d.peso_contrato_pct) + '% (referência, não é o percentual aplicado)') : null,
        h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, '% de desconto (a analista define)'), ent('pct-' + d.chave, d.pct_bp === null ? '' : num(d.pct_bp / 100), 'Percentual de desconto de ' + d.nome, 'ex.: 3'), ' ', d.valor_cent !== null ? h('span', null, '= ' + rs(d.valor_cent)) : h('span', { class: 'pt-pend' }, 'A DEFINIR PELA ANALISTA')),
        d.aviso ? h('div', { class: 'peq' }, d.aviso) : null)) : [h('p', { class: 'peq mudo' }, 'Nenhum indicador valorado abaixo da meta com os números confirmados até aqui.')];
      const arred = v.bloqueios.some((b) => /arredondamento de centavos/.test(b)) || v.arredondamento ? h('label', { class: 'pt-campo' }, h('span', { class: 'peq' }, 'Total dos descontos: '), sel('pt-arred', 'Critério de arredondamento', [['', 'escolher'], ['linhas', 'somar as linhas já arredondadas'], ['exato', 'somar sem arredondar e arredondar o total']], v.arredondamento || '')) : null;
      // escolha de fonte quando SIMAS e RM divergem (ou o SIMAS traz o indicador em mais de um grupo)
      const escolhas = v.lado_a_lado.filter((x) => x.diverge || (x.simas && x.simas.varios)).map((x) => h('div', { class: 'pt-desc' }, h('strong', null, x.indicador), ' · o SIMAS e o RM não coincidem. O sistema não decide. ',
        h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'Fonte que vale'), sel('fonte-' + x.chave, 'Fonte de ' + x.indicador, [['', 'escolher'], ['simas', 'SIMAS'], ['rm', 'RM'] ], x.escolha || ''))));
      const imp = (v.manual.impossibilitados || []).concat([{ indicador: '', motivo: '' }]);
      const impEls = imp.map((x, k) => h('div', { class: 'linha pt-imp' }, h('input', { type: 'text', value: x.indicador, placeholder: 'Indicador de qualidade', 'aria-label': 'Indicador impossibilitado ' + (k + 1), class: 'pt-imp-i', list: 'pt-ind-q' }), h('input', { type: 'text', value: x.motivo, placeholder: 'Motivo (ex.: dados divergentes no anexo técnico)', 'aria-label': 'Motivo ' + (k + 1), class: 'pt-imp-m' })));
      const aceitas = v.consideracoes_finais || [];
      const sug = v.sugestoes.map((s) => h('div', { class: 'linha espaco pt-sug' }, h('div', null, selo(s.marca, 'atencao'), ' ', s.texto, h('span', { class: 'peq mudo' }, ' · ' + s.origem)),
        aceitas.includes(s.texto) ? selo('aceita', 'ok') : h('button', { type: 'button', class: 'sec', onclick: () => salvar({ consideracoes_finais: aceitas.concat([s.texto]) }, 'Sugestão aceita.') }, 'Aceitar')));
      const nomesSecao = { cab: 'Abertura (título e objeto)', 1: '1. Introdução', 2: '2. Fundamentação legal', 3: '3. Identificação', 4: '4. SIMAS', 9: '9. Considerações finais (abertura)', 10: '10. Conclusão' };
      const secoesTexto = ['cab', '1', '2', '3', '4', '9', '10'].filter((k) => v.textos[k]).map((k) => {
        const t = v.textos[k];
        return h('details', { class: 'pt-sec', open: t.exige_revisao && !t.revisada, id: 'pt-sec-' + k }, h('summary', null, nomesSecao[k] + ' ', t.fixo ? selo('texto jurídico fixo', 'ok') : (t.exige_revisao ? (t.revisada ? selo('revisada', 'ok') : selo(t.n_trocas + ' trocado(s) · ' + t.n_revisar + ' a revisar', 'atencao')) : selo('sem mudanças', 'ok')), t.origem === 'editado pela analista' ? ' ' + selo('editado', 'atencao') : null),
          t.editado ? h('p', { class: 'pt-par' }, t.editado) : t.paragrafos.map(par),
          h('div', { class: 'linha' }, t.exige_revisao && !t.editado ? h('button', { type: 'button', class: 'sec', id: 'pt-rev-' + k, disabled: t.revisada, onclick: () => salvar({ revisar_secoes: [k] }, 'Seção revisada.') }, t.revisada ? 'Revisada' : 'Li e revisei esta seção') : null,
            h('button', { type: 'button', class: 'leve', onclick: () => { const ta = txt('pt-ed-' + k, t.editado || t.paragrafos.map((p) => p.segs.map((s) => s.t).join('')).join('\n'), 'Texto da seção ' + k, 8); const caixa = h('div', null, ta, h('button', { type: 'button', onclick: () => salvar({ texto_editado: Object.assign({}, v.texto_editado_atual || {}, { [k]: ta.value }) }, 'Texto da analista salvo.') }, 'Salvar o texto'), t.editado ? h('button', { type: 'button', class: 'leve', onclick: () => salvar({ texto_editado: Object.fromEntries(Object.entries(v.texto_editado_atual || {}).filter(([x]) => x !== k)) }, 'Voltou ao texto gerado.') }, 'Voltar ao texto gerado') : null); document.getElementById('pt-sec-' + k).append(caixa); } }, 'Editar à mão')));
      });
      const modelo = v.modelo ? h('p', { class: 'peq mudo' }, 'Base: parecer do ' + (v.modelo.trimestre || 'trimestre anterior') + ' (' + (v.modelo.nome_arquivo || 'arquivo') + '). ', h('ins', { class: 'pt-novo' }, 'verde'), ' = trocado pelo sistema (o texto antigo aparece riscado) · ', h('mark', { class: 'pt-rev' }, 'amarelo'), ' = a analista revisa · ', h('span', { class: 'pt-fixo' }, 'cinza'), ' = texto jurídico mantido.') : aviso('atencao', 'Sem relatório-modelo ativo nesta unidade: suba o parecer do trimestre anterior na Importação.');
      const cong = v.versao_congelada ? aviso(v.versao_congelada.mudou ? 'atencao' : 'info', 'Versão ' + v.versao_congelada.numero + ' congelada (' + v.versao_congelada.status + ')' + (v.versao_congelada.mudou ? ': os números ou textos mudaram depois dela; o "pronto" caiu e é preciso congelar uma versão nova.' : '.')) : null;
      const coletar = () => {
        const repasses = {}; for (const r of v.repasse.meses) repasses[r.mes] = f['rep-' + r.mes].value;
        const descontos_pct = {}; for (const d of aplicaveis) descontos_pct[d.chave] = f['pct-' + d.chave].value;
        const fontes = Object.assign({}, v.fontes); for (const x of v.lado_a_lado) if (f['fonte-' + x.chave]) { if (f['fonte-' + x.chave].value) fontes[x.chave] = f['fonte-' + x.chave].value; else delete fontes[x.chave]; }
        const imps = [...document.querySelectorAll('#pt-raiz .pt-imp')].map((l) => ({ indicador: l.querySelector('.pt-imp-i').value, motivo: l.querySelector('.pt-imp-m').value }));
        const c = { repasses, repasse_fonte: f['pt-fonte'].value, descontos_pct, qualidade_desconto: f['pt-qual'].value, s7: f['pt-s7'].value, s8: f['pt-s8'].value, impossibilitados: imps, numero_parecer: f['pt-numero'].value, s3_tas: f['pt-tas'].value, fontes };
        if (f['pt-arred']) c.arredondamento = f['pt-arred'].value;
        return c;
      };
      v.texto_editado_atual = Object.fromEntries(Object.entries(v.textos).filter(([, t]) => t.editado).map(([k, t]) => [k, t.editado]));
      trocar(slot, h('div', { class: 'cartao', id: 'pt-raiz' },
        h('h2', { style: 'margin-top:0' }, 'Parecer do trimestre ' + tri), h('p', { class: 'peq mudo' }, 'Quadros, descontos e textos. Só entram números confirmados: o que está pendente aparece destacado e impede o "pronto para conferência". O sistema só sugere: percentual de desconto, critério de arredondamento, faixa entre 85% e 100% e a fonte quando SIMAS e RM divergem são decisões da analista.'),
        v.pronto ? aviso('ok', h('strong', null, 'Pronto para conferência. '), 'Números conferidos pelo sistema por dois caminhos, por ' + v.pronto_por + '. Abra o documento do parecer para congelar a versão e convocar a conferência.') : (v.desatualizado ? aviso('atencao', 'Os números ou textos mudaram depois do "pronto para conferência". Confira de novo.') : null),
        cong,
        v.bloqueios.length ? h('div', { class: 'pt-bloq', id: 'pt-bloq' }, h('strong', null, v.bloqueios.length + ' pendência(s) ou diferença(s) impedem o "pronto para conferência"'), h('ul', { class: 'peq' }, v.bloqueios.map((b) => h('li', null, b)))) : null,
        v.avisos.length ? h('div', { class: 'pt-avisos' }, v.avisos.map((a) => aviso('atencao', a))) : null,
        h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'Número do parecer (ex.: 213/2026)'), (() => { const i = h('input', { type: 'text', id: 'pt-numero', value: v.numero_parecer || '', 'aria-label': 'Número do parecer' }); f['pt-numero'] = i; return i; })()),
        h('h3', null, 'Textos: abertura e seções 1 a 4, 9 e 10'), modelo, secoesTexto,
        h('label', { class: 'pt-campo pt-largo' }, h('span', { class: 'peq mudo' }, 'Termos aditivos novos do trimestre (acrescentado à seção 3; obrigatório se a meta mudou no trimestre)'), txt('pt-tas', v.s3_tas, 'Termos aditivos do trimestre', 3)),
        h('h3', null, 'Quadro 01 - Indicadores de produção (parte variável)'), tabela(v.documento.quadro1), escolhas,
        h('h3', null, 'Quadro 02 - Produção não valorada'), tabela(v.documento.quadro2),
        h('h3', null, 'Quadro 03 - Indicadores de qualidade (SIMAS)'), v.documento.quadro3.linhas.length ? tabela(v.documento.quadro3) : h('p', { class: 'peq mudo' }, 'O SIMAS ainda não foi lido/confirmado.'),
        h('datalist', { id: 'pt-ind-q' }, v.quadro3.map((q) => h('option', { value: q.nome }))),
        h('h3', null, '5.3 Impossibilitado de análise (campo manual, com motivo)'), impEls,
        h('h3', null, 'Repasse e descontos'),
        h('div', { class: 'linha' }, rep), h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'De onde vem o repasse (documento/cláusula)'), (() => { const i = h('input', { type: 'text', id: 'pt-fonte', value: v.repasse.fonte || '', 'aria-label': 'Fonte do repasse' }); f['pt-fonte'] = i; return i; })()),
        h('p', { class: 'peq' }, 'Repasse total do trimestre: ', h('strong', { class: v.repasse.total_cent === null ? 'pt-pend' : '' }, rs(v.repasse.total_cent))),
        descs, arred,
        h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'Descontos de qualidade (R$; informe 0,00 se não houver)'), ent('pt-qual', v.qualidade_cent === null ? '' : num(v.qualidade_cent / 100), 'Desconto de qualidade', '0,00')),
        h('p', null, 'Total de descontos: produção ', h('strong', { class: v.total_producao_cent === null ? 'pt-pend' : '' }, rs(v.total_producao_cent)), ' · total geral ', h('strong', { class: v.total_geral_cent === null ? 'pt-pend' : '', id: 'pt-total' }, rs(v.total_geral_cent))),
        h('details', null, h('summary', null, 'Digitar um número com motivo (quando a leitura não serve)'), h('div', { class: 'linha' },
          sel('aj-ind', 'Indicador', [...v.quadro1, ...v.quadro2].map((q) => [q.chave, q.nome]), ''), sel('aj-mes', 'Mês', v.meses.map((m) => [m, m]), ''), sel('aj-campo', 'Campo', [['meta', 'meta'], ['realizado', 'realizado']], ''),
          ent('aj-valor', '', 'Valor', 'valor'), ent('aj-motivo', '', 'Motivo ou fonte', 'motivo/fonte (obrigatório)'),
          h('button', { type: 'button', class: 'sec', id: 'aj-add', onclick: () => salvar({ ajustes: (v.ajustes || []).concat([{ chave: f['aj-ind'].value, mes: f['aj-mes'].value, campo: f['aj-campo'].value, valor: f['aj-valor'].value, motivo: f['aj-motivo'].value }]) }, 'Número registrado com motivo.') }, 'Registrar')),
          (v.ajustes || []).length ? h('ul', { class: 'peq' }, v.ajustes.map((a, k) => h('li', null, a.chave + ' · ' + a.mes + ' · ' + a.campo + ' = ' + nBR(a.valor) + ' — ' + a.motivo + ' ', h('button', { type: 'button', class: 'leve', onclick: () => salvar({ ajustes: v.ajustes.filter((_, j) => j !== k) }, 'Removido.') }, 'tirar')))) : null),
        h('h3', null, '7. Informações financeiras do trimestre anterior (campo manual)'), h('p', { class: 'peq mudo' }, 'Origem: ' + v.manual.s7.origem), txt('pt-s7', v.manual.s7.texto, 'Seção 7'),
        h('h3', null, '8. Parecer Conclusivo da CMA do trimestre anterior (campo manual)'), h('p', { class: 'peq mudo' }, 'Origem: ' + v.manual.s8.origem), txt('pt-s8', v.manual.s8.texto, 'Seção 8'),
        h('h3', null, '9. Considerações finais'), sug.length ? sug : h('p', { class: 'peq mudo' }, 'Sem sugestões. Elas nascem dos achados fixados, dos indicadores abaixo de 85% e dos itens do parecer anterior.'),
        aceitas.length ? h('ol', { class: 'peq' }, aceitas.map((t, k) => h('li', null, t, ' ', h('button', { type: 'button', class: 'leve', onclick: () => salvar({ consideracoes_finais: aceitas.filter((_, j) => j !== k) }, 'Removida.') }, 'tirar')))) : null,
        h('h3', null, 'Lado a lado das fontes'), h('p', { class: 'peq mudo' }, 'O SIMAS é a fonte principal quando confirmado; RM e planilha conferem. Divergência é mostrada e a analista escolhe.'), tabelaLado(v.lado_a_lado),
        h('h3', null, 'Conferência número a número'), h('p', { class: 'peq mudo' }, 'Cada número usado no parecer, ao lado de onde veio.'), tabelaConf(v.conferencia),
        h('div', { class: 'linha', style: 'margin-top:12px' },
          h('button', { type: 'button', id: 'pt-salvar', onclick: () => salvar(coletar()) }, 'Salvar'),
          h('button', { type: 'button', class: 'sec', id: 'pt-pronto', onclick: async () => { try { await api('PUT', base(contratoId, tri), coletar()); v = await api('POST', base(contratoId, tri) + '/pronto', {}); toast('Pronto para conferência.'); desenhar(); } catch (e) { await carregar().catch(() => {}); desenhar(); toast(e.message, true); } } }, 'Marcar pronto para conferência'),
          v.pronto ? h('a', { class: 'btn sec', id: 'pt-pdf', href: base(contratoId, tri) + '/pdf', target: '_blank', rel: 'noopener' }, 'Gerar o PDF do parecer (minuta)') : h('span', { class: 'peq mudo' }, 'O PDF sai depois do "pronto para conferência".'))));
    };
    slot.textContent = 'Carregando o parecer do trimestre…';
    try { await carregar(); desenhar(); } catch (e) { trocar(slot, aviso('info', 'Parecer do trimestre indisponível: ' + e.message)); }
  }
  window.CTAI_PARECER_TRI = { preencher, resumo };
})();
