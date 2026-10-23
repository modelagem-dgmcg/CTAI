/* Sala guiada: conferência de áudio + apontador conduzido. Sem dependências. Cria o próprio botão (canto inferior direito).
   Áudio: WebRTC ponto a ponto entre os navegadores (nada é gravado e nada de áudio passa pelo servidor).
   Apontador: quem conduz move o mouse; os outros veem uma bolinha com o nome, presa ao elemento da tela (funciona em monitores diferentes). */
(function () {
  'use strict';
  const CHAVE = 'ctai_sala';
  let est = null;                 // { codigo, eu, condutor, ice, max, condutorNome }
  let es = null;                  // EventSource
  let stream = null, mudo = true;
  let lista = [];                 // participantes [{id,nome,condutor,mudo,online}]
  const pcs = new Map();          // id -> { pc, iniciador, tentativas }
  const pend = new Map();         // id -> candidatos ICE que chegaram antes da hora
  const audios = new Map();       // id -> <audio>
  const medidores = new Map();    // id -> { an, buf }
  const tentativas = new Map();   // id -> número de refações
  let ctx = null, timerFala = null;
  let apontador = true, seguir = false, ultimo = null, voando = false, pendMover = null, dialogosAbertos = 0;
  let devEntrada = '', devSaida = '', confirmando = false;
  let tela = null;                // minha tela, quando estou compartilhando
  let quemMostra = '';            // nome de quem está compartilhando comigo
  const ui = {};

  /* ---------- utilidades ---------- */
  function el(tag, cls, texto) { const e = document.createElement(tag); if (cls) e.className = cls; if (texto !== undefined) e.textContent = texto; return e; }
  async function api(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, headers: { 'content-type': 'application/json', 'x-ctai': '1' }, body: corpo === undefined ? undefined : JSON.stringify(corpo), credentials: 'same-origin' });
    let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok) { const e = new Error((j && j.erro) || 'Erro ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  const guardar = (v) => { try { if (v) sessionStorage.setItem(CHAVE, JSON.stringify(v)); else sessionStorage.removeItem(CHAVE); } catch (_) { /* sem armazenamento */ } };
  const lembrado = () => { try { return JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch (_) { return null; } };
  let ultimaMsg = { t: '', ruim: false };
  const aviso = (t, ruim) => { ultimaMsg = { t: t || '', ruim: !!ruim }; if (ui.msg) { ui.msg.textContent = ultimaMsg.t; ui.msg.className = 'sg-msg' + (ruim ? ' sg-ruim' : ''); } };
  const sinalar = (para, dados) => api('POST', '/api/sala/sinal', { codigo: est.codigo, eu: est.eu, para, dados }).catch(() => {});

  /* ---------- áudio ---------- */
  const restricoes = (id) => ({ audio: Object.assign({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, id ? { deviceId: { exact: id } } : {}) });

  async function pegarMicrofone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { aviso('Este navegador não deixa usar o microfone nesta página. Você só vai ouvir.', true); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia(restricoes(devEntrada));
      stream.getAudioTracks().forEach((t) => { t.enabled = !mudo; });
    } catch (e) { stream = null; aviso('Sem acesso ao microfone (' + (e.name === 'NotAllowedError' ? 'permissão negada' : 'não encontrado') + '). Você só vai ouvir.', true); }
  }

  function medir(id, fluxo) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 256;
      ctx.createMediaStreamSource(fluxo).connect(an);
      medidores.set(id, { an, buf: new Uint8Array(an.frequencyBinCount) });
    } catch (_) { /* sem indicador de fala */ }
  }
  function ouvirFala() {
    clearInterval(timerFala);
    timerFala = setInterval(() => {
      if (!ui.lista) return;
      for (const [id, m] of medidores) {
        let pico = 0; m.an.getByteFrequencyData(m.buf); for (let i = 0; i < m.buf.length; i++) if (m.buf[i] > pico) pico = m.buf[i];
        const li = ui.lista.querySelector('[data-id="' + id + '"]');
        if (li) li.classList.toggle('sg-falando', pico > 90 && !(id === est.eu && mudo));
      }
    }, 250);
  }

  function criarPc(id, iniciador) {
    fecharPc(id);
    const pc = new RTCPeerConnection({ iceServers: est.ice });
    const reg = { pc, iniciador };
    pcs.set(id, reg);
    if (stream) stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream)); else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (tela) reg.telaSenders = tela.getTracks().map((t) => pc.addTrack(t, tela));
    pc.onnegotiationneeded = () => { if (reg.pronto) renegociar(id); };
    pc.onicecandidate = (e) => { if (e.candidate) sinalar(id, { tipo: 'ice', candidato: e.candidate }); };
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') { // tela de quem está compartilhando
        const fl = e.streams[0] || new MediaStream([e.track]);
        mostrarTela(id, fl);
        e.track.onmute = () => esconderTela(id); e.track.onended = () => esconderTela(id);
        return;
      }
      const fluxo = e.streams[0] || new MediaStream([e.track]);
      let a = audios.get(id);
      if (!a) { a = el('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); ui.audios.appendChild(a); audios.set(id, a); }
      a.srcObject = fluxo;
      if (devSaida && a.setSinkId) a.setSinkId(devSaida).catch(() => {});
      a.play().catch(() => { ui.som.hidden = false; });
      medir(id, fluxo);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { tentativas.set(id, 0); reg.pronto = true; if (tela) renegociar(id); }
      if (pc.connectionState === 'failed' && pcs.get(id) === reg) {
        fecharPc(id);
        const n = (tentativas.get(id) || 0) + 1; tentativas.set(id, n);
        if (n <= 5) setTimeout(sincronizar, 1500 * n); else aviso('Não consegui ligar o áudio com uma das pessoas. Pode ser bloqueio de rede.', true);
      }
    };
    return reg;
  }
  function fecharPc(id) {
    if (ui.tela && ui.tela.dataset.de === id) esconderTela(id);
    const r = pcs.get(id); if (r) { try { r.pc.onconnectionstatechange = null; r.pc.close(); } catch (_) { /* ok */ } pcs.delete(id); }
    const a = audios.get(id); if (a) { a.srcObject = null; a.remove(); audios.delete(id); }
    medidores.delete(id);
  }

  // Quem tem o id "maior" liga para o outro: assim nunca há duas ofertas ao mesmo tempo.
  function sincronizar() {
    if (!est) return;
    for (const p of lista) {
      if (p.id === est.eu) continue;
      if (!p.online) { fecharPc(p.id); continue; }
      if (!pcs.has(p.id) && est.eu > p.id) ligar(p.id);
    }
    for (const id of [...pcs.keys()]) if (!lista.some((p) => p.id === id)) fecharPc(id);
  }
  async function ligar(id) {
    const { pc } = criarPc(id, true);
    try { await pc.setLocalDescription(await pc.createOffer()); sinalar(id, { tipo: 'oferta', sdp: pc.localDescription }); } catch (_) { fecharPc(id); }
  }
  async function aoReceberSinal(de, d) {
    if (!est || !d) return;
    try {
      if (d.tipo === 'apresentando') { if (tela) pararTela(false); quemMostra = d.nome || ''; return; }
      if (d.tipo === 'parou') { esconderTela(de); return; }
      if (d.tipo === 'oferta') {
        const velho = pcs.get(de);
        let pc;
        if (d.reneg && velho && velho.pc.signalingState !== 'closed') { pc = velho.pc; if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' }).catch(() => {}); }
        else pc = criarPc(de, false).pc;
        await pc.setRemoteDescription(d.sdp); await esvaziar(de, pc);
        await pc.setLocalDescription(await pc.createAnswer());
        sinalar(de, { tipo: 'resposta', sdp: pc.localDescription });
      } else if (d.tipo === 'resposta') {
        const r = pcs.get(de); if (r) { await r.pc.setRemoteDescription(d.sdp); await esvaziar(de, r.pc); }
      } else if (d.tipo === 'ice') {
        const r = pcs.get(de);
        if (r && r.pc.remoteDescription) await r.pc.addIceCandidate(d.candidato).catch(() => {});
        else { if (!pend.has(de)) pend.set(de, []); pend.get(de).push(d.candidato); }
      }
    } catch (_) { fecharPc(de); }
  }
  async function renegociar(id) {
    const r = pcs.get(id); if (!r || r.pc.signalingState !== 'stable') return;
    try { await r.pc.setLocalDescription(await r.pc.createOffer()); sinalar(id, { tipo: 'oferta', reneg: true, sdp: r.pc.localDescription }); } catch (_) { /* tenta na próxima mudança */ }
  }
  // ---------- compartilhar a tela ----------
  async function compartilharTela() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { aviso('Este navegador não compartilha tela. Use o Chrome ou o Edge atualizados.', true); return; }
    let fl;
    try { fl = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); } catch (_) { aviso('Compartilhamento cancelado. Escolha "Tela inteira" para mostrar o sistema todo.'); return; }
    tela = fl; aviso('');
    const meu = (lista.find((x) => x.id === est.eu) || {}).nome || '';
    fl.getVideoTracks()[0].onended = () => pararTela(true);
    for (const p of lista) if (p.id !== est.eu && p.online) sinalar(p.id, { tipo: 'apresentando', nome: meu }); // quem estava mostrando a própria tela para
    for (const r of pcs.values()) r.telaSenders = fl.getTracks().map((t) => r.pc.addTrack(t, fl));
    desenhar();
  }
  function pararTela(avisar) {
    if (!tela) return;
    const fl = tela; tela = null; fl.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    for (const [id, r] of pcs.entries()) { for (const s of r.telaSenders || []) { try { r.pc.removeTrack(s); } catch (_) { /* ok */ } } r.telaSenders = []; if (avisar && est) sinalar(id, { tipo: 'parou' }); }
    desenhar();
  }
  function mostrarTela(id, fl) {
    if (!ui.tela) return;
    const nome = (lista.find((x) => x.id === id) || {}).nome || quemMostra || 'participante';
    ui.tela.dataset.de = id; ui.telaNome.textContent = 'Tela de ' + nome; ui.video.srcObject = fl; ui.video.play().catch(() => {}); ui.tela.hidden = false;
  }
  function esconderTela(id) {
    if (!ui.tela || (id && ui.tela.dataset.de && ui.tela.dataset.de !== id)) return;
    ui.video.srcObject = null; ui.tela.hidden = true; ui.tela.dataset.de = '';
  }
  async function esvaziar(id, pc) { for (const c of pend.get(id) || []) await pc.addIceCandidate(c).catch(() => {}); pend.delete(id); }

  function alternarMicrofone(valor) {
    mudo = valor === undefined ? !mudo : !!valor;
    if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !mudo; });
    if (est) api('POST', '/api/sala/mudo', { codigo: est.codigo, eu: est.eu, mudo }).catch(() => {});
    desenhar();
  }

  async function trocarMicrofone(id) {
    devEntrada = id;
    try {
      const novo = await navigator.mediaDevices.getUserMedia(restricoes(id));
      const trilha = novo.getAudioTracks()[0]; trilha.enabled = !mudo;
      for (const { pc } of pcs.values()) for (const s of pc.getSenders()) if (s.track && s.track.kind === 'audio') s.replaceTrack(trilha);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = novo; medidores.delete(est.eu); medir(est.eu, stream);
    } catch (_) { aviso('Não consegui trocar o microfone.', true); }
  }
  function trocarSaida(id) { devSaida = id; for (const a of audios.values()) if (a.setSinkId) a.setSinkId(id).catch(() => {}); }

  /* ---------- sala: entrar, sair ---------- */
  async function abrir(info) {
    est = info; lista = [];
    guardar({ codigo: info.codigo, eu: info.eu });
    desenhar();
    if (!window.RTCPeerConnection) aviso('Este navegador não tem áudio em tempo real. Use o Chrome, Edge ou Safari atualizados.', true);
    if (!stream) await pegarMicrofone();
    if (stream) medir(est.eu, stream);
    desenhar();
    es = new EventSource('/api/sala/eventos?codigo=' + encodeURIComponent(est.codigo) + '&eu=' + encodeURIComponent(est.eu));
    const ler = (e) => { try { return JSON.parse(e.data); } catch (_) { return {}; } };
    es.addEventListener('ola', (e) => { const d = ler(e); lista = d.participantes || []; sincronizar(); desenharLista(); if (d.ultimo && !est.condutor) aoPonteiro(d.ultimo); });
    es.addEventListener('participantes', (e) => { lista = ler(e).participantes || []; sincronizar(); desenharLista(); });
    es.addEventListener('sinal', (e) => { const d = ler(e); aoReceberSinal(d.de, d.dados); });
    es.addEventListener('ponteiro', (e) => { if (!est.condutor) aoPonteiro(ler(e)); });
    es.addEventListener('condutor', (e) => { // alguém assumiu a condução
      const d = ler(e); retirarEmissor(); est.condutor = d.id === est.eu; est.condutorNome = d.nome; esconderPonteiro(); limparPagina(); instalarEmissor(); desenhar();
      aviso(est.condutor ? 'Você agora conduz a sala.' : d.nome + ' assumiu a condução.');
    });
    es.addEventListener('silenciar', () => { if (!mudo) { alternarMicrofone(true); aviso('Quem conduz silenciou a sala. Ligue seu microfone para falar.'); } });
    es.addEventListener('encerrada', (e) => { const m = ler(e).motivo; sairLocal(); aviso(m || 'A sala foi encerrada.'); });
    es.onerror = () => { if (es && es.readyState === 2) { sairLocal(); aviso('A conexão com a sala caiu e não voltou. Entre de novo com o código.', true); } };
    ouvirFala(); instalarEmissor();
    ui.botao.classList.add('sg-ativo');
  }

  function sairLocal() {
    if (es) { es.close(); es = null; }
    if (tela) { tela.getTracks().forEach((t) => { t.onended = null; t.stop(); }); tela = null; }
    esconderTela();
    for (const id of [...pcs.keys()]) fecharPc(id);
    for (const a of audios.values()) a.remove();
    audios.clear(); medidores.clear(); pend.clear(); tentativas.clear();
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (ctx) { try { ctx.close(); } catch (_) { /* ok */ } ctx = null; }
    clearInterval(timerFala); retirarEmissor(); esconderPonteiro(); limparPagina();
    est = null; lista = []; mudo = true; guardar(null);
    if (ui.botao) ui.botao.classList.remove('sg-ativo');
    if (ui.som) ui.som.hidden = true;
    desenhar();
  }

  async function criar() {
    preparar();
    try { aviso(''); await abrir(await api('POST', '/api/sala/criar', {})); } catch (e) { aviso(e.message, true); }
  }
  async function entrar() {
    const codigo = ui.codigo.value.trim().toUpperCase();
    if (!codigo) { aviso('Digite o código da sala.', true); return; }
    preparar();
    try { aviso(''); await abrir(await api('POST', '/api/sala/entrar', { codigo })); } catch (e) { aviso(e.message, true); }
  }
  async function sair() {
    if (!est) return;
    if (est.condutor && !confirmando) { // dois cliques: evita encerrar a sala de todos por engano
      confirmando = true; ui.sair.textContent = 'Clique de novo para encerrar'; setTimeout(() => { confirmando = false; if (ui.sair) ui.sair.textContent = 'Encerrar sala'; }, 4000); return;
    }
    confirmando = false;
    try { await api('POST', '/api/sala/sair', { codigo: est.codigo, eu: est.eu }); } catch (_) { /* sai do mesmo jeito */ }
    sairLocal();
  }
  // Dentro do clique: libera o som do navegador (Safari/Chrome exigem um gesto da pessoa).
  function preparar() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch (_) { /* ok */ } }
  function ativarSom() { preparar(); for (const a of audios.values()) a.play().catch(() => {}); ui.som.hidden = true; }

  /* ---------- apontador: quem conduz ---------- */
  function ancora(e) {
    if (!e || e.closest('.sg-painel,.sg-botao,.sg-ponteiro,.sg-pagina')) return null;
    const partes = []; let n = e;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.id && /^[\w-]+$/.test(n.id)) { partes.unshift('#' + n.id); break; }
      if (n === document.body) { partes.unshift('body'); break; }
      const irmaos = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
      partes.unshift(n.tagName.toLowerCase() + (irmaos.length > 1 ? ':nth-of-type(' + (irmaos.indexOf(n) + 1) + ')' : ''));
      n = n.parentElement;
    }
    const s = partes.join('>');
    return s.length <= 300 ? s : null;
  }
  function enviarPos(tipo) {
    if (!est || !est.condutor || !apontador || !ultimo) return;
    const e = document.elementFromPoint(ultimo.x, ultimo.y);
    const alvo = ancora(e);
    let fx = null, fy = null;
    if (alvo && e) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { fx = (ultimo.x - r.left) / r.width; fy = (ultimo.y - r.top) / r.height; } }
    const dados = { tipo, alvo: fx === null ? '' : alvo, fx, fy, x: ultimo.x / innerWidth, y: ultimo.y / innerHeight, pagina: location.pathname + location.hash };
    if (tipo === 'mover') { pendMover = dados; despachar(); } else api('POST', '/api/sala/ponteiro', { codigo: est.codigo, eu: est.eu, dados }).catch(() => {});
  }
  function despachar() {
    if (voando || !pendMover || !est) return;
    const dados = pendMover; pendMover = null; voando = true;
    api('POST', '/api/sala/ponteiro', { codigo: est.codigo, eu: est.eu, dados }).catch(() => {}).then(() => { voando = false; despachar(); });
  }
  let tMover = 0;
  const aoMover = (e) => { ultimo = { x: e.clientX, y: e.clientY }; const t = Date.now(); if (t - tMover > 45) { tMover = t; enviarPos('mover'); } };
  const aoClicar = (e) => { ultimo = { x: e.clientX, y: e.clientY }; enviarPos('clique'); };
  const aoSair = (e) => { if (!e.relatedTarget && est && est.condutor && apontador) api('POST', '/api/sala/ponteiro', { codigo: est.codigo, eu: est.eu, dados: { tipo: 'sumir' } }).catch(() => {}); };
  let tRolar = 0;
  const aoRolar = () => { const t = Date.now(); if (t - tRolar > 60) { tRolar = t; enviarPos('mover'); } };
  const aoMudarPagina = () => setTimeout(() => enviarPos('mover'), 200);
  function instalarEmissor() {
    if (!est || !est.condutor) return;
    document.addEventListener('mousemove', aoMover, { passive: true, capture: true });
    document.addEventListener('click', aoClicar, { passive: true, capture: true });
    document.addEventListener('mouseout', aoSair, { passive: true });
    document.addEventListener('scroll', aoRolar, { passive: true, capture: true });
    window.addEventListener('hashchange', aoMudarPagina);
  }
  function retirarEmissor() {
    document.removeEventListener('mousemove', aoMover, { capture: true });
    document.removeEventListener('click', aoClicar, { capture: true });
    document.removeEventListener('mouseout', aoSair);
    document.removeEventListener('scroll', aoRolar, { capture: true });
    window.removeEventListener('hashchange', aoMudarPagina);
  }

  /* ---------- apontador: quem acompanha ---------- */
  function promover() { // mantém a bolinha acima de janelas abertas (dialog usa a camada superior do navegador)
    const n = document.querySelectorAll('dialog[open]').length;
    if (n !== dialogosAbertos || ui.ponteiro.dataset.p !== '1') {
      dialogosAbertos = n;
      if (ui.ponteiro.showPopover) { try { if (ui.ponteiro.matches(':popover-open')) ui.ponteiro.hidePopover(); ui.ponteiro.showPopover(); ui.ponteiro.dataset.p = '1'; } catch (_) { /* usa z-index */ } }
    }
  }
  function esconderPonteiro() { if (!ui.ponteiro) return; ui.ponteiro.style.opacity = '0'; }
  function limparPagina() { if (ui.pagina) ui.pagina.hidden = true; }
  function aoPonteiro(m) {
    if (!m || !ui.ponteiro) return;
    if (m.tipo === 'sumir') { esconderPonteiro(); return; }
    const aqui = location.pathname + location.hash;
    if (m.pagina && m.pagina !== aqui) {
      esconderPonteiro();
      const [cam, ...resto] = m.pagina.split('#');
      if (seguir && cam === location.pathname && resto.length) { location.hash = '#' + resto.join('#'); return; }
      ui.pagina.hidden = false; ui.paginaBtn.onclick = () => { location.href = m.pagina; };
      return;
    }
    limparPagina();
    let px, py;
    if (m.alvo) { try { const a = document.querySelector(m.alvo); if (a && m.fx !== null) { const r = a.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { px = r.left + m.fx * r.width; py = r.top + m.fy * r.height; } } } catch (_) { /* seletor inválido */ } }
    if (px === undefined) { px = m.x * innerWidth; py = m.y * innerHeight; }
    promover();
    ui.ponteiro.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
    ui.ponteiro.style.opacity = '1';
    if (m.tipo === 'clique') {
      const o = el('div', 'sg-onda'); o.style.left = Math.round(px) + 'px'; o.style.top = Math.round(py) + 'px';
      document.body.appendChild(o); setTimeout(() => o.remove(), 800);
    }
  }

  /* ---------- tela ---------- */
  function desenhar() {
    if (!ui.painel) return;
    const p = ui.corpo; p.textContent = '';
    ui.botao.textContent = est ? 'Sala ' + est.codigo : 'Sala guiada';
    if (ui.ponteiroNome && est) ui.ponteiroNome.textContent = est.condutorNome || (lista.find((x) => x.condutor) || {}).nome || 'Condutor';
    if (!est) {
      p.appendChild(el('p', 'sg-ajuda', 'Entre com o código de 5 letras que quem conduz informou. Use fone de ouvido para evitar eco.'));
      const linha = el('div', 'sg-linha');
      ui.codigo = el('input'); ui.codigo.placeholder = 'CÓDIGO'; ui.codigo.maxLength = 8; ui.codigo.autocomplete = 'off'; ui.codigo.setAttribute('aria-label', 'Código da sala');
      ui.codigo.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
      const b = el('button', null, 'Entrar'); b.onclick = entrar;
      linha.append(ui.codigo, b); p.appendChild(linha);
      if (ui.podeCriar) { const c = el('button', 'sg-sec', 'Criar sala (eu conduzo)'); c.onclick = criar; p.appendChild(c); }
    } else {
      p.appendChild(el('div', 'sg-codigo', est.codigo));
      p.appendChild(el('p', 'sg-ajuda', est.condutor ? 'Você conduz. Passe este código a quem vai acompanhar.' : 'Quem conduz: ' + (est.condutorNome || '') + '. Acompanhe a bolinha na sua tela.'));
      ui.lista = el('ul', 'sg-lista'); p.appendChild(ui.lista); desenharLista();
      const mic = el('button', mudo ? '' : 'sg-aberto', stream ? (mudo ? 'Ligar microfone' : 'Desligar microfone') : 'Sem microfone (só ouvindo)');
      mic.disabled = !stream; mic.onclick = () => alternarMicrofone(); p.appendChild(mic);
      if (est.condutor) {
        const l = el('div', 'sg-linha');
        const ap = el('button', 'sg-sec', 'Apontador: ' + (apontador ? 'ligado' : 'desligado'));
        ap.onclick = () => { apontador = !apontador; if (!apontador && est) api('POST', '/api/sala/ponteiro', { codigo: est.codigo, eu: est.eu, dados: { tipo: 'sumir' } }).catch(() => {}); desenhar(); };
        const si = el('button', 'sg-sec', 'Silenciar todos'); si.onclick = () => api('POST', '/api/sala/silenciar', { codigo: est.codigo, eu: est.eu }).catch((e) => aviso(e.message, true));
        l.append(ap, si); p.appendChild(l);
      } else {
        const lab = el('label', 'sg-seguir'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = seguir; cb.onchange = () => { seguir = cb.checked; };
        lab.append(cb, document.createTextNode(' Acompanhar a tela de quem conduz (dentro da mesma área)')); p.appendChild(lab);
      }
      const ts = el('button', tela ? 'sg-aberto' : 'sg-sec', tela ? 'Parar de compartilhar a tela' : 'Compartilhar minha tela');
      ts.onclick = () => (tela ? pararTela(true) : compartilharTela()); p.appendChild(ts);
      p.appendChild(el('p', 'sg-ajuda', tela ? 'Todos estão vendo a sua tela. Para mostrar o sistema inteiro, mude de janela à vontade: a tela compartilhada acompanha.' : 'Mostra a sua tela a todos da sala. Escolha "Tela inteira" para poder trocar de janela.'));
      if (!est.condutor) { const as = el('button', 'sg-sec', 'Assumir a condução'); as.onclick = () => api('POST', '/api/sala/assumir', { codigo: est.codigo, eu: est.eu }).catch((e) => aviso(e.message, true)); p.appendChild(as); }
      const det = el('details', 'sg-disp'); det.appendChild(el('summary', null, 'Microfone e fone'));
      det.addEventListener('toggle', () => { if (det.open) preencherDispositivos(det); });
      p.appendChild(det);
      ui.sair = el('button', 'sg-sair', est.condutor ? 'Encerrar sala' : 'Sair da sala'); ui.sair.onclick = sair; p.appendChild(ui.sair);
    }
    ui.msg = el('div', 'sg-msg' + (ultimaMsg.ruim ? ' sg-ruim' : ''), ultimaMsg.t); p.appendChild(ui.msg);
  }
  function desenharLista() {
    if (!ui.lista || !est) return;
    ui.lista.textContent = '';
    for (const x of lista) {
      const li = el('li'); li.dataset.id = x.id;
      li.append(el('span', 'sg-nome', x.nome + (x.id === est.eu ? ' (você)' : '') + (x.condutor ? ' · conduz' : '')), el('span', 'sg-estado', !x.online ? 'sem conexão' : (x.mudo ? 'mudo' : 'microfone aberto')));
      ui.lista.appendChild(li);
    }
    if (ui.ponteiroNome) ui.ponteiroNome.textContent = est.condutorNome || (lista.find((x) => x.condutor) || {}).nome || 'Condutor';
  }
  async function preencherDispositivos(det) {
    while (det.children.length > 1) det.removeChild(det.lastChild);
    let d = []; try { d = await navigator.mediaDevices.enumerateDevices(); } catch (_) { /* ok */ }
    const seletor = (rotulo, tipo, atual, aoTrocar) => {
      const itens = d.filter((x) => x.kind === tipo); if (!itens.length) return;
      const sel = el('select'); sel.setAttribute('aria-label', rotulo);
      itens.forEach((x, i) => { const o = el('option', null, x.label || (rotulo + ' ' + (i + 1))); o.value = x.deviceId; if (x.deviceId === atual) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => aoTrocar(sel.value); det.append(el('label', null, rotulo), sel);
    };
    seletor('Microfone', 'audioinput', devEntrada, trocarMicrofone);
    if (HTMLMediaElement.prototype.setSinkId) seletor('Fone / caixa de som', 'audiooutput', devSaida, trocarSaida);
    else det.appendChild(el('p', 'sg-ajuda', 'Neste navegador a saída de som é a do sistema (escolha o fone nas configurações do computador).'));
  }

  function montar() {
    ui.botao = el('button', 'sg-botao', 'Sala guiada'); ui.botao.type = 'button';
    ui.painel = el('div', 'sg-painel'); ui.painel.hidden = true; ui.painel.setAttribute('role', 'dialog'); ui.painel.setAttribute('aria-label', 'Sala guiada');
    const topo = el('div', 'sg-topo'); topo.appendChild(el('strong', null, 'Sala guiada'));
    const fechar = el('button', 'sg-x', '×'); fechar.setAttribute('aria-label', 'Recolher painel'); fechar.onclick = () => { ui.painel.hidden = true; };
    topo.appendChild(fechar);
    ui.corpo = el('div', 'sg-corpo');
    ui.som = el('button', 'sg-som', 'Toque aqui para ativar o som'); ui.som.hidden = true; ui.som.onclick = ativarSom;
    ui.audios = el('div'); ui.audios.hidden = true;
    ui.painel.append(topo, ui.som, ui.corpo, ui.audios);
    ui.botao.onclick = () => { ui.painel.hidden = !ui.painel.hidden; };
    ui.pagina = el('div', 'sg-pagina'); ui.pagina.hidden = true;
    ui.pagina.appendChild(el('span', null, 'Quem conduz está em outra tela. '));
    ui.paginaBtn = el('button', null, 'Ir para lá'); ui.pagina.appendChild(ui.paginaBtn);
    ui.ponteiro = el('div', 'sg-ponteiro'); ui.ponteiro.setAttribute('popover', 'manual'); ui.ponteiro.setAttribute('aria-hidden', 'true');
    ui.ponteiro.append(el('span', 'sg-ponta'), ui.ponteiroNome = el('span', 'sg-etiqueta', ''));
    ui.tela = el('div', 'sg-tela'); ui.tela.hidden = true;
    const cab = el('div', 'sg-tela-cab'); ui.telaNome = el('strong', null, 'Tela compartilhada');
    const cheia = el('button', null, 'Tela cheia'); cheia.onclick = () => { if (ui.video.requestFullscreen) ui.video.requestFullscreen().catch(() => {}); };
    const rec = el('button', null, 'Esconder'); rec.onclick = () => { ui.tela.hidden = true; };
    cab.append(ui.telaNome, cheia, rec);
    ui.video = document.createElement('video'); ui.video.autoplay = true; ui.video.muted = true; ui.video.setAttribute('playsinline', '');
    ui.tela.append(cab, ui.video);
    document.body.append(ui.botao, ui.painel, ui.pagina, ui.ponteiro, ui.tela);
    if (ui.ponteiro.showPopover) { try { ui.ponteiro.showPopover(); ui.ponteiro.dataset.p = '1'; } catch (_) { /* ok */ } }
    desenhar();
  }

  async function iniciar() {
    if (ui.botao) return;
    let e;
    try { e = await api('GET', '/api/sala/estado'); } catch (_) { return; } // sem login ou sem a rota: não mostra nada
    ui.podeCriar = !!e.podeCriar;
    montar();
    const antes = lembrado();
    if (antes) { // voltou de outra página: retoma a mesma sala
      try { const info = await api('GET', '/api/sala/retomar?codigo=' + encodeURIComponent(antes.codigo) + '&eu=' + encodeURIComponent(antes.eu)); await abrir(info); ui.som.hidden = false; } catch (_) { guardar(null); }
    }
  }
  // Para conferir se o áudio ligou de verdade (útil quando a rede da SES bloqueia): SalaGuiada.diagnostico() no console.
  function diagnostico() { return [...pcs.entries()].map(([id, r]) => ({ com: (lista.find((x) => x.id === id) || {}).nome || id, conexao: r.pc.connectionState, ice: r.pc.iceConnectionState })); }
  window.SalaGuiada = { iniciar, sair: sairLocal, diagnostico };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
