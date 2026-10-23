/* Peças comuns do front-end: elementos, chamadas à API, formatação, avisos e janelas. Sem dependências. */
(function () {
  'use strict';
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => add(el, x));
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  async function api(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, headers: { 'content-type': 'application/json', 'x-ctai': '1' }, body: corpo === undefined ? undefined : JSON.stringify(corpo), credentials: 'same-origin' });
    let j = null;
    try { j = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok) {
      if (r.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/me') && location.pathname !== '/') { location.href = entrada(); }
      const e = new Error((j && j.erro) || 'Algo deu errado (' + r.status + ').');
      e.status = r.status; e.dados = j; throw e;
    }
    return j;
  }
  const fmt = {
    num(n, c) { if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—'; return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: c === undefined ? 2 : c, maximumFractionDigits: c === undefined ? 2 : c }); },
    moeda(n) { if (n === null || n === undefined) return '—'; return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    data(s) { if (!s) return '—'; const d = new Date(s); if (Number.isNaN(d.getTime())) return s; return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); },
    comp(c) { if (!c) return ''; const [a, m] = c.split('-'); const nomes = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']; return nomes[Number(m)] + ' de ' + a; },
    valor(v) { if (v === null || v === undefined || v === '') return '—'; if (v === true) return 'sim'; if (v === false) return 'não'; const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' && /^-?[\d.]+$/.test(String(v)) ? fmt.num(n) : String(v); },
  };
  let tt;
  function toast(msg, erro) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = h('div', { class: 'toast' + (erro ? ' erro' : ''), role: 'status' }, msg);
    document.body.appendChild(t); clearTimeout(tt); tt = setTimeout(() => t.remove(), erro ? 6500 : 3500);
  }
  function janela(titulo, corpo, botoes) {
    return new Promise((resolve) => {
      const d = h('dialog', null, h('div', { class: 'corpo' }, h('h2', null, titulo), corpo), h('div', { class: 'botoes' }, (botoes || [{ rotulo: 'Fechar', valor: null, sec: true }]).map((b) =>
        h('button', { class: b.sec ? 'sec' : (b.perigo ? 'perigo' : ''), onclick: async () => { if (b.validar && !(await b.validar())) return; d.close(); resolve(b.valor); } }, b.rotulo))));
      d.addEventListener('close', () => { d.remove(); resolve(undefined); });
      document.body.appendChild(d); d.showModal();
    });
  }
  async function perguntar(titulo, rotulo, opcoes) {
    const o = opcoes || {};
    const campo = o.longo ? h('textarea', { id: 'perg-campo', rows: 3, placeholder: o.dica || '' }) : h('input', { type: 'text', id: 'perg-campo', placeholder: o.dica || '' });
    const msg = h('div', { class: 'msg-erro' });
    const corpo = h('div', null, o.texto ? h('p', null, o.texto) : null, h('div', { class: 'campo' }, h('label', { for: 'perg-campo' }, rotulo), campo, msg));
    const r = await janela(titulo, corpo, [{ rotulo: 'Cancelar', valor: null, sec: true }, { rotulo: o.botao || 'Confirmar', valor: 'ok', validar: () => { if (o.obrigatorio !== false && !campo.value.trim()) { msg.textContent = 'Preencha este campo.'; return false; } return true; } }]);
    return r === 'ok' ? campo.value.trim() : null;
  }
  async function confirmar(titulo, texto, rotulo, perigo) {
    return (await janela(titulo, h('p', null, texto), [{ rotulo: 'Cancelar', valor: false, sec: true }, { rotulo: rotulo || 'Confirmar', valor: true, perigo }])) === true;
  }
  const selo = (txt, tipo) => h('span', { class: 'selo ' + (tipo || '') }, txt);
  const seloGrav = (g) => selo(g, g === 'alta' || g === 'ALTA' ? 'alta' : (g === 'média' || g === 'MÉDIA' ? 'media' : 'baixa'));
  function aviso(tipo, ...c) { return h('div', { class: 'aviso ' + (tipo || '') }, c); }
  function tabela(cols, linhas, opc) {
    return h('div', { class: 'rolagem' }, h('table', null,
      h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.n ? 'n' : '' }, c.t)))),
      h('tbody', null, linhas.length ? linhas.map((l) => h('tr', null, l.map((c, i) => h('td', { class: cols[i] && cols[i].n ? 'n' : '' }, c)))) : h('tr', null, h('td', { colspan: cols.length, class: 'vazio' }, (opc && opc.vazio) || 'Nada por aqui ainda.')))));
  }
  function rotear(rotas, aoMudar) {
    async function ir() {
      const hash = location.hash.replace(/^#/, '') || '/';
      for (const [padrao, fn] of rotas) {
        const nomes = []; const re = new RegExp('^' + padrao.replace(/:([a-z]+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; }) + '$');
        const m = re.exec(hash);
        if (m) { const p = {}; nomes.forEach((n, i) => { p[n] = decodeURIComponent(m[i + 1]); }); aoMudar && aoMudar(hash); try { await fn(p); } catch (e) { montar(aviso('erro', e.message)); } window.scrollTo(0, 0); return; }
      }
      montar(aviso('erro', 'Página não encontrada.'));
    }
    // Fila: telas lentas não sobrescrevem a tela mais nova.
    let fila = Promise.resolve();
    const agendar = () => { fila = fila.then(ir, ir); };
    window.addEventListener('hashchange', agendar); agendar();
  }
  // Troca o conteúdo de um elemento aceitando listas (replaceChildren não aceita arrays).
  function troca(el, ...c) { el.replaceChildren(); add(el, c); return el; }
  function montar(...c) { const el = document.getElementById('conteudo'); el.replaceChildren(); add(el, c); el.focus && el.focus({ preventScroll: true }); }
  // Cartões recolhíveis: no primeiro acesso (cada login) ficam todos fechados; o que a pessoa abre fica aberto até o próximo login ou até ela fechar.
  const CH_ABERTOS = 'ctai_abertos';
  const lerAbertos = () => { try { return JSON.parse(localStorage.getItem(CH_ABERTOS) || '[]'); } catch (_) { return []; } };
  const gravarAbertos = (a) => { try { localStorage.setItem(CH_ABERTOS, JSON.stringify(a)); } catch (_) { /* sem armazenamento: segue funcionando */ } };
  const esquecerAbertos = () => { try { localStorage.removeItem(CH_ABERTOS); } catch (_) { /* nada */ } };
  function recolher(chave, cabecalho, resumo, conteudo) {
    const corpo = h('div', { class: 'rec-corpo' }, conteudo);
    const seta = h('span', { class: 'rec-seta', 'aria-hidden': 'true' }, '▸');
    const btn = h('button', { type: 'button', class: 'rec-cab', 'aria-expanded': 'false' }, seta, h('span', { class: 'rec-titulo' }, cabecalho), resumo ? h('span', { class: 'rec-resumo' }, resumo) : null);
    const caixa = h('div', { class: 'cartao rec' }, btn, corpo);
    const pintar = (aberto) => { caixa.classList.toggle('aberto', aberto); btn.setAttribute('aria-expanded', String(aberto)); corpo.hidden = !aberto; };
    pintar(lerAbertos().includes(chave));
    btn.addEventListener('click', () => {
      const abrir = !caixa.classList.contains('aberto'); pintar(abrir);
      const a = lerAbertos().filter((x) => x !== chave); if (abrir) a.push(chave); gravarAbertos(a);
    });
    return caixa;
  }
  // Quem chega por /unidade volta para a entrada da unidade, não para a da CTAI.
  const entrada = () => (location.pathname === '/unidade' ? '/?entrar=unidade' : '/');
  async function casca(opc) {
    const me = await api('GET', '/api/auth/me').catch(() => null);
    if (!me) { location.href = entrada(); return null; }
    const u = me.usuario;
    if (opc.perfis && !opc.perfis.includes(u.perfil) && u.perfil !== 'admin') { location.href = entrada(); return null; }
    const lat = h('nav', { class: 'lateral', 'aria-label': 'Menu' },
      h('div', { class: 'marca' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, 'C'), h('span', null, opc.titulo, h('small', null, opc.subtitulo))),
      opc.itens.map((i) => h('a', { class: 'nav' + (i.classe ? ' ' + i.classe : ''), href: i.href, 'data-h': i.href }, i.rotulo)),
      h('div', { class: 'rodape' }, h('div', null, h('strong', null, u.nome)), h('div', null, u.perfilNome), h('button', { class: 'sec', onclick: async () => { await api('POST', '/api/auth/logout', {}); esquecerAbertos(); location.href = '/'; } }, 'Sair')));
    const main = h('main', { class: 'conteudo', id: 'conteudo', tabindex: '-1' });
    document.getElementById('app').replaceChildren(h('div', { class: 'casca' }, lat, main));
    window.__marcarMenu = (hash) => lat.querySelectorAll('a.nav').forEach((a) => { const alvo = a.getAttribute('data-h').replace('#', ''); const h2 = hash.replace(/^\/[pv]\//, '/pareceres/').replace(/^\/analista/, '/pareceres'); a.classList.toggle('ativo', alvo === '/' ? (hash === '/' || hash.startsWith('/c/')) : h2.startsWith(alvo)); });
    if (u.trocar_senha) { await trocarSenha(true); if (window.SalaGuiada) window.SalaGuiada.iniciar(); } // a Sala guiada só liga depois da troca da senha provisória
    return u;
  }
  async function trocarSenha(obrigatoria) {
    const a = h('input', { type: 'password', id: 'ts-a', autocomplete: 'current-password' }), n = h('input', { type: 'password', id: 'ts-n', autocomplete: 'new-password' }), msg = h('div', { class: 'msg-erro' });
    const corpo = h('div', null, obrigatoria ? h('p', null, 'Este é o seu primeiro acesso. Troque a senha temporária para continuar.') : null,
      h('div', { class: 'campo' }, h('label', { for: 'ts-a' }, 'Senha atual'), a), h('div', { class: 'campo' }, h('label', { for: 'ts-n' }, 'Nova senha'), n, h('div', { class: 'ajuda' }, 'Pelo menos 8 caracteres, com letras e números.')), msg);
    for (;;) {
      const r = await janela('Trocar a senha', corpo, [{ rotulo: 'Trocar', valor: 'ok' }]);
      if (r !== 'ok') { if (obrigatoria) continue; return; }
      try { await api('POST', '/api/auth/trocar-senha', { atual: a.value, nova: n.value }); toast('Senha trocada.'); return; } catch (e) { msg.textContent = e.message; }
    }
  }
  window.CTAI = { h, api, fmt, toast, janela, perguntar, confirmar, selo, seloGrav, aviso, tabela, rotear, montar, troca, casca, trocarSenha, add, recolher, esquecerAbertos };
})();
