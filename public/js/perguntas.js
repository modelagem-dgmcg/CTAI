(function () {
  'use strict';
  // Perguntas de contrato: cartão autoexplicativo (usado na página da unidade e na tela URGÊNCIAS), tela URGÊNCIAS e selo do menu.
  // Regra desta tela: nenhum dado aparece sem dizer de onde veio (documento, trecho e data) e por que importa para o parecer.
  const { h, api, toast, selo, aviso, montar } = window.CTAI;
  const dataBr = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(s || ''); };
  const GRAU = { 1: ['Muda o valor do parecer', 'atencao'], 2: ['Muda o texto do parecer', 'info'], 3: ['Só conferência', 'ok'] };
  const base = 'font-size:16px;line-height:1.5;margin:2px 0';

  function quadro(titulo, corpo) {
    return h('div', { class: 'pq-quadro' }, h('div', { class: 'pq-quadro-t' }, titulo), corpo);
  }

  // Quadros "O que é isso" / "De onde veio" / "Por que importa" / "O que fazer agora".
  function explicacao(q) {
    const origem = q.doc_origem
      ? [h('p', { style: base }, h('strong', null, 'Documento: '), q.doc_origem), q.trecho_origem ? h('p', { style: base }, h('strong', null, 'Trecho: '), '“' + q.trecho_origem + '”') : null,
        h('p', { style: base }, h('strong', null, 'Data: '), q.data_origem ? dataBr(q.data_origem) + (/^Busca/.test(q.doc_origem) ? ' (dia da busca)' : ' (citada no documento)') : 'não consta no trecho lido')]
      : h('p', { style: base }, q.tipo === 'documento' ? 'Este documento não foi encontrado na pasta da unidade no Drive. Por isso o sistema não consegue confirmar o que vale.' : 'Origem não registrada neste item. Avise a coordenação antes de responder.');
    const valores = (q.valor_atual || q.valor_proposto) ? h('p', { style: base }, [q.valor_atual ? 'Hoje o sistema usa: ' + q.valor_atual + '.' : '', q.valor_proposto ? ' O documento diz: ' + q.valor_proposto + '.' : ''].join('')) : null;
    return h('div', { class: 'pq-quadros' },
      quadro('O que é isso', [h('p', { style: base }, q.o_que_e || q.pergunta), valores]),
      quadro('De onde veio', origem),
      quadro('Por que importa para o parecer deste trimestre', h('p', { style: base }, q.por_que_importa || 'O parecer usa este dado para conferir o repasse e as metas da unidade. Sem a sua resposta, o sistema segue com o valor que já tem e avisa que não foi confirmado.')),
      quadro('O que fazer agora', h('p', { style: base }, q.o_que_fazer || (q.tipo === 'documento' ? 'Anexe o documento pedido abaixo.' : 'Escolha uma das opções abaixo. Se não tiver certeza, escolha "Ainda não sei": a pergunta continua em aberto.'))));
  }

  function caminho() {
    return h('details', { class: 'un-caminho' }, h('summary', null, 'Como anexar um documento, passo a passo'),
      h('ol', null,
        h('li', null, 'Abra o documento no lugar indicado em "Onde achar" (Drive ou processo no SEI) e baixe o arquivo para o seu computador.'),
        h('li', null, 'Clique em "Anexar agora". O sistema abre a página da unidade já na etapa "Importar Arquivos".'),
        h('li', null, 'Arraste o arquivo para a área tracejada ou clique em "Escolher arquivos". Pode ser PDF, Word ou ZIP do SEI.'),
        h('li', null, 'Espere o sistema ler. Ele guarda só o texto, já com dados pessoais mascarados. O arquivo original não fica guardado.'),
        h('li', null, 'Volte aqui e clique em "Já anexei" no pedido correspondente.')));
  }

  // opc: { recarregar(): Promise, anexarAgora(q): void }
  function cartao(q, opc) {
    const impacto = GRAU[q.impacto] || GRAU[2];
    const cab = h('div', { class: 'linha espaco' }, h('p', { class: 'un-perg-t' }, q.pergunta), selo(impacto[0], impacto[1]));
    if (q.tipo === 'documento') {
      return h('div', { class: 'un-perg' + (q.anexo_ok ? ' ok' : '') }, cab, explicacao(q),
        h('p', { style: base }, h('strong', null, 'Anexe: '), q.documento_pedido + '.'),
        q.onde_encontrar ? h('p', { style: base }, h('strong', null, 'Onde achar: '), q.onde_encontrar + '.') : null,
        q.sugestao && !q.anexo_ok ? aviso('info', 'Parece que já chegou: ' + q.sugestao + '. Se for esse, clique em "Já anexei".') : null,
        q.anexo_ok ? null : caminho(),
        h('div', { class: 'linha', style: 'margin-top:8px' }, q.anexo_ok
          ? [selo('anexado', 'ok'), h('button', { type: 'button', class: 'leve', onclick: async () => { try { await api('POST', '/api/ctai/perguntas/' + q.id + '/anexo', { desfazer: true }); await opc.recarregar(); } catch (e) { toast(e.message, true); } } }, 'Desfazer')]
          : [h('button', { type: 'button', onclick: () => opc.anexarAgora(q) }, 'Anexar agora'), h('button', { type: 'button', class: 'sec', onclick: async () => { try { await api('POST', '/api/ctai/perguntas/' + q.id + '/anexo', {}); toast('Marcado como anexado.'); await opc.recarregar(); } catch (e) { toast(e.message, true); } } }, 'Já anexei')]));
    }
    const obs = h('textarea', { rows: 2, 'aria-label': 'Observação (opcional)', placeholder: 'Observação (opcional)', style: 'width:100%;font-size:16px', onchange: async () => { if (!q.resposta) return; try { await api('POST', '/api/ctai/perguntas/' + q.id + '/responder', { resposta: q.resposta, observacao: obs.value }); toast('Observação salva.'); } catch (e) { toast(e.message, true); } } }, q.observacao || '');
    const botoes = q.opcoes.map((o) => h('button', { type: 'button', class: 'un-op' + (o === q.resposta ? ' on' : ''), onclick: async () => {
      try { await api('POST', '/api/ctai/perguntas/' + q.id + '/responder', { resposta: o, observacao: obs.value }); toast('Resposta registrada.'); await opc.recarregar(); } catch (e) { toast(e.message, true); } } }, o));
    return h('div', { class: 'un-perg' + (q.aberta ? '' : ' ok') }, cab, explicacao(q), h('div', { class: 'linha un-ops' }, botoes), obs,
      q.resposta ? h('p', { class: 'mudo', style: base }, 'Resposta de ' + (q.respondida_por || '—') + (q.respondida_em ? ' em ' + dataBr(q.respondida_em) : '') + '. Você pode mudar clicando em outra opção.') : null);
  }

  // Leva à página da unidade já na etapa de importar.
  function anexarAgora(q) {
    try { sessionStorage.setItem('ctai_abrir_importar', q.contrato_id || ''); } catch (_) { /* sem memória do navegador */ }
    location.hash = '#/u/' + encodeURIComponent(q.contrato_id);
  }

  async function atualizarSelo() {
    try {
      const c = await api('GET', '/api/ctai/urgencias/contador');
      const a = document.querySelector('.lateral a.nav[data-h="#/urgencias"]'); if (!a) return;
      let b = a.querySelector('.contador'); if (!b) { b = h('span', { class: 'contador', id: 'urg-contador', 'aria-label': 'perguntas de contrato abertas' }); a.appendChild(b); }
      b.textContent = c.abertas ? String(c.abertas) : ''; b.style.display = c.abertas ? '' : 'none';
    } catch (_) { /* sem selo */ }
  }

  async function urgencias() {
    const d = await api('GET', '/api/ctai/urgencias');
    const recarregar = async () => { await urgencias(); atualizarSelo(); };
    const topo = h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Urgências'),
      h('p', { style: 'font-size:17px;line-height:1.5;margin:4px 0' }, 'Estas dúvidas de contrato vêm antes do parecer: o parecer deste trimestre usa valores e instrumentos que só você, dona da carteira, confirma.'),
      h('p', { style: 'font-size:17px;line-height:1.5;margin:4px 0' }, 'Respondendo agora, o parecer sai com dados confirmados e sem avisos de "não confirmado". A resposta só registra a sua decisão; não muda valores sozinha.')));
    const resumo = h('div', { class: 'cartao' }, h('div', { class: 'linha espaco' }, h('h3', { style: 'margin:0' }, d.abertas ? d.abertas + ' pergunta(s) em aberto em ' + d.unidades.length + ' unidade(s)' : 'Nada em aberto'), d.abertas ? selo('responda antes do parecer', 'atencao') : selo('tudo respondido', 'ok')),
      d.respondidas ? h('p', { class: 'mudo', style: base }, d.respondidas + ' já respondida(s).') : null,
      d.porAnalista && d.porAnalista.length ? h('div', null, h('h4', { style: 'margin:10px 0 4px' }, 'Em aberto por analista'), h('ul', null, d.porAnalista.map((a) => h('li', { style: base }, a.nome + ': ' + a.abertas)))) : null);
    const grupos = d.unidades.map((u) => h('section', { class: 'cartao pq-unidade' },
      h('div', { class: 'linha espaco' }, h('h2', { style: 'margin:0;font-size:20px' }, u.unidade), h('a', { class: 'btn leve', href: '#/u/' + encodeURIComponent(u.contrato_id) }, 'Abrir a unidade')),
      u.perguntas.map((q) => cartao(Object.assign({ contrato_id: u.contrato_id }, q), { recarregar, anexarAgora }))));
    montar(topo, resumo, d.abertas ? grupos : aviso('info', 'Quando houver dúvida de contrato nas suas unidades, ela aparece aqui.'));
  }

  window.CTAI_PERGUNTAS = { cartao, caminho, atualizarSelo, rotas: [['/urgencias', urgencias]] };
})();
