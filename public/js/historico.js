(function () {
  'use strict';
  // Histórico dos relatórios: carteira com tendência, linha do tempo da unidade, importação e conferência de rascunho, bloco no parecer.
  const { h, api, fmt, toast, janela, confirmar, selo, aviso, tabela, montar, troca } = window.CTAI;
  const lerBase64 = (arq) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(arq); });
  const rotuloTri = (t) => String(t || '').replace(/^(\d{4})-T(\d)$/, '$2º trimestre de $1');
  const num = (v) => (v === null || v === undefined || v === '' ? '—' : fmt.num(v, Number.isInteger(Number(v)) ? 0 : 1));
  const ANO = new Date().getFullYear();
  const TRIS = []; for (let a = ANO; a >= ANO - 4; a--) for (let t = 4; t >= 1; t--) TRIS.push(a + '-T' + t);

  // Mini-linha: uma nota por trimestre. Âmbar; fica bordô quando a última nota caiu.
  function minilinha(serie, larg, alt) {
    const W = larg || 92, H = alt || 28;
    if (!serie || !serie.length) return h('span', { class: 'mudo peq', title: 'Ainda não há histórico confirmado' }, 'sem histórico');
    const vs = serie.map((s) => s.igq), min = Math.min(...vs) - 3, max = Math.max(...vs) + 3;
    const x = (i) => (serie.length === 1 ? W / 2 : 4 + (i * (W - 8)) / (serie.length - 1)), y = (v) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8);
    const caiu = serie.length > 1 && vs[vs.length - 1] < vs[vs.length - 2];
    const cor = caiu ? '#8e1628' : '#d97706';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Nota por trimestre: ' + serie.map((s) => rotuloTri(s.trimestre) + ' ' + s.igq).join(', '));
    const linha = document.createElementNS(ns, 'polyline'); linha.setAttribute('points', serie.map((s, i) => x(i) + ',' + y(s.igq)).join(' ')); linha.setAttribute('fill', 'none'); linha.setAttribute('stroke', cor); linha.setAttribute('stroke-width', '2'); svg.appendChild(linha);
    const p = document.createElementNS(ns, 'circle'); p.setAttribute('cx', x(serie.length - 1)); p.setAttribute('cy', y(vs[vs.length - 1])); p.setAttribute('r', 3.5); p.setAttribute('fill', cor); svg.appendChild(p);
    const t = document.createElementNS(ns, 'title'); t.textContent = serie.map((s) => rotuloTri(s.trimestre) + ': ' + s.igq).join(' · '); svg.appendChild(t);
    return h('span', { class: 'hi-mini' }, svg, h('strong', { style: 'color:' + cor }, num(vs[vs.length - 1])), caiu ? h('span', { class: 'peq', style: 'color:#8e1628' }, '↓') : null);
  }
  const seloAvisos = (n, altos) => (n ? selo(n + (n === 1 ? ' aviso' : ' avisos'), altos ? 'alta' : 'atencao') : selo('sem avisos', 'ok'));
  const seloGrav = (g) => selo(g, g === 'ALTA' ? 'alta' : (g === 'MÉDIA' ? 'media' : 'baixa'));
  const cartaoAviso = (a) => h('div', { class: 'hi-aviso hi-' + String(a.gravidade || '').toLowerCase().replace('é', 'e') }, seloGrav(a.gravidade), ' ', a.texto);

  // ---------- importar / lançar ----------
  async function importar(contratoId, unidadeNome, aoFim) {
    const tri = h('select', { id: 'hi-tri' }, TRIS.map((t) => h('option', { value: t }, rotuloTri(t))));
    const tipo = h('select', { id: 'hi-tipo' }, [['parecer', 'Parecer (da CTAI)'], ['relatório da OSS', 'Relatório da OSS'], ['outro', 'Outro documento']].map(([v, r]) => h('option', { value: v }, r)));
    const num0 = h('input', { type: 'text', id: 'hi-num', maxlength: 40, placeholder: 'Ex.: 204/2026 (opcional)' });
    const arq = h('input', { type: 'file', id: 'hi-arq', accept: '.pdf,.docx,.xlsx,.csv,.txt' });
    const msg = h('div', { class: 'msg-erro' });
    const corpo = h('div', null, h('p', { class: 'peq mudo' }, unidadeNome + '. O sistema lê o documento e monta um rascunho. Nada entra no histórico até você conferir e confirmar.'),
      h('div', { class: 'campo' }, h('label', { for: 'hi-tri' }, 'De qual trimestre é o documento?'), tri), h('div', { class: 'campo' }, h('label', { for: 'hi-tipo' }, 'Que documento é?'), tipo),
      h('div', { class: 'campo' }, h('label', { for: 'hi-num' }, 'Número do parecer'), num0), h('div', { class: 'campo' }, h('label', { for: 'hi-arq' }, 'Arquivo (PDF com texto, Word, Excel, CSV ou TXT, até 4 MB)'), arq), msg,
      aviso('atencao', 'Não use PDF escaneado (imagem): o sistema não lê imagem. Não coloque dado de paciente.'));
    const r = await janela('Importar relatório anterior', corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Ler e montar o rascunho', valor: 'ok', validar: () => { if (!arq.files[0]) { msg.textContent = 'Escolha o arquivo.'; return false; } return true; } }]);
    if (r !== 'ok') return;
    try {
      toast('Lendo o documento… isso pode levar alguns segundos.');
      const f = arq.files[0]; if (f.size > 4 * 1024 * 1024) throw new Error('Arquivo acima de 4 MB.');
      const o = await api('POST', '/api/historico/importar', { contrato_id: contratoId, trimestre: tri.value, documento_tipo: tipo.value, numero_parecer: num0.value, nome: f.name, base64: await lerBase64(f) });
      toast(o.ia.ok ? 'Rascunho pronto. Confira cada campo.' : 'Documento lido, mas sem IA agora. Preencha à mão.', !o.ia.ok);
      location.hash = '#/historico/r/' + o.hist_id; if (aoFim) aoFim();
    } catch (e) { toast(e.message, true); }
  }
  async function lancarAMao(contratoId, unidadeNome) {
    const tri = h('select', { id: 'hi-tri2' }, TRIS.map((t) => h('option', { value: t }, rotuloTri(t))));
    const r = await janela('Lançar à mão', h('div', null, h('p', { class: 'peq mudo' }, unidadeNome + '. Para quando você não tem o arquivo ou prefere digitar.'), h('div', { class: 'campo' }, h('label', { for: 'hi-tri2' }, 'Trimestre'), tri)), [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Abrir a ficha', valor: 'ok' }]);
    if (r !== 'ok') return;
    try { const o = await api('POST', '/api/historico/relatorios', { contrato_id: contratoId, trimestre: tri.value, documento_tipo: 'parecer' }); location.hash = '#/historico/r/' + o.hist_id; } catch (e) { toast(e.message, true); }
  }
  async function escolherUnidade(unidades) {
    const sel = h('select', { id: 'hi-un' }, unidades.map((u) => h('option', { value: u.contrato_id }, u.unidade)));
    const r = await janela('De qual unidade?', h('div', { class: 'campo' }, h('label', { for: 'hi-un' }, 'Unidade da sua carteira'), sel), [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: 'Continuar', valor: 'ok' }]);
    return r === 'ok' ? unidades.find((u) => u.contrato_id === sel.value) : null;
  }

  // ---------- carteira ----------
  async function carteira() {
    const [o, meta] = await Promise.all([api('GET', '/api/historico/carteira'), api('GET', '/api/historico/meta')]);
    const eu = meta.voce || {};
    const espelho = h('div', { class: 'linha', style: 'align-items:center' }, selo(meta.espelho.ligado ? 'Cópia no Drive: ligada' : 'Cópia no Drive: desligada', meta.espelho.ligado ? 'ok' : ''),
      meta.espelho.ligado ? h('button', { type: 'button', class: 'sec', onclick: async () => { try { const r = await api('POST', '/api/historico/espelho/enviar'); toast(r.ok ? 'Cópia enviada ao Drive.' : (r.motivo || 'Não enviou.'), !r.ok); } catch (e) { toast(e.message, true); } } }, 'Enviar agora') : null,
      meta.espelho.ligado ? h('button', { type: 'button', class: 'sec', onclick: async () => { if (!(await confirmar('Restaurar da planilha', 'Só funciona com o histórico do sistema vazio. Continuar?', 'Restaurar'))) return; try { const r = await api('POST', '/api/historico/espelho/restaurar'); toast(r.ok ? r.relatorios + ' relatório(s) restaurado(s).' : (r.motivo || 'Não restaurou.'), !r.ok); carteira(); } catch (e) { toast(e.message, true); } } }, 'Restaurar da planilha') : null);
    const linhas = o.unidades.slice().sort((a, b) => (b.avisosAltos - a.avisosAltos) || (b.avisos - a.avisos) || a.unidade.localeCompare(b.unidade, 'pt-BR')).map((u) => [
      h('a', { href: '#/historico/' + encodeURIComponent(u.contrato_id) }, h('strong', null, u.unidade), u.demo ? ' ' : null, u.demo ? selo('demonstração', 'demo') : null),
      minilinha(u.tendencia), seloAvisos(u.avisos, u.avisosAltos), u.confirmados + ' confirmado(s)',
      u.rascunhos ? selo(u.rascunhos + ' para conferir', 'atencao') : '',
    ]);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Histórico das unidades'), h('p', null, 'Os relatórios e pareceres anteriores de cada unidade da sua carteira, com a nota ao longo dos trimestres e os avisos que o cruzamento encontra.')),
      h('div', { class: 'linha' }, h('button', { type: 'button', onclick: async () => { if (!o.unidades.length) return toast('Você não tem unidade na carteira.', true); const u = o.unidades.length === 1 ? o.unidades[0] : await escolherUnidade(o.unidades); if (u) importar(u.contrato_id, u.unidade); } }, 'Importar relatório anterior'))),
      h('div', { class: 'cartao' }, tabela([{ t: 'Unidade' }, { t: 'Nota por trimestre' }, { t: 'Avisos' }, { t: 'Histórico' }, { t: '' }], linhas, { vazio: 'Nenhuma unidade na sua carteira.' })),
      ['admin', 'superintendente'].includes(eu.perfil) ? h('div', { class: 'cartao' }, h('h3', null, 'Cópia no Google Drive'), h('p', { class: 'mudo peq' }, meta.espelho.ligado ? 'Cada confirmação envia o histórico à planilha da CTAI.' : meta.espelho.motivo + ' Veja docs/ESPELHO-DRIVE.md.'), espelho) : null);
  }

  // ---------- unidade: linha do tempo ----------
  async function unidade(p) {
    const o = await api('GET', '/api/historico/unidades/' + encodeURIComponent(p.contrato));
    const nome = o.contrato.unidade;
    const rec = (r) => h('li', null, r.texto + ' ', selo(r.situacao, r.situacao === 'atendida' ? 'ok' : (r.situacao === 'repetida' ? 'alta' : 'atencao')),
      h('select', { 'aria-label': 'Situação da recomendação', onchange: async (ev) => { const novo = ev.target.value; const nota = await window.CTAI.perguntar('Situação da recomendação', 'Observação (opcional)', { obrigatorio: false, botao: 'Registrar' }); if (nota === null) { ev.target.value = r.situacao; return; } try { await api('PUT', '/api/historico/recomendacoes/' + r.id, { situacao: novo, nota }); toast('Registrado.'); unidade(p); } catch (e) { toast(e.message, true); ev.target.value = r.situacao; } } },
        ['aberta', 'atendida', 'repetida'].map((s) => h('option', { value: s, selected: s === r.situacao }, s))));
    const tempo = o.linhaDoTempo.length ? o.linhaDoTempo.slice().reverse().map((t) => h('div', { class: 'hi-tempo' }, h('div', { class: 'hi-marco' }, h('strong', null, rotuloTri(t.trimestre)), h('span', { class: 'peq mudo' }, t.documento_tipo + (t.numero_parecer ? ' ' + t.numero_parecer : ''))),
      h('div', { class: 'hi-fatos' }, h('span', null, 'Nota total: ', h('strong', null, num(t.igq))), h('span', null, 'Desconto: ', h('strong', null, t.desconto_pct === null || t.desconto_pct === undefined ? '—' : num(t.desconto_pct) + '%')), h('span', null, t.achados + ' achado(s)'), h('span', null, t.abertas + ' recomendação(ões) em aberto')),
      t.recomendacoes.length ? h('ul', { class: 'hi-recs' }, t.recomendacoes.map(rec)) : null,
      h('a', { href: '#/historico/r/' + t.hist_id, class: 'peq' }, 'Ver o relatório'))) : [h('p', { class: 'mudo' }, 'Ainda não há relatório confirmado desta unidade. Importe o primeiro.')];
    const lista = o.relatorios.map((r) => [rotuloTri(r.trimestre), r.documento_tipo + (r.numero_parecer ? ' ' + r.numero_parecer : ''), r.estado === 'confirmado' ? selo('confirmado', 'ok') : selo('rascunho: conferir', 'atencao'), num(r.igq), r.nome_arquivo || 'lançado à mão', h('a', { href: '#/historico/r/' + r.hist_id }, r.estado === 'confirmado' ? 'Ver' : 'Conferir')]);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, nome), h('p', null, 'Histórico dos relatórios anteriores')), h('div', { class: 'linha' }, h('a', { class: 'btn sec', href: '#/historico' }, 'Voltar'), h('button', { type: 'button', class: 'sec', onclick: () => lancarAMao(p.contrato, nome) }, 'Lançar à mão'), h('button', { type: 'button', onclick: () => importar(p.contrato, nome) }, 'Importar relatório anterior'))),
      h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Nota por trimestre'), minilinha(o.tendencia, 160, 40))),
      o.avisos.length ? h('div', { class: 'cartao' }, h('h2', null, 'O que o histórico mostra (' + o.avisos.length + ')'), o.avisos.map(cartaoAviso)) : (o.tendencia.length ? aviso('ok', 'O cruzamento não encontrou repetição, queda seguida ou divergência.') : null),
      h('div', { class: 'cartao' }, h('h2', null, 'Linha do tempo'), tempo),
      h('div', { class: 'cartao' }, h('h2', null, 'Relatórios importados'), tabela([{ t: 'Trimestre' }, { t: 'Documento' }, { t: 'Situação' }, { t: 'Nota', n: true }, { t: 'Origem' }, { t: '' }], lista, { vazio: 'Nenhum relatório ainda.' })));
  }

  // ---------- conferência do rascunho ----------
  async function relatorio(p) {
    const d = await api('GET', '/api/historico/relatorios/' + p.id);
    const unidadeNome = (await api('GET', '/api/historico/unidades/' + encodeURIComponent(d.contrato_id))).contrato.unidade;
    const trava = d.estado === 'confirmado';
    const E = { trimestre: d.trimestre, documento_tipo: d.documento_tipo, numero_parecer: d.numero_parecer || '', igq: d.igq === null ? '' : d.igq, desconto_pct: d.desconto_pct === null ? '' : d.desconto_pct, desconto_valor: d.desconto_valor === null ? '' : d.desconto_valor,
      indicadores: d.indicadores.map((x) => Object.assign({}, x)), achados: d.achados.map((x) => Object.assign({}, x)), recomendacoes: d.recomendacoes.map((x) => Object.assign({}, x)) };
    const campo = (rotulo, el, id) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo), el);
    const ent = (id, val, aoMudar, extra) => h('input', Object.assign({ type: 'text', id, value: val === null || val === undefined ? '' : val, disabled: trava, oninput: (ev) => aoMudar(ev.target.value) }, extra || {}));
    const origem = (x) => (x.trecho ? h('div', { class: 'peq ' + (x.verificada ? 'mudo' : ''), style: x.verificada ? '' : 'color:#8e1628' }, (x.verificada ? '✔ confere no texto · ' : '⚠ não encontrei no texto · ') + x.trecho) : (d.origem === 'ia' && !trava ? h('div', { class: 'peq', style: 'color:#8e1628' }, '⚠ sem trecho de origem: confira') : null));
    const lista = (chave, vazio, cabecalho, linha, novo) => {
      const alvo = h('div');
      const desenhar = () => troca(alvo, E[chave].length ? E[chave].map((x, i) => h('div', { class: 'hi-item' }, linha(x, i), trava ? null : h('button', { type: 'button', class: 'leve', 'aria-label': 'Remover esta linha', onclick: () => { E[chave].splice(i, 1); desenhar(); } }, 'Remover'))) : h('p', { class: 'mudo peq' }, vazio));
      desenhar();
      return h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, cabecalho), trava ? null : h('button', { type: 'button', class: 'sec', onclick: () => { E[chave].push(novo()); desenhar(); } }, 'Adicionar linha')), alvo);
    };
    const secInd = lista('indicadores', 'Nenhum indicador. Adicione se o documento traz a nota de cada indicador.', 'Nota de cada indicador', (x) => h('div', { class: 'hi-linha' },
      h('div', { class: 'hi-campos' }, ent(null, x.indicador_id, (v) => { x.indicador_id = v; }, { placeholder: 'Nº (ex.: 3.1)', 'aria-label': 'Número do indicador', style: 'width:90px' }), ent(null, x.nome, (v) => { x.nome = v; }, { placeholder: 'Nome do indicador', 'aria-label': 'Nome do indicador', style: 'flex:1;min-width:180px' }),
        ent(null, x.pontos, (v) => { x.pontos = v; }, { placeholder: 'Pontos', 'aria-label': 'Pontos obtidos', inputmode: 'decimal', style: 'width:80px' }), h('span', { class: 'mudo' }, 'de'), ent(null, x.max, (v) => { x.max = v; }, { placeholder: 'Máx.', 'aria-label': 'Pontos máximos', inputmode: 'decimal', style: 'width:80px' })), origem(x)),
      () => ({ indicador_id: '', nome: '', pontos: '', max: '', trecho: '', verificada: false }));
    const secAch = lista('achados', 'Nenhum achado.', 'Achados do documento', (x) => h('div', { class: 'hi-linha' },
      h('div', { class: 'hi-campos' }, ent(null, x.tipo, (v) => { x.tipo = v; }, { placeholder: 'Assunto (ex.: Ouvidoria)', 'aria-label': 'Assunto do achado', style: 'width:200px' }),
        h('select', { 'aria-label': 'Gravidade', disabled: trava, onchange: (ev) => { x.gravidade = ev.target.value; } }, ['ALTA', 'MÉDIA', 'BAIXA'].map((g) => h('option', { value: g, selected: g === x.gravidade }, g)))),
      h('textarea', { rows: 2, disabled: trava, 'aria-label': 'O que foi constatado', placeholder: 'O que foi constatado', oninput: (ev) => { x.descricao = ev.target.value; } }, x.descricao || ''), origem(x)),
      () => ({ tipo: '', descricao: '', gravidade: 'MÉDIA', trecho: '', verificada: false }));
    const secRec = lista('recomendacoes', 'Nenhuma recomendação.', 'Recomendações feitas à unidade', (x) => h('div', { class: 'hi-linha' },
      h('div', { class: 'hi-campos' }, ent(null, x.tema, (v) => { x.tema = v; }, { placeholder: 'Tema (ex.: RH)', 'aria-label': 'Tema da recomendação', style: 'width:200px' }), trava ? selo(x.situacao, x.situacao === 'atendida' ? 'ok' : 'atencao') : null),
      h('textarea', { rows: 2, disabled: trava, 'aria-label': 'Recomendação', placeholder: 'O que foi recomendado', oninput: (ev) => { x.texto = ev.target.value; } }, x.texto || ''), origem(x)),
      () => ({ tema: '', texto: '', situacao: 'aberta', trecho: '', verificada: false }));
    const corpoSalvar = () => ({ trimestre: E.trimestre, documento_tipo: E.documento_tipo, numero_parecer: E.numero_parecer, igq: E.igq, desconto_pct: E.desconto_pct, desconto_valor: E.desconto_valor, indicadores: E.indicadores, achados: E.achados, recomendacoes: E.recomendacoes });
    const salvar = async (silencioso) => { try { await api('PUT', '/api/historico/relatorios/' + d.hist_id, corpoSalvar()); if (!silencioso) toast('Rascunho salvo.'); return true; } catch (e) { toast(e.message, true); return false; } };
    const naoVerif = d.indicadores.filter((x) => !x.verificada).length + d.achados.filter((x) => !x.verificada).length + d.recomendacoes.filter((x) => !x.verificada).length;
    const textoLido = h('div');
    const verTexto = async () => { try { const t = await api('GET', '/api/historico/relatorios/' + d.hist_id + '?texto=1'); troca(textoLido, h('pre', { class: 'hi-texto' }, t.texto || '(sem texto)')); } catch (e) { toast(e.message, true); } };
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, (trava ? 'Relatório confirmado' : 'Conferir o rascunho') + ' · ' + unidadeNome), h('p', null, rotuloTri(d.trimestre) + ' · ' + d.documento_tipo + (d.nome_arquivo ? ' · ' + d.nome_arquivo : ''))),
      h('div', { class: 'linha' }, h('a', { class: 'btn sec', href: '#/historico/' + encodeURIComponent(d.contrato_id) }, 'Voltar'), trava ? selo('confirmado por ' + d.confirmado_por, 'ok') : selo('rascunho', 'atencao'))),
      trava ? aviso('info', 'Este relatório já está no histórico e não pode mais ser editado. Só a situação das recomendações muda, na tela da unidade.') : aviso('atencao', h('strong', null, d.origem === 'ia' ? 'O sistema leu o documento e propôs estes dados' + (d.provedor ? ' (' + d.provedor + ')' : '') + '. ' : 'Preencha os dados à mão. '), 'Confira cada campo com o documento. ' + (naoVerif ? naoVerif + ' linha(s) estão marcadas "não encontrei no texto": confira com atenção. ' : '') + 'Só entra no histórico depois que você confirmar.'),
      h('div', { class: 'cartao' }, h('h2', null, 'Dados gerais'), h('div', { class: 'hi-grade' },
        campo('Trimestre', h('select', { id: 'hi-r-tri', disabled: trava, onchange: (ev) => { E.trimestre = ev.target.value; } }, (TRIS.includes(d.trimestre) ? TRIS : [d.trimestre].concat(TRIS)).map((t) => h('option', { value: t, selected: t === E.trimestre }, rotuloTri(t)))), 'hi-r-tri'),
        campo('Documento', h('select', { id: 'hi-r-tipo', disabled: trava, onchange: (ev) => { E.documento_tipo = ev.target.value; } }, ['parecer', 'relatório da OSS', 'outro'].map((t) => h('option', { value: t, selected: t === E.documento_tipo }, t))), 'hi-r-tipo'),
        campo('Número do parecer', ent('hi-r-num', E.numero_parecer, (v) => { E.numero_parecer = v; }), 'hi-r-num'),
        campo('Nota total (IGQ, 0 a 100)', ent('hi-r-igq', E.igq, (v) => { E.igq = v; }, { inputmode: 'decimal' }), 'hi-r-igq'),
        campo('Desconto (%)', ent('hi-r-dp', E.desconto_pct, (v) => { E.desconto_pct = v; }, { inputmode: 'decimal' }), 'hi-r-dp'),
        campo('Desconto (R$)', ent('hi-r-dv', E.desconto_valor, (v) => { E.desconto_valor = v; }, { inputmode: 'decimal' }), 'hi-r-dv')),
        d.origem === 'ia' && !trava ? h('div', { class: 'peq ' + (d.igq === null ? 'mudo' : '') }, 'Nota total lida do documento: ' + num(d.igq)) : null),
      secInd, secAch, secRec,
      d.tem_texto && !trava ? h('div', { class: 'cartao' }, h('h3', null, 'Texto lido do documento'), h('p', { class: 'mudo peq' }, 'Para conferir os números e as frases de origem. Fica guardado só até você confirmar.'), h('button', { type: 'button', class: 'sec', onclick: verTexto }, 'Mostrar o texto lido'), textoLido) : null,
      trava ? null : h('div', { class: 'cartao' }, h('div', { class: 'linha' },
        h('button', { type: 'button', id: 'hi-salvar', class: 'sec', onclick: () => salvar(false) }, 'Salvar rascunho'),
        h('button', { type: 'button', id: 'hi-confirmar', onclick: async () => { if (!(await confirmar('Confirmar no histórico', 'Você conferiu os dados com o documento? Depois de confirmar, o relatório não se edita mais e entra nos cruzamentos.', 'Sim, confirmar'))) return; if (!(await salvar(true))) return; try { await api('POST', '/api/historico/relatorios/' + d.hist_id + '/confirmar'); toast('Confirmado. O histórico da unidade foi atualizado.'); location.hash = '#/historico/' + encodeURIComponent(d.contrato_id); } catch (e) { toast(e.message, true); } } }, 'Conferi e confirmo'),
        h('button', { type: 'button', class: 'perigo', onclick: async () => { if (!(await confirmar('Descartar o rascunho', 'O rascunho será apagado. O arquivo original continua com você.', 'Descartar', true))) return; try { await api('DELETE', '/api/historico/relatorios/' + d.hist_id); toast('Rascunho descartado.'); location.hash = '#/historico/' + encodeURIComponent(d.contrato_id); } catch (e) { toast(e.message, true); } } }, 'Descartar'))));
  }

  // ---------- bloco na tela do parecer ----------
  async function bloco(contratoId) {
    const o = await api('GET', '/api/historico/unidades/' + encodeURIComponent(contratoId) + '/avisos');
    const topo = h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0' }, 'Do histórico desta unidade'), h('a', { class: 'btn sec', href: '#/historico/' + encodeURIComponent(contratoId) }, 'Abrir o histórico'));
    if (!o.confirmados) return h('div', { class: 'cartao hi-bloco' }, topo, h('p', { class: 'mudo peq', style: 'margin:8px 0 0' }, 'Ainda não há relatório anterior confirmado desta unidade. Importe os anteriores para o sistema avisar o que se repete.'));
    return h('div', { class: 'cartao hi-bloco' }, topo, h('div', { class: 'linha', style: 'margin:8px 0' }, minilinha(o.tendencia, 140, 34), h('span', { class: 'peq mudo' }, o.confirmados + ' relatório(s) confirmado(s) · último: ' + rotuloTri(o.ultimo))),
      o.avisos.length ? o.avisos.slice(0, 6).map(cartaoAviso) : h('p', { class: 'peq', style: 'margin:0' }, 'Sem repetição, queda seguida ou divergência nos relatórios anteriores.'),
      o.avisos.length > 6 ? h('p', { class: 'peq mudo' }, '+ ' + (o.avisos.length - 6) + ' aviso(s) na tela do histórico.') : null);
  }
  // Sinal curto para o cartão da unidade na carteira.
  const sinal = (r) => (r ? h('span', { class: 'hi-sinal' }, minilinha(r.tendencia, 70, 22), r.avisos ? selo(r.avisos + (r.avisos === 1 ? ' aviso' : ' avisos'), r.avisosAltos ? 'alta' : 'atencao') : null) : null);

  window.CTAI_HISTORICO = { rotas: [['/historico', carteira], ['/historico/r/:id', relatorio], ['/historico/:contrato', unidade]], bloco, sinal, minilinha };
})();
