(function () {
  'use strict';
  // Mensageiro da equipe: texto e anexos, uma conversa por pessoa.
  const { h, api, toast, montar, aviso, fmt } = window.CTAI;
  const ESTADO = { login: null };
  const VIVO = { login: null, hist: null, pintar: null, sig: '' };
  const assinatura = (ms) => ms.length + ':' + (ms.length ? (ms[ms.length - 1].id || ms[ms.length - 1].criado_em) : '');
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
    const [c, pe] = await Promise.all([api('GET', '/api/mensageiro/contatos'), api('GET', '/api/mensageiro/ponte/estado').catch(() => ({ configurada: false }))]);
    const ext = { itens: [], erro: null };
    if (pe.configurada) { try { ext.itens = (await api('GET', '/api/mensageiro/ponte/contatos')).contatos; } catch (e) { ext.erro = e.message; } }
    const col = h('div', { class: 'cartao msg-contatos', id: 'msg-contatos' });
    const painel = h('div', { class: 'cartao', id: 'msg-painel' }, h('p', { class: 'mudo' }, 'Escolha uma pessoa para conversar.'));
    const pintarContatos = () => {
      const itens = c.contatos.map((p) => h('button', { type: 'button', class: 'ct' + (p.login === ESTADO.login ? ' ativo' : ''), 'data-login': p.login, onclick: () => abrir(p.login) },
        h('span', { class: 'ponto ' + (p.status ? p.status.nivel : 'off'), title: p.status ? p.status.texto : '' }),
        h('span', { class: 'ct-txt' }, p.nome, h('br'), h('small', null, (p.cargo || PERFIL[p.perfil] || p.perfil) + ' · ' + (p.status ? p.status.texto : ''))), p.naoLidas ? h('span', { class: 'selo atencao' }, String(p.naoLidas)) : null));
      const ext2 = ext.itens.map((p) => h('button', { type: 'button', class: 'ct' + (ESTADO.login === 'analista:' + p.id ? ' ativo' : ''), 'data-externo': p.id, onclick: () => abrirExterno(p) }, h('span', { class: 'ponto off' }), h('span', { class: 'ct-txt' }, p.nome, h('br'), h('small', null, p.gerencia ? 'Analista · ' + p.gerencia : 'Analista'))));
      col.replaceChildren(...[h('button', { type: 'button', class: 'sec msg-todos', id: 'msg-todos', onclick: abrirGrupo }, 'Escrever para várias pessoas'), h('h3', null, 'Equipe da CTAI'),
        ...itens, c.contatos.length ? null : h('p', { class: 'mudo peq' }, 'Nenhum outro usuário da equipe ainda.'),
        pe.configurada || ext.erro ? h('h3', { style: 'margin-top:14px' }, 'Diretoria (Analista)') : null,
        ext.erro ? aviso('atencao', 'Não consegui falar com o Analista agora: ' + ext.erro) : null, ...ext2].filter(Boolean));
    };
    async function abrirExterno(p) {
      ESTADO.login = 'analista:' + p.id; pintarContatos();
      let msgs = [];
      try { msgs = (await api('GET', '/api/mensageiro/ponte/conversa?id=' + encodeURIComponent(p.id))).mensagens; } catch (e) { painel.replaceChildren(h('h3', null, p.nome), aviso('erro', e.message)); return; }
      const hist = h('div', { class: 'msg-hist', id: 'msg-hist' }, msgs.length ? msgs.map((m) => h('div', { class: 'msg-b' + (m.meu ? ' meu' : '') }, m.texto, h('small', null, (m.meu ? 'CTAI' : m.de) + ' · ' + hora(m.criado_em)))) : h('p', { class: 'mudo' }, 'Sem mensagens ainda.'));
      const texto = h('textarea', { id: 'msg-texto', rows: 2, placeholder: 'Escreva a mensagem…', 'aria-label': 'Mensagem' });
      const enviar = async () => { try { await api('POST', '/api/mensageiro/ponte/enviar', { id: p.id, texto: texto.value }); abrirExterno(p); } catch (e) { toast(e.message, true); } };
      painel.replaceChildren(h('h3', null, p.nome + ' · Analista'), hist, h('div', { class: 'campo' }, texto), h('div', { class: 'linha' }, h('button', { id: 'msg-enviar', onclick: enviar }, 'Enviar')),
        h('p', { class: 'mudo peq' }, 'A mensagem chega ao Analista como “CTAI”, com o seu nome. Para o Analista, só texto; anexos valem entre a equipe do CTAI.'));
      hist.scrollTop = hist.scrollHeight;
    }
    async function abrirGrupo() {
      ESTADO.login = null; pintarContatos();
      const gr = (await api('GET', '/api/mensageiro/grupos')).grupos;
      const sel = h('select', { id: 'gr-g' }, gr.map((g) => h('option', { value: g.id }, g.nome)));
      const texto = h('textarea', { id: 'gr-t', rows: 5, placeholder: 'Escreva o recado. Cada pessoa recebe na sua própria conversa.', 'aria-label': 'Mensagem' });
      const arq = h('input', { type: 'file', id: 'gr-a', accept: '.pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg', 'aria-label': 'Anexar documento' });
      const enviar = async () => {
        try {
          const corpo = { grupo: sel.value, texto: texto.value }; const f = arq.files[0];
          if (f) { if (f.size > 4 * 1024 * 1024) throw new Error('Arquivo acima de 4 MB.'); corpo.anexo = { nome: f.name, base64: await lerBase64(f) }; }
          const o = await api('POST', '/api/mensageiro/enviar-grupo', corpo); toast('Enviado para ' + o.enviadas + (o.enviadas === 1 ? ' pessoa.' : ' pessoas.')); texto.value = ''; arq.value = '';
        } catch (e) { toast(e.message, true); }
      };
      painel.replaceChildren(h('h3', null, 'Escrever para várias pessoas'), h('div', { class: 'campo' }, h('label', { for: 'gr-g' }, 'Para quem'), sel), h('div', { class: 'campo' }, texto),
        h('div', { class: 'linha' }, arq, h('button', { id: 'gr-enviar', onclick: enviar }, 'Enviar')), h('p', { class: 'mudo peq' }, 'Cada pessoa vê o recado na conversa dela com você, marcado com o nome do grupo.'));
    }
    async function abrir(login) {
      ESTADO.login = login;
      const d = await api('GET', '/api/mensageiro/conversa/' + encodeURIComponent(login));
      const p = c.contatos.find((x) => x.login === login); if (p) p.naoLidas = 0;
      pintarContatos(); atualizarContador();
      const pintarMsgs = (msgs) => msgs.length ? msgs.map((m) => h('div', { class: 'msg-b' + (m.meu ? ' meu' : '') },
        m.grupo ? h('small', { class: 'grupo-tag' }, 'Para: ' + m.grupo) : null, m.texto || null, m.anexo ? h('div', null, h('a', { href: '/api/mensageiro/anexo/' + m.anexo.id, download: m.anexo.nome }, '📎 ' + m.anexo.nome), ' ', h('small', null, kb(m.anexo.tamanho))) : null, h('small', null, hora(m.criado_em)))) : h('p', { class: 'mudo' }, 'Sem mensagens ainda.');
      const hist = h('div', { class: 'msg-hist', id: 'msg-hist' }, pintarMsgs(d.mensagens));
      VIVO.login = login; VIVO.hist = hist; VIVO.pintar = pintarMsgs; VIVO.sig = assinatura(d.mensagens);
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
    // Atualização ao vivo: enquanto a tela está aberta, confere a cada 3 s se chegou mensagem (e ao voltar para a aba).
    VIVO.login = null; VIVO.hist = null;
    let ocupado = false;
    const tic = async () => {
      if (ocupado || document.hidden) return;
      ocupado = true;
      try {
        const novos = (await api('GET', '/api/mensageiro/contatos')).contatos;
        if (ESTADO.login && !String(ESTADO.login).startsWith('analista:') && VIVO.hist && VIVO.login === ESTADO.login) {
          const d = await api('GET', '/api/mensageiro/conversa/' + encodeURIComponent(ESTADO.login));
          const s = assinatura(d.mensagens);
          if (s !== VIVO.sig) {
            const perto = VIVO.hist.scrollHeight - VIVO.hist.scrollTop - VIVO.hist.clientHeight < 80;
            VIVO.sig = s; VIVO.hist.replaceChildren(...[].concat(VIVO.pintar(d.mensagens)));
            if (perto) VIVO.hist.scrollTop = VIVO.hist.scrollHeight;
          }
          const ativo = novos.find((x) => x.login === ESTADO.login); if (ativo) ativo.naoLidas = 0;
        }
        c.contatos = novos; pintarContatos(); atualizarContador();
      } catch (_) { /* tenta de novo no próximo ciclo */ } finally { ocupado = false; }
    };
    const relogio = setInterval(() => { if (!document.body.contains(painel)) { clearInterval(relogio); document.removeEventListener('visibilitychange', aoVoltar); return; } tic(); }, 3000);
    const aoVoltar = () => { if (!document.hidden) tic(); };
    document.addEventListener('visibilitychange', aoVoltar);
    montar(h('div', { class: 'topo' }, h('div', null, h('h1', null, 'Falar com a equipe'), h('p', null, 'Conversa com a equipe, com texto e documentos anexos.'))), h('div', { class: 'msg-grade' }, col, painel));
    atualizarContador();
  }
  window.CTAI_MENSAGEIRO = { rotas: [['/mensageiro', mensageiro]], atualizarContador };
})();
