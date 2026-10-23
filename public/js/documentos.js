(function () {
  'use strict';
  // Documentos além do parecer: ofício, despacho e documento em branco, com biblioteca de modelos que a própria pessoa ensina.
  const { h, api, fmt, toast, perguntar, confirmar, janela, selo, aviso, tabela, montar, troca } = window.CTAI;
  const EU = () => (window.__eu && window.__eu()) || {};
  const migalha = (...p) => h('div', { class: 'migalha' }, p.map((x, i) => [i ? ' › ' : '', x]));
  const TIPOS = [['oficio', 'Ofício'], ['despacho', 'Despacho'], ['branco', 'Documento em branco']];
  const nomeTipo = (t) => (TIPOS.find((x) => x[0] === t) || [])[1] || t;
  const lerArquivo = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(f); });
  const situacao = (d) => selo(d.status, d.status === 'finalizado' || d.status === 'conferido' ? 'ok' : (d.status === 'com reparos' ? 'atencao' : ''));
  const abrirDoc = (id, nova) => { if (nova && window.CTAI_UNIDADE) window.CTAI_UNIDADE.janelaNova('/d/' + id); else location.hash = '#/d/' + id; };

  // ---------- lista ----------
  async function lista() {
    const [todos, conferir] = await Promise.all([api('GET', '/api/documentos'), api('GET', '/api/documentos?paraConferir=1')]);
    const linhas = (l) => l.map((d) => [h('a', { href: '#/d/' + d.doc_id }, d.titulo), d.tipoNome, d.unidade || h('span', { class: 'mudo' }, '—'), d.criador_nome || '', situacao(d), fmt.data(d.atualizado_em)]);
    const cab = [{ t: 'Documento' }, { t: 'Tipo' }, { t: 'Unidade' }, { t: 'Criado por' }, { t: 'Situação' }, { t: 'Atualizado' }];
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Ofícios, despachos e outros'), h('p', null, 'Documentos que não são parecer. Cada um nasce de um modelo seu ou da equipe, ou de uma frase sua.')),
      h('div', { class: 'linha' }, h('a', { class: 'btn', href: '#/d/novo/-/-' }, 'Novo documento'), h('a', { class: 'btn sec', href: '#/documentos/modelos' }, 'Meus modelos'))),
      conferir.documentos.length ? h('div', { class: 'cartao' }, h('h2', null, 'Esperando a sua conferência'), tabela(cab, linhas(conferir.documentos))) : null,
      h('div', { class: 'cartao' }, todos.documentos.length ? tabela(cab, linhas(todos.documentos)) : h('p', { class: 'mudo' }, 'Nenhum documento ainda. Clique em "Novo documento".')));
  }

  // ---------- biblioteca de modelos ----------
  async function editarModelo(m, depois) {
    const nome = h('input', { type: 'text', value: m.nome, id: 'mm-n' });
    const corpo = h('textarea', { rows: 14, id: 'mm-c' }, m.corpo);
    const comp = h('input', { type: 'checkbox', id: 'mm-s', checked: m.compartilhado });
    const ok = await janela('Modelo: ' + m.nome, h('div', null,
      h('div', { class: 'campo' }, h('label', { for: 'mm-n' }, 'Nome'), nome),
      h('div', { class: 'campo' }, h('label', { for: 'mm-c' }, 'Texto do modelo (o que muda fica entre {{chaves}})'), corpo),
      h('label', { style: 'font-weight:400' }, comp, ' Compartilhar com a equipe')),
      [{ rotulo: 'Cancelar', valor: false, sec: true }, { rotulo: 'Salvar nova versão', valor: true }]);
    if (!ok) return;
    try { await api('PUT', '/api/documentos/modelos/' + m.modelo_id, { nome: nome.value, tipo: m.tipo, corpo: corpo.value, campos: m.campos, compartilhado: comp.checked }); toast('Modelo salvo.'); depois(); } catch (e) { toast(e.message, true); }
  }

  function formEnsinar(depois) {
    const tipo = h('select', { id: 'en-t' }, TIPOS.filter((t) => t[0] !== 'branco').map((t) => h('option', { value: t[0] }, t[1])));
    const nome = h('input', { type: 'text', id: 'en-n', placeholder: 'ex.: Ofício de encaminhamento de relatório' });
    const arq = h('input', { type: 'file', id: 'en-a', accept: '.pdf,.txt', 'aria-label': 'Anexar PDF ou TXT' });
    const texto = h('textarea', { id: 'en-x', rows: 8, placeholder: 'Ou cole aqui o texto de um documento que serve de exemplo.' });
    const saida = h('div');
    arq.addEventListener('change', async () => {
      const f = arq.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast('Arquivo acima de 4 MB.', true); arq.value = ''; return; }
      troca(saida, h('p', { class: 'mudo' }, 'Lendo o arquivo…'));
      try { const o = await api('POST', '/api/analista/extrair', { nome: f.name, base64: await lerArquivo(f) }); texto.value = o.texto.slice(0, 40000); if (!nome.value) nome.value = f.name.replace(/\.[^.]+$/, ''); troca(saida, aviso('ok', 'Arquivo lido. Confira o texto abaixo e clique em "Aprender este modelo".')); } catch (e) { troca(saida, aviso('erro', e.message)); }
    });
    const aprender = async () => {
      if (texto.value.trim().length < 30) { toast('Anexe um arquivo ou cole o texto do documento.', true); return; }
      troca(saida, h('p', { class: 'mudo' }, 'Aprendendo o modelo…'));
      try {
        const o = await api('POST', '/api/documentos/modelos/aprender', { texto: texto.value });
        const corpo = h('textarea', { rows: 14, id: 'en-corpo' }, o.corpo);
        const campos = o.campos.map((c) => ({ c, el: h('input', { type: 'text', value: c.rotulo, 'aria-label': 'Nome do campo ' + c.id }) }));
        const comp = h('input', { type: 'checkbox', id: 'en-s' });
        troca(saida,
          o.semIA ? aviso('atencao', 'A IA não está disponível agora (' + (o.motivo || '') + '). Marquei só o que costuma mudar (processo, data, número). Ajuste o texto: tudo o que muda a cada documento deve ficar entre {{chaves}}.') : aviso('ok', 'Pronto. Confira abaixo o que o sistema entendeu que muda a cada documento.'),
          h('div', { class: 'campo' }, h('label', { for: 'en-corpo' }, 'Texto do modelo'), corpo),
          campos.length ? h('div', null, h('h3', null, 'Campos que serão perguntados'), h('div', { class: 'duas' }, campos.map((x) => h('div', { class: 'campo' }, h('label', null, '{{' + x.c.id + '}}'), x.el)))) : h('p', { class: 'mudo peq' }, 'Nenhum campo marcado: o modelo será usado como texto fixo.'),
          h('label', { style: 'font-weight:400' }, comp, ' Compartilhar com a equipe (por padrão o modelo é só seu)'),
          h('div', { class: 'linha', style: 'margin-top:10px' }, h('button', { type: 'button', onclick: async () => {
            if (!nome.value.trim()) { toast('Dê um nome ao modelo.', true); return; }
            try { await api('POST', '/api/documentos/modelos', { nome: nome.value, tipo: tipo.value, corpo: corpo.value, compartilhado: comp.checked, campos: campos.map((x) => ({ id: x.c.id, rotulo: x.el.value })) }); toast('Modelo guardado.'); depois(); } catch (e) { toast(e.message, true); }
          } }, 'Guardar modelo')));
      } catch (e) { troca(saida, aviso('erro', e.message)); }
    };
    return h('div', null,
      aviso('atencao', 'Ensine com um documento sem nomes de pacientes. O sistema esconde CPF, SUS, e-mail e telefone antes de qualquer envio à IA, mas nomes de pessoas não são escondidos.'),
      h('div', { class: 'duas' }, h('div', { class: 'campo' }, h('label', { for: 'en-t' }, 'Tipo'), tipo), h('div', { class: 'campo' }, h('label', { for: 'en-n' }, 'Nome do modelo'), nome)),
      h('div', { class: 'campo' }, h('label', { for: 'en-a' }, 'Anexar um PDF ou TXT'), arq), texto,
      h('div', { class: 'linha', style: 'margin:8px 0' }, h('button', { type: 'button', onclick: aprender }, 'Aprender este modelo')), saida);
  }

  async function modelos() {
    const o = await api('GET', '/api/documentos/modelos');
    const recarregar = () => modelos().catch((e) => toast(e.message, true));
    montar(migalha(h('a', { href: '#/documentos' }, 'Ofícios, despachos e outros'), 'Modelos'),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Modelos'), h('p', null, 'O sistema aprende com um documento que você tem. Na próxima vez, você escolhe o modelo e ele monta o rascunho.'))),
      window.CTAI.recolher('doc:ensinar', 'Ensinar um modelo novo', 'anexe um PDF/TXT ou cole o texto', formEnsinar(recarregar)),
      h('div', { class: 'cartao' }, o.modelos.length ? tabela([{ t: 'Modelo' }, { t: 'Tipo' }, { t: 'Versão' }, { t: 'De' }, { t: 'Quem vê' }, { t: '' }],
        o.modelos.map((m) => [m.nome, m.tipoNome, 'v' + m.versao, m.meu ? 'você' : m.dono, m.compartilhado ? selo('equipe', 'ok') : selo('só eu'),
          m.meu ? h('div', { class: 'linha' }, h('button', { type: 'button', class: 'sec', onclick: () => editarModelo(m, recarregar) }, 'Editar'),
            h('button', { type: 'button', class: 'sec', onclick: async () => { if (await confirmar('Remover o modelo', 'Os documentos já feitos com ele continuam como estão.', 'Remover', true)) { try { await api('DELETE', '/api/documentos/modelos/' + m.modelo_id); recarregar(); } catch (e) { toast(e.message, true); } } } }, 'Remover')) : ''])) : h('p', { class: 'mudo' }, 'Você ainda não tem modelos. Ensine o primeiro acima.')));
  }

  // ---------- novo documento ----------
  async function novo(p) {
    const contrato = p.contrato === '-' ? '' : decodeURIComponent(p.contrato), tri = p.tri === '-' ? '' : p.tri;
    const [ms, cs] = await Promise.all([api('GET', '/api/documentos/modelos'), api('GET', '/api/ctai/contratos')]);
    const selTipo = h('select', { id: 'nd-t' }, TIPOS.map((t) => h('option', { value: t[0] }, t[1])));
    const selCont = h('select', { id: 'nd-c' }, [h('option', { value: '' }, '— sem unidade —')].concat(cs.contratos.map((c) => h('option', Object.assign({ value: c.contrato_id }, c.contrato_id === contrato ? { selected: true } : {}), c.unidade))));
    const selMod = h('select', { id: 'nd-m' });
    const campos = h('div', { class: 'duas' });
    const pedido = h('textarea', { id: 'nd-p', rows: 3, placeholder: 'Ex.: ofício à gestora pedindo o relatório de produção de agosto, prazo de 5 dias.' });
    const conf = h('input', { type: 'checkbox', id: 'nd-conf' });
    const titulo = h('input', { type: 'text', id: 'nd-ti', placeholder: 'Se deixar em branco, usa o tipo do documento' });
    let atual = null; const vals = {};
    const pintarModelos = () => {
      const t = selTipo.value; const l = ms.modelos.filter((m) => m.tipo === t);
      selMod.replaceChildren(h('option', { value: '' }, t === 'branco' ? '— não se aplica —' : (l.length ? '— sem modelo (só a minha frase) —' : '— você ainda não tem modelo deste tipo —')), ...l.map((m) => h('option', { value: m.modelo_id }, m.nome + (m.meu ? '' : ' (equipe)'))));
      selMod.disabled = t === 'branco'; pintarCampos();
    };
    const pintarCampos = () => {
      atual = ms.modelos.find((m) => String(m.modelo_id) === selMod.value) || null;
      campos.replaceChildren(...(atual ? atual.campos.map((c) => h('div', { class: 'campo' }, h('label', null, c.rotulo), h('input', { type: 'text', value: vals[c.id] || '', oninput: (e) => { vals[c.id] = e.target.value; } }))) : []));
    };
    if (p.tipo && TIPOS.some((t) => t[0] === p.tipo)) selTipo.value = p.tipo;
    selTipo.addEventListener('change', pintarModelos); selMod.addEventListener('change', pintarCampos); pintarModelos();
    const montarRascunho = async () => {
      try {
        let texto = '', aviso1 = null;
        if (selTipo.value !== 'branco' && (atual || pedido.value.trim())) {
          let contexto = '';
          if (selCont.value) { const c = cs.contratos.find((x) => x.contrato_id === selCont.value); contexto = [c.unidade && 'Unidade: ' + c.unidade, c.oss && 'OSS: ' + c.oss, c.numero_cg && 'Contrato de Gestão: ' + c.numero_cg, tri && 'Trimestre: ' + tri].filter(Boolean).join('\n'); }
          const o = await api('POST', '/api/documentos/redigir', { modelo_id: atual ? atual.modelo_id : null, campos: vals, pedido: pedido.value, contexto, contrato_id: selCont.value || undefined });
          texto = o.texto; aviso1 = o.aviso;
        }
        const r = await api('POST', '/api/documentos', { tipo: selTipo.value, modelo_id: atual ? atual.modelo_id : undefined, contrato_id: selCont.value || undefined, trimestre: tri || undefined, titulo: titulo.value || (atual ? atual.nome : ''), campos: vals, texto, conferencia: conf.checked });
        if (aviso1) toast(aviso1, true);
        location.hash = '#/d/' + r.doc_id;
      } catch (e) { toast(e.message, true); }
    };
    montar(migalha(h('a', { href: '#/documentos' }, 'Ofícios, despachos e outros'), 'Novo documento'),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Novo documento'), h('p', null, 'Escolha o tipo. Se tiver modelo, ele monta o rascunho; se não, descreva em uma frase ou comece em branco.'))),
      h('div', { class: 'cartao' },
        h('div', { class: 'duas' }, h('div', { class: 'campo' }, h('label', { for: 'nd-t' }, 'Tipo'), selTipo), h('div', { class: 'campo' }, h('label', { for: 'nd-c' }, 'Unidade (opcional)'), selCont)),
        h('div', { class: 'campo' }, h('label', { for: 'nd-m' }, 'Modelo'), selMod, h('a', { class: 'peq', href: '#/documentos/modelos' }, 'Ensinar um modelo novo')),
        campos,
        h('div', { class: 'campo' }, h('label', { for: 'nd-p' }, 'Ou diga em uma frase o que precisa'), pedido),
        h('div', { class: 'campo' }, h('label', { for: 'nd-ti' }, 'Título'), titulo),
        h('label', { style: 'font-weight:400' }, conf, ' Pedir conferência de colegas antes do PDF (opcional)'),
        h('div', { class: 'linha', style: 'margin-top:10px' }, h('button', { type: 'button', onclick: montarRascunho }, 'Montar o rascunho'))));
  }

  // ---------- editor do documento ----------
  async function editor(p) {
    const d = await api('GET', '/api/documentos/' + p.id);
    const travado = !!d.sei_numero; const meu = d.meu || (EU().perfil === 'admin');
    document.title = d.titulo + ' · CTAI';
    const recarregar = () => editor(p).catch((e) => toast(e.message, true));
    const titulo = h('input', { type: 'text', id: 'dc-ti', value: d.titulo }); const texto = h('textarea', { id: 'dc-tx', rows: 22, style: 'font-family:inherit;line-height:1.5' }, d.texto);
    if (!meu || travado) { titulo.disabled = true; texto.disabled = true; }
    const salvar = async (quieto) => { try { await api('PUT', '/api/documentos/' + d.doc_id, { titulo: titulo.value, texto: texto.value, campos: d.campos }); if (!quieto) { toast('Salvo.'); recarregar(); } return true; } catch (e) { toast(e.message, true); return false; } };
    const pdf = async () => { if (meu && !travado && !(await salvar(true))) return; window.open('/api/documentos/' + d.doc_id + '/pdf', '_blank', 'noopener'); };
    const sei = async () => {
      const n = await perguntar('Registrar no SEI', 'Número do documento que o SEI gerou', { botao: 'Finalizar' }); if (!n) return;
      try { await api('POST', '/api/documentos/' + d.doc_id + '/sei', { numero: n }); toast('Registrado.'); recarregar(); } catch (e) { toast(e.message, true); }
    };
    const pedirConf = async () => {
      const col = (await api('GET', '/api/documentos/colegas')).colegas;
      const caixas = col.map((c) => h('label', { style: 'font-weight:400;display:block' }, h('input', { type: 'checkbox', value: c.usuario_id, checked: d.conferencia.some((x) => x.usuario_id === c.usuario_id) }), ' ' + c.nome));
      const ok = await janela('Quem confere?', h('div', null, h('p', { class: 'mudo' }, 'Cada pessoa escolhida responde "ok" ou aponta o que ajustar. Se você mudar o texto depois, todos conferem de novo.'), caixas), [{ rotulo: 'Cancelar', valor: false, sec: true }, { rotulo: 'Pedir conferência', valor: true }]);
      if (!ok) return;
      try { if (!(await salvar(true))) return; await api('POST', '/api/documentos/' + d.doc_id + '/conferencia', { pedir: true, convocados: caixas.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value)) }); toast('Conferência pedida.'); recarregar(); } catch (e) { toast(e.message, true); }
    };
    const responder = async (status) => {
      let comentario = '';
      if (status === 'reparo') { comentario = await perguntar('O que precisa ajustar?', 'Escreva em poucas palavras', { longo: true, botao: 'Enviar' }); if (!comentario) return; }
      try { await api('POST', '/api/documentos/' + d.doc_id + '/conferir', { status, comentario }); toast('Resposta registrada.'); recarregar(); } catch (e) { toast(e.message, true); }
    };
    const blocoConf = d.conferencia_pedida ? h('div', { class: 'cartao' }, h('h2', null, 'Conferência'),
      tabela([{ t: 'Colega' }, { t: 'Resposta' }, { t: 'Comentário' }], d.conferencia.map((c) => [c.nome, selo(c.status === 'ok' ? 'ok' : (c.status === 'reparo' ? 'pede ajuste' : 'aguardando'), c.status === 'ok' ? 'ok' : (c.status === 'reparo' ? 'atencao' : '')), c.comentario || ''])),
      d.souConferente && !travado ? h('div', { class: 'linha', style: 'margin-top:8px' }, h('button', { type: 'button', onclick: () => responder('ok') }, 'Está ok'), h('button', { type: 'button', class: 'sec', onclick: () => responder('reparo') }, 'Pedir ajuste')) : null,
      meu && !travado ? h('div', { class: 'linha', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'sec', onclick: pedirConf }, 'Mudar quem confere'),
        h('button', { type: 'button', class: 'sec', onclick: async () => { try { await api('POST', '/api/documentos/' + d.doc_id + '/conferencia', { pedir: false }); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Dispensar a conferência')) : null) : null;
    const consulta = d.contrato_id && window.CTAI_UNIDADE && d.trimestre ? await window.CTAI_UNIDADE.painelDados(d.contrato_id, d.trimestre).catch(() => null) : null;
    montar(migalha(h('a', { href: '#/documentos' }, 'Ofícios, despachos e outros'), d.titulo),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, d.tipoNome, ' ', situacao(d)), h('p', null, [d.unidade, d.trimestre, 'criado por você'.replace('você', d.meu ? 'você' : 'outra pessoa')].filter(Boolean).join(' · ')))),
      d.conferencia_pedida && !d.liberado ? aviso('atencao', 'O PDF só é liberado quando todos os colegas convocados responderem "ok".') : null,
      travado ? aviso('ok', h('strong', null, 'Registrado no SEI. '), 'Documento ' + d.sei_numero + '. Não pode mais ser alterado.') : null,
      consulta,
      h('div', { class: 'cartao' }, h('div', { class: 'campo' }, h('label', { for: 'dc-ti' }, 'Título'), titulo), h('div', { class: 'campo' }, h('label', { for: 'dc-tx' }, 'Texto'), texto),
        h('div', { class: 'linha' },
          meu && !travado ? h('button', { type: 'button', onclick: () => salvar(false) }, 'Salvar') : null,
          h('button', { type: 'button', class: 'sec', disabled: !d.liberado, title: d.liberado ? '' : 'Aguardando a conferência', onclick: pdf }, 'Gerar o PDF'),
          meu && !travado && !d.conferencia_pedida ? h('button', { type: 'button', class: 'sec', onclick: pedirConf }, 'Pedir conferência de colegas') : null,
          meu && !travado ? h('button', { type: 'button', class: 'sec', disabled: !d.liberado, onclick: sei }, 'Registrar o número do SEI') : null)),
      blocoConf);
  }

  window.CTAI_DOCUMENTOS = { rotas: [['/documentos', lista], ['/documentos/modelos', modelos], ['/d/novo/:contrato/:tri', novo], ['/d/novo/:contrato/:tri/:tipo', novo], ['/d/:id', editor]], abrirDoc };
})();
