(function () {
  'use strict';
  // Guarda de documentos: como a tela conta que um arquivo foi "Bloqueado por segurança". Tudo vai por textContent: o trecho do documento
  // nunca é interpretado como HTML. Liberar (só superintendência/administração) exige um motivo, que fica na trilha.
  const { h, api, toast } = window.CTAI;

  // b = bloqueio vindo do servidor { id, arquivo, oQue[], onde[], porque, oQueFazer, achados[{onde,msg,trecho}], liberadoPor, liberadoEm }
  function cartao(b, opc) {
    opc = opc || {};
    if (!b) return null;
    const achados = (b.achados || []).map((a) => h('li', null, h('span', null, a.msg || ''), a.onde ? h('span', { class: 'peq mudo' }, ' (' + a.onde + ')') : null, a.trecho ? h('div', { class: 'peq mudo guarda-trecho', style: 'font-family:monospace;word-break:break-word;white-space:pre-wrap' }, 'Trecho: ' + a.trecho) : null));
    let liberar = null;
    if (b.liberadoPor) liberar = h('p', { class: 'peq' }, 'Liberado por ' + b.liberadoPor + (b.liberadoEm ? ' em ' + new Date(b.liberadoEm).toLocaleDateString('pt-BR') : '') + '. Envie o arquivo de novo: o sistema vai ler só o texto sem o que estava escondido.');
    else if (opc.podeLiberar && b.id) {
      const motivo = h('input', { type: 'text', 'aria-label': 'Motivo da liberação', placeholder: 'Por que é seguro liberar? (ex.: conferi com a unidade; o texto escondido é só o rodapé do modelo)', style: 'min-width:260px;flex:1' });
      liberar = h('div', { class: 'linha' }, motivo, h('button', { class: 'sec', onclick: async (ev) => {
        const m = motivo.value.trim(); if (m.length < 10) { toast('Explique em uma frase por que é seguro liberar.', true); return; }
        ev.target.disabled = true;
        try { const r = await api('POST', '/api/gestao/guarda/' + b.id + '/liberar', { motivo: m }); toast(r.aviso || 'Liberado.'); if (opc.aoLiberar) await opc.aoLiberar(); }
        catch (e) { ev.target.disabled = false; toast(e.message, true); }
      } }, 'Liberar com motivo'));
    }
    return h('div', { class: 'aviso erro guarda-cartao', role: 'alert', style: 'margin:6px 0' },
      h('strong', null, 'Bloqueado por segurança. '),
      'Este arquivo não foi lido nem guardado. ',
      h('div', { class: 'peq' }, h('strong', null, 'O que foi encontrado: '), (b.oQue || []).join('; ') || 'conteúdo suspeito', (b.onde || []).length ? ' · onde: ' + b.onde.join(', ') : ''),
      achados.length ? h('ul', { style: 'margin:4px 0;padding-left:18px' }, achados) : null,
      h('div', { class: 'peq' }, h('strong', null, 'Por que isso importa: '), b.porque || ''),
      h('div', { class: 'peq' }, h('strong', null, 'O que fazer: '), b.oQueFazer || ''),
      liberar);
  }
  window.CTAI_GUARDA_UI = { cartao };
})();
