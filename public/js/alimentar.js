(function () {
  'use strict';
  // "Alimentar o Analista": primeiro acesso. Soltar vários arquivos, acompanhar a leitura, conferir em lote e liberar o menu completo.
  const { h, api, toast, confirmar, aviso, montar } = window.CTAI;
  const ANO = new Date().getFullYear();
  const TRIS = []; for (let a = ANO; a >= ANO - 4; a--) for (let t = 4; t >= 1; t--) TRIS.push(a + '-T' + t);
  const ROTULO = {
    fila: 'Na fila', lendo: 'Lendo e mascarando dados pessoais', montando: 'Montando o rascunho',
    pronto: 'Conferido pelo sistema, aguarda sua aprovação', aprovado: 'Aprovado', duplicado: 'Já importado antes',
    problema: 'Com problema', precisa_dados: 'Precisa da unidade e do trimestre',
  };
  const OCUPADO = ['fila', 'lendo', 'montando'];
  const resumoMasc = (m) => Object.entries(m || {}).map(([k, v]) => v + ' ' + k).join(', ');

  async function enviar(arq) {
    const r = await fetch('/api/alimentar/arquivo', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-ctai': '1', 'x-nome-arquivo': encodeURIComponent(arq.name) }, body: arq });
    let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok) throw new Error((j && j.erro) || 'Não consegui enviar ' + arq.name + ' (' + r.status + ').');
    return j;
  }

  async function tela() {
    let est = null, assinatura = '', enviando = null, timer = null;
    const marcados = new Set(); const escolhas = new Map();
    const raiz = h('div', { id: 'al-raiz' });
    const entrada = h('input', { type: 'file', id: 'al-arquivos', multiple: true, accept: '.zip,.pdf,.docx,.xlsx,.csv,.txt', style: 'display:none' });

    async function receber(lista) {
      const arqs = Array.from(lista || []); if (!arqs.length) return;
      for (let i = 0; i < arqs.length; i++) {
        enviando = { n: i + 1, total: arqs.length, nome: arqs[i].name }; desenhar(true);
        try { await enviar(arqs[i]); } catch (e) { toast(e.message, true); }
        await atualizar();
      }
      enviando = null; entrada.value = ''; await atualizar(); desenhar(true);
    }

    const zona = h('div', { class: 'cartao', id: 'al-zona', style: 'border:2px dashed #d97706;text-align:center;padding:28px', tabindex: '0', role: 'button', 'aria-label': 'Soltar arquivos aqui ou escolher no computador',
      ondragover: (ev) => { ev.preventDefault(); zona.style.background = '#fff7ed'; }, ondragleave: () => { zona.style.background = ''; },
      ondrop: (ev) => { ev.preventDefault(); zona.style.background = ''; receber(ev.dataTransfer.files); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); entrada.click(); } } },
      h('h3', null, 'Solte aqui os relatórios e pareceres'),
      h('p', { class: 'peq mudo' }, 'Pode soltar vários de uma vez: ZIP, PDF, Word, Excel, CSV ou TXT (até 4 MB por arquivo). PDF escaneado, só imagem, não é lido.'),
      h('button', { class: 'sec', onclick: () => entrada.click() }, 'Escolher arquivos no computador'));
    entrada.addEventListener('change', () => receber(entrada.files));

    function linha(i) {
      const ocup = OCUPADO.includes(i.estado);
      const ident = i.estado === 'precisa_dados' ? (() => {
        const e = escolhas.get(i.id) || { contrato_id: i.contrato_id || (est.unidades.length === 1 ? est.unidades[0].contrato_id : ''), trimestre: i.trimestre || '' };
        escolhas.set(i.id, e);
        const su = h('select', { 'aria-label': 'Unidade', onchange: (ev) => { e.contrato_id = ev.target.value; } }, h('option', { value: '' }, 'Unidade...'), est.unidades.map((u) => h('option', { value: u.contrato_id, selected: u.contrato_id === e.contrato_id }, u.unidade)));
        const st = h('select', { 'aria-label': 'Trimestre', onchange: (ev) => { e.trimestre = ev.target.value; } }, h('option', { value: '' }, 'Trimestre...'), TRIS.map((t) => h('option', { value: t, selected: t === e.trimestre }, t)));
        return h('div', { class: 'linha' }, su, st, h('button', { class: 'leve', onclick: async () => {
          if (!e.contrato_id || !e.trimestre) { toast('Escolha a unidade e o trimestre.', true); return; }
          try { await api('POST', '/api/alimentar/' + i.id + '/identificar', e); await atualizar(); desenhar(true); } catch (er) { toast(er.message, true); } } }, 'Continuar'));
      })() : null;
      const marca = i.estado === 'pronto' ? h('input', { type: 'checkbox', checked: marcados.has(i.id), 'aria-label': 'Selecionar ' + i.nome, onchange: (ev) => { if (ev.target.checked) marcados.add(i.id); else marcados.delete(i.id); } }) : null;
      return h('tr', { 'data-estado': i.estado },
        h('td', null, marca),
        h('td', null, h('strong', null, i.nome), i.unidade || i.trimestre ? h('div', { class: 'peq mudo' }, [i.unidade, i.trimestre].filter(Boolean).join(' · ')) : null),
        h('td', null, (ocup ? '⏳ ' : i.estado === 'problema' ? '⚠ ' : i.estado === 'aprovado' ? '✓ ' : '') + ROTULO[i.estado], i.motivo ? h('div', { class: 'peq mudo' }, i.motivo) : null, ident),
        h('td', { class: 'peq' }, resumoMasc(i.mascarados) || '—'),
        h('td', { class: 'peq' }, (i.divergencias || []).length ? h('ul', { style: 'margin:0;padding-left:16px' }, i.divergencias.map((d) => h('li', null, d))) : '—'),
        h('td', null, i.hist_id && ['pronto', 'aprovado', 'duplicado'].includes(i.estado) ? h('a', { href: '#/historico/r/' + i.hist_id }, 'Abrir') : null,
          !ocup && i.estado !== 'aprovado' ? h('button', { class: 'leve', onclick: async () => { try { await api('DELETE', '/api/alimentar/' + i.id); await atualizar(); desenhar(true); } catch (er) { toast(er.message, true); } } }, 'Tirar') : null));
    }

    function desenhar(forcar) {
      if (!est) return;
      const sig = JSON.stringify([est, enviando]);
      if (!forcar && sig === assinatura) return; assinatura = sig;
      const r = est.resumo;
      const prontos = est.itens.filter((i) => i.estado === 'pronto');
      const limpos = prontos.filter((i) => !(i.divergencias || []).length);
      const andamento = enviando ? 'Enviando ' + enviando.n + ' de ' + enviando.total + ': ' + enviando.nome : r.pendentes ? r.pendentes + ' em processamento...' : '';
      raiz.replaceChildren(
        h('h2', null, 'Alimentar o Analista'),
        est.trava ? aviso('info', 'Para começar, envie os relatórios e pareceres que a unidade já tem. O sistema lê, tabula e confere enquanto você acompanha. O menu completo abre quando o envio terminar.')
          : aviso('ok', 'Seu acesso está liberado. Você pode continuar enviando arquivos por aqui.'),
        aviso('atencao', h('strong', null, 'Antes de enviar: '), 'remova dados de paciente (nome, CPF, telefone, endereço, prontuário) quando for fácil. O sistema mascara esses dados antes de guardar e antes de qualquer envio à IA, e não guarda o arquivo original, mas a máscara não é perfeita.'),
        est.ia.pronta ? null : aviso('atencao', h('strong', null, 'Leitura por IA desligada. '), est.ia.mensagem),
        zona, entrada,
        andamento ? h('p', { class: 'peq', id: 'al-andamento', role: 'status' }, '⏳ ' + andamento) : null,
        est.itens.length ? h('div', { class: 'cartao' },
          h('h3', null, 'Arquivos'),
          h('p', { class: 'peq', id: 'al-resumo' }, r.lidos + ' lidos, ' + r.problemas + ' com problema' + (r.precisaDados ? ', ' + r.precisaDados + ' esperando você' : '') + (r.aprovados ? ', ' + r.aprovados + ' aprovados' : '') + '.'),
          h('div', { class: 'rolagem' }, h('table', null,
            h('thead', null, h('tr', null, ['', 'Arquivo', 'Andamento', 'Dados pessoais mascarados', 'Divergências', ''].map((t) => h('th', null, t)))),
            h('tbody', null, est.itens.map(linha)))),
          prontos.length ? h('div', { class: 'linha', id: 'al-lote' },
            h('button', { id: 'al-aprovar-sel', onclick: () => aprovar(Array.from(marcados)) }, 'Aprovar selecionados'),
            limpos.length ? h('button', { class: 'sec', id: 'al-aprovar-limpos', onclick: () => aprovar(limpos.map((i) => i.id)) }, 'Aprovar todos sem divergência (' + limpos.length + ')') : null,
            h('span', { class: 'peq mudo' }, 'Só o que for aprovado entra nos cruzamentos. Rascunho em branco precisa ser aberto e preenchido antes.')) : null,
          r.problemas || r.precisaDados ? h('div', { class: 'linha' }, h('button', { class: 'leve', id: 'al-pular', onclick: pular }, 'Pular os que deram problema')) : null) : null,
        est.trava ? h('div', { class: 'cartao' },
          h('h3', null, 'Terminou?'),
          h('p', { class: 'peq' }, est.podeLiberar ? 'Tudo foi lido. Você pode abrir o menu completo e continuar a conferência depois, pelo Histórico.' : r.pendentes ? 'Aguarde o fim da leitura.' : r.precisaDados ? 'Indique a unidade e o trimestre dos arquivos que esperam, ou use "Pular os que deram problema".' : 'Envie ao menos um arquivo. Se não tiver nenhum agora, peça à administração para liberar o seu acesso.'),
          h('button', { id: 'al-liberar', disabled: !est.podeLiberar, onclick: liberar }, 'Concluir e abrir o menu completo')) : null);
    }

    async function aprovar(ids) {
      if (!ids.length) { toast('Marque ao menos um arquivo.', true); return; }
      try {
        const o = await api('POST', '/api/alimentar/aprovar', { ids });
        ids.forEach((id) => marcados.delete(id));
        toast(o.aprovados + ' aprovado(s)' + (o.falhas.length ? ', ' + o.falhas.length + ' não puderam ser aprovados: ' + o.falhas[0].motivo : '') + '.', !!o.falhas.length && !o.aprovados);
        await atualizar(); desenhar(true);
      } catch (e) { toast(e.message, true); }
    }
    async function pular() {
      try { const o = await api('POST', '/api/alimentar/pular-problemas', {}); toast(o.puladas + ' arquivo(s) pulados.'); await atualizar(); desenhar(true); } catch (e) { toast(e.message, true); }
    }
    async function liberar() {
      if (!(await confirmar('Abrir o menu completo?', 'Os arquivos ainda não aprovados ficam como rascunho no Histórico, para você conferir depois.', 'Abrir'))) return;
      try { await api('POST', '/api/alimentar/liberar', {}); location.hash = '#/'; location.reload(); } catch (e) { toast(e.message, true); }
    }
    async function atualizar() { est = await api('GET', '/api/alimentar/estado'); }

    await atualizar(); montar(raiz); desenhar(true);
    clearInterval(window.__alTimer);
    timer = window.__alTimer = setInterval(async () => {
      if (!document.getElementById('al-raiz')) { clearInterval(timer); return; }
      if (enviando) return;
      try { await atualizar(); desenhar(false); } catch (_) { /* tenta de novo */ }
    }, 1500);
  }

  window.CTAI_ALIMENTAR = { rotas: [['/alimentar', tela]], tela };
})();
