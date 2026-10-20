(function () {
  'use strict';
  const { h, api, fmt, toast, janela, perguntar, confirmar, selo, seloGrav, aviso, tabela, rotear, montar, troca, casca } = window.CTAI;
  let EU = null, INFO = null;

  const ehGestor = () => EU.perfil === 'gestor_unidade' || EU.perfil === 'admin';
  const statusSelo = (s) => selo(s, s === 'pronta' ? 'ok' : (s === 'rascunho' ? '' : 'atencao'));
  const faixaDemo = () => (INFO && INFO.contrato.demo ? h('div', { class: 'faixa-demo' }, h('strong', null, 'DEMONSTRAÇÃO – dados fictícios. '), 'Nada daqui vale como relatório oficial. O administrador pode apagar estes dados.') : null);
  const migalha = (...p) => h('div', { class: 'migalha' }, p.map((x, i) => [i ? ' › ' : '', x]));

  // Avisos sobre o vínculo com o SEI. Só avisam: nada bloqueia o envio.
  const avisosSei = (d, cid, comLink) => (d.sei && d.sei.alertas.length ? d.sei.alertas.map((a) => aviso('atencao', h('strong', null, 'SEI: '), a.mensagemUnidade, comLink ? [' ', h('a', { href: '#/c/' + cid + '/envios' }, 'Registrar o número')] : null)) : null);

  async function carregarInfo() { INFO = await api('GET', '/api/unidade/competencias'); return INFO; }

  // ---------- Início ----------
  async function inicio() {
    await carregarInfo();
    const c = INFO.contrato;
    montar(faixaDemo(),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, c.unidade), h('p', null, c.oss + ' · Contrato de Gestão ' + (c.numero_cg || '')))),
      h('div', { class: 'aviso info' }, 'Cada mês tem seis fichas (uma por setor) e algumas listas. Quando todas estiverem prontas, o gestor confere e envia: o sistema gera o PDF que segue para o SEI e a CTAI recebe e recalcula.'),
      h('div', { class: 'grade' }, INFO.competencias.map((k) => h('div', { class: 'cartao' },
        h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, fmt.comp(k.competencia_id)), k.mes_implantacao ? selo('implantação', 'atencao') : null),
        h('p', { class: 'mudo peq' }, k.versaoEnvio ? 'Enviado (versão ' + k.versaoEnvio + ') · situação: ' + k.status : 'Ainda não enviado'),
        k.seiAlertas ? h('p', { class: 'peq' }, selo('SEI pendente', 'atencao'), ' o vínculo com o documento no SEI pede atenção. Abra o mês.') : null,
        h('div', { class: 'barra', role: 'img', 'aria-label': k.fichasProntas + ' de ' + k.fichasTotal + ' fichas prontas' }, h('i', { style: 'width:' + Math.round((k.fichasProntas / k.fichasTotal) * 100) + '%' })),
        h('p', { class: 'peq mudo' }, k.fichasProntas + ' de ' + k.fichasTotal + ' fichas prontas'),
        h('a', { class: 'btn', href: '#/c/' + k.cid }, 'Abrir o mês')))));
  }

  // ---------- Competência ----------
  function abas(cid, ativa) {
    return h('div', { class: 'abas' }, [['', 'Resumo'], ['/enviar', 'Conferir e enviar'], ['/envios', 'Envios']].map(([p, r]) => h('a', { href: '#/c/' + cid + p, class: ativa === p ? 'ativo' : '' }, r)));
  }
  async function cabecalho(cid, aba) {
    const d = await api('GET', '/api/unidade/competencias/' + cid);
    await carregarInfo();
    return [d, [faixaDemo(), migalha(h('a', { href: '#/' }, 'Início'), fmt.comp(d.competencia.competencia_id)),
      h('div', { class: 'topo' }, h('div', null, h('h1', null, fmt.comp(d.competencia.competencia_id)), h('p', null, d.competencia.unidade + (d.competencia.mes_implantacao ? ' · mês de implantação' : '')))), abas(cid, aba)]];
  }

  async function competencia(p) {
    const [d, topo] = await cabecalho(p.cid, '');
    const totalLinhas = Object.values(d.contagem).reduce((s, x) => s + x.confirmadas, 0);
    const prontas = d.setores.filter((s) => s.status === 'pronta').length;
    const lotes = d.lotes.length ? aviso('atencao', h('strong', null, 'Linhas vindas da integração aguardam a sua confirmação. '), 'Elas só entram no cálculo e no envio depois que o gestor confirmar.',
      d.lotes.map((l) => h('div', { class: 'linha', style: 'margin-top:6px' }, h('span', null, l.fonte + ': ' + l.registros + ' linha(s)'),
        ehGestor() ? [h('button', { onclick: async () => { await api('POST', '/api/unidade/lotes/' + l.lote_id + '/confirmar', { substituir: false }); toast('Lote confirmado.'); competencia(p); } }, 'Confirmar'),
          h('button', { class: 'sec', onclick: async () => { if (await confirmar('Descartar o lote?', 'As linhas deste lote serão apagadas do rascunho.', 'Descartar', true)) { await api('POST', '/api/unidade/lotes/' + l.lote_id + '/descartar', {}); competencia(p); } } }, 'Descartar')] : null))) : null;
    montar(topo,
      h('div', { class: 'kpis' }, kpi('Fichas prontas', prontas + ' de ' + d.setores.length), kpi('Linhas confirmadas', fmt.num(totalLinhas, 0)), kpi('Pontos pelas regras', d.pontos.total + ' de 100', 'informativo; a pontuação final é da CTAI'), kpi('Versão enviada', d.envios.length ? 'v' + d.envios[0].versao : 'nenhuma')),
      lotes, avisosSei(d, p.cid, true),
      h('div', { class: 'grade' }, d.setores.map((s) => h('div', { class: 'cartao' },
        h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, s.nome), statusSelo(s.status)),
        h('p', { class: 'mudo peq' }, s.resumo),
        s.indicadores.length ? h('p', { class: 'peq' }, 'Indicadores: ' + s.indicadores.join(', ')) : null,
        h('div', { class: 'linha' }, h('a', { class: 'btn', href: '#/c/' + p.cid + '/ficha/' + s.id }, s.status === 'pronta' ? 'Ver a ficha' : 'Preencher a ficha')),
        s.fontes.length ? h('div', { style: 'margin-top:12px;border-top:1px solid var(--borda);padding-top:8px' }, h('strong', { class: 'peq' }, 'Listas'), s.fontes.map((f) => {
          const c = d.contagem[f];
          return h('div', { class: 'linha espaco peq', style: 'margin-top:4px' }, h('a', { href: '#/c/' + p.cid + '/lista/' + f }, nomeFonte(f)), h('span', { class: 'mudo' }, c.confirmadas + ' linha(s)' + (c.pendentes ? ' + ' + c.pendentes + ' pendentes' : '')));
        })) : null))));
  }
  const NOMES_FONTES = {};
  const nomeFonte = (f) => NOMES_FONTES[f] || f;
  const kpi = (r, v, nota) => h('div', { class: 'kpi' }, h('div', { class: 'r' }, r), h('div', { class: 'num-grande' }, v), nota ? h('div', { class: 'r' }, nota) : null);

  // ---------- Ficha ----------
  function entradaCampo(c, valor) {
    const id = 'f-' + c.id;
    const comum = { id, name: c.id };
    if (c.tipo === 'sim_nao') return h('select', comum, ['', 'sim', 'não'].map((o) => h('option', { value: o, selected: o === (valor || '') }, o || '— escolha —')));
    if (c.tipo === 'selecao') return h('select', comum, [''].concat(c.opcoes).map((o) => h('option', { value: o, selected: o === (valor || '') }, o || '— escolha —')));
    if (c.tipo === 'texto_longo') return h('textarea', Object.assign({ rows: 3, maxlength: 2000 }, comum), valor || '');
    if (c.tipo === 'texto') return h('input', Object.assign({ type: 'text', value: valor || '', maxlength: 200 }, comum));
    return h('input', Object.assign({ type: 'text', inputmode: c.tipo === 'inteiro' ? 'numeric' : 'decimal', value: valor === undefined ? '' : String(valor).replace('.', ',') }, comum));
  }

  async function ficha(p) {
    const [d, topo] = await cabecalho(p.cid, '');
    const f = await api('GET', '/api/unidade/competencias/' + p.cid + '/ficha/' + p.setor);
    const dados = f.ficha.dados;
    const bloqueada = !f.podeEditar;
    const inputs = {};
    const grupos = [];
    for (const c of f.campos) {
      const chave = c.indicador || (c.id.endsWith('_obs') ? 'obs' : 'geral');
      let g = grupos.find((x) => x.chave === chave);
      if (!g) { g = { chave, campos: [] }; grupos.push(g); }
      g.campos.push(c);
    }
    const form = h('form', { novalidate: true }, grupos.map((g) => h('div', { class: 'cartao' },
      h('h3', null, g.chave === 'obs' ? 'Observações' : (g.chave === 'geral' ? 'Dados gerais' : 'Indicador ' + g.chave + ' · ' + (d.pontos && d.pontos.porIndicador[g.chave] !== undefined ? d.pontos.porIndicador[g.chave] + ' ponto(s) pelas regras' : ''))),
      h('div', { class: 'duas' }, g.campos.map((c) => {
        const el = entradaCampo(c, dados[c.id]);
        if (bloqueada) el.setAttribute('disabled', '');
        inputs[c.id] = el;
        return h('div', { class: 'campo', id: 'cp-' + c.id }, h('label', { for: 'f-' + c.id }, c.rotulo, c.unidade ? h('span', { class: 'un' }, ' (' + c.unidade + ')') : null), el, c.ajuda ? h('div', { class: 'ajuda' }, c.ajuda) : null, h('div', { class: 'msg-erro' }));
      })))));
    const valoresDoForm = () => { const o = {}; for (const [id, el] of Object.entries(inputs)) o[id] = el.value; return o; };
    const mostrarErros = (erros) => { document.querySelectorAll('.campo.erro').forEach((x) => { x.classList.remove('erro'); x.querySelector('.msg-erro').textContent = ''; }); (erros || []).forEach((e) => { const el = document.getElementById('cp-' + e.campo); if (el) { el.classList.add('erro'); el.querySelector('.msg-erro').textContent = e.mensagem; } }); const prim = document.querySelector('.campo.erro'); if (prim) prim.scrollIntoView({ block: 'center' }); };
    const salvar = async (pronta) => {
      try {
        await api('PUT', '/api/unidade/competencias/' + p.cid + '/ficha/' + p.setor, { dados: valoresDoForm() });
        mostrarErros([]);
        if (pronta !== undefined) await api('POST', '/api/unidade/competencias/' + p.cid + '/ficha/' + p.setor + '/pronta', { pronta });
        toast(pronta ? 'Ficha salva e marcada como pronta.' : 'Ficha salva.');
        ficha(p);
      } catch (e) { mostrarErros(e.dados && e.dados.erros); toast(e.message, true); }
    };
    montar(topo,
      h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, f.setor.nome), statusSelo(f.ficha.status)),
      h('p', { class: 'mudo' }, f.setor.resumo),
      aviso('atencao', h('strong', null, 'Não escreva dados de paciente. '), 'Nada de nome, CPF, número de prontuário ou data de nascimento, nem nas observações. Para identificar um atendimento, use só o número de protocolo.'),
      f.ficha.status === 'pronta' ? aviso('info', 'Esta ficha está marcada como pronta. Se você salvar uma alteração, ela volta a ser rascunho.') : null,
      bloqueada ? aviso('erro', 'Você não pode editar a ficha de outro setor.') : null,
      form,
      h('div', { class: 'cartao' }, h('h3', null, 'Como o sistema vai usar estes dados'), tabela([{ t: 'Indicador' }, { t: 'Valor', n: true }, { t: 'Origem' }, { t: 'Pontos', n: true }],
        f.setor.indicadores.map((i) => { const c = d.consolidado[i] || {}; return [i, fmt.valor(c.valor), ({ digitado: 'digitado por você', apoio: 'calculado das contagens', linhas: 'calculado das linhas' })[c.origem] || '—', String(d.pontos.porIndicador[i] ?? 0)]; }),
        { vazio: 'Este setor não tem indicador próprio; seus dados alimentam os cruzamentos da CTAI.' }),
        h('p', { class: 'mudo peq' }, 'Atualizado após salvar. Se o valor digitado ficar em branco, o sistema usa as contagens ou as linhas das listas.')),
      bloqueada ? null : h('div', { class: 'linha no-print' }, h('button', { type: 'button', class: 'sec', onclick: () => salvar() }, 'Salvar rascunho'),
        f.ficha.status === 'pronta' ? null : h('button', { type: 'button', onclick: () => salvar(true) }, 'Salvar e marcar como pronta'),
        f.ficha.status === 'pronta' ? h('button', { type: 'button', class: 'sec', onclick: async () => { await api('POST', '/api/unidade/competencias/' + p.cid + '/ficha/' + p.setor + '/pronta', { pronta: false }); ficha(p); } }, 'Reabrir para edição') : null,
        h('a', { href: '#/c/' + p.cid }, 'Voltar ao mês')));
  }

  // ---------- Lista (linhas brutas) ----------
  async function lista(p) {
    const [d, topo] = await cabecalho(p.cid, '');
    const r = await api('GET', '/api/unidade/competencias/' + p.cid + '/linhas/' + p.fonte);
    const f = r.fonte;
    const modo = { v: 'substituir' };
    const resultado = h('div');
    const enviarTexto = async (csv) => {
      troca(resultado);
      try {
        const out = await api('POST', '/api/unidade/competencias/' + p.cid + '/linhas/' + p.fonte, { csv, modo: modo.v });
        toast(out.gravadas + ' linha(s) gravadas.'); if (out.avisos && out.avisos.length) toast(out.avisos[0]); lista(p);
      } catch (e) {
        troca(resultado, aviso('erro', h('strong', null, e.dados && e.dados.recusado ? 'Arquivo recusado. ' : 'Nenhuma linha foi gravada. '), e.message,
          e.dados && e.dados.erros ? tabela([{ t: 'Linha', n: true }, { t: 'Coluna' }, { t: 'Problema' }], e.dados.erros.map((x) => [String(x.linha), x.coluna, x.mensagem])) : null));
      }
    };
    const arquivo = h('input', { type: 'file', accept: '.csv,text/csv', id: 'arq', onchange: async () => { const a = arquivo.files[0]; if (a) await enviarTexto(await a.text()); arquivo.value = ''; } });
    const manual = {};
    const formManual = h('form', { class: 'duas', onsubmit: async (e) => {
      e.preventDefault();
      const reg = {}; for (const c of f.colunas) reg[c.nome] = manual[c.nome].value;
      try { const out = await api('POST', '/api/unidade/competencias/' + p.cid + '/linhas/' + p.fonte, { registros: [reg], modo: 'somar' }); toast(out.gravadas + ' linha adicionada.'); lista(p); } catch (er) { toast(er.message + (er.dados && er.dados.erros ? ' ' + er.dados.erros[0].mensagem : ''), true); }
    } }, f.colunas.map((c) => {
      const el = c.tipo === 'selecao' ? h('select', { id: 'm-' + c.nome }, [''].concat(c.opcoes).map((o) => h('option', { value: o }, o || '—')))
        : c.tipo === 'sim_nao' ? h('select', { id: 'm-' + c.nome }, ['', 'sim', 'não'].map((o) => h('option', { value: o }, o || '—')))
        : h('input', { type: c.tipo === 'data' ? 'date' : (c.tipo === 'hora' ? 'time' : 'text'), id: 'm-' + c.nome, inputmode: c.tipo === 'numero' ? 'decimal' : null });
      manual[c.nome] = el;
      return h('div', { class: 'campo' }, h('label', { for: 'm-' + c.nome }, c.rotulo + (c.obrigatorio ? ' *' : '')), el, c.ajuda ? h('div', { class: 'ajuda' }, c.ajuda) : null);
    }).concat([h('div', null, h('button', { type: 'submit', class: 'sec' }, 'Adicionar esta linha'))]));
    const colunasTab = [{ t: 'Protocolo' }, { t: 'Categoria' }, { t: 'Início' }, { t: 'Fim' }, { t: 'Minutos', n: true }, { t: 'Origem' }];
    montar(topo,
      h('h2', null, f.nome), h('p', { class: 'mudo' }, f.ajuda),
      aviso('atencao', h('strong', null, 'Só protocolo, datas, horas, minutos e categorias. '), 'Arquivo com coluna de nome, CPF, prontuário ou data de nascimento é recusado por inteiro. Nada é gravado.'),
      h('div', { class: 'cartao' }, h('h3', null, 'Enviar um arquivo CSV'),
        h('p', { class: 'peq mudo' }, 'Use o modelo para ter o cabeçalho certo. O arquivo é conferido antes de gravar: se uma linha tiver problema, nenhuma é gravada.'),
        h('div', { class: 'linha' }, h('a', { class: 'btn sec', href: '/api/unidade/fontes/' + p.fonte + '/modelo.csv' }, 'Baixar o modelo'), arquivo),
        h('div', { class: 'linha', style: 'margin-top:8px' }, h('label', { style: 'font-weight:400;margin:0' }, h('input', { type: 'radio', name: 'modo', checked: true, onchange: () => { modo.v = 'substituir'; } }), ' Substituir as linhas atuais'), h('label', { style: 'font-weight:400;margin:0' }, h('input', { type: 'radio', name: 'modo', onchange: () => { modo.v = 'somar'; } }), ' Somar às atuais')),
        resultado),
      h('div', { class: 'cartao' }, h('h3', null, 'Ou digitar uma linha'), formManual),
      h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, r.total + ' linha(s) no rascunho' + (r.total > r.linhas.length ? ' (mostrando ' + r.linhas.length + ')' : '')),
        r.total ? h('button', { class: 'sec', onclick: async () => { if (await confirmar('Limpar a lista?', 'As linhas digitadas ou enviadas por arquivo serão apagadas do rascunho (as da integração ficam).', 'Limpar', true)) { await api('DELETE', '/api/unidade/competencias/' + p.cid + '/linhas/' + p.fonte); lista(p); } } }, 'Limpar a lista') : null),
        tabela(colunasTab, r.linhas.map((l) => [l.protocolo, l.categoria || '—', (l.data_inicio || '') + ' ' + (l.hora_inicio || ''), (l.data_fim || '') + ' ' + (l.hora_fim || ''), l.minutos === null ? '—' : fmt.num(l.minutos, 1), l.origem + (l.confirmada ? '' : ' (pendente)')]), { vazio: 'Nenhuma linha ainda.' })),
      h('a', { href: '#/c/' + p.cid }, 'Voltar ao mês'));
    void d;
  }

  // ---------- Conferir e enviar ----------
  async function enviar(p) {
    const [d, topo] = await cabecalho(p.cid, '/enviar');
    const regras = await api('GET', '/api/regras/' + INFO.contrato.contrato_id);
    const nomes = Object.fromEntries(regras.indicadores.map((i) => [i.id, i]));
    const jaEnviou = d.envios.length > 0;
    const motivo = h('textarea', { id: 'motivo', rows: 2, placeholder: 'O que mudou desde o último envio?' });
    const resultado = h('div');
    const botao = h('button', { disabled: d.bloqueios.length > 0 || !d.voce.podeEnviar, onclick: async () => {
      if (jaEnviou && !motivo.value.trim()) { toast('Informe o motivo da correção.', true); motivo.focus(); return; }
      if (!(await confirmar('Gerar o PDF e enviar?', 'O envio fica registrado e não pode ser alterado. Se precisar corrigir depois, será uma nova versão com o motivo.', 'Gerar e enviar'))) return;
      botao.disabled = true;
      try {
        const o = await api('POST', '/api/unidade/competencias/' + p.cid + '/enviar', { motivo: motivo.value });
        troca(resultado, aviso('ok', h('strong', null, 'Enviado (versão ' + o.versao + '). '), 'A CTAI recebeu os dados e já recalculou. Falta o documento oficial: baixe o PDF, anexe e assine no SEI e, depois, registre aqui o número do documento. ', h('a', { href: '/api/unidade/envios/' + o.envio_id + '/pdf', target: '_blank', rel: 'noopener' }, 'Abrir o PDF'), ' · ', h('a', { href: '#/c/' + p.cid + '/envios' }, 'Registrar o número do SEI'), h('div', { class: 'peq mudo' }, 'No rodapé do PDF: Versão v' + o.versao + ' · código de integridade ' + o.hash.slice(0, 12))));
        toast('Relatório enviado.');
      } catch (e) { toast(e.message, true); botao.disabled = false; }
    } }, 'Gerar o PDF e enviar para a CTAI');
    montar(topo,
      d.bloqueios.length ? aviso('erro', h('strong', null, 'Ainda não dá para enviar:'), h('ul', null, d.bloqueios.map((b) => h('li', null, b)))) : aviso('ok', 'Tudo pronto para enviar.'),
      !d.voce.podeEnviar ? aviso('info', 'Só o gestor da unidade envia o relatório. Você pode preencher a ficha do seu setor.') : null,
      h('div', { class: 'cartao' }, h('h3', null, 'O que o sistema conferiu'),
        d.avisos.length ? h('ul', null, d.avisos.map((a) => h('li', null, seloGrav(a.nivel === 'atencao' ? 'média' : 'baixa'), ' ', a.mensagem))) : h('p', { class: 'mudo' }, 'Nenhum ponto de atenção.'),
        h('p', { class: 'mudo peq' }, 'Estes avisos são da unidade e não impedem o envio. A CTAI recalcula de forma independente, a partir das linhas.')),
      h('div', { class: 'cartao' }, h('h3', null, 'Indicadores como serão enviados'),
        tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Valor', n: true }, { t: 'Origem' }, { t: 'Pontos', n: true }, { t: 'Anexo' }],
          regras.indicadores.map((i) => { const c = d.consolidado[i.id] || {}; return [i.id, i.nome, fmt.valor(c.valor), ({ digitado: 'digitado', apoio: 'das contagens', linhas: 'das linhas' })[c.origem] || '—', (d.pontos.porIndicador[i.id] ?? 0) + ' / ' + i.max, c.anexo || '—']; })),
        h('p', { class: 'peq' }, h('strong', null, 'Pontos pelas regras do contrato: ' + d.pontos.total + ' de 100.'), ' Informativo. A pontuação final é da CTAI.')),
      h('div', { class: 'cartao' }, h('h3', null, jaEnviou ? 'Novo envio (versão ' + (d.envios[0].versao + 1) + ')' : 'Enviar'),
        jaEnviou ? h('div', { class: 'campo' }, h('label', { for: 'motivo' }, 'Motivo da correção'), motivo) : null, h('div', { class: 'linha' }, botao), resultado,
        h('p', { class: 'mudo peq' }, 'O PDF é gerado antes de gravar. O sistema não guarda senha nem credencial do SEI: o documento é anexado e assinado no SEI, por quem tem a competência. Depois de assinar, registre o número do documento na aba Envios. Os dois caminhos andam juntos: os dados no sistema (a CTAI recalcula) e o PDF assinado no SEI (o documento oficial). O sistema não bloqueia o envio por falta desse registro.')));
    void nomes;
  }

  async function envios(p) {
    const [d, topo] = await cabecalho(p.cid, '/envios');
    const cn = d.sei;
    const registrar = async (v, campo, msg) => {
      try { const o = await api('POST', '/api/unidade/envios/' + v.envio_id + '/sei', { numero: campo.value }); toast('Registrado: SEI nº ' + o.sei_numero + ' para a versão v' + o.versao + '.'); envios(p); } catch (e) { msg.textContent = e.message; campo.setAttribute('aria-invalid', 'true'); campo.focus(); }
    };
    const corrigir = async (v) => {
      const novo = h('input', { type: 'text', id: 'sei-novo', inputmode: 'numeric', maxlength: 12, autocomplete: 'off' });
      const mot = h('textarea', { id: 'sei-motivo', rows: 2, placeholder: 'ex.: digitei o número do documento errado' });
      const msg = h('div', { class: 'msg-erro' });
      const corpo = h('div', null, h('p', null, 'Número registrado hoje: ', h('strong', null, v.sei.numero), '. O registro anterior fica guardado no histórico; ele não é apagado.'),
        h('div', { class: 'campo' }, h('label', { for: 'sei-novo' }, 'Número correto do documento no SEI'), novo), h('div', { class: 'campo' }, h('label', { for: 'sei-motivo' }, 'Motivo da correção'), mot), msg);
      await janela('Corrigir o número do SEI da versão v' + v.versao, corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Corrigir', valor: 'ok', validar: async () => {
        try { await api('POST', '/api/unidade/envios/' + v.envio_id + '/sei', { numero: novo.value, motivo: mot.value }); toast('Número corrigido.'); return true; } catch (e) { msg.textContent = e.message; return false; } } }]);
      envios(p);
    };
    const cartao = (v) => {
      const campo = h('input', { type: 'text', id: 'sei-' + v.envio_id, inputmode: 'numeric', maxlength: 12, autocomplete: 'off', placeholder: 'só dígitos, 6 a 12', 'aria-describedby': 'sei-ajuda' });
      const msg = h('div', { class: 'msg-erro', id: 'sei-erro-' + v.envio_id, role: 'alert' });
      return h('div', { class: 'cartao' },
        h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, 'Versão v' + v.versao), selo(v.situacao, v.sei ? 'ok' : 'atencao')),
        h('p', { class: 'mudo peq' }, 'Enviada em ' + fmt.data(v.enviado_em) + ' por ' + v.enviado_por + ' · ' + (v.motivo || 'primeiro envio')),
        h('p', { class: 'peq' }, 'Código no rodapé do PDF: ', h('code', null, 'Versão v' + v.versao + ' · ' + v.hash_curto), ' · ', h('a', { href: '/api/unidade/envios/' + v.envio_id + '/pdf', target: '_blank', rel: 'noopener' }, 'Abrir o PDF')),
        v.sei ? h('div', null, h('p', null, 'Documento no SEI nº ', h('strong', null, v.sei.numero), h('span', { class: 'mudo peq' }, ' · registrado por ' + v.sei.registrado_por + ' em ' + fmt.data(v.sei.registrado_em))),
          v.sei.historico.length > 1 ? h('details', null, h('summary', { class: 'peq', style: 'cursor:pointer' }, 'Histórico do registro (' + v.sei.historico.length + ')'), h('ul', { class: 'peq' }, v.sei.historico.map((x) => h('li', null, 'nº ' + x.sei_numero + ' · ' + x.registrado_por + ' em ' + fmt.data(x.registrado_em) + (x.motivo ? ' · ' + x.motivo : ''))))) : null,
          ehGestor() ? h('button', { class: 'leve', onclick: () => corrigir(v) }, 'Corrigir o número') : null)
          : (ehGestor()
            ? h('div', { class: 'campo' }, h('label', { for: 'sei-' + v.envio_id }, 'Número do documento no SEI'), h('div', { class: 'linha' }, campo, h('button', { onclick: () => registrar(v, campo, msg) }, 'Registrar')), msg)
            : h('p', { class: 'mudo peq' }, 'Ainda sem registro. Quem registra é o gestor da unidade.')));
    };
    montar(topo,
      avisosSei(d, p.cid, false),
      aviso('info', h('strong', { id: 'sei-ajuda' }, 'Depois de anexar e assinar no SEI, registre aqui o número do documento, para a CTAI saber qual versão foi ao processo. '), 'O sistema não bloqueia nada por falta deste registro, e não guarda senha nem credencial do SEI. Cada versão enviada tem o seu documento no SEI.'),
      cn.versoes.length ? cn.versoes.map(cartao) : h('p', { class: 'vazio' }, 'Nenhum envio ainda.'));
  }

  // ---------- Regras ----------
  async function regras() {
    await carregarInfo();
    const r = await api('GET', '/api/regras/' + INFO.contrato.contrato_id);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Regras de pontuação'), h('p', null, 'Versão ' + r.versao + ' · soma máxima ' + r.soma_maxima + ' pontos'))),
      r.pendencias.length ? aviso('atencao', h('strong', null, 'Pontos em aberto com a CTAI:'), h('ul', null, r.pendencias.map((x) => h('li', null, h('strong', null, x.onde + ': '), x.texto)))) : null,
      h('div', { class: 'cartao' }, tabela([{ t: 'Item' }, { t: 'Indicador' }, { t: 'Faixas de pontos' }, { t: 'Máx.', n: true }], r.indicadores.map((i) => [i.id, i.nome + (i.pendente ? ' ⚠' : ''), i.faixas, String(i.max)]))),
      h('div', { class: 'cartao' }, h('h3', null, 'Faixas de pagamento da parte variável'), tabela([{ t: 'IGQ' }, { t: 'Paga', n: true }], r.faixas_pagamento.map((f) => [f.igq_min + ' a ' + f.igq_max, f.paga_pct + '%']))));
  }

  // ---------- Integração ----------
  async function integracao() {
    await carregarInfo();
    const r = await api('GET', '/api/integracoes');
    const it = r.integracoes.find((i) => i.contrato_id === INFO.contrato.contrato_id);
    const sel = h('select', { id: 'ic' }, INFO.competencias.map((k) => h('option', { value: k.cid }, fmt.comp(k.competencia_id))));
    const saida = h('div');
    const rodar = async (dryRun) => {
      troca(saida, h('p', { class: 'mudo' }, 'Consultando o sistema da unidade…'));
      try {
        const o = await api('POST', '/api/integracoes/' + it.integracao_id + '/sincronizar', { cid: Number(sel.value), dryRun });
        troca(saida, aviso(dryRun ? 'info' : 'ok', dryRun ? 'Prévia: nada foi gravado.' : 'Linhas trazidas como lote pendente. Confirme no resumo do mês.'),
          tabela([{ t: 'Fonte' }, { t: 'Buscadas', n: true }, { t: 'Válidas', n: true }, { t: 'Recusadas', n: true }, { t: 'Situação' }], o.resumo.map((x) => [x.fonte, String(x.buscados), String(x.validos), String(x.recusados), x.erro ? 'erro: ' + x.erro : (x.motivoRecusa ? 'recusada: ' + x.motivoRecusa : 'ok')])));
      } catch (e) { troca(saida, aviso('erro', e.message)); }
    };
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Integração com o sistema da unidade'), h('p', null, 'Trazer as linhas direto do sistema, em vez de digitar ou subir arquivo.'))),
      !it ? aviso('info', 'Não há integração configurada para esta unidade.') : [
        h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, it.nome), selo(it.estado, it.estado === 'conectada' ? 'ok' : 'atencao')),
          h('p', { class: 'mudo' }, 'Última busca: ' + fmt.data(it.ultima_sync) + (it.ultimo_erro ? ' · último erro: ' + it.ultimo_erro : '')),
          h('p', { class: 'peq mudo' }, 'A configuração (endereço e acesso) é feita pelo administrador. Só os campos mapeados são lidos; qualquer dado pessoal que venha junto é ignorado.')),
        ehGestor() && it.ativo ? h('div', { class: 'cartao' }, h('h3', null, 'Buscar linhas'), h('div', { class: 'campo' }, h('label', { for: 'ic' }, 'Mês'), sel),
          h('div', { class: 'linha' }, h('button', { class: 'sec', onclick: () => rodar(true) }, 'Ver prévia (não grava)'), h('button', { onclick: () => rodar(false) }, 'Buscar e guardar como lote pendente')), saida) : aviso('info', 'A integração ainda não está ativa. Enquanto isso, use as fichas e as listas.')]);
  }

  async function iniciar() {
    EU = await casca({ titulo: 'CTAI', subtitulo: 'Portal da unidade', perfis: ['gestor_unidade', 'setor_unidade'], itens: [{ href: '#/', rotulo: 'Meses' }, { href: '#/regras', rotulo: 'Regras de pontuação' }, { href: '#/integracao', rotulo: 'Integração' }] });
    if (!EU) return;
    try { const m = await api('GET', '/api/meta'); Object.entries(m.fontes).forEach(([k, v]) => { NOMES_FONTES[k] = v.nome; }); } catch (_) { /* segue */ }
    rotear([['/', inicio], ['/c/:cid', competencia], ['/c/:cid/enviar', enviar], ['/c/:cid/envios', envios], ['/c/:cid/ficha/:setor', ficha], ['/c/:cid/lista/:fonte', lista], ['/regras', regras], ['/integracao', integracao]], (hash) => window.__marcarMenu && window.__marcarMenu(hash));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  iniciar();
})();
