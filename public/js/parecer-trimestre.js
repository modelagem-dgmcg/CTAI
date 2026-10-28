(function () {
  'use strict';
  // Apuração do trimestre para o Parecer CTAI (etapa "Produzir"): quadros e descontos com conferência número a número.
  // Só número confirmado entra. O que está pendente, ausente ou divergente aparece destacado, nunca como valor.
  const { h, api, toast, aviso, selo } = window.CTAI;
  const nBR = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const rs = (c) => (c === null || c === undefined ? 'PENDENTE' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const base = (c, t) => '/api/importar/unidade/' + encodeURIComponent(c) + '/' + t + '/parecer';
  const trocar = (el, ...cs) => el.replaceChildren(...cs.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const celula = (txt) => h('td', { class: /PENDENTE|A DEFINIR/.test(txt) ? 'pt-pend' : '' }, txt);
  const tabela = (q) => h('table', { class: 'pt-tab' }, h('thead', null, h('tr', null, q.colunas.map((c) => h('th', null, c)))), h('tbody', null, q.linhas.map((l) => h('tr', null, l.map(celula)))));
  const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

  async function preencher(slot, { contratoId, tri }) {
    let v;
    const carregar = async () => { v = await api('GET', base(contratoId, tri)); };
    const salvar = async (corpo, msg) => { try { v = await api('PUT', base(contratoId, tri), corpo); toast(msg || 'Salvo.'); desenhar(); } catch (e) { toast(e.message, true); } };
    const desenhar = () => {
      const f = {}; // campos lidos na hora de salvar
      const ent = (id, valor, rot, ph) => { const i = h('input', { type: 'text', id, value: valor, inputmode: 'decimal', placeholder: ph || '', 'aria-label': rot }); f[id] = i; return i; };
      const txt = (id, valor, rot) => { const i = h('textarea', { id, rows: 3, 'aria-label': rot }, valor || ''); f[id] = i; return i; };
      const rep = v.repasse.meses.map((r) => h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'Repasse ' + r.mes.slice(5) + '/' + r.mes.slice(0, 4)), ent('rep-' + r.mes, r.cent === null ? '' : num(r.cent / 100), 'Repasse ' + r.mes, '0,00')));
      const aplicaveis = v.descontos.filter((d) => d.aplicavel);
      const descs = aplicaveis.length ? aplicaveis.map((d) => h('div', { class: 'pt-desc' }, h('strong', null, d.nome), ' · ', d.faixa === 'abaixo_85' ? 'abaixo do mínimo de 85%' : 'entre 85% e 100%', d.peso_contrato_pct !== null ? h('span', { class: 'peq mudo' }, ' · peso no contrato: ' + nBR(d.peso_contrato_pct) + '% (referência, não é o percentual aplicado)') : null,
        h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, '% de desconto (a definir pela analista)'), ent('pct-' + d.chave, d.pct_bp === null ? '' : num(d.pct_bp / 100), 'Percentual de desconto de ' + d.nome, 'ex.: 3'), ' ', d.valor_cent !== null ? h('span', null, '= ' + rs(d.valor_cent)) : h('span', { class: 'pt-pend' }, 'A DEFINIR PELA ANALISTA')),
        d.aviso ? h('div', { class: 'peq' }, d.aviso) : null)) : [h('p', { class: 'peq mudo' }, 'Nenhum indicador valorado abaixo da meta com os números confirmados até aqui.')];
      const arred = v.bloqueios.some((b) => /arredondamento de centavos/.test(b)) || v.arredondamento ? h('label', { class: 'pt-campo' }, h('span', { class: 'peq' }, 'Total dos descontos: '), (() => { const s = h('select', { id: 'pt-arred', 'aria-label': 'Critério de arredondamento' }, h('option', { value: '' }, 'escolher'), h('option', { value: 'linhas', selected: v.arredondamento === 'linhas' }, 'somar as linhas já arredondadas'), h('option', { value: 'exato', selected: v.arredondamento === 'exato' }, 'somar sem arredondar e arredondar o total')); f['pt-arred'] = s; return s; })()) : null;
      const imp = (v.manual.impossibilitados || []).concat([{ indicador: '', motivo: '' }]);
      const impEls = imp.map((x, k) => h('div', { class: 'linha pt-imp' }, h('input', { type: 'text', value: x.indicador, placeholder: 'Indicador de qualidade', 'aria-label': 'Indicador impossibilitado ' + (k + 1), 'data-i': k, class: 'pt-imp-i' }), h('input', { type: 'text', value: x.motivo, placeholder: 'Motivo (ex.: dados divergentes no anexo técnico)', 'aria-label': 'Motivo ' + (k + 1), 'data-i': k, class: 'pt-imp-m' })));
      const aceitas = v.consideracoes_finais || [];
      const sug = v.sugestoes.map((s) => h('div', { class: 'linha espaco pt-sug' }, h('div', null, selo(s.marca, 'atencao'), ' ', s.texto, h('span', { class: 'peq mudo' }, ' · ' + s.origem)),
        aceitas.includes(s.texto) ? selo('aceita', 'ok') : h('button', { type: 'button', class: 'sec', onclick: () => salvar({ consideracoes_finais: aceitas.concat([s.texto]) }, 'Sugestão aceita.') }, 'Aceitar')));
      const conf = h('table', { class: 'pt-tab', id: 'pt-conf' }, h('thead', null, h('tr', null, ['Número no parecer', 'Valor', 'Origem (arquivo e trecho)', 'Estado'].map((c) => h('th', null, c)))),
        h('tbody', null, v.conferencia.map((c) => h('tr', null, h('td', null, c.indicador + ' · ' + c.mes.slice(5) + '/' + c.mes.slice(0, 4) + ' · ' + c.campo), h('td', null, nBR(c.valor)), h('td', { class: 'peq' }, (c.arquivo ? c.arquivo + ' · ' : '') + c.origem + (c.trecho ? ' · "' + String(c.trecho).slice(0, 160) + '"' : '')), h('td', null, selo(c.estado, c.estado === 'confirmado' ? 'ok' : 'atencao'))))));
      const modelo = v.modelo ? h('details', { class: 'pt-modelo' }, h('summary', null, 'Texto do parecer do ' + (v.modelo.trimestre || 'trimestre anterior') + ' (base para redigir). Em destaque, o que costuma mudar.'),
        v.modelo.secoes.map((s) => h('details', null, h('summary', null, (s.numero ? s.numero + ' ' : '') + s.titulo), h('div', { class: 'peq' }, s.revisar.length ? h('div', null, 'Revisar: ', s.revisar.map((t) => h('mark', null, t + ' '))) : null, h('pre', { class: 'pt-pre' }, s.texto))))) : null;
      const ajuste = h('details', null, h('summary', null, 'Digitar um número com motivo (quando a leitura não serve)'), h('div', { class: 'linha' },
        (() => { const s = h('select', { id: 'aj-ind', 'aria-label': 'Indicador' }, [...v.quadro1, ...v.quadro2].map((q) => h('option', { value: q.chave }, q.nome))); f['aj-ind'] = s; return s; })(),
        (() => { const s = h('select', { id: 'aj-mes', 'aria-label': 'Mês' }, v.meses.map((m) => h('option', { value: m }, m))); f['aj-mes'] = s; return s; })(),
        (() => { const s = h('select', { id: 'aj-campo', 'aria-label': 'Campo' }, h('option', { value: 'meta' }, 'meta'), h('option', { value: 'realizado' }, 'realizado')); f['aj-campo'] = s; return s; })(),
        ent('aj-valor', '', 'Valor', 'valor'), ent('aj-motivo', '', 'Motivo ou fonte', 'motivo/fonte (obrigatório)'),
        h('button', { type: 'button', class: 'sec', id: 'aj-add', onclick: () => salvar({ ajustes: (v.ajustes || []).concat([{ chave: f['aj-ind'].value, mes: f['aj-mes'].value, campo: f['aj-campo'].value, valor: f['aj-valor'].value, motivo: f['aj-motivo'].value }]) }, 'Número registrado com motivo.') }, 'Registrar')),
        (v.ajustes || []).length ? h('ul', { class: 'peq' }, v.ajustes.map((a, k) => h('li', null, a.chave + ' · ' + a.mes + ' · ' + a.campo + ' = ' + nBR(a.valor) + ' — ' + a.motivo + ' ', h('button', { type: 'button', class: 'leve', onclick: () => salvar({ ajustes: v.ajustes.filter((_, j) => j !== k) }, 'Removido.') }, 'tirar')))) : null);
      const coletar = () => {
        const repasses = {}; for (const r of v.repasse.meses) repasses[r.mes] = f['rep-' + r.mes].value;
        const descontos_pct = {}; for (const d of aplicaveis) descontos_pct[d.chave] = f['pct-' + d.chave].value;
        const imps = [...document.querySelectorAll('#pt-raiz .pt-imp')].map((l) => ({ indicador: l.querySelector('.pt-imp-i').value, motivo: l.querySelector('.pt-imp-m').value }));
        const c = { repasses, repasse_fonte: f['pt-fonte'].value, descontos_pct, qualidade_desconto: f['pt-qual'].value, s7: f['pt-s7'].value, s8: f['pt-s8'].value, impossibilitados: imps };
        if (f['pt-arred']) c.arredondamento = f['pt-arred'].value;
        return c;
      };
      trocar(slot, h('div', { class: 'cartao', id: 'pt-raiz' },
        h('h2', { style: 'margin-top:0' }, 'Apuração do trimestre ' + tri), h('p', { class: 'peq mudo' }, 'Quadros e descontos do parecer. Só entram números confirmados: o que está pendente aparece destacado e impede o "pronto para conferência". Os textos das seções 1 a 4, 9 e 10 seguem sendo redigidos a partir do parecer anterior.'),
        v.pronto ? aviso('ok', h('strong', null, 'Pronto para conferência. '), 'Números conferidos pelo sistema por dois caminhos, por ' + v.pronto_por + '.') : (v.desatualizado ? aviso('atencao', 'Os números mudaram depois do "pronto para conferência". Confira de novo.') : null),
        v.bloqueios.length ? h('div', { class: 'pt-bloq', id: 'pt-bloq' }, h('strong', null, v.bloqueios.length + ' pendência(s) ou diferença(s) impedem o "pronto para conferência"'), h('ul', { class: 'peq' }, v.bloqueios.map((b) => h('li', null, b)))) : null,
        v.avisos.length ? h('div', { class: 'pt-avisos' }, v.avisos.map((a) => aviso('atencao', a))) : null,
        h('h3', null, 'Quadro 01 - Indicadores de produção (parte variável)'), tabela(v.documento.quadro1),
        h('h3', null, 'Quadro 02 - Produção não valorada'), tabela(v.documento.quadro2),
        h('h3', null, 'Repasse e descontos'),
        h('div', { class: 'linha' }, rep), h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'De onde vem o repasse (documento/cláusula)'), (() => { const i = h('input', { type: 'text', id: 'pt-fonte', value: v.repasse.fonte || '', 'aria-label': 'Fonte do repasse' }); f['pt-fonte'] = i; return i; })()),
        h('p', { class: 'peq' }, 'Repasse total do trimestre: ', h('strong', { class: v.repasse.total_cent === null ? 'pt-pend' : '' }, rs(v.repasse.total_cent))),
        descs, arred,
        h('label', { class: 'pt-campo' }, h('span', { class: 'peq mudo' }, 'Descontos de qualidade (R$; informe 0,00 se não houver)'), ent('pt-qual', v.qualidade_cent === null ? '' : num(v.qualidade_cent / 100), 'Desconto de qualidade', '0,00')),
        h('p', null, 'Total de descontos: produção ', h('strong', { class: v.total_producao_cent === null ? 'pt-pend' : '' }, rs(v.total_producao_cent)), ' · total geral ', h('strong', { class: v.total_geral_cent === null ? 'pt-pend' : '', id: 'pt-total' }, rs(v.total_geral_cent))),
        ajuste,
        h('h3', null, '5.3 Impossibilitado de análise (campo manual)'), impEls,
        h('h3', null, '7. Informações financeiras do trimestre anterior (campo manual)'), h('p', { class: 'peq mudo' }, 'Origem: ' + v.manual.s7.origem), txt('pt-s7', v.manual.s7.texto, 'Seção 7'),
        h('h3', null, '8. Parecer Conclusivo da CMA do trimestre anterior (campo manual)'), h('p', { class: 'peq mudo' }, 'Origem: ' + v.manual.s8.origem), txt('pt-s8', v.manual.s8.texto, 'Seção 8'),
        h('h3', null, '9. Considerações finais'), sug.length ? sug : h('p', { class: 'peq mudo' }, 'Sem sugestões. Elas nascem dos achados fixados e dos indicadores abaixo de 85%.'),
        aceitas.length ? h('ol', { class: 'peq' }, aceitas.map((t) => h('li', null, t))) : null,
        h('h3', null, 'Conferência número a número'), h('p', { class: 'peq mudo' }, 'Cada número usado no parecer, ao lado de onde veio.'), conf,
        modelo,
        h('div', { class: 'linha', style: 'margin-top:12px' },
          h('button', { type: 'button', id: 'pt-salvar', onclick: () => salvar(coletar()) }, 'Salvar'),
          h('button', { type: 'button', class: 'sec', id: 'pt-pronto', onclick: async () => { try { await api('PUT', base(contratoId, tri), coletar()); v = await api('POST', base(contratoId, tri) + '/pronto', {}); toast('Pronto para conferência.'); desenhar(); } catch (e) { await carregar().catch(() => {}); desenhar(); toast(e.message, true); } } }, 'Marcar pronto para conferência'),
          v.pronto ? h('a', { class: 'btn sec', id: 'pt-pdf', href: base(contratoId, tri) + '/pdf', target: '_blank', rel: 'noopener' }, 'Gerar o PDF da apuração') : h('span', { class: 'peq mudo' }, 'O PDF sai depois do "pronto para conferência".'))));
    };
    slot.textContent = 'Carregando a apuração do trimestre…';
    try { await carregar(); desenhar(); } catch (e) { trocar(slot, aviso('info', 'Apuração do trimestre indisponível: ' + e.message)); }
  }
  window.CTAI_PARECER_TRI = { preencher };
})();
