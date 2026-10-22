(function () {
  'use strict';
  // Mensageiro da equipe: texto e anexos, uma conversa por pessoa.
  const { h, api, toast, montar, aviso, fmt } = window.CTAI;
  const ESTADO = { login: null };
  const hora = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const PERFIL = { admin: 'Administração', criador: 'Analista', colega: 'Conferente', superintendente: 'Superintendência' };

  async function atualizarContador() {
    try {
      const c = await api('GET', '/api/mensageiro/contador');
      const a = document.querySelector('.lateral a.nav[data-h="#/mensageiro"]'); if (!a) return;
      let b = a.querySelector('.contador'); if (!b) { b = h('span', { class: 'contador', id: 'msg-contador', 'aria-label': 'mensagens não lidas' }); a.appendChild(b); }
      b.textContent = c.naoLidas ? String(c.naoLidas) : ''; b.style.display = c.naoLidas ? '' : 'none';
    } catch (_) { /* sem contador */ }
  }

  const lerBase64 = (arq) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Não consegui ler o arquivo.')); r.readAsDataURL(arq); });

  async function mensageiro() {
    const [c] = await Promise.all([api('GET', '/api/mensageiro/contatos')]);
    const col = h('div', { class: 'cartao msg-contatos', id: 'msg-contatos' });
    const painel = h('div', { class: 'cartao', id: 'msg-painel' }, h('p', { class: 'mudo' }, 'Escolha uma pessoa para conversar.'));
    const pintarContatos = () => col.replaceChildren(h('h3', null, 'Equipe'), ...c.contatos.map((p) => h('button', { type: 'button', class: 'ct' + (p.login === ESTADO.login ? ' ativo' : ''), 'data-login': p.login, onclick: () => abrir(p.login) },
      h('span', null, p.nome, h('br'), h('small', null, (PERFIL[p.perfil] || p.perfil) + ' · ' + p.origem)), p.naoLidas ? h('span', { class: 'selo atencao' }, String(p.naoLidas)) : null)),
      c.contatos.length ? null : h('p', { class: 'mudo peq' }, 'Nenhum outro usuário da equipe ainda.'),
      h('p', { class: 'mudo peq', style: 'margin-top:10px' }, 'Usuários do Analista da diretoria entram aqui quando a ligação entre os dois sistemas for configurada.'));
    async function abrir(login) {
      ESTADO.login = login;
      const d = await api('GET', '/api/mensageiro/conversa/' + encodeURIComponent(login));
      const p = c.contatos.find((x) => x.login === login); if (p) p.naoLidas = 0;
      pintarContatos(); atualizarContador();
      const hist = h('div', { class: 'msg-hist', id: 'msg-hist' }, d.mensagens.length ? d.mensagens.map((m) => h('div', { class: 'msg-b' + (m.meu ? ' meu' : '') },
        m.texto || null, m.anexo ? h('div', null, h('a', { href: '/api/mensageiro/anexo/' + m.anexo.id, download: m.anexo.nome }, '📎 ' + m.anexo.nome), ' ', h('small', null, kb(m.anexo.tamanho))) : null, h('small', null, hora(m.criado_em)))) : h('p', { class: 'mudo' }, 'Sem mensagens ainda.'));
      const texto = h('textarea', { id: 'msg-texto', rows: 2, placeholder: 'Escreva a mensagem…', 'aria-label': 'Mensagem' });
      const arq = h('input', { type: 'file', id: 'msg-arquivo', accept: '.pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg', 'aria-label': 'Anexar documento' });
      const enviar = async () => {
        try {
          const corpo = { para: login, texto: texto.value };
          const f = arq.files[0];
          if (f) { if (f.size > 4 * 1024 * 1024) throw new Error('Arquivo acima de 4 MB.'); corpo.anexo = { nome: f.name, base64: await lerBase64(f) }; }
          await api('POST', '/api/mensageiro/enviar', corpo); abrir(login);
        } catch (e) { toast(e.message, true); }
      };
      texto.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) enviar(); });
      painel.replaceChildren(h('h3', null, d.contato.nome), hist, h('div', { class: 'campo' }, texto), h('div', { class: 'linha' }, arq, h('button', { id: 'msg-enviar', onclick: enviar }, 'Enviar')),
        h('p', { class: 'mudo peq' }, 'Anexos: PDF, Word, Excel, CSV, TXT, PNG ou JPG, até 4 MB. Não envie senha nem dado pessoal de paciente. Ctrl+Enter envia.'));
      hist.scrollTop = hist.scrollHeight;
    }
    pintarContatos();
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Mensageiro'), h('p', null, 'Conversa com a equipe, com texto e documentos anexos.'))), h('div', { class: 'msg-grade' }, col, painel));
    atualizarContador();
  }
  window.CTAI_MENSAGEIRO = { rotas: [['/mensageiro', mensageiro]], atualizarContador };
})();
