(function () {
  'use strict';
  // Importar Arquivos (etapa 1 da página da unidade). A analista baixa o ZIP, PDF ou Word do SEI e solta aqui.
  // Reaproveita o fluxo do "Alimentar o Analista": o ZIP é aberto no navegador, o PDF é lido na máquina e só o texto (já mascarado) sobe.
  // A tela já nasce amarrada à unidade e ao trimestre da página. O sistema dá o "check" na lista de conferência da unidade.
  const anterior = (t) => { const m = /^(\d{4})-T([1-4])$/.exec(t || ''); if (!m) return ''; return Number(m[2]) === 1 ? (Number(m[1]) - 1) + '-T4' : m[1] + '-T' + (Number(m[2]) - 1); };
  const { h, api, toast, janela, confirmar, aviso, selo } = window.CTAI;
  const AL = () => window.CTAI_ALIMENTAR.base;
  const NOMES_FONTE = { unidade: 'Da unidade, pelo SEI', gerado_simas: 'Gerado no SIMAS pela analista', pedida_setor: 'Pedida pela CTAI a outro setor', processo_parecer: 'Dentro do processo do parecer', fonte_externa: 'Fonte externa (consulta da analista)' };
  const TAG_FONTE = { gerado_simas: 'gerado no SIMAS', pedida_setor: 'pedida a outro setor', processo_parecer: 'no processo do parecer', fonte_externa: 'fonte externa' };
  const SITUACAO = { nao_pedido: 'Não pedido', pedido: 'Pedido', recebido: 'Recebido' };
  const SOLTOS = /\.(zip|pdf|docx)$/i;      // o que a analista solta
  const DENTRO_DO_ZIP = /\.(pdf|docx|html?)$/i; // o que o ZIP do SEI traz e é lido
  const fmtData = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR') + ' ' + new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const trocar = (el, ...cs) => el.replaceChildren(...cs.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const reduzido = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const ICONE_OK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path class="al-tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICONE_X = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 6v7M12 17.5v.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
  const ICONE_MEIO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 12h10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

  // ---------- editor da lista de conferência ----------
  async function editarLista(contratoId, aoFechar) {
    let v;
    try { v = await api('GET', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista'); } catch (e) { toast(e.message, true); return; }
    let itens = (v.rascunho ? v.rascunho.itens : v.efetiva.itens).map((i) => Object.assign({}, i));
    const caixa = h('div', { class: 'imp-ed' });
    const msg = h('div', { class: 'msg-erro', role: 'alert' });
    const redesenhar = () => {
      const cab = [];
      if (v.modelo) cab.push(h('p', { class: 'peq' }, 'Proposta a partir do relatório de ', h('strong', null, v.modelo.trimestre || 'trimestre anterior'), ' (', v.modelo.nome_arquivo || 'arquivo', ').'));
      if (v.rascunho && v.rascunho.nota) cab.push(h('p', { class: 'peq mudo' }, v.rascunho.nota));
      if (!v.rascunho) cab.push(aviso(v.efetiva.origem === 'catalogo' ? 'atencao' : 'info', v.efetiva.aviso || ('Lista confirmada, versão ' + v.efetiva.versao + '. Ao salvar, nasce uma versão nova.')));
      cab.push(h('p', { class: 'peq mudo' }, 'Renomeie, marque como opcional, mude a periodicidade ou tire o que não vale. A lista só passa a valer depois que você confirmar.'));
      trocar(caixa, cab,
        itens.map((it, k) => h('div', { class: 'imp-ed-item', 'data-codigo': it.codigo || '' },
          h('div', { class: 'imp-ed-linha' },
            h('label', { class: 'imp-ed-nome' }, h('span', { class: 'peq mudo' }, 'Nome do item'), h('input', { type: 'text', value: it.nome || '', 'aria-label': 'Nome do item ' + (k + 1), oninput: (ev) => { it.nome = ev.target.value; } })),
            h('button', { type: 'button', class: 'sec', 'aria-label': 'Tirar ' + (it.nome || 'item'), onclick: () => { itens.splice(k, 1); redesenhar(); } }, 'Tirar')),
          h('div', { class: 'imp-ed-linha' },
            h('label', { class: 'imp-ed-chk' }, h('input', Object.assign({ type: 'checkbox', onchange: (ev) => { it.obrigatorio = ev.target.checked; } }, it.obrigatorio ? { checked: true } : {})), ' Obrigatório'),
            h('label', null, h('span', { class: 'peq mudo' }, 'Quando chega'), h('select', { onchange: (ev) => { it.periodicidade = ev.target.value; } }, [['mensal', 'Todo mês'], ['trimestral', 'Uma vez no trimestre']].map(([val, r]) => h('option', Object.assign({ value: val }, it.periodicidade === val ? { selected: true } : {}), r)))),
            h('label', null, h('span', { class: 'peq mudo' }, 'De onde vem'), h('select', { onchange: (ev) => { it.origem = ev.target.value; } }, Object.entries(NOMES_FONTE).map(([val, r]) => h('option', Object.assign({ value: val }, it.origem === val ? { selected: true } : {}), r))))),
          h('label', null, h('span', { class: 'peq mudo' }, 'Palavras no nome do arquivo (separe por vírgula)'), h('input', { type: 'text', value: (it.palavras || []).join(', '), oninput: (ev) => { it.palavras = ev.target.value.split(',').map((x) => x.trim()).filter(Boolean); } })),
          it.trecho ? h('p', { class: 'peq mudo imp-ed-trecho' }, 'No modelo: “' + it.trecho + '”', it.fonte_ia ? ' · sugerido pela IA' : '') : null)),
        h('div', { class: 'linha' },
          h('button', { type: 'button', class: 'sec', id: 'imp-ed-novo', onclick: () => { itens.push({ codigo: '', nome: '', obrigatorio: true, periodicidade: 'mensal', origem: 'unidade', palavras: [] }); redesenhar(); const ult = caixa.querySelectorAll('.imp-ed-nome input'); if (ult.length) ult[ult.length - 1].focus(); } }, '+ Adicionar item'),
          v.padrao_disponivel ? h('button', { type: 'button', class: 'sec', id: 'imp-ed-padrao', onclick: async () => { if (!(await salvar(false))) return; try { const o = await api('POST', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista/completar-padrao', {}); toast(o.acrescentados ? o.acrescentados + ' item(ns) da lista padrão acrescentados.' : 'A lista padrão não traz nada a mais.'); v = await api('GET', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista'); itens = v.rascunho.itens.map((i) => Object.assign({}, i)); redesenhar(); } catch (e) { msg.textContent = e.message; } } }, 'Acrescentar itens da lista padrão') : null,
          v.rascunho ? h('button', { type: 'button', class: 'leve', id: 'imp-ed-descartar', onclick: async () => { if (!(await confirmar('Descartar o rascunho?', 'A lista em vigor continua como está.', 'Descartar', true))) return; try { await api('POST', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista/descartar', {}); fecharFlag = true; fechar(); } catch (e) { msg.textContent = e.message; } } }, 'Descartar rascunho') : null),
        msg);
    };
    const salvar = async (aviso1) => {
      msg.textContent = '';
      if (itens.some((i) => !String(i.nome || '').trim())) { msg.textContent = 'Todo item precisa de nome.'; return false; }
      try { await api('PUT', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista', { itens }); if (aviso1) toast('Rascunho salvo.'); return true; } catch (e) { msg.textContent = e.message; return false; }
    };
    let fecharFlag = false;
    const fechar = () => { const d = document.querySelector('dialog[open]'); if (d) d.close(); };
    redesenhar();
    const p = janela('Lista de conferência da unidade', caixa, [
      { rotulo: 'Fechar', valor: null, sec: true },
      { rotulo: 'Salvar rascunho', valor: 'rascunho', sec: true, validar: () => salvar(true) },
      { rotulo: 'Confirmar a lista', valor: 'confirmar', validar: async () => {
        if (!(await salvar(false))) return false;
        if (!itens.length) { msg.textContent = 'Acrescente ao menos um item.'; return false; }
        try { const o = await api('POST', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista/confirmar', {}); toast('Lista confirmada (versão ' + o.versao + ', ' + o.itens + ' itens).'); return true; } catch (e) { msg.textContent = e.message; return false; }
      } },
    ]);
    const r = await p;
    if (aoFechar) aoFechar(r === 'confirmar' || r === 'rascunho' || fecharFlag);
  }

  // O que o sistema leu do relatório-modelo (seções, quadros, indicadores e fontes).
  // Números do consolidado do SIMAS: a leitura só propõe; a analista confirma (e confirma o mês dos blocos de indicadores).
  async function verSimas(contratoId, tri, depois) {
    let v;
    try { v = await api('GET', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/' + tri + '/simas'); } catch (e) { toast(e.message, true); return; }
    if (!v.lido) { toast('O consolidado do SIMAS ainda não foi lido neste trimestre.', true); return; }
    const fmtN = (x) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
    const msg = h('p', { class: 'peq', id: 'imp-simas-msg', role: 'status' });
    const cab = v.cabecalho || {};
    const selMes = {}; // ocorrência -> select
    const fechar = () => { const d = document.querySelector('dialog .imp-simas'); const dlg = d && d.closest('dialog'); if (dlg) dlg.close(); };
    const rotMes = (m) => { const [a, mm] = String(m).split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1] + '/' + a; };
    const ordem = h('div', { class: 'imp-simas-ordem' }, h('p', { class: 'peq' }, h('strong', null, 'Mês de cada bloco de indicadores. '), 'O PDF repete os indicadores ' + v.ordem_meses.length + ' vezes sem dizer o mês. Presumi pela ordem em que aparecem; ', h('strong', null, 'confira e ajuste'), ' antes de confirmar.'),
      v.ordem_meses.map((o) => { const sel = h('select', { 'aria-label': 'Mês do bloco ' + o.ocorrencia }, v.ordem_meses.map((o2) => h('option', Object.assign({ value: o2.mes }, o2.mes === o.mes ? { selected: true } : {}), rotMes(o2.mes)))); selMes[o.ocorrencia] = sel;
        return h('label', { class: 'linha' }, 'Bloco ' + o.ocorrencia + ': ', sel, o.estado === 'confirmado' ? selo('confirmado', 'ok') : selo('presumido pela ordem, conferir', 'atencao')); }));
    const prod = v.numeros.filter((n) => n.tipo !== 'indicador');
    const grupos = [...new Set(prod.map((n) => n.secao + '|' + n.grupo))];
    const tabelaProd = grupos.map((g) => { const linhas = prod.filter((n) => n.secao + '|' + n.grupo === g);
      return h('details', { class: 'imp-simas-grupo' }, h('summary', null, g.replace('|', ' · ') + ' (' + linhas.filter((n) => n.tipo === 'producao').length + ' linhas)'),
        h('table', { class: 'tabela' }, h('thead', null, h('tr', null, ['Descrição', 'Previsto', 'Realizado', 'Atingido %', ''].map((t) => h('th', null, t)))),
          h('tbody', null, linhas.map((n) => h('tr', { class: n.tipo === 'total_grupo' ? 'imp-total' : '' }, h('td', null, n.descricao), h('td', { class: 'num' }, fmtN(n.previsto)), h('td', { class: 'num' }, fmtN(n.realizado)), h('td', { class: 'num' }, n.pct === null ? '—' : fmtN(n.pct) + '%'), h('td', null, n.sem_meta ? 'sem meta' : '')))))); });
    const ind = v.numeros.filter((n) => n.tipo === 'indicador');
    const tabelaInd = ind.length ? h('details', { class: 'imp-simas-grupo' }, h('summary', null, 'Indicadores (' + ind.length + ')'),
      h('table', { class: 'tabela' }, h('thead', null, h('tr', null, ['Indicador', 'Bloco', 'Meta', 'Realizado', 'Atingido'].map((t) => h('th', null, t)))),
        h('tbody', null, ind.map((n) => h('tr', null, h('td', null, n.descricao), h('td', null, 'bloco ' + n.ocorrencia + ' · ' + rotMes(n.mes) + (n.mes_estado === 'confirmado' ? '' : ' (presumido)')), h('td', null, n.regra), h('td', { class: 'num' }, fmtN(n.realizado)), h('td', null, n.atingido)))))) : null;
    const divs = v.divergencias.length ? h('div', { class: 'imp-simas-divs', id: 'imp-simas-divs' }, h('h3', null, 'Para conferir (' + v.divergencias.length + ')'), h('p', { class: 'peq mudo' }, 'O sistema só sinaliza as diferenças entre o SIMAS, o RM (Anexo I) e a planilha de monitoramento. Não diz qual está certo. Cada uma virou um achado "A CONFERIR" desta unidade, na ', h('a', { href: '#/analista' }, 'Fila de achados'), ', onde você fixa ou descarta com motivo.'),
      h('ul', null, v.divergencias.map((d) => h('li', null, h('strong', null, d.indicador), ' · ', d.detalhe, d.nota ? h('div', { class: 'peq mudo' }, d.nota) : null)))) : h('p', { class: 'peq mudo' }, 'Nenhuma diferença para sinalizar com os números lidos até agora.');
    const fim = h('div', { class: 'linha' },
      h('button', { type: 'button', id: 'imp-simas-confirmar', disabled: !v.resumo.propostos, onclick: async () => {
        const om = {}; for (const [k, sel] of Object.entries(selMes)) om[k] = sel.value;
        try { const r = await api('POST', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/' + tri + '/simas/confirmar', { ordem_meses: om }); toast(r.confirmados + ' número(s) confirmado(s).'); fechar(); depois(); } catch (e) { msg.textContent = e.message; }
      } }, v.resumo.propostos ? 'Confirmar ' + v.resumo.propostos + ' números' : 'Tudo confirmado'),
      h('button', { type: 'button', class: 'sec', id: 'imp-simas-achados', onclick: async () => { try { const r = await api('POST', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/' + tri + '/simas/achados', {}); toast(r.novos ? r.novos + ' ponto(s) a conferir na Fila de achados.' : 'Nenhum ponto novo para a Fila de achados.'); } catch (e) { msg.textContent = e.message; } } }, 'Atualizar os achados (depois de ler o RM)'),
      h('button', { type: 'button', class: 'leve', onclick: () => fechar() }, 'Fechar'));
    const corpo = h('div', { class: 'imp-est imp-simas' },
      h('p', { class: 'peq' }, (cab.unidade || '') + (cab.periodos && cab.periodos.length ? ' · período ' + cab.periodos.map(rotMes).join(', ') : '') + (cab.gerado_por ? ' · gerado por ' + cab.gerado_por : '') + (cab.gerado_em ? ' em ' + new Date(cab.gerado_em).toLocaleString('pt-BR') : '')),
      (v.avisos || []).length ? aviso('atencao', v.avisos.join(' ')) : null,
      h('p', { class: 'peq mudo' }, v.resumo.grupos + ' grupos, ' + v.resumo.linhas + ' linhas, ' + v.resumo.indicadores + ' indicadores. Nada é definitivo até você confirmar.'),
      ordem, tabelaProd, tabelaInd, divs, msg, fim);
    janela('Números do SIMAS · ' + tri, corpo, []);
  }
  async function verEstrutura(contratoId) {
    let v;
    try { v = await api('GET', '/api/importar/unidade/' + encodeURIComponent(contratoId) + '/lista'); } catch (e) { toast(e.message, true); return; }
    const m = v.modelo; if (!m) return;
    const bloco = (tit, lista, f) => h('div', { class: 'imp-est' }, h('h3', null, tit + ' (' + lista.length + ')'), lista.length ? h('ul', { class: 'peq' }, lista.slice(0, 40).map((x) => h('li', null, f(x)))) : h('p', { class: 'peq mudo' }, 'Nada encontrado.'));
    await janela('O que foi lido no relatório-modelo', h('div', null,
      h('p', { class: 'peq mudo' }, (m.nome_arquivo || 'Relatório') + (m.trimestre ? ' · ' + m.trimestre : '') + ' · ' + (m.caracteres || 0).toLocaleString('pt-BR') + ' caracteres, já sem dados pessoais. O texto completo fica guardado para o Redator.'),
      bloco('Seções', m.secoes, (x) => (x.numero ? x.numero + ' ' : '') + x.titulo),
      bloco('Quadros e tabelas', m.tabelas, (x) => x.titulo),
      bloco('Indicadores', m.indicadores, (x) => (x.numero ? x.numero + ' ' : '') + x.nome),
      bloco('Fontes e anexos citados', m.fontes, (x) => x.nome + ' · ' + NOMES_FONTE[x.origem] + ' · ' + (x.periodicidade === 'mensal' ? 'mensal' : 'trimestral') + (x.vezes > 1 ? ' · citado ' + x.vezes + ' vezes' : ''))));
  }

  // ---------- a etapa ----------
  // opc: { contratoId, tri, estado (já carregado), aoMudar(estado) }
  async function preencher(raiz, opc) {
    const { contratoId, tri } = opc;
    const u = '/api/importar/unidade/' + encodeURIComponent(contratoId);
    let est = opc.estado || null;
    let trabalhando = false, parar = false, mensagem = '', fase = '';
    let enviandoId = null;
    const lote = []; // arquivos da última soltura: { id, nome, estado, msg }
    const totais = { paginas: 0, protegidos: 0 };
    const abaixo = h('div', { class: 'imp-corpo' });
    raiz.replaceChildren(abaixo);
    const statusEl = h('p', { class: 'al-status', role: 'status', 'aria-live': 'polite', hidden: true });
    const hostModelo = h('div', { id: 'imp-modelo' });
    const hostPainel = h('div', { id: 'imp-painel-host' });
    const hostLista = h('div', { id: 'imp-lista-host' });
    const hostFim = h('div', { id: 'imp-fim' });
    const entrada = h('input', { type: 'file', id: 'imp-arquivos', multiple: true, accept: '.zip,.pdf,.docx', style: 'display:none', 'aria-label': 'Escolher arquivos' });
    const entradaModelo = h('input', { type: 'file', id: 'imp-modelo-arquivo', accept: '.zip,.pdf,.docx', style: 'display:none', 'aria-label': 'Escolher o relatório do trimestre anterior' });
    const dica = (txt) => h('p', { class: 'al-dica' }, txt);

    // ----- soltar -----
    let cadeia = Promise.resolve();
    const receber = (lista, modelo) => {
      const arqs = Array.from(lista || []); if (!arqs.length) return;
      cadeia = cadeia.then(() => soltar(arqs, modelo)).catch((e) => { toast(e.message, true); });
      entrada.value = ''; entradaModelo.value = '';
    };
    const zona = (id, titulo, textoDica, botao, modelo) => {
      const el = h('div', { class: 'cartao al-zona imp-zona', id, tabindex: '0', role: 'button', 'aria-label': titulo,
        ondragover: (ev) => { ev.preventDefault(); el.classList.add('sobre'); }, ondragleave: () => el.classList.remove('sobre'),
        ondrop: (ev) => { ev.preventDefault(); el.classList.remove('sobre'); receber(ev.dataTransfer.files, modelo); },
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); (modelo ? entradaModelo : entrada).click(); } } },
        h('h3', null, titulo), dica(textoDica), h('button', { type: 'button', class: modelo ? '' : 'sec', onclick: (ev) => { ev.stopPropagation(); (modelo ? entradaModelo : entrada).click(); } }, botao));
      return el;
    };
    entrada.addEventListener('change', () => receber(entrada.files, false));
    entradaModelo.addEventListener('change', () => receber(entradaModelo.files, true));
    window.addEventListener('beforeunload', antesDeSair);
    function antesDeSair(ev) { if (trabalhando) { ev.preventDefault(); ev.returnValue = ''; } }
    let nascendo = true; setTimeout(() => { nascendo = false; }, 0); // a página monta o elemento logo depois de chamar
    const vivo = () => nascendo || document.body.contains(raiz);

    function dizer(t) { mensagem = t || ''; trocar(statusEl, mensagem); statusEl.hidden = !mensagem; }

    async function entradasDe(arq, modelo) {
      if (!/\.zip$/i.test(arq.name)) {
        if (!SOLTOS.test(arq.name)) { toast(arq.name + ': use ZIP, PDF ou Word (.docx).', true); return []; }
        return [{ nome: arq.name, tamanho: arq.size, zip: null, pegar: async () => arq }];
      }
      dizer('Abrindo ' + arq.name + '...');
      let z;
      try { z = await (await AL().carregarJSZip()).loadAsync(arq); } catch (e) { toast('Não consegui abrir o ZIP ' + arq.name + '. Baixe de novo do SEI e solte outra vez.', true); return []; }
      const lista = []; let fora = 0;
      for (const f of Object.values(z.files)) {
        if (f.dir) continue;
        if (/(^|\/)(\.|__MACOSX)/.test(f.name) || AL().IGNORADOS.test(f.name)) { fora++; continue; }
        const nome = f.name.split('/').pop();
        if (!DENTRO_DO_ZIP.test(nome)) { fora++; continue; }
        lista.push({ nome, tamanho: (f._data && Number(f._data.uncompressedSize)) || 0, zip: arq.name, pegar: () => f.async('blob') });
      }
      lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
      if (!lista.length) { toast('O ZIP ' + arq.name + ' não tem PDF nem Word que eu consiga ler.', true); return []; }
      if (fora) toast(fora + ' arquivo(s) de outro tipo ficaram de fora (só ZIP, PDF e Word são lidos).');
      if (modelo) { // o relatório do trimestre anterior: escolhe o parecer ou relatório dentro do ZIP
        const melhor = lista.find((x) => /parecer/i.test(x.nome)) || lista.find((x) => /relat[oó]rio/i.test(x.nome)) || lista[0];
        return [melhor];
      }
      return lista;
    }

    async function soltar(arqs, modelo) {
      trabalhando = true; parar = false;
      try {
        let entradas = [];
        for (const a of arqs) entradas = entradas.concat(await entradasDe(a, modelo));
        if (modelo && entradas.length > 1) { toast('O relatório do trimestre anterior é um arquivo só. Usei: ' + entradas[0].nome); entradas = entradas.slice(0, 1); }
        if (!entradas.length) return;
        await enviar(entradas, modelo);
      } finally { trabalhando = false; enviandoId = null; fase = ''; dizer(''); if (vivo()) { await atualizar(); desenharPainel(); } }
    }

    async function enviar(entradas, modelo) {
      dizer('Preparando a leitura...');
      lote.length = 0; totais.paginas = 0; totais.protegidos = 0;
      const porZip = new Map(); // um lote por ZIP (o servidor guarda o nome do ZIP)
      for (const e of entradas) { const k = e.zip || ''; if (!porZip.has(k)) porZip.set(k, []); porZip.get(k).push(e); }
      for (const [zip, grupo] of porZip) {
        let reg;
        try { reg = await api('POST', '/api/alimentar/lote', { zip: zip || null, arquivos: grupo.map((g) => ({ nome: g.nome, tamanho: g.tamanho })), destino: { contrato_id: contratoId, trimestre: tri, modelo: !!modelo } }); }
        catch (e) { toast(e.message, true); continue; }
        grupo.forEach((g, k) => lote.push({ id: reg.itens[k].id, nome: g.nome, estado: reg.itens[k].estado === 'espera' ? 'espera' : 'problema', msg: reg.itens[k].estado === 'espera' ? '' : 'Tipo não aceito.', pegar: g.pegar }));
      }
      desenharPainel();
      try { hostPainel.scrollIntoView({ behavior: reduzido() ? 'auto' : 'smooth', block: 'start' }); } catch (_) { /* sem rolagem */ }
      const base = AL();
      for (let k = 0; k < lote.length; k++) {
        const it = lote[k];
        if (it.estado !== 'espera') continue;
        if (parar) { await api('DELETE', '/api/alimentar/' + it.id).catch(() => {}); it.estado = 'problema'; it.msg = 'Envio parado.'; continue; }
        enviandoId = it.id; it.estado = 'lendo'; fase = ''; const posicao = ' (' + (k + 1) + ' de ' + lote.length + ')';
        dizer('Abrindo ' + base.bonito(it.nome) + posicao + '...'); desenharPainel();
        let corpo = null;
        try { corpo = await it.pegar(); } catch (_) { corpo = null; }
        try {
          if (!corpo) { await api('DELETE', '/api/alimentar/' + it.id).catch(() => {}); it.estado = 'problema'; it.msg = 'Não consegui abrir este arquivo dentro do ZIP.'; }
          else {
            const ext = (it.nome.split('.').pop() || '').toLowerCase();
            let origem = null, enviado = false;
            if (['pdf', 'html', 'htm'].includes(ext)) {
              fase = 'Lendo na sua máquina'; dizer('Lendo ' + base.bonito(it.nome) + posicao + ' na sua máquina...'); desenharPainel();
              let ult = 0;
              const r = await base.lerLocal(it.nome, ext, corpo, (n, t) => { const agora = Date.now(); if (agora - ult < 250 && n < t) return; ult = agora; fase = 'Lendo na sua máquina (página ' + n + ' de ' + t + ')'; desenharPainel(); });
              if (r.carga) {
                fase = 'Enviando texto'; desenharPainel();
                try { await base.enviarTexto(it.id, it.nome, r.carga, dizer); enviado = true; } catch (e) { if (!e.fatal || /sessão/.test(e.message)) throw e; origem = 'fallback-erro'; }
              } else origem = r.fallback;
            }
            if (!enviado) {
              if (corpo.size > base.LIMITE_MB * 1024 * 1024) { await api('DELETE', '/api/alimentar/' + it.id).catch(() => {}); it.estado = 'problema'; it.msg = 'Grande demais (limite de ' + base.LIMITE_MB + ' MB).'; }
              else { fase = origem ? 'Enviando o arquivo inteiro' : 'Enviando'; desenharPainel(); await base.enviarArquivo(it.id, it.nome, corpo, dizer, origem); }
            }
            if (it.estado === 'lendo') {
              const f = await api('GET', '/api/importar/fila?ids=' + it.id).catch(() => ({ itens: [] }));
              const x = (f.itens || [])[0];
              if (x) { it.estado = x.estado === 'lido' ? 'lido' : (x.estado === 'duplicado' ? 'duplicado' : 'problema'); it.msg = x.motivo || ''; totais.paginas += Number(x.paginas || 0); totais.protegidos += Number(x.protegidos || 0); }
              else { it.estado = 'lido'; }
            }
          }
        } catch (e) {
          toast(e.message, true);
          it.estado = 'problema'; it.msg = e.message;
          if (e.fatal && /sessão/.test(e.message)) { parar = true; }
          else if (!e.fatal) { parar = true; dizer('A conexão não voltou. O que já foi lido está guardado. Solte os arquivos de novo para continuar.'); }
        }
        corpo = null; enviandoId = null; fase = '';
        await atualizar(); desenharPainel();
      }
      if (parar) for (const it of lote) if (it.estado === 'espera') { await api('DELETE', '/api/alimentar/' + it.id).catch(() => {}); it.estado = 'problema'; it.msg = 'Envio parado.'; }
    }

    // ----- painel de andamento (criado uma vez; só textos e classes mudam, para a animação ser suave) -----
    const P = (() => {
      const c = 2 * Math.PI * 44;
      const anel = h('span', { class: 'al-anel', html: '<svg viewBox="0 0 100 100" width="104" height="104" aria-hidden="true"><circle class="al-anel-fundo" cx="50" cy="50" r="44"/><circle class="al-anel-barra" cx="50" cy="50" r="44" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1) + '"/></svg>' });
      const pct = h('span', { class: 'al-anel-pct', id: 'imp-pct' }, '0%'); anel.appendChild(pct);
      const titulo = h('h2', { class: 'al-un', id: 'imp-pt' }, 'Lendo os arquivos');
      const sub = h('p', { class: 'al-sub', id: 'imp-ps' }, '');
      const chip = h('span', { class: 'al-chip', id: 'imp-chip' }, '');
      const t1 = h('div', { class: 'al-tile' }, h('strong', { id: 'imp-n-docs' }, '0 de 0'), h('span', null, 'arquivos lidos'));
      const t2 = h('div', { class: 'al-tile' }, h('strong', { id: 'imp-n-pag' }, '0'), h('span', null, 'páginas lidas'));
      const t3 = h('div', { class: 'al-tile' }, h('strong', { id: 'imp-n-prot' }, '0'), h('span', null, 'dados protegidos'));
      const barra = h('div', { class: 'al-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Andamento da leitura' }, h('i'));
      const lista = h('ul', { class: 'al-lista', id: 'imp-fila' });
      const parada = h('button', { type: 'button', class: 'leve', id: 'imp-parar', onclick: () => { parar = true; dizer('Parando depois deste arquivo...'); } }, 'Parar o envio');
      const raizP = h('section', { class: 'cartao al-painel imp-painel', id: 'imp-painel', hidden: true, 'aria-label': 'Andamento da leitura' },
        h('div', { class: 'al-cab' }, anel, h('div', { class: 'al-cab-txt' }, titulo, sub, h('div', { class: 'linha' }, chip, parada))), h('div', { class: 'al-tiles' }, t1, t2, t3), barra, lista);
      return { raiz: raizP, c, anel, pct, sub, chip, barra, lista, parada, linhas: new Map(), chave: '' };
    })();
    const q = (id) => P.raiz.querySelector('#' + id);
    function desenharPainel() {
      P.raiz.hidden = !lote.length;
      if (!lote.length) return;
      const feitos = lote.filter((x) => !['espera', 'lendo'].includes(x.estado)).length;
      const total = lote.length, pct = total ? Math.round((feitos / total) * 100) : 0;
      P.raiz.setAttribute('data-estado', trabalhando ? 'lendo' : 'pronto');
      P.pct.textContent = pct + '%';
      P.anel.querySelector('.al-anel-barra').setAttribute('stroke-dashoffset', (P.c * (1 - pct / 100)).toFixed(1));
      P.barra.setAttribute('aria-valuenow', String(pct)); P.barra.firstChild.style.width = pct + '%';
      const probs = lote.filter((x) => x.estado === 'problema').length;
      P.sub.textContent = (est && est.contrato ? est.contrato.unidade : '') + ' · ' + tri;
      P.chip.textContent = trabalhando ? 'Lendo os documentos' : (probs ? 'Pronto, com pontos de atenção' : 'Tudo lido');
      P.chip.className = 'al-chip ' + (trabalhando ? 'lendo' : (probs ? 'atencao' : 'ok'));
      P.parada.hidden = !(trabalhando && !parar);
      q('imp-n-docs').textContent = lote.filter((x) => ['lido', 'duplicado'].includes(x.estado)).length + ' de ' + total;
      q('imp-n-pag').textContent = AL().num(totais.paginas); q('imp-n-prot').textContent = AL().num(totais.protegidos);
      const chave = lote.map((x) => x.id).join(',');
      if (chave !== P.chave) {
        P.chave = chave; P.linhas.clear(); P.lista.replaceChildren();
        for (const it of lote) {
          const ic = h('span', { class: 'al-ic', 'aria-hidden': 'true' }); const et = h('span', { class: 'al-et' }); const mt = h('span', { class: 'al-mt' });
          const li = h('li', { class: 'al-item', 'data-estado': 'espera' }, ic, h('span', { class: 'al-tx' }, h('span', { class: 'al-nm' }, AL().bonito(it.nome)), et, mt));
          P.linhas.set(it.id, { li, ic, et, mt }); P.lista.appendChild(li);
        }
      }
      const ROT = { espera: 'Aguardando', lendo: 'Lendo agora', lido: 'Lido', duplicado: 'Já importado', problema: 'Com problema' };
      for (const it of lote) {
        const r = P.linhas.get(it.id); if (!r) continue;
        const e = it.estado === 'duplicado' ? 'lido' : it.estado;
        if (r.li.getAttribute('data-estado') !== e) { r.li.setAttribute('data-estado', e); r.ic.innerHTML = e === 'lido' ? ICONE_OK : (e === 'problema' ? ICONE_X : ''); }
        const ro = (it.estado === 'lendo' && fase) ? fase : (ROT[it.estado] || it.estado);
        if (r.et.textContent !== ro) r.et.textContent = ro;
        const mt = ['lido', 'duplicado', 'problema'].includes(it.estado) ? (it.msg || '') : '';
        if (r.mt.textContent !== mt) r.mt.textContent = mt;
      }
    }

    // ----- cartões -----
    function desenharModelo() {
      if (!est) return;
      const m = est.modelo;
      trocar(hostModelo,
        est.lista.aviso ? aviso(est.lista.origem === 'catalogo' ? 'atencao' : 'info', h('strong', { id: 'imp-aviso-lista' }, est.lista.aviso)) : null,
        est.proposta ? h('div', { class: 'cartao imp-proposta', id: 'imp-proposta' }, h('div', { class: 'linha espaco' },
          h('div', null, h('strong', null, 'Há uma lista proposta com ' + est.proposta.itens + ' itens.'), h('div', { class: 'peq mudo' }, est.proposta.nota || 'Confira e confirme para ela valer.')),
          h('button', { type: 'button', id: 'imp-conferir-lista', onclick: () => editarLista(contratoId, mudou) }, 'Conferir e confirmar a lista'))) : null,
        m ? h('div', { class: 'cartao imp-modelo' }, h('div', { class: 'linha espaco' },
          h('div', null, h('strong', { id: 'imp-modelo-legenda' }, 'Modelo: parecer do ' + (anterior(tri) || m.trimestre || 'trimestre anterior')), ' · ' + (m.nome_arquivo || 'relatório') + (m.trimestre && m.trimestre !== anterior(tri) ? ' (o texto indica ' + m.trimestre + ')' : ''), h('div', { class: 'peq mudo' }, 'Guardado em ' + fmtData(m.criado_em) + ', sem dados pessoais. Vale como modelo deste trimestre.')),
          h('div', { class: 'linha' }, h('button', { type: 'button', class: 'sec', id: 'imp-ver-estrutura', onclick: () => verEstrutura(contratoId) }, 'Ver o que foi lido'), h('button', { type: 'button', class: 'leve', onclick: () => entradaModelo.click() }, 'Trocar o relatório-modelo'))))
          : zona('imp-zona-modelo', 'Primeiro: o relatório do trimestre anterior', 'Solte o relatório ou parecer do trimestre anterior, já assinado no SEI (PDF, Word ou o ZIP). Ele vira o modelo da lista de conferência desta unidade.', 'Escolher o relatório do trimestre anterior', true));
    }

    function desenharLista() {
      if (!est) return;
      const r = est.resumo;
      const linhaItem = (it) => {
        const icone = it.estado === 'completo' ? ICONE_OK : (it.estado === 'parcial' ? ICONE_MEIO : ((it.estado === 'falta' || it.estado === 'pedido') ? ICONE_X : ''));
        const cont = it.periodicidade === 'mensal' && it.esperados ? it.recebidos + '/' + it.esperados : (it.recebidos ? '✔' : '');
        const salvar = async (s, campos) => { try { await api('POST', u + '/' + tri + '/check', Object.assign({ item: it.codigo, mes: s.mes }, campos)); await atualizar(); } catch (e) { toast(e.message, true); } };
        const rot = (s) => s.mes ? s.rotulo : '';
        const manual = (s) => {
          const por = s.check === 'arquivo';
          if (it.origem === 'pedida_setor') {
            const sel = h('select', { class: 'imp-sit', 'aria-label': 'Situação de ' + it.nome + (rot(s) ? ' ' + rot(s) : ''), disabled: por, onchange: () => salvar(s, { situacao: sel.value, data_pedido: dt.value, processo_sei: pr.value, observacao: obs.value }) },
              Object.entries(SITUACAO).map(([v, r]) => h('option', Object.assign({ value: v }, (s.situacao || 'nao_pedido') === v ? { selected: true } : {}), r)));
            const dt = h('input', { type: 'date', class: 'imp-data', value: s.data_pedido || '', 'aria-label': 'Data do pedido', disabled: por, onchange: () => { if (sel.value !== 'nao_pedido') salvar(s, { situacao: sel.value, data_pedido: dt.value, processo_sei: pr.value, observacao: obs.value }); } });
            const pr = h('input', { type: 'text', class: 'imp-proc', placeholder: 'Nº do processo SEI do pedido', value: s.processo_sei || '', 'aria-label': 'Processo SEI do pedido', disabled: por, onchange: () => { if (sel.value !== 'nao_pedido') salvar(s, { situacao: sel.value, data_pedido: dt.value, processo_sei: pr.value, observacao: obs.value }); } });
            const obs = h('input', { type: 'text', class: 'imp-obs', placeholder: 'Valores lançados / observação', value: s.observacao || '', 'aria-label': 'Observação de ' + it.nome, disabled: por, onchange: () => { if (sel.value !== 'nao_pedido') salvar(s, { situacao: sel.value, data_pedido: dt.value, processo_sei: pr.value, observacao: obs.value }); } });
            return h('div', { class: 'imp-slot', 'data-mes': s.mes, 'data-situacao': s.situacao }, h('div', { class: 'linha' }, rot(s) ? h('strong', null, rot(s)) : null, sel, dt, pr), obs, por ? h('div', { class: 'peq mudo' }, 'Recebido pelo arquivo enviado.') : null);
          }
          if (it.origem === 'gerado_simas') {
            const obs = h('input', { type: 'text', class: 'imp-obs', placeholder: 'Por que sem o consolidado agora?', value: s.alternativa_manual ? (s.observacao || '') : '', 'aria-label': 'Observação: SIMAS sem acesso agora', disabled: por, onchange: async () => { if (caixa.checked) await salvar(s, { situacao: 'recebido', observacao: obs.value }); } });
            const caixa = h('input', Object.assign({ type: 'checkbox', 'aria-label': 'SIMAS sem acesso agora', disabled: por, onchange: async (ev) => { await salvar(s, ev.target.checked ? { situacao: 'recebido', observacao: obs.value } : { marcado: false }); } }, s.alternativa_manual ? { checked: true } : {}));
            return h('div', { class: 'imp-slot', 'data-mes': s.mes }, por ? h('div', { class: 'peq' }, 'Consolidado recebido: ' + s.arquivos.map((a) => AL().bonito(a.nome)).join('; ')) : h('label', { class: 'imp-slot-chk' }, caixa, ' SIMAS sem acesso agora (segue sem o consolidado)'), por ? null : obs);
          }
          if (it.origem === 'processo_parecer') {
            const obs = h('input', { type: 'text', class: 'imp-obs', placeholder: 'Informação anotada (ex.: o que a CMA concluiu)', value: s.observacao || '', 'aria-label': 'Informação de ' + it.nome, onchange: async () => { if (caixa.checked) await salvar(s, { situacao: 'consultado', observacao: obs.value }); } });
            const caixa = h('input', Object.assign({ type: 'checkbox', 'aria-label': 'Consultado: ' + it.nome, onchange: async (ev) => { await salvar(s, ev.target.checked ? { situacao: 'consultado', observacao: obs.value } : { marcado: false }); } }, s.check === 'consultado' ? { checked: true } : {}));
            return h('div', { class: 'imp-slot', 'data-mes': s.mes }, h('label', { class: 'imp-slot-chk' }, caixa, ' Consultado no processo do parecer' + (rot(s) ? ' (' + rot(s) + ')' : '')), obs);
          }
          const caixa = h('input', Object.assign({ type: 'checkbox', 'aria-label': 'Marcar ' + it.nome + (s.mes ? ' ' + s.rotulo : ''), onchange: async (ev) => { await marcar(it, s, ev.target.checked, ev.target); } }, s.check === 'manual' ? { checked: true } : {}, s.check === 'arquivo' ? { checked: true, disabled: true } : {}));
          const obs = h('input', { type: 'text', class: 'imp-obs', placeholder: 'Observação (ex.: número do despacho)', value: s.observacao || '', 'aria-label': 'Observação de ' + it.nome + (s.mes ? ' ' + s.rotulo : ''), onchange: async () => { if (caixa.checked && s.check !== 'arquivo') await marcar(it, s, true, caixa, obs.value); } });
          return h('div', { class: 'imp-slot', 'data-mes': s.mes }, h('label', { class: 'imp-slot-chk' }, caixa, ' ' + (s.mes ? s.rotulo : 'Recebi')), obs);
        };
        const extra = it.origem !== 'unidade' ? h('div', { class: 'imp-ext' }, it.slots.map(manual))
          : (it.periodicidade === 'mensal' ? h('div', { class: 'imp-meses' }, it.slots.map((s) => h('span', { class: 'imp-mes ' + (s.check ? 'ok' : 'vazio'), 'data-mes': s.mes, title: s.arquivos.map((a) => a.nome).join('; ') }, (s.check ? '✔ ' : '') + s.rotulo))) : null);
        const aviso1 = (est.ausencias || []).find((x) => x.item === it.codigo);
        const arqs = it.slots.flatMap((s) => s.arquivos.map((a) => a.nome));
        return h('li', { class: 'imp-item', 'data-codigo': it.codigo, 'data-estado': it.estado, id: 'imp-i-' + it.codigo },
          h('span', { class: 'imp-ic', 'aria-hidden': 'true', html: icone }),
          h('div', { class: 'imp-tx' },
            h('div', { class: 'imp-nm' }, it.nome, ' ', h('span', { class: 'imp-tag' }, it.obrigatorio ? 'obrigatório' : 'opcional'), TAG_FONTE[it.origem] ? h('span', { class: 'imp-tag ext' }, TAG_FONTE[it.origem]) : null, it.estado === 'pedido' ? h('span', { class: 'imp-tag ext' }, 'pedido, aguardando') : null, cont ? h('span', { class: 'imp-cont', title: 'Recebidos' }, cont) : null),
            aviso1 ? h('div', { class: 'imp-regra', role: 'alert' }, h('strong', null, 'Atenção: '), aviso1.texto, ' Falta em: ' + aviso1.meses_sem.map((m) => (est.meses.find((x) => x.mes === m) || {}).rotulo || m).join(', ') + '. Estado: sem planilha → meta não cumprida (regra da CTAI).') : null,
            it.origem === 'gerado_simas' ? h('div', { class: 'peq mudo imp-simas-dica' }, 'O parecer usa o SIMAS como fonte principal de produção e qualidade. Gere o relatório "Metas atingidas - consolidado" no SIMAS (PDF) e solte aqui; os números são lidos e ficam esperando a sua conferência.') : null,
            it.origem === 'gerado_simas' && est.simas && est.simas.lido ? h('div', { class: 'linha' }, h('button', { type: 'button', class: 'sec', id: 'imp-simas-ver', onclick: () => verSimas(contratoId, tri, atualizar) }, 'Ver e confirmar os números do SIMAS'), h('span', { class: 'peq mudo' }, est.simas.grupos + ' grupos, ' + est.simas.linhas + ' linhas, ' + est.simas.indicadores + ' indicadores · ' + (est.simas.propostos ? est.simas.propostos + ' esperando conferência' : 'todos confirmados'))) : null,
            extra, arqs.length ? h('div', { class: 'peq mudo imp-arq' }, arqs.map((n) => AL().bonito(n)).join('; ')) : null));
      };
      const avulsos = est.avulsos.length ? h('div', { class: 'imp-avulsos', id: 'imp-avulsos' }, h('h3', null, 'Avulsos (' + est.avulsos.length + ')'), h('p', { class: 'peq mudo' }, 'O sistema não soube em qual item entram. Aponte o item de cada um.'),
        est.avulsos.map((a) => linhaAvulso(a))) : null;
      trocar(hostLista, h('section', { class: 'cartao imp-confere', id: 'imp-confere' },
        h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, 'Lista de conferência · ' + tri), h('button', { type: 'button', class: 'sec', id: 'imp-editar-lista', onclick: () => editarLista(contratoId, mudou) }, 'Editar a lista')),
        h('p', { class: 'imp-resumo', id: 'imp-resumo' }, r.texto),
        est.lista.vazia ? aviso('atencao', 'A lista está vazia. Envie o relatório do trimestre anterior ou monte a lista à mão em "Editar a lista".') : h('ul', { class: 'imp-lista' }, est.itens.filter((i) => i.estado !== 'nao_exigido').map(linhaItem)),
        avulsos));
    }
    function linhaAvulso(a) {
      const meses = est.meses; const lista = est.itens.filter((i) => i.origem === 'unidade');
      const sel = h('select', { 'aria-label': 'Item de ' + a.nome }, h('option', { value: '' }, 'Escolher o item...'), lista.map((i) => h('option', Object.assign({ value: i.codigo }, a.sugestao && a.sugestao.codigo === i.codigo ? { selected: true } : {}), i.nome)));
      const mes = h('select', { 'aria-label': 'Mês de ' + a.nome }, h('option', { value: '' }, 'Mês...'), meses.map((m) => h('option', Object.assign({ value: m.mes }, a.mes === m.mes ? { selected: true } : {}), m.rotulo)));
      return h('div', { class: 'imp-avulso', 'data-id': a.id },
        h('div', null, h('strong', null, AL().bonito(a.nome)), a.aviso ? h('div', { class: 'peq mudo' }, a.aviso) : null, a.sugestao ? h('div', { class: 'peq' }, 'Parece ser: ' + a.sugestao.nome) : null),
        h('div', { class: 'linha' }, sel, mes,
          h('button', { type: 'button', class: 'sec', onclick: async () => { if (!sel.value) { toast('Escolha o item.', true); return; } try { await api('POST', '/api/importar/arquivos/apontar', { arquivo_id: a.id, item: sel.value, mes: mes.value }); toast('Arquivo apontado.'); await atualizar(); } catch (e) { toast(e.message, true); } } }, 'Apontar'),
          h('button', { type: 'button', class: 'leve', onclick: async () => { if (!(await confirmar('Tirar este arquivo?', 'O texto guardado dele será apagado.', 'Tirar', true))) return; try { await api('DELETE', '/api/importar/arquivos/' + a.id); await atualizar(); } catch (e) { toast(e.message, true); } } }, 'Tirar')));
    }
    async function marcar(it, s, marcado, caixa, obs) {
      try { await api('POST', u + '/' + tri + '/check', { item: it.codigo, mes: s.mes, marcado, observacao: obs !== undefined ? obs : ((caixa.closest('.imp-slot').querySelector('.imp-obs') || {}).value || '') }); await atualizar(); }
      catch (e) { toast(e.message, true); caixa.checked = !marcado; }
    }

    function desenharFim() {
      if (!est) return;
      const con = est.concluida;
      trocar(hostFim, con
        ? h('div', { class: 'linha espaco' }, aviso('ok', h('strong', null, 'Importação concluída'), ' em ' + fmtData(con.em) + ' por ' + con.por + (con.faltantes.length ? '. Seguiu sem: ' + con.faltantes.join('; ') + '.' : '.')),
          h('button', { type: 'button', class: 'leve', id: 'imp-reabrir', onclick: async () => { try { await api('POST', u + '/' + tri + '/reabrir', {}); toast('Importação reaberta.'); await atualizar(); mudou(true); } catch (e) { toast(e.message, true); } } }, 'Reabrir'))
        : h('div', { class: 'linha' }, h('button', { type: 'button', id: 'imp-concluir', onclick: concluir }, 'Concluir importação'),
          h('span', { class: 'peq mudo' }, est.feitaPorChecks ? 'Todos os itens obrigatórios estão com check. Esta etapa já conta como feita; concluir deixa o registro.' : 'A etapa conta como feita quando todos os itens obrigatórios tiverem check, ou quando você concluir.')));
    }
    async function concluir() {
      const faltam = est.resumo.faltam.map((f) => f.nome + (f.detalhe ? ' (' + f.detalhe + ')' : ''));
      const nada = !est.arquivos && est.itens.every((i) => i.slots.every((s) => !s.check));
      let corpo = {};
      if (faltam.length || nada) {
        const obs = h('input', { type: 'text', id: 'imp-obs-conclusao', placeholder: 'Motivo (opcional)', 'aria-label': 'Motivo' });
        const ok = await janela('Concluir mesmo assim?', h('div', null, nada ? h('p', null, 'Nenhum arquivo foi recebido neste trimestre.') : h('p', null, 'Ainda faltam itens obrigatórios:'), faltam.length ? h('ul', null, faltam.map((f) => h('li', null, f))) : null, h('p', { class: 'peq mudo' }, 'Isso fica registrado na trilha de auditoria.'), obs),
          [{ rotulo: 'Voltar', valor: false, sec: true }, { rotulo: 'Concluir mesmo assim', valor: true }]);
        if (ok !== true) return;
        corpo = { confirmar_faltantes: true, observacao: obs.value };
      }
      try { await api('POST', u + '/' + tri + '/concluir', corpo); toast('Importação concluída.'); await atualizar(); mudou(true); } catch (e) { toast(e.message, true); }
    }

    // ----- atualizar -----
    let ultimaFeita = est ? est.feita : null;
    function mudou(forcar) { if (opc.aoMudar) opc.aoMudar(est, forcar === true); }
    async function atualizar() {
      if (!vivo()) return;
      est = await api('GET', u + '/' + tri);
      desenharModelo(); desenharLista(); desenharFim();
      if (ultimaFeita === null) ultimaFeita = est.feita;
      else if (!trabalhando && est.feita !== ultimaFeita) { ultimaFeita = est.feita; if (opc.aoMudar) opc.aoMudar(est, false); }
    }
    trocar(abaixo, statusEl, hostModelo, h('div', { class: 'cartao al-zona imp-zona', id: 'imp-zona', tabindex: '0', role: 'button', 'aria-label': 'Soltar os arquivos de ' + tri + ' aqui',
      ondragover: (ev) => { ev.preventDefault(); ev.currentTarget.classList.add('sobre'); }, ondragleave: (ev) => ev.currentTarget.classList.remove('sobre'),
      ondrop: (ev) => { ev.preventDefault(); ev.currentTarget.classList.remove('sobre'); receber(ev.dataTransfer.files, false); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); entrada.click(); } } },
    h('h3', null, 'Solte aqui os arquivos de ' + tri),
    dica('Pode soltar o ZIP do SEI, ou vários PDF e Word de uma vez. O PDF é lido na sua máquina: só o texto, já sem dados pessoais, vai para o sistema. O arquivo original não é guardado.'),
    h('button', { type: 'button', class: 'sec', id: 'imp-escolher', onclick: (ev) => { ev.stopPropagation(); entrada.click(); } }, 'Escolher arquivos no computador')),
    entrada, entradaModelo, hostPainel, hostLista, hostFim);
    hostPainel.appendChild(P.raiz);
    if (est) { desenharModelo(); desenharLista(); desenharFim(); }
    try { await atualizar(); } catch (e) { trocar(abaixo, aviso('erro', e.message)); }
  }

  window.CTAI_IMPORTAR = { preencher, editarLista, verEstrutura };
})();
