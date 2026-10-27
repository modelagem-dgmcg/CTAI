(function () {
  'use strict';
  // Contrato e atualizações (termos aditivos) de cada unidade, vindos da pasta do Drive da diretoria.
  // O navegador só fala com o servidor do CTAI; o servidor é quem lê o Drive. Nada vale até a pessoa conferir e confirmar o quadro.
  const { h, api, toast, confirmar, selo, aviso, tabela, montar, troca } = window.CTAI;
  const br = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '—'); };
  const hora = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const ROT_CAT = { valor: 'Valor', repasse: 'Repasse', meta: 'Meta', indicador: 'Indicador', desconto: 'Desconto', art15a: 'Art. 15-A', vigencia: 'Vigência', outro: 'Outro' };
  const ROT_EFEITO = { novo: 'novo', altera: 'altera', revoga: 'revoga', mantem: 'mantém' };
  const rotuloTipo = (a) => (a.tipo_doc === 'contrato' ? 'Contrato' : a.tipo_doc === 'aditivo' ? (a.numero_aditivo ? a.numero_aditivo + 'º Termo Aditivo' : 'Termo Aditivo') : 'Outro');

  // ---------- bloco na tela da unidade ----------
  async function preencher(slot, contratoId) {
    const termo = { v: '' };
    const desenhar = async (forcar) => {
      troca(slot, h('div', { class: 'cartao', id: 'ct-bloco' }, h('h2', { style: 'margin-top:0' }, 'Contrato e atualizações'), h('p', { class: 'mudo' }, 'Consultando a pasta de contratos…')));
      let lista, q;
      try {
        const est = await api('GET', '/api/contratos-drive/estado');
        if (!est.configurada) { troca(slot, h('div', { class: 'cartao', id: 'ct-bloco' }, h('h2', { style: 'margin-top:0' }, 'Contrato e atualizações'), aviso('info', 'A pasta de contratos ainda não foi ligada. A administração guarda o endereço em Integrações > Contratos e TAs (Drive).'))); return; }
        lista = await api('GET', '/api/contratos-drive/unidade/' + encodeURIComponent(contratoId) + (termo.v || forcar ? '?' + new URLSearchParams(Object.assign(termo.v ? { termo: termo.v } : {}, forcar ? { atualizar: '1' } : {})).toString() : ''));
        q = await api('GET', '/api/contratos-drive/unidade/' + encodeURIComponent(contratoId) + '/quadro');
      } catch (e) { troca(slot, h('div', { class: 'cartao', id: 'ct-bloco' }, h('h2', { style: 'margin-top:0' }, 'Contrato e atualizações'), aviso('info', e.message))); return; }
      troca(slot, bloco(lista, q, contratoId, termo, desenhar));
    };
    await desenhar(false);
  }

  function bloco(lista, q, contratoId, termo, redesenhar) {
    const ler = async (a) => {
      try {
        toast('Lendo o documento… isso pode levar alguns segundos.');
        const o = await api('POST', '/api/contratos-drive/unidade/' + encodeURIComponent(contratoId) + '/ler', { drive_id: a.id, termo: lista.termo_manual ? lista.termo : undefined });
        toast(o.ia.ok ? 'Quadro pronto. Confira cada campo.' : 'Documento lido, mas sem IA agora. Preencha à mão.', !o.ia.ok);
        location.hash = '#/contrato-doc/' + o.doc_id;
      } catch (e) { toast(e.message, true); }
    };
    const situacao = (a) => (!a.lido ? selo('não lido', 'atencao') : (a.lido.estado === 'confirmado' ? (a.mudou_depois_da_leitura ? selo('mudou no Drive depois da leitura', 'alta') : selo('confirmado', 'ok')) : selo('rascunho: conferir', 'atencao')));
    const acao = (a) => h('div', { class: 'linha' },
      a.url ? h('a', { class: 'btn sec', href: a.url, target: '_blank', rel: 'noopener' }, 'Abrir no Drive') : null,
      a.lido && a.lido.estado === 'rascunho' ? h('a', { class: 'btn', href: '#/contrato-doc/' + a.lido.doc_id }, 'Conferir') : null,
      a.lido && a.lido.estado === 'confirmado' && !a.mudou_depois_da_leitura ? h('a', { class: 'btn sec', href: '#/contrato-doc/' + a.lido.doc_id }, 'Ver o quadro') : null,
      a.e_doc && (!a.lido || a.mudou_depois_da_leitura) ? h('button', { type: 'button', class: 'ct-ler', onclick: () => ler(a) }, 'Ler e montar o quadro do contrato') : null,
      !a.e_doc ? h('span', { class: 'peq mudo', title: 'Só Google Docs são lidos pelo sistema' }, 'não é Google Doc: só abrir') : null);
    const linhas = lista.arquivos.map((a) => [h('div', null, h('strong', null, a.nome), h('div', { class: 'peq mudo' }, a.caminho)), rotuloTipo(a), br(a.atualizado_em), situacao(a), acao(a)]);
    const outro = h('input', { type: 'text', id: 'ct-termo', placeholder: 'Ex.: palmares', value: termo.v, 'aria-label': 'Outro termo de busca' });
    const v = q.vale_hoje;
    const marca = (conf) => (conf ? selo('confirmado', 'ok') : selo('proposta', 'atencao'));
    const hoje = q.documentos.length ? h('div', { id: 'ct-vale-hoje', style: 'margin-top:14px' },
      h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, 'O que vale hoje'), v.tudo_confirmado ? selo('todos os quadros confirmados', 'ok') : selo('PROPOSTA: há quadro por confirmar', 'atencao')),
      v.tudo_confirmado ? null : h('p', { class: 'peq mudo' }, 'O contrato e os aditivos foram aplicados em ordem, mas o que está marcado como proposta ainda não foi conferido por você. Nada daqui é valor oficial até confirmar.'),
      h('p', { class: 'peq' }, [v.vigencia_fim ? h('span', null, 'Vigência até ', h('strong', null, br(v.vigencia_fim.valor)), ' (' + v.vigencia_fim.doc + ') ', marca(v.vigencia_fim.confirmado), '  ') : null, v.valor_total ? h('span', null, 'Valor: ', h('strong', null, v.valor_total.valor), ' (' + v.valor_total.doc + ') ', marca(v.valor_total.confirmado)) : null]),
      v.pontos.length ? tabela([{ t: 'Assunto' }, { t: 'Ponto' }, { t: 'Valor / meta' }, { t: 'Vem de' }, { t: 'Situação' }], v.pontos.map((p) => [ROT_CAT[p.categoria] || p.categoria, h('div', null, h('strong', null, p.titulo), p.descricao ? h('div', { class: 'peq mudo' }, p.descricao) : null), p.valor || '—', p.doc + (p.efeito === 'altera' ? ' (altera)' : ''), marca(p.confirmado)])) : h('p', { class: 'mudo peq' }, 'Nenhum ponto no quadro ainda.'),
      v.revogados.length ? h('p', { class: 'peq mudo' }, 'Retirados por aditivo: ' + v.revogados.map((r) => r.titulo + ' (' + r.doc + ')').join('; ')) : null,
      q.documentos.some((d) => d.muda) ? h('div', null, h('h4', { style: 'margin:10px 0 4px' }, 'O que cada aditivo muda'), h('ul', { class: 'peq' }, q.documentos.filter((d) => d.muda).map((d) => h('li', null, h('strong', null, d.rotulo + ': '), d.muda, ' ', marca(d.estado === 'confirmado'))))) : null) : null;
    return h('div', { class: 'cartao', id: 'ct-bloco' },
      h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Contrato e atualizações'), h('button', { type: 'button', class: 'sec', id: 'ct-atualizar', onclick: () => redesenhar(true) }, 'Atualizar a lista')),
      lista.novidades.length ? aviso('atencao', h('strong', null, 'Mudou na pasta desde a última consulta: '), lista.novidades.map((n) => n.nome + (n.novo ? ' (novo)' : ' (alterado)')).join('; ') + '.') : null,
      h('p', { class: 'peq mudo' }, 'Pasta atualizada em ' + br(lista.pasta_atualizada_em) + ' (a diretoria só atualiza a pasta no dia 20 de cada mês). Consulta de ' + hora(lista.lido_em) + (lista.da_copia ? ' (cópia)' : '') + ' · busca por "' + lista.termo + '".'),
      lista.aviso ? aviso('atencao', 'Não consegui atualizar agora (' + lista.aviso + '). Mostrando a última cópia.') : null,
      lista.amplo ? aviso('info', 'A busca por "' + lista.termos_tentados[0] + '" não achou nada; usei só "' + lista.termo + '". Confira se todos os arquivos são desta unidade.') : null,
      lista.arquivos.length ? tabela([{ t: 'Documento' }, { t: 'Tipo' }, { t: 'No Drive em' }, { t: 'Situação' }, { t: '' }], linhas) : aviso('info', 'Nenhum documento encontrado na pasta para esta unidade. Use outro termo abaixo, se o nome da pasta for diferente.'),
      hoje,
      h('details', { style: 'margin-top:10px' }, h('summary', { class: 'peq' }, 'Buscar com outro termo'), h('div', { class: 'linha' }, outro, h('button', { type: 'button', class: 'sec', onclick: () => { termo.v = outro.value.trim(); redesenhar(false); } }, 'Buscar'), termo.v ? h('button', { type: 'button', class: 'leve', onclick: () => { termo.v = ''; redesenhar(false); } }, 'Voltar ao termo automático') : null)));
  }

  // ---------- conferência do quadro (rascunho -> confirmado) ----------
  async function tela(p) {
    const d = await api('GET', '/api/contratos-drive/docs/' + p.id);
    const trava = d.estado !== 'rascunho';
    const unidadeNome = (await api('GET', '/api/ctai/contratos')).contratos.find((c) => c.contrato_id === d.contrato_id);
    const E = { tipo: d.tipo, numero_aditivo: d.numero_aditivo === null ? '' : d.numero_aditivo, data_doc: br(d.data_doc) === '—' ? '' : br(d.data_doc), objeto: d.objeto || '', vigencia_inicio: d.vigencia_inicio ? br(d.vigencia_inicio) : '', vigencia_fim: d.vigencia_fim ? br(d.vigencia_fim) : '', valor_total: d.valor_total || '', muda: d.muda || '', pontos: d.pontos.map((x) => Object.assign({}, x)) };
    const campo = (rot, el, id) => h('div', { class: 'campo' }, h('label', { for: id }, rot), el);
    const ent = (id, val, fn, extra) => h('input', Object.assign({ type: 'text', id, value: val === null || val === undefined ? '' : val, disabled: trava, oninput: (ev) => fn(ev.target.value) }, extra || {}));
    const area = (id, val, fn, linhas) => h('textarea', { id, rows: linhas || 2, disabled: trava, oninput: (ev) => fn(ev.target.value) }, val || '');
    const origem = (x) => (x.trecho ? h('div', { class: 'peq', style: x.verificada ? '' : 'color:#8e1628' }, (x.verificada ? '✔ confere no texto · ' : '⚠ não encontrei no texto · ') + x.trecho) : (d.origem === 'ia' && !trava ? h('div', { class: 'peq', style: 'color:#8e1628' }, '⚠ sem trecho de origem: confira') : null));
    const alvo = h('div');
    const desenhar = () => troca(alvo, E.pontos.length ? E.pontos.map((x, i) => h('div', { class: 'hi-item' }, h('div', { class: 'hi-linha' },
      h('div', { class: 'hi-campos' },
        h('select', { 'aria-label': 'Assunto', disabled: trava, onchange: (ev) => { x.categoria = ev.target.value; } }, Object.keys(ROT_CAT).map((k) => h('option', { value: k, selected: k === x.categoria }, ROT_CAT[k]))),
        ent(null, x.titulo, (v) => { x.titulo = v; }, { placeholder: 'Ponto (ex.: Repasse mensal)', 'aria-label': 'Ponto', style: 'flex:1;min-width:180px' }),
        ent(null, x.valor, (v) => { x.valor = v; }, { placeholder: 'Valor ou meta', 'aria-label': 'Valor ou meta', style: 'width:170px' }),
        h('select', { 'aria-label': 'Efeito', disabled: trava, onchange: (ev) => { x.efeito = ev.target.value; } }, Object.keys(ROT_EFEITO).map((k) => h('option', { value: k, selected: k === x.efeito }, ROT_EFEITO[k])))),
      h('textarea', { rows: 2, disabled: trava, 'aria-label': 'Explicação curta', placeholder: 'Explicação curta', oninput: (ev) => { x.descricao = ev.target.value; } }, x.descricao || ''), origem(x)),
      trava ? null : h('button', { type: 'button', class: 'leve', 'aria-label': 'Remover esta linha', onclick: () => { E.pontos.splice(i, 1); desenhar(); } }, 'Remover'))) : h('p', { class: 'mudo peq' }, 'Nenhum ponto. Adicione valores, metas, indicadores e regras de desconto (art. 15-A) como estão no documento.'));
    desenhar();
    const corpo = () => ({ tipo: E.tipo, numero_aditivo: E.numero_aditivo, data_doc: E.data_doc, objeto: E.objeto, vigencia_inicio: E.vigencia_inicio, vigencia_fim: E.vigencia_fim, valor_total: E.valor_total, muda: E.muda, pontos: E.pontos });
    const salvar = async (silencioso) => { try { await api('PUT', '/api/contratos-drive/docs/' + d.doc_id, corpo()); if (!silencioso) toast('Rascunho salvo.'); return true; } catch (e) { toast(e.message, true); return false; } };
    const textoLido = h('div');
    const verTexto = async () => { try { const t = await api('GET', '/api/contratos-drive/docs/' + d.doc_id + '?texto=1'); troca(textoLido, h('pre', { class: 'hi-texto' }, t.texto || '(sem texto)')); } catch (e) { toast(e.message, true); } };
    const voltar = '#/u/' + encodeURIComponent(d.contrato_id);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, (trava ? 'Quadro confirmado' : 'Conferir o quadro') + ' · ' + (unidadeNome ? unidadeNome.unidade : d.contrato_id)), h('p', null, d.rotulo + ' · ' + d.nome)),
      h('div', { class: 'linha' }, h('a', { class: 'btn sec', href: voltar }, 'Voltar'), d.url ? h('a', { class: 'btn sec', href: d.url, target: '_blank', rel: 'noopener' }, 'Abrir no Drive') : null, trava ? selo(d.estado === 'confirmado' ? 'confirmado por ' + d.confirmado_por : 'substituído', d.estado === 'confirmado' ? 'ok' : '') : selo('rascunho', 'atencao'))),
      trava ? aviso('info', 'Este quadro já vale e não pode mais ser editado. Se o documento mudar no Drive, leia de novo: nasce um novo rascunho que substitui este quando você confirmar.')
        : aviso('atencao', h('strong', null, d.origem === 'ia' ? 'O sistema leu o documento e propôs este quadro' + (d.provedor ? ' (' + d.provedor + ')' : '') + '. ' : 'Preencha à mão. '), 'Confira cada campo com o documento. ' + (d.truncado ? 'O texto era muito longo e foi cortado: confira o que falta. ' : '') + 'Nada vale até você confirmar.'),
      h('div', { class: 'cartao' }, h('h2', null, 'Dados gerais'), h('div', { class: 'hi-grade' },
        campo('Documento', h('select', { id: 'ct-tipo', disabled: trava, onchange: (ev) => { E.tipo = ev.target.value; } }, [['contrato', 'Contrato de gestão'], ['aditivo', 'Termo aditivo'], ['outro', 'Outro']].map(([k, r]) => h('option', { value: k, selected: k === E.tipo }, r))), 'ct-tipo'),
        campo('Nº do termo aditivo', ent('ct-num', E.numero_aditivo, (v) => { E.numero_aditivo = v; }, { inputmode: 'numeric' }), 'ct-num'),
        campo('Data do documento (dd/mm/aaaa)', ent('ct-data', E.data_doc, (v) => { E.data_doc = v; }), 'ct-data'),
        campo('Início da vigência', ent('ct-vi', E.vigencia_inicio, (v) => { E.vigencia_inicio = v; }), 'ct-vi'),
        campo('Fim da vigência', ent('ct-vf', E.vigencia_fim, (v) => { E.vigencia_fim = v; }), 'ct-vf'),
        campo('Valor total', ent('ct-vt', E.valor_total, (v) => { E.valor_total = v; }), 'ct-vt')),
        campo('Objeto', area('ct-obj', E.objeto, (v) => { E.objeto = v; }), 'ct-obj'),
        campo('O que este aditivo muda no contrato', area('ct-muda', E.muda, (v) => { E.muda = v; }), 'ct-muda')),
      h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Valores, repasses, metas, indicadores e regras de desconto'), trava ? null : h('button', { type: 'button', class: 'sec', id: 'ct-add', onclick: () => { E.pontos.push({ categoria: 'valor', titulo: '', valor: '', descricao: '', efeito: 'novo', trecho: '', verificada: false }); desenhar(); } }, 'Adicionar linha')), alvo),
      d.tem_texto && !trava ? h('div', { class: 'cartao' }, h('h3', null, 'Texto lido do documento'), h('p', { class: 'mudo peq' }, 'Para conferir. Já vem com dados pessoais mascarados e fica guardado só até você confirmar.'), h('button', { type: 'button', class: 'sec', onclick: verTexto }, 'Mostrar o texto lido'), textoLido) : null,
      trava ? null : h('div', { class: 'cartao' }, h('div', { class: 'linha' },
        h('button', { type: 'button', id: 'ct-salvar', class: 'sec', onclick: () => salvar(false) }, 'Salvar rascunho'),
        h('button', { type: 'button', id: 'ct-confirmar', onclick: async () => { if (!(await confirmar('Confirmar o quadro', 'Você conferiu os dados com o documento? Depois de confirmar o quadro não se edita mais e passa a valer em "o que vale hoje".', 'Sim, confirmar'))) return; if (!(await salvar(true))) return; try { await api('POST', '/api/contratos-drive/docs/' + d.doc_id + '/confirmar'); toast('Quadro confirmado.'); location.hash = voltar; } catch (e) { toast(e.message, true); } } }, 'Confirmar'),
        h('button', { type: 'button', class: 'perigo', onclick: async () => { if (!(await confirmar('Descartar o rascunho', 'O rascunho será apagado. O documento continua no Drive.', 'Descartar', true))) return; try { await api('DELETE', '/api/contratos-drive/docs/' + d.doc_id); toast('Rascunho descartado.'); location.hash = voltar; } catch (e) { toast(e.message, true); } } }, 'Descartar'))));
  }

  window.CTAI_CONTRATOS = { preencher, rotas: [['/contrato-doc/:id', tela]] };
})();
