(function () {
  'use strict';
  // Caixa de entrada da CTAI, ausência/substituição e "Minhas unidades".
  const { h, api, fmt, toast, janela, perguntar, selo, aviso, tabela, montar } = window.CTAI;
  const EU = () => window.__eu || {};
  const F = { unidade: '', tipo: '', situacao: 'pendentes' };
  const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const tomTipo = { prazo_vencido: 'alta', prazo_vencer: 'atencao', resposta: 'atencao', minuta: 'atencao', sem_carteira: 'atencao', sem_gestor: 'atencao', redirecionado: '', envio: 'ok', reenvio: 'ok' };
  const qs = (o) => { const p = new URLSearchParams(); for (const k of Object.keys(o)) if (o[k]) p.set(k, o[k]); const s = p.toString(); return s ? '?' + s : ''; };

  // contador no menu
  async function atualizarContador() {
    try {
      const c = await api('GET', '/api/caixa/contador');
      const a = document.querySelector('.lateral a.nav[data-h="#/caixa"]'); if (!a) return;
      let b = a.querySelector('.contador'); if (!b) { b = h('span', { class: 'contador', id: 'caixa-contador', 'aria-label': 'não lidos' }); a.appendChild(b); }
      b.textContent = c.naoLidos ? String(c.naoLidos) : ''; b.style.display = c.naoLidos ? '' : 'none';
    } catch (_) { /* sem contador */ }
  }

  async function caixa() {
    const d = await api('GET', '/api/caixa' + qs(F));
    const s = await api('GET', '/api/caixa/substituicoes');
    const refazer = () => { caixa(); atualizarContador(); };
    const abrir = async (i) => { try { await api('POST', '/api/caixa/' + i.item_id + '/lido'); } catch (_) { /* segue */ } atualizarContador(); if (i.link) location.hash = i.link; };
    const tratar = async (i) => { const o = await perguntar('Marcar como tratado', 'Observação (opcional)', { obrigatorio: false, longo: true, texto: 'Vale para todos que recebem este item.' }); if (o === null) return; try { await api('POST', '/api/caixa/' + i.item_id + '/tratar', { obs: o }); toast('Tratado.'); refazer(); } catch (e) { toast(e.message, true); refazer(); } };
    const reabrir = async (i) => { try { await api('POST', '/api/caixa/' + i.item_id + '/reabrir', {}); refazer(); } catch (e) { toast(e.message, true); } };
    const redirecionar = async (i) => {
      const pessoas = s.pessoas.filter((p) => p.usuario_id !== EU().usuario_id);
      const sel = h('select', { id: 'cx-red-para' }, pessoas.map((p) => h('option', { value: p.usuario_id }, p.nome)));
      const mot = h('input', { type: 'text', id: 'cx-red-motivo', placeholder: 'Motivo (opcional)' });
      const r = await janela('Redirecionar item', h('div', null, h('p', { class: 'mudo peq' }, 'A pessoa precisa ter a unidade na carteira.'), h('div', { class: 'campo' }, h('label', { for: 'cx-red-para' }, 'Para'), sel), h('div', { class: 'campo' }, h('label', { for: 'cx-red-motivo' }, 'Motivo'), mot)), [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Redirecionar', valor: 'ok' }]);
      if (r !== 'ok') return;
      try { await api('POST', '/api/caixa/' + i.item_id + '/redirecionar', { para_usuario_id: Number(sel.value), motivo: mot.value }); toast('Item redirecionado.'); refazer(); } catch (e) { toast(e.message, true); }
    };
    const historico = async (i) => {
      const x = await api('GET', '/api/caixa/' + i.item_id);
      await janela('Histórico do item', h('div', null, h('p', { class: 'mudo peq' }, 'Recebem: ' + x.destinatarios.map((p) => p.nome + (p.lido_em ? ' (leu ' + fmt.data(p.lido_em) + ')' : ' (não leu)')).join(', ')),
        tabela([{ t: 'Quando' }, { t: 'Quem' }, { t: 'O quê' }], x.historico.map((e) => [fmt.data(e.em), e.quem, e.acao + (e.detalhe ? ' — ' + e.detalhe : '')]))));
    };
    const card = (i) => h('div', { class: 'cartao cx-item' + (i.lido || i.tratado ? '' : ' nao-lido'), 'data-item': i.item_id },
      h('div', { class: 'linha espaco' }, h('div', null, selo(i.tipo_rotulo, tomTipo[i.tipo] || ''), ' ', i.em_substituicao_de ? selo('em substituição de ' + i.em_substituicao_de, 'atencao') : null, ' ', !i.lido && !i.tratado ? selo('não lido', 'alta') : null, ' ', i.tratado ? selo('tratado', 'ok') : selo('pendente', 'atencao')), h('span', { class: 'mudo peq' }, fmt.data(i.criado_em))),
      h('h3', { style: 'margin:6px 0 2px' }, i.titulo),
      h('p', { class: 'mudo peq', style: 'margin:0' }, [i.unidade, i.competencia_id ? 'competência ' + i.competencia_id.split('-').reverse().join('/') : null].filter(Boolean).join(' · '), i.texto ? ' — ' + i.texto : ''),
      i.tratado ? h('p', { class: 'peq', style: 'margin:4px 0' }, 'Tratado por ' + i.tratado_por + ' em ' + fmt.data(i.tratado_em) + (i.tratado_obs ? ' — ' + i.tratado_obs : '')) : null,
      h('div', { class: 'linha' }, i.link ? h('button', { class: 'cx-abrir', onclick: () => abrir(i) }, 'Abrir') : null,
        i.tratado ? h('button', { class: 'sec', onclick: () => reabrir(i) }, 'Reabrir') : h('button', { class: 'sec cx-tratar', onclick: () => tratar(i) }, 'Marcar como tratado'),
        h('button', { class: 'leve', onclick: () => redirecionar(i) }, 'Redirecionar'), h('button', { class: 'leve', onclick: () => historico(i) }, 'Histórico')));
    const opc = (id, rot, lista, v, fn) => h('div', { class: 'campo filtro' }, h('label', { for: id }, rot), h('select', { id, onchange: (e) => fn(e.target.value) }, lista.map(([k, t]) => h('option', Object.assign({ value: k }, String(k) === String(v) ? { selected: true } : {}), t))));

    // substituição
    const pessoas = s.pessoas;
    const ehSuper = ['superintendente', 'admin'].includes(EU().perfil);
    const hoje = new Date().toISOString().slice(0, 10);
    const f = { de: h('select', { id: 'sb-de' }, pessoas.map((p) => h('option', Object.assign({ value: p.usuario_id }, p.usuario_id === EU().usuario_id ? { selected: true } : {}), p.nome))),
      para: h('select', { id: 'sb-para' }, pessoas.filter((p) => p.usuario_id !== EU().usuario_id).map((p) => h('option', { value: p.usuario_id }, p.nome))),
      desde: h('input', { type: 'date', id: 'sb-desde', value: hoje }), ate: h('input', { type: 'date', id: 'sb-ate' }), motivo: h('input', { type: 'text', id: 'sb-motivo', placeholder: 'Ex.: férias' }) };
    const criarSub = async () => {
      try { await api('POST', '/api/caixa/substituicoes', { de_usuario_id: ehSuper ? Number(f.de.value) : undefined, para_usuario_id: Number(f.para.value), desde: f.desde.value, ate: f.ate.value, motivo: f.motivo.value }); toast('Caixa redirecionada.'); refazer(); } catch (e) { toast(e.message, true); }
    };
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Caixa de entrada'), h('p', null, 'Tudo que chegou das unidades e o que está a vencer, nas unidades da sua carteira. Quem divide a unidade com você recebe os mesmos itens; o primeiro que tratar marca para todos.'))),
      h('div', { class: 'filtros cartao' },
        opc('cx-f-un', 'Unidade', [['', 'Todas']].concat(d.unidades.map((u) => [u.contrato_id, u.unidade])), F.unidade, (v) => { F.unidade = v; caixa(); }),
        opc('cx-f-tipo', 'Tipo', [['', 'Todos']].concat(Object.entries(d.tipos)), F.tipo, (v) => { F.tipo = v; caixa(); }),
        opc('cx-f-sit', 'Situação', [['pendentes', 'Pendentes'], ['nao_lidos', 'Não lidos'], ['tratados', 'Tratados'], ['', 'Todos']], F.situacao, (v) => { F.situacao = v; caixa(); }),
        d.contagem.naoLidos ? h('button', { class: 'sec', id: 'cx-todos-lidos', onclick: async () => { await api('POST', '/api/caixa/lidos', {}); refazer(); } }, 'Marcar todos como lidos') : null),
      h('div', { class: 'kpis' }, h('div', { class: 'kpi' + (d.contagem.naoLidos ? ' atencao' : '') }, h('div', { class: 'r' }, 'Não lidos'), h('div', { class: 'num-grande' }, String(d.contagem.naoLidos))), h('div', { class: 'kpi' }, h('div', { class: 'r' }, 'Pendentes'), h('div', { class: 'num-grande' }, String(d.contagem.pendentes)))),
      h('div', { id: 'cx-lista' }, d.itens.length ? d.itens.map(card) : h('div', { class: 'cartao' }, h('p', { class: 'mudo' }, 'Nada por aqui para este filtro.'))),
      h('div', { class: 'cartao', id: 'cx-subst' }, h('h2', { style: 'margin-top:0' }, 'Ausência ou substituição'),
        h('p', { class: 'mudo peq' }, 'Redireciona a caixa para outra pessoa por um período. Os itens novos vão para o substituto, marcados "em substituição de ' + (EU().nome || 'você') + '", e ele(a) passa a abrir as unidades durante o período.'),
        h('div', { class: 'duas' }, ehSuper ? h('div', { class: 'campo' }, h('label', { for: 'sb-de' }, 'Caixa de'), f.de) : null, h('div', { class: 'campo' }, h('label', { for: 'sb-para' }, 'Substituto'), f.para),
          h('div', { class: 'campo' }, h('label', { for: 'sb-desde' }, 'De'), f.desde), h('div', { class: 'campo' }, h('label', { for: 'sb-ate' }, 'Até'), f.ate), h('div', { class: 'campo' }, h('label', { for: 'sb-motivo' }, 'Motivo'), f.motivo)),
        h('button', { id: 'sb-criar', onclick: criarSub }, 'Redirecionar a caixa'),
        s.substituicoes.length ? tabela([{ t: 'Caixa de' }, { t: 'Substituto' }, { t: 'Período' }, { t: 'Situação' }, { t: '' }], s.substituicoes.map((x) => [x.de_nome, x.para_nome, dataBr(x.desde) + ' a ' + dataBr(x.ate), selo(x.situacao, x.situacao === 'em vigor' ? 'ok' : ''),
          ['em vigor', 'agendada'].includes(x.situacao) ? h('button', { class: 'leve', onclick: async () => { try { await api('DELETE', '/api/caixa/substituicoes/' + x.subst_id); refazer(); } catch (e) { toast(e.message, true); } } }, 'Cancelar') : ''])) : null));
    atualizarContador();
  }

  async function minhas() {
    const d = await api('GET', '/api/caixa/minhas-unidades');
    const tomPrazo = (s) => (['vencido', 'entregue com atraso'].includes(s) ? 'alta' : (s === 'a vencer' ? 'atencao' : 'ok'));
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Minhas unidades'), h('p', null, d.todas ? 'Você vê todas as unidades (sem carteira definida).' : 'Unidades da sua carteira. Clique para abrir.'))),
      d.unidades.length ? h('div', { class: 'unidades-grid', id: 'mu-lista' }, d.unidades.map((u) => {
        const p = u.pior_prazo;
        return h('a', { class: 'cartao un-card', href: u.link, 'data-contrato': u.contrato_id, style: 'text-decoration:none;color:inherit;display:block' },
          h('h3', { style: 'margin:0' }, u.unidade), h('p', { class: 'mudo peq' }, [u.tipo, u.municipio].filter(Boolean).join(' · ') || ' '),
          h('div', null, selo(u.fase, ''), ' ', p ? selo('Prazo ' + p.canal + ' ' + p.situacao, tomPrazo(p.situacao)) : null, ' ', u.sem_gestor ? selo('aguardando gestor', 'atencao') : null),
          h('p', { class: 'peq' }, 'Pendências na caixa: ', h('strong', null, String(u.pendencias_caixa)), ' · Achados abertos: ', h('strong', null, String(u.achados.abertos)), ' · Divergências abertas: ', h('strong', null, String(u.divergencias_abertas))),
          h('p', { class: 'mudo peq' }, 'Última entrega: ' + (u.ultima_entrega ? fmt.data(u.ultima_entrega) : 'nenhuma ainda')));
      })) : h('div', { class: 'cartao' }, h('p', { class: 'mudo' }, 'Nenhuma unidade na sua carteira.')));
  }

  window.CTAI_CAIXA = { rotas: [['/caixa', caixa], ['/minhas-unidades', minhas]], atualizarContador };
})();
