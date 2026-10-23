(function () {
  'use strict';
  // "Ensinar ao Sistema": texto livre + anexo opcional. Nada muda sozinho: superintendência e administração avaliam.
  const { h, api, fmt, toast, janela, perguntar, selo, aviso, tabela, montar, troca } = window.CTAI;
  const lerBase64 = (arq) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(arq); });
  const cor = (s) => (s === 'aprovado' ? 'ok' : (s === 'recusado' ? 'alta' : (s === 'em análise' ? 'atencao' : '')));

  async function ensinar() {
    const o = await api('GET', '/api/ensinar');
    const recarregar = () => ensinar().catch((e) => toast(e.message, true));
    const titulo = h('input', { type: 'text', id: 'en-ti', placeholder: 'Um nome curto (opcional)' });
    const texto = h('textarea', { id: 'en-tx', rows: 8, placeholder: 'Escreva do seu jeito o que o sistema deve aprender: uma regra, um jeito de trabalhar, um erro que ele comete, um modelo de documento…' });
    const arq = h('input', { type: 'file', id: 'en-ar', accept: '.pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg', 'aria-label': 'Anexar arquivo' });
    const imediato = h('input', { type: 'checkbox', id: 'en-im' });
    const tipo = h('select', { id: 'en-tp', disabled: true }, [['oficio', 'Ofício'], ['despacho', 'Despacho']].map(([v, r]) => h('option', { value: v }, r)));
    imediato.addEventListener('change', () => { tipo.disabled = !imediato.checked; });
    const enviar = async () => {
      try {
        const corpo = { titulo: titulo.value, texto: texto.value, uso_imediato: imediato.checked, tipo_documento: imediato.checked ? tipo.value : undefined };
        const f = arq.files[0];
        if (f) { if (f.size > 4 * 1024 * 1024) throw new Error('Arquivo acima de 4 MB.'); corpo.anexo = { nome: f.name, base64: await lerBase64(f) }; }
        const r = await api('POST', '/api/ensinar', corpo);
        toast(r.aviso || (r.modelo_id ? 'Recebido. O modelo já está disponível para você em Novo documento.' : 'Recebido. A superintendência e a administração vão avaliar.'), !!r.aviso);
        recarregar();
      } catch (e) { toast(e.message, true); }
    };
    const avaliar = async (p, status) => {
      let parecer = '';
      if (status === 'recusado') { parecer = await perguntar('Por que recusar?', 'Escreva em poucas palavras', { longo: true, botao: 'Recusar' }); if (!parecer) return; }
      else if (status === 'aprovado') { const r = await perguntar('Aprovar', 'Observação (opcional)', { botao: 'Aprovar' }); if (r === undefined || r === null) return; parecer = r; }
      try { await api('POST', '/api/ensinar/' + p.ensino_id + '/avaliar', { status, parecer }); toast('Registrado.'); recarregar(); } catch (e) { toast(e.message, true); }
    };
    const ver = (p) => janela(p.titulo, h('div', null, h('p', { class: 'mudo peq' }, 'De ' + p.de + ' · ' + fmt.data(p.criado_em)), h('p', { style: 'white-space:pre-wrap' }, p.texto || '(sem texto, só anexo)'),
      p.anexo ? h('p', null, h('a', { href: '/api/ensinar/' + p.ensino_id + '/anexo', download: p.anexo.nome }, '📎 ' + p.anexo.nome)) : null, p.parecer ? aviso('info', 'Avaliação: ' + p.parecer) : null));
    const linhas = o.pedidos.map((p) => [h('a', { href: '#/ensinar', onclick: (ev) => { ev.preventDefault(); ver(p); } }, p.titulo), o.avaliador ? p.de : null, p.uso_imediato ? selo('modelo em uso', 'ok') : '', selo(p.status, cor(p.status)), fmt.data(p.criado_em),
      o.avaliador ? h('div', { class: 'linha' }, h('button', { type: 'button', class: 'sec', onclick: () => avaliar(p, 'em_analise') }, 'Em análise'), h('button', { type: 'button', onclick: () => avaliar(p, 'aprovado') }, 'Aprovar'), h('button', { type: 'button', class: 'sec', onclick: () => avaliar(p, 'recusado') }, 'Recusar')) : (p.parecer || '')]);
    const cab = [{ t: 'Pedido' }, o.avaliador ? { t: 'De' } : null, { t: '' }, { t: 'Situação' }, { t: 'Enviado' }, { t: o.avaliador ? '' : 'Resposta' }].filter(Boolean);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Ensinar ao Sistema'), h('p', null, 'Conte o que o sistema precisa aprender. Nada muda sozinho: a superintendência e a administração recebem uma cópia e avaliam.'))),
      h('div', { class: 'cartao' },
        aviso('atencao', 'Não escreva senha nem nome de paciente. Se anexar um documento, prefira um exemplo sem dados de pessoas.'),
        h('div', { class: 'campo' }, h('label', { for: 'en-ti' }, 'Título'), titulo), h('div', { class: 'campo' }, h('label', { for: 'en-tx' }, 'O que quer ensinar'), texto),
        h('div', { class: 'campo' }, h('label', { for: 'en-ar' }, 'Anexar um arquivo (opcional)'), arq),
        h('div', { class: 'linha' }, h('label', { style: 'font-weight:400;margin:0' }, imediato, ' É um modelo de documento que vou usar agora, de '), tipo),
        h('p', { class: 'mudo peq' }, 'Marcando essa opção, o sistema aprende o modelo na hora e ele aparece em "Novo documento" só para você, até ser aprovado para a equipe.'),
        h('div', { class: 'linha', style: 'margin-top:10px' }, h('button', { type: 'button', id: 'en-enviar', onclick: enviar }, 'Enviar ao sistema'))),
      h('div', { class: 'cartao' }, h('h2', null, o.avaliador ? 'Pedidos recebidos' : 'Seus pedidos'), o.pedidos.length ? tabela(cab, linhas.map((l) => l.filter((x) => x !== null))) : h('p', { class: 'mudo' }, 'Nenhum pedido ainda.')));
  }
  window.CTAI_ENSINAR = { rotas: [['/ensinar', ensinar]] };
})();
