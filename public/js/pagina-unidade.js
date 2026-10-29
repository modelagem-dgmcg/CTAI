(function () {
  'use strict';
  // Página da unidade: uma tela corrida, em sequência (linha de montagem), que abre em aba própria.
  // Importar Arquivos → Conferir → Decidir → Produzir → Conferir novamente → Registrar no SEI.
  // Tudo é calculado dos dados que já existem; o sistema marca sozinho cada etapa como feita.
  // A etapa 1 não depende de envio da unidade pela internet: a analista solta aqui os arquivos baixados do SEI (ver public/js/importar.js).
  const { h, api, fmt, toast, janela, perguntar, selo, aviso, tabela, montar } = window.CTAI;
  const EU = () => window.__eu || {};

  const triDe = (comp) => { const [a, m] = String(comp).split('-'); return a + '-T' + Math.ceil(Number(m) / 3); };
  const mesesDe = (t) => { const [a, q] = t.split('-T'); const n = Number(q); return [0, 1, 2].map((i) => a + '-' + String(3 * (n - 1) + 1 + i).padStart(2, '0')); };
  const triEncerrado = () => { const d = new Date(); let a = d.getFullYear(), q = Math.ceil((d.getMonth() + 1) / 3) - 1; if (q < 1) { q = 4; a--; } return a + '-T' + q; }; // último trimestre já fechado (hoje, em outubro/2026: 2026-T3)
  const triAtual = () => { const d = new Date(); return d.getFullYear() + '-T' + Math.ceil((d.getMonth() + 1) / 3); };
  const guardaTri = (id, v) => { try { if (v) sessionStorage.setItem('ctai_tri_' + id, v); return sessionStorage.getItem('ctai_tri_' + id); } catch (_) { return null; } };

  // Nova janela (editor flutuante): o mesmo nome reaproveita a janela já aberta daquele documento.
  function janelaNova(hash, nome) {
    const url = location.pathname + '#' + hash.replace(/^#/, '');
    // noopener: a janela nova não herda o que esta aba guarda (por exemplo, a sala guiada em andamento).
    window.open(url, nome || ('ctai-' + hash), 'popup=yes,width=1180,height=860,resizable=yes,scrollbars=yes,noopener');
  }

  // Aviso quando a mesma unidade está aberta em outra aba (uma sobrescreveria a outra).
  const aba = Math.random().toString(36).slice(2);
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('ctai-unidade') : null;
  let atual = null;
  if (canal) canal.onmessage = (m) => {
    const d = m.data || {};
    if (!atual || d.id !== atual.id || d.aba === aba) return;
    if (d.t === 'ola') canal.postMessage({ t: 'aqui', id: atual.id, aba });
    if (d.t === 'aqui' && atual.aviso) atual.aviso.hidden = false;
  };
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/u/')) { atual = null; document.title = 'Analista CTAI'; } });

  // ---------- Configurações (regra do contrato, com senha e motivo) ----------
  async function configuracoes(contratoId, aoSalvar) {
    const d = await api('GET', '/api/ctai/contratos/' + encodeURIComponent(contratoId) + '/decisoes');
    const base = (d.contratoRegras && d.contratoRegras.conteudo) || { indicadores: [], observacoes: [] };
    const campo = (rot, el) => h('div', { class: 'campo' }, h('label', null, rot), el);
    const inp = (v, ph) => h('input', { type: 'text', value: v === null || v === undefined ? '' : String(v), placeholder: ph || '' });
    const area = (v, linhas) => h('textarea', { rows: linhas || 2 }, v || '');
    const topo = { contrato_numero: inp(base.contrato_numero), oss: inp(base.oss), valor_mensal: inp(base.valor_mensal), fixa_pct: inp(base.fixa_pct), variavel_pct: inp(base.variavel_pct) };
    const lista = h('div', { class: 'cfg-lista' });
    const linhas = [];
    const novaLinha = (i) => {
      const f = { tipo: h('select', null, [['producao', 'Produção'], ['qualidade', 'Qualidade'], ['monitoramento', 'Monitoramento']].map(([v, r]) => h('option', Object.assign({ value: v }, v === (i.tipo || 'qualidade') ? { selected: true } : {}), r))), nome: inp(i.nome), pt: inp(i.peso_pct_total), pv: inp(i.peso_pct_variavel), meta: area(i.meta), esp: area(i.especificacao), fonte: inp(i.fonte), clausula: inp(i.clausula) };
      const caixa = h('fieldset', { class: 'cfg-ind' },
        h('div', { class: 'cfg-ind-topo' }, h('strong', null, 'Indicador'), h('button', { type: 'button', class: 'sec', onclick: () => { caixa.remove(); linhas.splice(linhas.indexOf(f), 1); } }, 'Remover')),
        campo('Nome', f.nome), h('div', { class: 'cfg-duplo' }, campo('Tipo', f.tipo), campo('Cláusula', f.clausula)),
        h('div', { class: 'cfg-duplo' }, campo('Peso no total (%)', f.pt), campo('Peso na parte variável (%)', f.pv)),
        campo('Meta', f.meta), campo('Como é medido', f.esp), campo('Fonte do dado', f.fonte));
      linhas.push(f); lista.appendChild(caixa);
    };
    (base.indicadores || []).forEach(novaLinha);
    const obs = area((base.observacoes || []).join('\n'), 4);
    const motivo = h('textarea', { rows: 2, placeholder: 'Ex.: o 3º Termo Aditivo mudou a meta do indicador X' });
    const senha = h('input', { type: 'password', autocomplete: 'current-password' });
    const msg = h('div', { class: 'msg-erro' });
    const corpo = h('div', { class: 'cfg' },
      aviso('info', 'Aqui fica a regra como está escrita no contrato e nos termos aditivos. Alterações pedem o motivo e a sua senha, e ficam registradas. Depois de alterar, a regra volta a "a conferir".'),
      d.regra && d.regra.tem && !d.regra.descritiva ? aviso('atencao', 'As regras de cálculo automático desta unidade não mudam por aqui. Esta tela ajusta só o texto da regra do contrato.') : null,
      h('div', { class: 'cfg-duplo' }, campo('Número do contrato', topo.contrato_numero), campo('OSS', topo.oss)),
      h('div', { class: 'cfg-trio' }, campo('Valor mensal', topo.valor_mensal), campo('Parte fixa (%)', topo.fixa_pct), campo('Parte variável (%)', topo.variavel_pct)),
      h('h3', null, 'Indicadores'), lista,
      h('button', { type: 'button', class: 'sec', onclick: () => novaLinha({}) }, '+ Adicionar indicador'),
      campo('Observações (uma por linha)', obs),
      h('h3', null, 'Confirmar a alteração'), campo('Motivo (uma linha basta)', motivo), campo('Sua senha', senha), msg);
    const r = await janela('Configurações · regra do contrato', corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, {
      rotulo: 'Salvar alteração', valor: 'ok', validar: async () => {
        msg.textContent = '';
        if (motivo.value.trim().length < 5) { msg.textContent = 'Escreva o motivo da alteração.'; return false; }
        if (!senha.value) { msg.textContent = 'Confirme com a sua senha.'; return false; }
        const conteudo = {
          unidade: base.unidade, contrato_numero: topo.contrato_numero.value, oss: topo.oss.value, valor_mensal: topo.valor_mensal.value, fixa_pct: topo.fixa_pct.value, variavel_pct: topo.variavel_pct.value,
          cobertura: base.cobertura, fonte_arquivo: base.fonte_arquivo, tas_no_arquivo: base.tas_no_arquivo,
          indicadores: linhas.map((f) => ({ tipo: f.tipo.value, nome: f.nome.value, peso_pct_total: f.pt.value, peso_pct_variavel: f.pv.value, meta: f.meta.value, especificacao: f.esp.value, fonte: f.fonte.value, clausula: f.clausula.value })),
          observacoes: obs.value.split('\n').map((x) => x.trim()).filter(Boolean),
        };
        try { await api('PUT', '/api/ctai/configuracao/' + encodeURIComponent(contratoId) + '/regras', { conteudo, motivo: motivo.value, senha: senha.value }); return true; } catch (e) { msg.textContent = e.message; return false; }
      },
    }]);
    if (r === 'ok') { toast('Regra atualizada e registrada.'); if (aoSalvar) aoSalvar(); }
  }

  // ---------- A página ----------
  async function pagina(p) {
    const id = p.id;
    const [rc, rp, rd, rv] = await Promise.all([api('GET', '/api/ctai/contratos'), api('GET', '/api/ctai/pareceres'), api('GET', '/api/documentos?contrato=' + encodeURIComponent(id)).catch(() => ({ documentos: [] })), api('GET', '/api/provisorios?contrato=' + encodeURIComponent(id)).catch(() => ({ pedidos: [] }))]);
    const c = rc.contratos.find((x) => x.contrato_id === id);
    if (!c) { montar(aviso('erro', 'Unidade não encontrada, ou fora da sua carteira.')); return; }
    document.title = c.unidade + ' · Analista CTAI';
    const avDup = h('div', { id: 'un-dup', hidden: true }, aviso('atencao', h('strong', null, 'Esta unidade já está aberta em outra aba. '), 'Edite só em uma delas, para uma não sobrescrever a outra.'));
    atual = { id, aviso: avDup };
    if (canal) canal.postMessage({ t: 'ola', id, aba });

    const pareceres = rp.pareceres.filter((x) => x.contrato_id === id);
    const comDados = [...new Set(c.competencias.map((k) => triDe(k.competencia_id)).concat(pareceres.map((x) => x.trimestre)))].sort().reverse();
    const tris = [...new Set(comDados.concat([triAtual(), triEncerrado()]))].sort().reverse();
    const T = (tris.includes(guardaTri(id)) ? guardaTri(id) : triEncerrado()); // abre no último trimestre encerrado: é o que a analista monta agora
    const K = c.competencias.filter((k) => triDe(k.competencia_id) === T);
    const docs = (rd.documentos || []).filter((x) => !x.trimestre || x.trimestre === T);
    const Pa = pareceres.find((x) => x.trimestre === T) || null;
    const V = Pa && Pa.ultimaVersao;
    const euCriador = Pa && Pa.criador_id === EU().usuario_id;
    const recarregar = () => pagina(p);

    let imp = await api('GET', '/api/importar/unidade/' + encodeURIComponent(id) + '/' + T).catch(() => null); // lista de conferência e arquivos do trimestre
    const div = K.reduce((n, k) => n + (k.divergenciasAbertas || 0), 0);
    const alertasSei = K.reduce((n, k) => n + (k.seiAlertas || 0), 0);
    const decidido = !c.semRegras && !c.decisoesAbertas;
    const produzido = !!(Pa && V);
    const revisado = !!(V && V.status === 'autorizada');
    const noSei = !!(Pa && Pa.status === 'anexado ao SEI');
    let recebido, conferido, feitas, atualIdx;
    const calcular = () => {
      recebido = !!(imp && imp.feita); // todos os itens obrigatórios com check, ou "Concluir importação"
      const numerosPendentes = imp && imp.numeros ? imp.numeros.propostos : 0;
      conferido = recebido && div === 0 && alertasSei === 0 && numerosPendentes === 0;
      feitas = [recebido, conferido, decidido, produzido, revisado, noSei];
      atualIdx = feitas.indexOf(false);
    };
    calcular();

    const txtEstado = (i) => (feitas[i] ? 'feita' : (i === atualIdx ? 'agora' : 'depois'));
    const seloEtapa = (i) => selo(txtEstado(i) === 'feita' ? '✔ feita' : (txtEstado(i) === 'agora' ? 'a fazer agora' : 'mais adiante'), txtEstado(i) === 'feita' ? 'ok' : (txtEstado(i) === 'agora' ? 'atencao' : ''));
    const link = (hash, rot, cls) => h('a', { class: cls || '', href: '#' + hash }, rot);
    const botaoNovaJanela = (hash, rot) => h('button', { type: 'button', onclick: () => janelaNova(hash) }, rot);

    const slotImportar = h('div', { id: 'un-importar' });
    const conteudos = [
      // 1. Importar Arquivos: soltar o ZIP/PDF/Word do SEI, lista de conferência com check por item
      () => [slotImportar],
      // 2. Conferir
      () => [K.length ? tabela([{ t: 'Mês' }, { t: 'Divergências abertas', n: true }, { t: 'Sistema × SEI' }, { t: '' }], K.map((k) => [fmt.comp(k.competencia_id), String(k.divergenciasAbertas || 0), k.seiAlertas ? h('a', { href: '#/c/' + k.cid + '/envios', title: 'Alerta entre o sistema e o SEI' }, selo('SEI: ' + k.seiAlertas + ' alerta(s)', 'atencao')) : '—', link('/c/' + k.cid, 'Conferir')])) : aviso('info', 'Este trimestre não tem meses abertos pelo portal da unidade. A conferência segue pelos arquivos importados e pelos números lidos.'),
        imp && imp.numeros && imp.numeros.propostos ? aviso('atencao', h('strong', null, imp.numeros.propostos + ' número(s) lido(s) esperando a sua conferência. '), h('a', { href: '#/alimentar' }, 'Conferir em Alimentar o Analista')) : null,
        h('p', { class: 'mudo peq' }, 'Fica feita quando a importação estiver feita, sem divergência aberta, sem alerta entre o sistema e o SEI e sem número lido esperando conferência.')],
      // 3. Decidir
      () => [h('div', { class: 'linha espaco' }, h('div', null, c.semRegras ? selo('sem regra cadastrada', 'atencao') : (c.regra && c.regra.conferida ? selo('regra conferida', 'ok') : selo('regra a conferir', 'atencao')), ' ', c.decisoesAbertas ? selo(c.decisoesAbertas + ' dúvida(s) de regra em aberto', 'atencao') : selo('sem dúvidas em aberto', 'ok')),
        h('div', { class: 'linha' }, link('/regras/' + id, c.decisoesAbertas ? 'Decidir as dúvidas' : 'Ver regras e decisões', 'btn sec'), h('button', { type: 'button', class: 'sec', onclick: () => configuracoes(id, recarregar).catch((e) => toast(e.message, true)) }, 'Configurações'))),
        h('p', { class: 'mudo peq' }, 'As regras do contrato já estão carregadas. Aqui ficam só as dúvidas que mudam o resultado, cada uma com a decisão e quem decidiu.')],
      // 4. Produzir
      () => {
        if (Pa) return [h('div', { class: 'linha espaco' }, h('div', null, h('strong', null, Pa.titulo), h('div', { class: 'mudo peq' }, 'Criado por ' + Pa.criador_nome + ' · ' + (V ? 'versão ' + V.numero + ' congelada' : 'rascunho, ainda não foi para a conferência'))), botaoNovaJanela('/p/' + Pa.parecer_id, 'Abrir o documento em janela própria')),
          (recebido && conferido && decidido) ? null : aviso('atencao', 'Ainda há etapas anteriores sem terminar. Dá para redigir, mas confira antes de enviar para a conferência.')];
        const posso = ['criador', 'admin'].includes(EU().perfil);
        return [posso ? h('div', { class: 'linha espaco' }, h('span', null, 'Nenhum documento deste trimestre ainda. O parecer abre já com os meses ' + mesesDe(T).map((m) => fmt.comp(m)).join(', ') + '.'),
          h('button', { type: 'button', onclick: async () => { try { const o = await api('POST', '/api/ctai/pareceres', { contrato_id: id, trimestre: T, competencias: mesesDe(T) }); toast('Parecer criado.'); await recarregar(); janelaNova('/p/' + o.parecer_id); } catch (e) { toast(e.message, true); } } }, 'Começar o parecer de ' + T))
          : aviso('info', 'O documento deste trimestre é aberto por quem tem o perfil de criação de pareceres.'),
          null];
      },
      // 5. Conferir novamente
      () => {
        if (!V) return [h('p', { class: 'mudo' }, 'Quando o documento for congelado no editor, ele segue para a conferência dos colegas e a autorização da superintendência.')];
        return [h('div', { class: 'linha espaco' }, h('div', null, 'Versão ' + V.numero + ' · ', selo(V.status, V.status === 'autorizada' ? 'ok' : 'atencao')),
          h('div', { class: 'linha' }, link('/v/' + V.versao_id, 'Abrir a conferência', 'btn sec'), V.status === 'autorizada' ? h('a', { class: 'btn', href: '/api/ctai/versoes/' + V.versao_id + '/pdf', target: '_blank', rel: 'noopener' }, 'Gerar o PDF') : null)),
          V.status === 'autorizada' ? null : h('p', { class: 'mudo peq' }, 'O PDF é liberado depois da conferência e da autorização. O OK da conferência é controle interno; a assinatura é feita no SEI.')];
      },
      // 6. Registrar no SEI
      () => {
        if (noSei) return [aviso('ok', h('strong', null, 'Registrado no SEI. '), 'Documento ' + Pa.sei_numero + (Pa.sei_anexado_em ? ' · ' + fmt.data(Pa.sei_anexado_em) : '') + '. Esta unidade está concluída neste trimestre.')];
        if (!revisado) return [h('p', { class: 'mudo' }, 'Depois que o documento estiver autorizado, você leva o PDF ao SEI, assina e envia. O SEI gera o número do documento. Volte aqui, cole o número e finalize.')];
        return [h('div', { class: 'linha espaco' }, h('span', null, 'Levou ao SEI? Cole aqui o número que o SEI gerou.'),
          euCriador ? h('button', { type: 'button', onclick: async () => { const n = await perguntar('Registrar no SEI', 'Número do documento no SEI', { botao: 'Finalizar' }); if (!n) return; try { await api('POST', '/api/ctai/pareceres/' + Pa.parecer_id + '/sei', { numero: n }); toast('Registrado. Unidade concluída.'); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Registrar o número e finalizar')
            : h('span', { class: 'mudo peq' }, 'Quem registra é quem criou o documento.'))];
      },
    ];
    const parecerEtapa4 = conteudos[3];
    const slotApuracao = h('div', { id: 'un-apuracao' });
    conteudos[3] = () => [slotApuracao].concat(parecerEtapa4()).concat([
      h('div', { class: 'etapa-docs' }, h('h3', null, 'Ofício, despacho e outros'),
        h('div', { class: 'linha' }, [['oficio', 'Novo ofício'], ['despacho', 'Novo despacho'], ['branco', 'Documento em branco']].map(([t, r]) => h('button', { type: 'button', class: 'sec', onclick: () => janelaNova('/d/novo/' + encodeURIComponent(id) + '/' + T + '/' + t) }, r)), h('a', { class: 'btn sec', href: '#/documentos/modelos', target: '_blank', rel: 'noopener' }, 'Meus modelos')),
        docs.length ? tabela([{ t: 'Documento' }, { t: 'Tipo' }, { t: 'Situação' }, { t: '' }], docs.map((d) => [d.titulo, d.tipoNome, selo(d.status, d.status === 'finalizado' || d.status === 'conferido' ? 'ok' : (d.status === 'com reparos' ? 'atencao' : '')), h('button', { type: 'button', class: 'sec', onclick: () => janelaNova('/d/' + d.doc_id) }, 'Abrir')])) : h('p', { class: 'mudo peq' }, 'Nenhum ofício ou despacho desta unidade neste trimestre.'))]);
    const decidirAcesso = async (x, concordo) => {
      let justificativa = '';
      if (!concordo) { justificativa = await perguntar('Por que não concorda?', 'Escreva a justificativa. O gestor da unidade vai receber esta resposta.', { longo: true, botao: 'Enviar resposta' }); if (!justificativa) return; }
      try { await api('POST', '/api/provisorios/' + x.usuario_id + '/decidir', { concordo, justificativa }); toast(concordo ? 'Acesso mantido.' : 'Resposta enviada ao gestor.'); recarregar(); } catch (e) { toast(e.message, true); }
    };
    const acessosProv = (rv.pedidos || []).length ? h('div', { class: 'cartao' }, h('h2', { style: 'margin-top:0' }, 'Acessos provisórios pedidos pela unidade'),
      h('p', { class: 'mudo peq' }, 'Se você concordar, o acesso fica permanente. Se não concordar, escreva a justificativa; sem concordância o acesso é apagado no prazo.'),
      (rv.pedidos || []).map((x) => h('div', { class: 'linha espaco', style: 'border-top:1px solid #e5e7eb;padding:8px 0' },
        h('div', null, h('strong', null, x.nome), ' · ' + x.setor + ' · ' + x.formulario, h('div', null, 'Justificativa do gestor: ' + x.justificativa), h('div', { class: 'mudo peq' }, 'Apagado em ' + fmt.data(x.expira_em) + ' se ninguém concordar' + (x.status === 'discordado' ? ' · você já respondeu que não concorda' : ''))),
        h('div', { class: 'linha' }, h('button', { type: 'button', onclick: () => decidirAcesso(x, true) }, 'Concordo'), h('button', { type: 'button', class: 'sec', onclick: () => decidirAcesso(x, false) }, 'Não concordo'))))) : null;
    const NOMES = ['Importar Arquivos', 'Conferir', 'Decidir', 'Produzir', 'Conferir novamente', 'Registrar no SEI'];
    const secoes = NOMES.map((nome, i) => {
      const aberta = i === atualIdx || (atualIdx === -1 && i === 5);
      const det = h('details', Object.assign({ class: 'etapa ' + txtEstado(i), id: 'etapa-' + i }, aberta ? { open: true } : {}),
        h('summary', null, h('span', { class: 'etapa-n' }, feitas[i] ? '✔' : String(i + 1)), h('span', { class: 'etapa-t' }, nome), h('span', { class: 'etapa-s' }, seloEtapa(i))),
        h('div', { class: 'etapa-corpo' }, conteudos[i]()));
      return det;
    });
    const barra = h('nav', { class: 'etapas', 'aria-label': 'Etapas desta unidade' }, NOMES.map((nome, i) => h('button', { type: 'button', class: 'etapa-chip ' + txtEstado(i), title: nome, onclick: () => { secoes[i].open = true; secoes[i].scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      h('span', { class: 'chip-n' }, feitas[i] ? '✔' : String(i + 1)), h('span', { class: 'chip-t' }, nome))));
    const repintar = () => {
      secoes.forEach((det, i) => {
        det.className = 'etapa ' + txtEstado(i);
        const sm = det.querySelector('summary');
        sm.querySelector('.etapa-n').textContent = feitas[i] ? '✔' : String(i + 1);
        sm.querySelector('.etapa-s').replaceChildren(seloEtapa(i));
      });
      barra.querySelectorAll('.etapa-chip').forEach((b, i) => { b.className = 'etapa-chip ' + txtEstado(i); b.querySelector('.chip-n').textContent = feitas[i] ? '✔' : String(i + 1); });
    };
    if (window.CTAI_PARECER_TRI) window.CTAI_PARECER_TRI.preencher(slotApuracao, { contratoId: id, tri: T }).catch(() => {});
    if (window.CTAI_IMPORTAR) window.CTAI_IMPORTAR.preencher(slotImportar, { contratoId: id, tri: T, estado: imp,
      aoMudar: (novo, recarga) => { if (recarga) { recarregar(); return; } imp = novo; calcular(); repintar(); } }).catch((e) => { slotImportar.replaceChildren(aviso('erro', e.message)); });
    const slotRegistro = h('div', { id: 'un-registro' });
    api('GET', '/api/ctai/contratos/' + encodeURIComponent(id) + '/instrumentos').then(({ registro: g }) => {
      if (!g) return;
      const lista = h('details', null, h('summary', { class: 'peq' }, 'Ver os ' + g.instrumentos.length + ' instrumentos (contrato, aditivos, apostilamentos)'),
        h('div', { class: 'rolagem' }, h('table', { class: 'al-arq', style: 'table-layout:auto;min-width:0' }, h('thead', null, h('tr', null, ['Instrumento', 'Nº', 'Objeto', 'Início', 'Fim'].map((t) => h('th', null, t)))),
          h('tbody', null, g.instrumentos.map((x) => h('tr', null, h('td', null, x.instrumento.toLowerCase()), h('td', null, x.numero || '—'), h('td', null, x.objeto || '—'), h('td', null, x.inicio ? x.inicio.split('-').reverse().join('/') : '—'), h('td', null, x.fim ? x.fim.split('-').reverse().join('/') : '—')))))));
      slotRegistro.replaceChildren(h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, 'Contrato e termos aditivos'), g.conferido ? selo('conferido', 'ok') : selo('a conferir', 'atencao')),
        h('p', { style: 'font-size:16px;line-height:1.5' }, g.texto),
        h('p', { class: 'mudo peq' }, 'Vem do registro da DGMCG (planilha de contratos e T.A.s). Não traz metas nem valores: esses são lidos dos documentos do contrato.'),
        lista,
        g.conferido ? null : h('div', { class: 'linha' }, h('button', { type: 'button', class: 'sec', onclick: async () => { try { await api('POST', '/api/ctai/contratos/' + encodeURIComponent(id) + '/instrumentos/confirmar', {}); toast('Registro conferido.'); recarregar(); } catch (e) { toast(e.message, true); } } }, 'Conferi: está certo'))));
    }).catch(() => {});
    const slotContrato = h('div', { id: 'un-contrato' });
    if (window.CTAI_CONTRATOS) window.CTAI_CONTRATOS.preencher(slotContrato, id).catch(() => {});
    const seletor = h('select', { id: 'un-tri', 'aria-label': 'Trimestre', onchange: (e) => { guardaTri(id, e.target.value); recarregar(); } }, tris.map((t) => h('option', Object.assign({ value: t }, t === T ? { selected: true } : {}), t)));
    montar(avDup,
      h('div', { class: 'topo' }, h('div', null, h('h1', null, c.unidade, ' ', c.demo ? selo('demonstração', 'demo') : null), h('p', null, [c.tipo, c.oss, c.numero_cg].filter(Boolean).join(' · '))),
        h('div', { class: 'linha' }, h('label', { for: 'un-tri', class: 'mudo peq', style: 'margin:0' }, 'Trimestre'), seletor, h('button', { type: 'button', class: 'sec', onclick: () => configuracoes(id, recarregar).catch((e) => toast(e.message, true)) }, 'Configurações'))),
      acessosProv, slotRegistro, slotContrato, barra, secoes);
  }

  // Painel de consulta do editor: dados do trimestre e regras do contrato, para conferir sem trocar de janela.
  async function painelDados(contratoId, trimestre) {
    const [rc, d] = await Promise.all([api('GET', '/api/ctai/contratos'), api('GET', '/api/ctai/contratos/' + encodeURIComponent(contratoId) + '/decisoes')]);
    const c = rc.contratos.find((x) => x.contrato_id === contratoId);
    const K = c ? c.competencias.filter((k) => triDe(k.competencia_id) === trimestre) : [];
    const cr = d.contratoRegras && d.contratoRegras.conteudo;
    const corpo = h('div', null,
      h('h3', null, 'Meses de ' + trimestre),
      K.length ? tabela([{ t: 'Mês' }, { t: 'Situação' }, { t: 'Envio' }, { t: 'Divergências abertas', n: true }, { t: 'Sistema × SEI' }],
        K.map((k) => [fmt.comp(k.competencia_id), selo(k.status), k.versaoEnvio ? 'v' + k.versaoEnvio : 'não enviou', String(k.divergenciasAbertas || 0), k.seiAlertas ? selo(k.seiAlertas + ' alerta(s)', 'atencao') : '—'])) : h('p', { class: 'mudo' }, 'Sem meses deste trimestre no sistema.'),
      h('div', { class: 'linha espaco', style: 'margin-top:14px' }, h('h3', { style: 'margin:0' }, 'Regras do contrato'), h('button', { type: 'button', class: 'sec', onclick: () => configuracoes(contratoId, () => location.reload()).catch((e) => toast(e.message, true)) }, 'Configurações')),
      cr ? [h('p', { class: 'mudo peq' }, [cr.contrato_numero && 'Contrato ' + cr.contrato_numero, cr.oss, cr.valor_mensal && 'valor mensal ' + cr.valor_mensal].filter(Boolean).join(' · ') + (d.contratoRegras.conferida ? ' · regra conferida' : ' · regra a conferir')),
        tabela([{ t: 'Indicador' }, { t: 'Tipo' }, { t: 'Peso %', n: true }, { t: 'Meta' }], (cr.indicadores || []).map((i) => [i.nome, i.tipo, i.peso_pct_total === null || i.peso_pct_total === undefined ? '—' : String(i.peso_pct_total), i.meta || '—'])),
        (cr.observacoes || []).length ? h('ul', { class: 'peq' }, cr.observacoes.map((o) => h('li', null, o))) : null]
        : h('p', { class: 'mudo' }, 'Esta unidade ainda não tem a regra do contrato cadastrada.'));
    return window.CTAI.recolher('editor-dados:' + contratoId, 'Consulta: dados do trimestre e regras do contrato', 'para conferir sem sair do documento', corpo);
  }

  window.CTAI_UNIDADE = { painelDados, pagina, configuracoes, janelaNova, rotas: [['/u/:id', pagina]] };
})();
