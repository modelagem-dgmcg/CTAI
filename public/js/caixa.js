(function () {
  'use strict';
  // Caixa de entrada da CTAI: uma tela só, organizada por unidade (itens, situação, compartilhamento) e ausência/substituição.
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

  F.busca = F.busca || ''; F.abertas = F.abertas || {};
  const SIT = [['pendentes', 'Pendentes'], ['nao_lidos', 'Não lidos'], ['tratados', 'Tratados'], ['todos', 'Todos']];
  const tomPrazo = (x) => (['vencido', 'entregue com atraso'].includes(x) ? 'alta' : (x === 'a vencer' ? 'atencao' : 'ok'));
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Caixa de entrada única: um bloco por unidade, com tudo o que chegou, a situação e quem acompanha.
  async function caixa() {
    const d = await api('GET', '/api/caixa/unidades' + qs({ tipo: F.tipo, situacao: F.situacao === '' ? 'todos' : F.situacao }));
    const s = await api('GET', '/api/caixa/substituicoes');
    const rs = await api('GET', '/api/caixa/resumo');
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
    const faixa = (id, n, rot, tom, tipo, sit) => h('a', { href: '#/caixa', id: 'cx-rs-' + id, style: 'text-decoration:none;color:inherit', onclick: (e) => { e.preventDefault(); F.tipo = tipo || ''; F.situacao = sit || 'pendentes'; caixa(); } }, h('strong', { class: 'num-grande', style: 'font-size:20px' }, String(n)), ' ', h('span', { class: 'peq' }, rot));
    const card = (i) => h('div', { class: 'cartao cx-item' + (i.lido || i.tratado ? '' : ' nao-lido'), 'data-item': i.item_id },
      h('div', { class: 'linha espaco' }, h('div', null, selo(i.tipo_rotulo, tomTipo[i.tipo] || ''), ' ', i.em_substituicao_de ? selo('em substituição de ' + i.em_substituicao_de, 'atencao') : null, ' ', !i.lido && !i.tratado ? selo('não lido', 'alta') : null, ' ', i.tratado ? selo('tratado', 'ok') : selo('pendente', 'atencao')), h('span', { class: 'mudo peq' }, fmt.data(i.criado_em))),
      h('h3', { style: 'margin:6px 0 2px' }, i.titulo),
      h('p', { class: 'mudo peq', style: 'margin:0' }, [i.unidade, i.competencia_id ? 'competência ' + i.competencia_id.split('-').reverse().join('/') : null].filter(Boolean).join(' · '), i.texto ? ' — ' + i.texto : ''),
      i.tratado ? h('p', { class: 'peq', style: 'margin:4px 0' }, 'Tratado por ' + i.tratado_por + ' em ' + fmt.data(i.tratado_em) + (i.tratado_obs ? ' — ' + i.tratado_obs : '')) : null,
      h('div', { class: 'linha' }, i.link ? h('button', { class: 'cx-abrir', onclick: () => abrir(i) }, 'Abrir') : null,
        i.tratado ? h('button', { class: 'sec', onclick: () => reabrir(i) }, 'Reabrir') : h('button', { class: 'sec cx-tratar', onclick: () => tratar(i) }, 'Marcar como tratado'),
        h('button', { class: 'leve', onclick: () => redirecionar(i) }, 'Redirecionar'), h('button', { class: 'leve', onclick: () => historico(i) }, 'Histórico')));
    const opc = (id, rot, lista, v, fn) => h('div', { class: 'campo filtro' }, h('label', { for: id }, rot), h('select', { id, onchange: (e) => fn(e.target.value) }, lista.map(([k, t]) => h('option', Object.assign({ value: k }, String(k) === String(v) ? { selected: true } : {}), t))));


    // ---- Compartilhamento: liga/desliga por colega, dentro do bloco da unidade ----
    const compartilhar = async (u, p, ligado) => {
      try { await api('PUT', '/api/caixa/unidades/' + encodeURIComponent(u.contrato_id) + '/compartilhar/' + p.usuario_id, { ligado }); toast(ligado ? p.nome + ' passa a acompanhar ' + u.unidade + '.' : p.nome + ' deixa de acompanhar ' + u.unidade + '.'); } catch (e) { toast(e.message, true); }
      refazer();
    };
    const interruptor = (u, p) => {
      const ligado = u.equipe.includes(p.usuario_id);
      const bloqueado = !u.pode_compartilhar || (!p.tem_carteira && !ligado);
      const i = h('input', { type: 'checkbox', role: 'switch', class: 'cx-compart', 'data-pessoa': p.usuario_id, disabled: bloqueado, onchange: (e) => compartilhar(u, p, e.target.checked) });
      i.checked = ligado;
      return h('label', { class: 'ck interruptor' + (bloqueado ? ' mudo' : '') }, i, ' ', p.nome + (p.usuario_id === d.eu ? ' (você)' : ''), !p.tem_carteira ? h('span', { class: 'peq' }, ' · vê todas, sem carteira') : null);
    };

    // Só aparece quando alguém mais acompanha a unidade; do contrário fica um link discreto para compartilhar.
    const compartilhamento = (u) => {
      const outros = d.pessoas.filter((p) => u.equipe.includes(p.usuario_id) && p.usuario_id !== d.eu);
      if (!outros.length && !u.pode_compartilhar) return null;
      const painel = h('div', { class: 'interruptores' }, d.pessoas.map((p) => interruptor(u, p)));
      return h('details', { class: 'compart', open: false },
        h('summary', { class: 'peq' }, outros.length ? 'Compartilhada com ' + outros.map((p) => p.nome).join(', ') + ' · gerenciar' : 'Compartilhar esta unidade com um colega'),
        painel, u.pode_compartilhar ? null : h('p', { class: 'mudo peq', style: 'margin:4px 0 0' }, 'Só quem acompanha a unidade (ou a superintendência) muda o compartilhamento.'));
    };

    // ---- Bloco de uma unidade ----
    const bloco = (u) => {
      const abertoPadrao = u.nao_lidos > 0;
      const aberto = F.abertas[u.contrato_id] === undefined ? abertoPadrao : F.abertas[u.contrato_id];
      const pz = u.pior_prazo;
      const det = h('details', { class: 'cartao un-bloco', 'data-contrato': u.contrato_id },
        h('summary', null, h('span', { class: 'un-nome' }, h('strong', null, u.unidade), h('span', { class: 'mudo peq' }, ' ' + ([u.tipo, u.municipio].filter(Boolean).join(' · ')))),
          h('span', { class: 'un-selos' }, selo(u.fase, ''), pz ? selo('Prazo ' + pz.canal + ' ' + pz.situacao, tomPrazo(pz.situacao)) : null, u.sem_gestor ? selo('aguardando gestor', 'atencao') : null,
            u.nao_lidos ? selo(u.nao_lidos + ' não lido(s)', 'alta') : null, selo(u.itens.length + ' item(ns)', u.itens.length ? 'atencao' : 'ok'))),
        h('div', { class: 'un-corpo' },
          h('div', { class: 'linha espaco' }, h('p', { class: 'mudo peq', style: 'margin:0' }, 'Última entrega: ' + (u.ultima_entrega ? fmt.data(u.ultima_entrega) : 'nenhuma ainda') + ' · Achados abertos: ' + u.achados.abertos + ' · Divergências abertas: ' + u.divergencias_abertas),
            h('a', { class: 'btn sec', href: u.link }, 'Abrir conferência')),
          u.itens.length ? u.itens.map(card) : h('p', { class: 'mudo' }, 'Nada neste filtro para esta unidade.'),
          compartilhamento(u)));
      if (aberto) det.open = true;
      det.addEventListener('toggle', () => { F.abertas[u.contrato_id] = det.open; });
      return det;
    };

    // ---- Ausência / substituição (liga e desliga) ----
    const pessoas = s.pessoas;
    const ehSuper = ['superintendente', 'admin'].includes(EU().perfil);
    const hoje = new Date().toISOString().slice(0, 10);
    const minhas = s.substituicoes.filter((x) => ehSuper || x.de_usuario_id === EU().usuario_id);
    const ativas = minhas.filter((x) => ['em vigor', 'agendada'].includes(x.situacao));
    const ativarAusencia = async (modelo) => {
      const de = h('select', { id: 'sb-de' }, pessoas.map((p) => h('option', Object.assign({ value: p.usuario_id }, p.usuario_id === (modelo ? modelo.de_usuario_id : EU().usuario_id) ? { selected: true } : {}), p.nome)));
      const para = h('select', { id: 'sb-para' }, pessoas.filter((p) => p.usuario_id !== EU().usuario_id || ehSuper).map((p) => h('option', Object.assign({ value: p.usuario_id }, modelo && p.usuario_id === modelo.para_usuario_id ? { selected: true } : {}), p.nome)));
      const desde = h('input', { type: 'date', id: 'sb-desde', value: modelo && modelo.desde > hoje ? modelo.desde : hoje }), ate = h('input', { type: 'date', id: 'sb-ate', value: modelo ? modelo.ate : '' });
      const motivo = h('input', { type: 'text', id: 'sb-motivo', placeholder: 'Ex.: férias', value: modelo ? (modelo.motivo || '') : '' });
      const campo = (id, r, el) => h('div', { class: 'campo' }, h('label', { for: id }, r), el);
      const r = await janela('Ativar ausência', h('div', null, h('p', { class: 'mudo peq' }, 'Os itens novos vão para o substituto, marcados "em substituição de ...", e ele(a) passa a abrir as unidades durante o período.'),
        ehSuper ? campo('sb-de', 'Caixa de', de) : null, campo('sb-para', 'Substituto', para), campo('sb-desde', 'De', desde), campo('sb-ate', 'Até', ate), campo('sb-motivo', 'Motivo', motivo)),
        [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Ativar', valor: 'ok' }]);
      if (r !== 'ok') return;
      try { await api('POST', '/api/caixa/substituicoes', { de_usuario_id: ehSuper ? Number(de.value) : undefined, para_usuario_id: Number(para.value), desde: desde.value, ate: ate.value, motivo: motivo.value }); toast('Ausência ativada.'); refazer(); } catch (e) { toast(e.message, true); }
    };
    const desativar = async (x) => { try { await api('DELETE', '/api/caixa/substituicoes/' + x.subst_id); toast('Ausência desativada.'); refazer(); } catch (e) { toast(e.message, true); } };
    const painelAusencia = h('div', { class: 'cartao', id: 'cx-subst', style: 'padding:10px 14px' },
      h('div', { class: 'linha espaco' }, h('div', null, h('strong', null, 'Ausência / substituição '), ativas.length ? selo('ativa', 'ok') : selo('desligada', '')),
        ativas.length ? null : h('button', { class: 'sec', id: 'sb-ativar', onclick: () => ativarAusencia(null) }, 'Ativar ausência')),
      ativas.map((x) => h('div', { class: 'linha espaco', style: 'margin-top:8px' }, h('span', { class: 'peq' }, (ehSuper ? x.de_nome + ' → ' : 'Caixa → ') + x.para_nome + ' · ' + dataBr(x.desde) + ' a ' + dataBr(x.ate) + (x.motivo ? ' · ' + x.motivo : '')),
        h('button', { class: 'sec', onclick: () => desativar(x) }, 'Desativar'))),
      minhas.filter((x) => !['em vigor', 'agendada'].includes(x.situacao)).slice(0, 3).map((x) => h('div', { class: 'linha espaco mudo peq', style: 'margin-top:6px' }, h('span', null, (ehSuper ? x.de_nome + ' → ' : '') + x.para_nome + ' · ' + dataBr(x.desde) + ' a ' + dataBr(x.ate) + ' · ' + x.situacao),
        x.ate >= hoje && !ativas.length ? h('button', { class: 'leve', onclick: () => ativarAusencia(x) }, 'Reativar') : null)));

    // ---- Lista de unidades (com busca na hora) ----
    const lista = h('div', { id: 'cx-lista' });
    const desenharLista = () => {
      const q = norm(F.busca);
      const un = d.unidades.filter((u) => !q || norm(u.unidade + ' ' + (u.municipio || '')).includes(q));
      const vazio = d.geral.length === 0 && !un.length;
      lista.replaceChildren(...un.map(bloco).concat([
        d.geral.length && !q ? h('div', { class: 'cartao' }, h('h3', null, 'Geral (sem unidade)'), d.geral.map(card)) : null,
        vazio ? h('div', { class: 'cartao' }, h('p', { class: 'mudo' }, 'Nenhuma unidade encontrada.')) : null].filter(Boolean)));
    };
    const busca = h('input', { type: 'search', id: 'cx-busca', placeholder: 'Buscar unidade ou município…', value: F.busca, 'aria-label': 'Buscar unidade', oninput: (e) => { F.busca = e.target.value; desenharLista(); } });
    desenharLista();

    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Caixa de entrada'), h('p', null, d.todas ? 'Tudo que chegou das unidades, por unidade. Você vê todas (sem carteira definida).' : 'Tudo que chegou das unidades da sua carteira, reunido por unidade. Quem divide a unidade com você recebe os mesmos itens; o primeiro que tratar marca para todos.'))),
      window.CTAI_COMECE ? window.CTAI_COMECE.cartao() : null,
      h('div', { class: 'cartao cx-resumo', id: 'cx-resumo', style: 'padding:10px 14px' }, h('div', { class: 'linha', style: 'gap:18px;flex-wrap:wrap' },
        faixa('nao_lidos', rs.naoLidos, 'não lidos', rs.naoLidos ? 'atencao' : '', '', 'nao_lidos'), faixa('prazos', rs.prazos_vencidos, 'prazo(s) vencido(s)', rs.prazos_vencidos ? 'alta' : '', 'prazo_vencido'),
        faixa('prazos2', rs.prazos_a_vencer, 'a vencer', rs.prazos_a_vencer ? 'atencao' : '', 'prazo_vencer'), faixa('resp', rs.respostas, 'achado(s) com resposta', rs.respostas ? 'atencao' : '', 'resposta'),
        faixa('semg', rs.sem_gestor, 'unidade(s) sem gestor', rs.sem_gestor ? 'atencao' : '', 'sem_gestor'))),
      h('div', { class: 'filtros cartao' },
        h('div', { class: 'campo filtro' }, h('label', { for: 'cx-busca' }, 'Unidade'), busca),
        opc('cx-f-tipo', 'Tipo', [['', 'Todos']].concat(Object.entries(d.tipos)), F.tipo, (v) => { F.tipo = v; caixa(); }),
        opc('cx-f-sit', 'Situação', SIT, F.situacao === '' ? 'todos' : F.situacao, (v) => { F.situacao = v; caixa(); }),
        d.contagem.naoLidos ? h('button', { class: 'sec', id: 'cx-todos-lidos', onclick: async () => { await api('POST', '/api/caixa/lidos', {}); refazer(); } }, 'Marcar todos como lidos') : null),
      painelAusencia, lista);
    atualizarContador();
  }

  window.CTAI_CAIXA = { rotas: [['/caixa', caixa], ['/minhas-unidades', () => { location.replace('#/caixa'); }]], atualizarContador };
})();
