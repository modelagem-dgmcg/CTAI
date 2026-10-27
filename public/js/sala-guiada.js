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
  const semAudio = new Set();     // ids com quem o áudio não ligou depois de várias tentativas
  let vigia = null;
  let ctx = null, timerFala = null;
  let apontador = true, seguir = true, ultimo = null, voando = false, pendMover = null, dialogosAbertos = 0;
  let devEntrada = '', devSaida = '', confirmando = false;
  let saindoDaPagina = false;     // a página está sendo trocada ou recarregada: não é queda da sala
  window.addEventListener('pagehide', () => { saindoDaPagina = true; }); window.addEventListener('beforeunload', () => { saindoDaPagina = true; });
  let tela = null;                // minha tela, quando estou compartilhando
  let quemMostra = '';            // nome de quem está compartilhando comigo
  let operando = null;            // id de quem eu estou operando (só o app dele)
  let operador = null;            // { id, nome } de quem opera o meu app
  let pedido = null;              // id a quem pedi permissão para operar
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
      stream.getAudioTracks().forEach((t) => { t.enabled = !mudo; try { t.contentHint = 'speech'; } catch (_) { /* ok */ } });
    } catch (e) {
      stream = null;
      erroMic = e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'bloqueado' : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'ausente' : e.name === 'NotReadableError' ? 'ocupado' : 'outro';
      aviso(textoErroMic(), true);
    }
  }
  let erroMic = '';
  function textoErroMic() {
    if (erroMic === 'bloqueado') return 'O navegador bloqueou o microfone deste site. Clique no cadeado ao lado do endereço, escolha Microfone > Permitir e clique em "Permitir microfone".';
    if (erroMic === 'ausente') return 'Não encontrei nenhum microfone neste computador. Ligue um fone com microfone e clique em "Permitir microfone".';
    if (erroMic === 'ocupado') return 'Outro programa está usando o microfone (Teams, Zoom ou outra aba). Feche-o e clique em "Permitir microfone".';
    return 'Não consegui ligar o microfone. Clique em "Permitir microfone" para tentar de novo.';
  }
  // Tenta de novo depois que a pessoa liberou o microfone no navegador, sem sair da sala.
  async function tentarMicrofone() {
    await pegarMicrofone();
    if (!stream) { desenhar(); return; }
    const trilha = stream.getAudioTracks()[0]; erroMic = ''; aviso('Microfone liberado. Ele está desligado: clique em "Ligar" para falar.');
    for (const reg of pcs.values()) { const s = reg.audioSender || reg.pc.getSenders().find((x) => !x.track || x.track.kind === 'audio'); if (s) s.replaceTrack(trilha).catch(() => {}); }
    medir(est.eu, stream); desenhar();
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
    const reg = { pc, iniciador, desde: Date.now() };
    pcs.set(id, reg);
    if (stream) stream.getAudioTracks().forEach((t) => { reg.audioSender = pc.addTrack(t, stream); });
    else reg.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender; // sem microfone agora: a vaga fica aberta para ligar depois sem refazer a conexão
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
      if (pc.connectionState === 'connected') { tentativas.set(id, 0); semAudio.delete(id); reg.pronto = true; if (tela) renegociar(id); }
      if (pc.connectionState === 'disconnected' && iniciador) setTimeout(() => { if (pcs.get(id) === reg && pc.connectionState === 'disconnected') { try { pc.restartIce(); } catch (_) { /* ok */ } } }, 3000);
      if (est) { desenharBarra(); desenharLista(); }
      if (pc.connectionState === 'failed' && pcs.get(id) === reg) {
        fecharPc(id);
        const n = (tentativas.get(id) || 0) + 1; tentativas.set(id, n);
        if (n <= 5) setTimeout(sincronizar, 1500 * n); else falhaAudio(id);
      }
    };
    return reg;
  }
  // Estado simples do áudio com cada pessoa: ok, conectando ou falhou.
  function estadoAudio(id) {
    if (semAudio.has(id)) return 'falhou';
    const r = pcs.get(id); if (!r) return 'conectando';
    return r.pc.connectionState === 'connected' ? 'ok' : (r.pc.connectionState === 'failed' ? 'falhou' : 'conectando');
  }
  function falhaAudio(id) {
    if (semAudio.has(id)) return;
    semAudio.add(id);
    aviso('Não consegui ligar o áudio com ' + nomeDe(id) + '. Quase sempre é bloqueio da rede (a conexão de voz usa portas que alguns firewalls fecham). Peça à TI para liberar UDP ou configurar um servidor TURN (CTAI_SALA_ICE). A tela e o apontador continuam funcionando.', true);
    desenharBarra(); desenharLista();
  }
  // A cada 3 s: refaz a conexão que ficou presa (um sinal perdido deixa tudo "conectando" para sempre) e reabre o som se o navegador o travou.
  function vigiar() {
    clearInterval(vigia);
    vigia = setInterval(() => {
      if (!est) return;
      for (const [id, r] of [...pcs.entries()]) {
        if (r.pc.connectionState === 'connected' || !r.iniciador || Date.now() - r.desde < 12000) continue;
        fecharPc(id);
        const n = (tentativas.get(id) || 0) + 1; tentativas.set(id, n);
        if (n <= 4) setTimeout(sincronizar, 300); else falhaAudio(id);
      }
      for (const a of audios.values()) if (a.paused && a.srcObject && ui.som) ui.som.hidden = false;
    }, 3000);
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
      if (!p.online) { fecharPc(p.id); semAudio.delete(p.id); tentativas.delete(p.id); continue; }
      if (!pcs.has(p.id) && est.eu > p.id && !semAudio.has(p.id)) ligar(p.id);
    }
    for (const id of [...pcs.keys()]) if (!lista.some((p) => p.id === id)) fecharPc(id);
    if (operando && !lista.some((p) => p.id === operando && p.online)) { operando = null; desenhar(); }
    if (operador && !lista.some((p) => p.id === operador.id && p.online)) encerrarOperador(false);
  }
  async function ligar(id) {
    const { pc } = criarPc(id, true);
    try { await pc.setLocalDescription(afinar(await pc.createOffer())); sinalar(id, { tipo: 'oferta', sdp: pc.localDescription }); } catch (_) { fecharPc(id); }
  }
  async function aoReceberSinal(de, d) {
    if (!est || !d) return;
    try {
      if (d.tipo === 'apresentando') { if (tela) pararTela(false); quemMostra = d.nome || ''; return; }
      if (d.tipo === 'parou') { esconderTela(de); return; }
      if (d.tipo === 'ctl-pedir') { receberPedido(de, d); return; }
      if (d.tipo === 'ctl-resp') { if (pedido !== de) return; pedido = null; if (d.ok) { operando = de; aviso('Você está operando o sistema de ' + nomeDe(de) + '. Clique na imagem da tela dela.'); registrar('operacao_iniciada', nomeDe(de)); } else aviso(nomeDe(de) + ' não permitiu a operação.', true); desenhar(); return; }
      if (d.tipo === 'ctl-parar') { if (operando === de) { operando = null; pedido = null; aviso(nomeDe(de) + ' encerrou a operação.'); } if (operador && operador.id === de) encerrarOperador(false); desenhar(); return; }
      if (d.tipo === 'ctl-ev') { if (operador && operador.id === de) aplicar(d); return; }
      if (d.tipo === 'oferta') {
        const velho = pcs.get(de);
        let pc;
        if (d.reneg && velho && velho.pc.signalingState !== 'closed') { pc = velho.pc; if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' }).catch(() => {}); }
        else pc = criarPc(de, false).pc;
        await pc.setRemoteDescription(d.sdp); await esvaziar(de, pc);
        await pc.setLocalDescription(afinar(await pc.createAnswer()));
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
  // Voz mais clara: Opus em mono, 64 kbps, com correção de perda de pacotes.
  function afinar(d) {
    if (!d || !d.sdp) return d;
    const sdp = d.sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec[^\r\n]*)/g, (m, pt, par) => (/maxaveragebitrate/.test(par) ? m : 'a=fmtp:' + pt + ' ' + par + ';maxaveragebitrate=64000;stereo=0;sprop-stereo=0'));
    return { type: d.type, sdp };
  }
  async function renegociar(id) {
    const r = pcs.get(id); if (!r || r.pc.signalingState !== 'stable') return;
    try { await r.pc.setLocalDescription(afinar(await r.pc.createOffer())); sinalar(id, { tipo: 'oferta', reneg: true, sdp: r.pc.localDescription }); } catch (_) { /* tenta na próxima mudança */ }
  }
  // ---------- operar o app de outra pessoa (só a aba do sistema, só com a permissão dela) ----------
  const nomeDe = (id) => (lista.find((x) => x.id === id) || {}).nome || 'participante';
  const registrar = (acao, com) => { if (est) api('POST', '/api/sala/registro', { codigo: est.codigo, eu: est.eu, acao, com }).catch(() => {}); };
  function pedirOperar(id) {
    if (pedido || operando) return;
    pedido = id; sinalar(id, { tipo: 'ctl-pedir', nome: nomeDe(est.eu) });
    aviso('Pedido enviado a ' + nomeDe(id) + '. Aguarde a permissão.'); desenhar();
    setTimeout(() => { if (pedido === id) { pedido = null; aviso(nomeDe(id) + ' não respondeu ao pedido.', true); desenhar(); } }, 60000);
  }
  function pararOperar() { if (!operando) return; const id = operando; operando = null; sinalar(id, { tipo: 'ctl-parar' }); registrar('operacao_encerrada', nomeDe(id)); aviso('Você parou de operar.'); desenhar(); }
  function receberPedido(de, d) {
    const quem = lista.find((x) => x.id === de);
    if (!est || !quem || !quem.condutor || operador) { sinalar(de, { tipo: 'ctl-resp', ok: false }); return; } // só quem conduz pode pedir
    const cx = el('div', 'sg-convite'); cx.setAttribute('role', 'alertdialog');
    cx.append(el('strong', null, quem.nome + ' pede para operar o seu sistema'),
      el('p', null, 'Você vai mostrar a aba do sistema. Ele(a) poderá clicar e digitar nela, e você verá tudo acontecer. Senhas não são digitadas por ele(a). Você pode parar a qualquer momento.'));
    const l = el('div', 'sg-linha');
    const sim = el('button', null, 'Permitir'); sim.onclick = async () => {
      cx.remove();
      const ok = tela ? true : await compartilharTela(true);
      if (!ok) { sinalar(de, { tipo: 'ctl-resp', ok: false }); return; }
      operador = { id: de, nome: quem.nome }; desenhar();
      sinalar(de, { tipo: 'ctl-resp', ok: true }); registrar('operacao_autorizada', quem.nome);
    };
    const nao = el('button', 'sg-sec', 'Agora não'); nao.onclick = () => { cx.remove(); sinalar(de, { tipo: 'ctl-resp', ok: false }); };
    l.append(sim, nao); cx.appendChild(l); document.body.appendChild(cx);
  }
  function encerrarOperador(avisarOutro) {
    if (!operador) return; const o = operador; operador = null;
    if (avisarOutro) sinalar(o.id, { tipo: 'ctl-parar' });
    registrar('operacao_encerrada', o.nome); esconderPonteiro(); desenhar();
  }
  const VEDADO = '.sg-painel,.sg-botao,.sg-barra,.sg-tela,.sg-convite,.sg-ponteiro,.sg-pagina';
  function focaveis() {
    return [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && !n.closest(VEDADO) && n.type !== 'hidden' && n.offsetParent !== null);
  }
  function aplicar(d) {
    const alvoEm = () => { const e = document.elementFromPoint(d.x * innerWidth, d.y * innerHeight); return e && !e.closest(VEDADO) ? e : null; };
    if (d.t === 'mv' || d.t === 'click') {
      if (ui.ponteiroNome) ui.ponteiroNome.textContent = operador.nome;
      aoPonteiro({ tipo: d.t === 'click' ? 'clique' : 'mover', alvo: '', fx: null, fy: null, x: d.x, y: d.y, pagina: location.pathname + location.hash });
    }
    if (d.t === 'click') {
      const e = alvoEm(); if (!e) return;
      const o = { bubbles: true, cancelable: true, view: window, clientX: d.x * innerWidth, clientY: d.y * innerHeight };
      e.dispatchEvent(new MouseEvent('mousedown', o));
      const f = e.closest('input,textarea,select,button,a,[tabindex]'); if (f && f.focus) f.focus();
      e.dispatchEvent(new MouseEvent('mouseup', o));
      if (e.click) e.click(); else e.dispatchEvent(new MouseEvent('click', o));
    } else if (d.t === 'wheel') {
      let e = alvoEm(), rolou = false;
      while (e && e !== document.body && e !== document.documentElement) {
        const oy = getComputedStyle(e).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) { e.scrollBy({ top: Number(d.dy) || 0 }); rolou = true; break; }
        e = e.parentElement;
      }
      if (!rolou) window.scrollBy({ top: Number(d.dy) || 0 });
    } else if (d.t === 'key') {
      const a = document.activeElement; if (!a || a.closest(VEDADO)) return;
      const k = String(d.key || '');
      if (k === 'Tab') { const l = focaveis(); if (!l.length) return; const i = l.indexOf(a); const n = l[(i + (d.shift ? -1 : 1) + l.length) % l.length]; n.focus(); return; }
      const texto = (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|password|range|color|hidden)$/.test(a.type)) || a.tagName === 'TEXTAREA';
      if (a.tagName === 'INPUT' && a.type === 'password') return; // senha: só a própria pessoa digita
      if (texto && !a.readOnly && !a.disabled) {
        const ini = () => { try { return [a.selectionStart, a.selectionEnd]; } catch (_) { return [null, null]; } };
        const poe = (t) => { const [i, f] = ini(); if (i === null) a.value += t; else a.setRangeText(t, i, f, 'end'); a.dispatchEvent(new Event('input', { bubbles: true })); };
        if (k.length === 1) { poe(k); return; }
        if (k === 'Backspace') { const [i, f] = ini(); if (i === null) a.value = a.value.slice(0, -1); else if (i !== f) a.setRangeText('', i, f, 'end'); else if (i > 0) a.setRangeText('', i - 1, i, 'end'); a.dispatchEvent(new Event('input', { bubbles: true })); return; }
        if (k === 'Enter' && a.tagName === 'TEXTAREA') { poe('\n'); return; }
      }
      if (k === 'Enter' || k === ' ') {
        const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
        const livre = a.dispatchEvent(ev);
        if (livre && k === 'Enter' && a.tagName === 'INPUT' && a.form && texto) { if (a.form.requestSubmit) a.form.requestSubmit(); }
        else if (livre && (a.tagName === 'BUTTON' || a.tagName === 'A' || a.tagName === 'SUMMARY')) a.click();
      } else a.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }
  }
  // Quem opera: o que acontece sobre a imagem da tela dela é enviado como posição relativa (0 a 1) e como teclas.
  let tOp = 0, opPend = null, opVoo = false;
  function enviarOp(dados) { if (!operando) return; sinalar(operando, Object.assign({ tipo: 'ctl-ev' }, dados)); }
  function enviarOpMover(dados) { opPend = dados; if (opVoo) return; opVoo = true; const d = opPend; opPend = null; sinalar(operando, Object.assign({ tipo: 'ctl-ev' }, d)).then(() => { opVoo = false; if (opPend) enviarOpMover(opPend); }); }
  function posNaImagem(e) {
    const v = ui.video, vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return null;
    const b = v.getBoundingClientRect(), esc = Math.min(b.width / vw, b.height / vh), w = vw * esc, h = vh * esc;
    const x = (e.clientX - (b.left + (b.width - w) / 2)) / w, y = (e.clientY - (b.top + (b.height - h) / 2)) / h;
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
  }
  function ligarOperacao() {
    ui.video.addEventListener('mousemove', (e) => { if (!operando) return; const t = Date.now(); if (t - tOp < 40) return; tOp = t; const p = posNaImagem(e); if (p) enviarOpMover(Object.assign({ t: 'mv' }, p)); });
    ui.video.addEventListener('click', (e) => { if (!operando) return; ui.tela.focus(); const p = posNaImagem(e); if (p) enviarOp(Object.assign({ t: 'click' }, p)); });
    ui.video.addEventListener('wheel', (e) => { if (!operando) return; e.preventDefault(); const p = posNaImagem(e); if (p) enviarOp(Object.assign({ t: 'wheel', dy: Math.max(-600, Math.min(600, e.deltaY)) }, p)); }, { passive: false });
    ui.tela.addEventListener('keydown', (e) => {
      if (!operando || e.target !== ui.tela || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 || ['Backspace', 'Enter', 'Tab'].includes(e.key)) { e.preventDefault(); enviarOp({ t: 'key', key: e.key, shift: e.shiftKey }); }
    });
  }
  // ---------- compartilhar a tela ----------
  async function compartilharTela(soAba) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { aviso('Este navegador não compartilha tela. Use o Chrome ou o Edge atualizados.', true); return false; }
    let fl;
    try { fl = await navigator.mediaDevices.getDisplayMedia(soAba ? { video: { cursor: 'always' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' } : { video: { cursor: 'always' }, audio: false }); } catch (_) { aviso(soAba ? 'Compartilhamento cancelado. A operação precisa que você mostre a aba do sistema.' : 'Compartilhamento cancelado. Escolha "Tela inteira" para mostrar o sistema todo.'); return false; }
    if (soAba) { const ds = (fl.getVideoTracks()[0].getSettings() || {}).displaySurface; if (ds && ds !== 'browser') { fl.getTracks().forEach((t) => t.stop()); aviso('Você escolheu a tela inteira ou uma janela. Para operar, escolha a ABA do sistema.', true); return false; } }
    tela = fl; aviso('');
    const meu = (lista.find((x) => x.id === est.eu) || {}).nome || '';
    fl.getVideoTracks()[0].onended = () => pararTela(true);
    for (const p of lista) if (p.id !== est.eu && p.online) sinalar(p.id, { tipo: 'apresentando', nome: meu }); // quem estava mostrando a própria tela para
    for (const r of pcs.values()) r.telaSenders = fl.getTracks().map((t) => r.pc.addTrack(t, fl));
    desenhar();
    return true;
  }
  function pararTela(avisar) {
    if (!tela) return;
    if (operador) encerrarOperador(true);
    const fl = tela; tela = null; fl.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    for (const [id, r] of pcs.entries()) { for (const s of r.telaSenders || []) { try { r.pc.removeTrack(s); } catch (_) { /* ok */ } } r.telaSenders = []; if (avisar && est) sinalar(id, { tipo: 'parou' }); }
    desenhar();
  }
  function mostrarTela(id, fl) {
    if (!ui.tela) return;
    const nome = (lista.find((x) => x.id === id) || {}).nome || quemMostra || 'participante';
    ui.tela.dataset.de = id; ui.telaNome.textContent = (operando === id ? 'Operando: ' : 'Tela de ') + nome;
    ui.tela.classList.toggle('sg-operando', operando === id); ui.video.srcObject = fl; ui.video.play().catch(() => {}); ui.tela.hidden = false;
  }
  function esconderTela(id) {
    if (!ui.tela || (id && ui.tela.dataset.de && ui.tela.dataset.de !== id)) return;
    ui.video.srcObject = null; ui.tela.hidden = true; ui.tela.dataset.de = '';
  }
  async function esvaziar(id, pc) { for (const c of pend.get(id) || []) await pc.addIceCandidate(c).catch(() => {}); pend.delete(id); }

  function alternarMicrofone(valor) {
    mudo = valor === undefined ? !mudo : !!valor;
    if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !mudo; });
    try { sessionStorage.setItem('ctai_sala_mic', mudo ? '0' : '1'); } catch (_) { /* ok */ }
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
    es.onerror = () => { if (saindoDaPagina) return; if (es && es.readyState === 2) { sairLocal(); aviso('A conexão com a sala caiu e não voltou. Entre de novo com o código.', true); } };
    ouvirFala(); vigiar(); instalarEmissor();
    ui.botao.classList.add('sg-ativo');
  }

  function sairLocal() {
    if (es) { es.close(); es = null; }
    if (tela) { tela.getTracks().forEach((t) => { t.onended = null; t.stop(); }); tela = null; }
    esconderTela();
    for (const id of [...pcs.keys()]) fecharPc(id);
    for (const a of audios.values()) a.remove();
    audios.clear(); medidores.clear(); pend.clear(); tentativas.clear(); semAudio.clear(); clearInterval(vigia);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (ctx) { try { ctx.close(); } catch (_) { /* ok */ } ctx = null; }
    clearInterval(timerFala); retirarEmissor(); esconderPonteiro(); limparPagina();
    operando = null; operador = null; pedido = null;
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
      confirmando = true; [ui.sair, ui.barraSair].forEach((b) => { if (b) b.textContent = 'Clique de novo para encerrar'; }); setTimeout(() => { confirmando = false; if (ui.sair) ui.sair.textContent = 'Encerrar sala'; if (ui.barraSair) ui.barraSair.textContent = 'Encerrar sala'; }, 4000); return;
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
  let visto = 0, seguindoAgora = false, tSeguindo = null, tRolada = 0;
  function aoPonteiro(m) {
    if (!m || !ui.ponteiro) return;
    if (m.tipo === 'sumir') { esconderPonteiro(); ui.seta.hidden = true; seguindoAgora = false; desenharBarra(); return; }
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
    visto = Date.now(); if (!seguindoAgora) { seguindoAgora = true; desenharBarra(); } clearTimeout(tSeguindo); tSeguindo = setTimeout(() => { seguindoAgora = false; ui.seta.hidden = true; desenharBarra(); }, 5000);
    const fora = px < 0 || py < 0 || px > innerWidth || py > innerHeight;
    if (fora) { // a bolinha está fora da parte visível: seta na borda e, se estiver acompanhando, rola até lá
      const cx = Math.max(30, Math.min(innerWidth - 30, px)), cy = Math.max(70, Math.min(innerHeight - 30, py));
      ui.seta.style.transform = 'translate(' + Math.round(cx) + 'px,' + Math.round(cy) + 'px) rotate(' + Math.round(Math.atan2(py - cy, px - cx) * 180 / Math.PI) + 'deg)'; ui.seta.hidden = false;
      if (seguir && m.alvo && Date.now() - tRolada > 1200) { try { const a = document.querySelector(m.alvo); if (a) { tRolada = Date.now(); a.scrollIntoView({ block: 'center', behavior: 'smooth' }); } } catch (_) { /* ok */ } }
    } else ui.seta.hidden = true;
    ui.ponteiro.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
    ui.ponteiro.style.opacity = '1';
    if (m.tipo === 'clique') {
      const o = el('div', 'sg-onda'); o.style.left = Math.round(px) + 'px'; o.style.top = Math.round(py) + 'px';
      document.body.appendChild(o); setTimeout(() => o.remove(), 800);
    }
  }

  /* ---------- tela ---------- */
  function desenharBarra() {
    if (!ui.barra) return;
    ui.moldura.hidden = !operador;
    if (ui.tela) { const op = !!operando && ui.tela.dataset.de === operando; ui.tela.classList.toggle('sg-operando', op); if (op) ui.telaNome.textContent = 'Operando: ' + nomeDe(operando); }
    if (!est) { ui.barra.hidden = true; return; }
    ui.barra.hidden = false; ui.barra.classList.toggle('sg-alerta', !!operador); ui.barra.textContent = '';
    const chip = (t, on) => ui.barra.appendChild(el('span', 'sg-chip' + (on ? ' sg-on' : ''), t));
    ui.barra.appendChild(el('span', 'sg-ao-vivo', '● Ao vivo'));
    chip(stream ? (mudo ? 'Microfone desligado' : 'Microfone ligado') : 'Só ouvindo', !mudo && !!stream);
    { const outros = lista.filter((x) => x.id !== est.eu && x.online);
      if (outros.length) {
        const ruins = outros.filter((x) => estadoAudio(x.id) === 'falhou'), ok = outros.filter((x) => estadoAudio(x.id) === 'ok');
        chip(ruins.length ? 'Áudio com falha: ' + ruins.map((x) => x.nome).join(', ') : (ok.length === outros.length ? 'Áudio conectado' : 'Áudio conectando…'), !ruins.length && ok.length === outros.length);
      } }
    if (est.condutor) chip('Apontador ' + (apontador ? 'ligado' : 'desligado'), apontador);
    else if (seguindoAgora) ui.barra.appendChild(el('span', 'sg-siga', '👆 ' + (est.condutorNome || 'Quem conduz') + ' está mostrando. Siga a bolinha'));
    if (tela) chip('Sua tela está sendo mostrada', true);
    if (operando) chip('Você opera o sistema de ' + nomeDe(operando), true);
    if (operador) chip(operador.nome + ' está operando o seu sistema', true);
    const painel = el('button', null, 'Painel'); painel.onclick = () => { ui.painel.hidden = !ui.painel.hidden; };
    ui.barra.appendChild(painel);
    if (operando) { const b = el('button', 'sg-sec', 'Parar de operar'); b.onclick = pararOperar; ui.barra.appendChild(b); }
    if (operador) { const b = el('button', 'sg-vermelho', 'PARAR AGORA'); b.onclick = () => encerrarOperador(true); ui.barra.appendChild(b); }
    ui.barraSair = el('button', 'sg-sec', est.condutor ? 'Encerrar sala' : 'Sair'); ui.barraSair.onclick = () => sair(); ui.barra.appendChild(ui.barraSair);
  }
  function desenhar() {
    if (!ui.painel) return;
    const p = ui.corpo; p.textContent = '';
    ui.botao.textContent = est ? 'Ao vivo · ' + est.codigo : 'Ajuda ao vivo';
    desenharBarra();
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
      p.appendChild(el('p', 'sg-ajuda', est.condutor ? 'Você conduz. Passe este código a quem vai acompanhar.' : 'Quem conduz: ' + (est.condutorNome || '') + '.'));
      ui.lista = el('ul', 'sg-lista'); p.appendChild(ui.lista); desenharLista();
      const chave = (titulo, ligado, texto, acao, desab) => {
        const l = el('div', 'sg-chave' + (ligado ? ' sg-lig' : '')); const t = el('div', 'sg-chave-t');
        t.append(el('strong', null, titulo), el('span', null, texto));
        const b = el('button', ligado ? 'sg-aberto' : '', ligado ? 'Desligar' : 'Ligar'); b.disabled = !!desab; b.onclick = acao;
        l.append(t, b); p.appendChild(l);
      };
      if (stream) chave('Microfone', !mudo, mudo ? 'Desligado: ninguém ouve você' : 'Ligado: todos ouvem você', () => alternarMicrofone());
      else { const l = el('div', 'sg-chave sg-falta'); const t = el('div', 'sg-chave-t'); t.append(el('strong', null, 'Microfone'), el('span', null, erroMic ? textoErroMic() : 'Ainda não liberado. Clique em "Permitir microfone".')); const b = el('button', 'sg-aberto', 'Permitir microfone'); b.onclick = tentarMicrofone; l.append(t, b); p.appendChild(l); }
      if (est.condutor) chave('Apontador', apontador, apontador ? 'Ligado: todos veem sua bolinha' : 'Desligado', () => { apontador = !apontador; if (!apontador && est) api('POST', '/api/sala/ponteiro', { codigo: est.codigo, eu: est.eu, dados: { tipo: 'sumir' } }).catch(() => {}); desenhar(); });
      chave('Mostrar minha tela', !!tela, tela ? 'Ligado: todos veem sua tela' : 'Desligado', () => (tela ? pararTela(true) : compartilharTela()));
      if (est.condutor) {
        for (const x of lista) {
          if (x.id === est.eu || !x.online) continue;
          const ativo = operando === x.id;
          chave('Operar a tela de ' + x.nome, ativo, ativo ? 'Ligado: você clica e digita no sistema dela' : (pedido === x.id ? 'Aguardando a permissão…' : 'Desligado. Ela precisa permitir'), () => (ativo ? pararOperar() : pedirOperar(x.id)), !!pedido && pedido !== x.id);
        }
      } else if (operador) chave('Deixar ' + operador.nome + ' operar', true, 'Ligado: ele(a) clica e digita no seu sistema', () => encerrarOperador(true));
      if (est.condutor) {
        const si = el('button', 'sg-sec', 'Silenciar todos'); si.onclick = () => api('POST', '/api/sala/silenciar', { codigo: est.codigo, eu: est.eu }).catch((e) => aviso(e.message, true));
        p.appendChild(si);
        const cv = el('div', 'sg-linha'); const sel = el('select'); sel.setAttribute('aria-label', 'Quem convidar');
        [['online', 'Quem está no sistema agora'], ['equipe', 'Toda a equipe da CTAI'], ['todos', 'Todas as pessoas com acesso']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sel.appendChild(o); });
        const bc = el('button', null, 'Convidar'); bc.onclick = async () => { try { const o = await api('POST', '/api/sala/convidar', { codigo: est.codigo, eu: est.eu, quem: sel.value }); aviso(o.convidados ? 'Convite enviado a ' + o.convidados + ' pessoa(s).' : 'Ninguém para convidar nesse grupo agora.'); } catch (e) { aviso(e.message, true); } };
        cv.append(sel, bc); p.appendChild(cv);
      } else {
        const lab = el('label', 'sg-seguir'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = seguir; cb.onchange = () => { seguir = cb.checked; };
        lab.append(cb, document.createTextNode(' Acompanhar a tela de quem conduz (dentro da mesma área)')); p.appendChild(lab);
        const as = el('button', 'sg-sec', 'Assumir a condução'); as.onclick = () => api('POST', '/api/sala/assumir', { codigo: est.codigo, eu: est.eu }).catch((e) => aviso(e.message, true)); p.appendChild(as);
      }
      const det = el('details', 'sg-disp'); det.appendChild(el('summary', null, 'Microfone e fone'));
      det.addEventListener('toggle', () => { if (det.open) preencherDispositivos(det); });
      p.appendChild(det);
      ui.sair = el('button', 'sg-sair', est.condutor ? 'Encerrar sala' : 'Sair da sala'); ui.sair.onclick = () => sair(); p.appendChild(ui.sair); { const aj = el('a', 'sg-ajuda', 'Como funciona (manual com imagens)'); aj.href = '/ajuda/sala-guiada.html'; aj.target = '_blank'; aj.rel = 'noopener'; aj.style.cssText = 'display:block;margin-top:8px;font-size:13px;color:#d97706;text-align:center'; p.appendChild(aj); }
    }
    ui.msg = el('div', 'sg-msg' + (ultimaMsg.ruim ? ' sg-ruim' : ''), ultimaMsg.t); p.appendChild(ui.msg);
  }
  let assinatura = '';
  function desenharLista() {
    if (!ui.lista || !est) return;
    const ass = lista.map((x) => x.id + (x.online ? '1' : '0') + (x.id === est.eu ? '' : estadoAudio(x.id))).join(',');
    if (ass !== assinatura) { assinatura = ass; desenhar(); return; } // entrou ou saiu alguém: refaz os botões
    ui.lista.textContent = '';
    for (const x of lista) {
      const li = el('li'); li.dataset.id = x.id;
      li.append(el('span', 'sg-nome', x.nome + (x.id === est.eu ? ' (você)' : '') + (x.condutor ? ' · conduz' : '')), el('span', 'sg-estado', !x.online ? 'sem conexão' : (x.mudo ? 'mudo' : 'microfone aberto') + (x.id === est.eu ? '' : ' · áudio ' + ({ ok: 'conectado', conectando: 'conectando…', falhou: 'com falha' })[estadoAudio(x.id)])));
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
    ui.botao = el('button', 'sg-botao', 'Ajuda ao vivo'); ui.botao.type = 'button';
    ui.painel = el('div', 'sg-painel'); ui.painel.hidden = true; ui.painel.setAttribute('role', 'dialog'); ui.painel.setAttribute('aria-label', 'Ajuda ao vivo');
    const topo = el('div', 'sg-topo'); topo.appendChild(el('strong', null, 'Ajuda ao vivo'));
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
    ui.seta = el('div', 'sg-seta', '➤'); ui.seta.hidden = true; ui.seta.setAttribute('aria-hidden', 'true');
    ui.barra = el('div', 'sg-barra'); ui.barra.hidden = true; ui.barra.setAttribute('role', 'status');
    ui.moldura = el('div', 'sg-moldura'); ui.moldura.hidden = true;
    ui.tela = el('div', 'sg-tela'); ui.tela.hidden = true; ui.tela.tabIndex = 0;
    const cab = el('div', 'sg-tela-cab'); ui.telaNome = el('strong', null, 'Tela compartilhada');
    const cheia = el('button', null, 'Tela cheia'); cheia.onclick = () => { if (ui.video.requestFullscreen) ui.video.requestFullscreen().catch(() => {}); };
    const rec = el('button', null, 'Esconder'); rec.onclick = () => { ui.tela.hidden = true; };
    cab.append(ui.telaNome, cheia, rec);
    ui.video = document.createElement('video'); ui.video.autoplay = true; ui.video.muted = true; ui.video.setAttribute('playsinline', '');
    ui.tela.append(cab, ui.video);
    document.body.append(ui.botao, ui.painel, ui.barra, ui.seta, ui.moldura, ui.pagina, ui.ponteiro, ui.tela);
    ligarOperacao();
    if (ui.ponteiro.showPopover) { try { ui.ponteiro.showPopover(); ui.ponteiro.dataset.p = '1'; } catch (_) { /* ok */ } }
    desenhar();
  }

  async function iniciar() {
    if (ui.botao) return;
    let e;
    try { e = await api('GET', '/api/sala/estado'); } catch (_) { return; } // sem login ou sem a rota: não mostra nada
    ui.podeCriar = !!e.podeCriar;
    montar();
    setTimeout(verConvites, 1500);
    const antes = lembrado();
    if (antes) { // voltou de outra página: retoma a mesma sala
      try {
        const info = await api('GET', '/api/sala/retomar?codigo=' + encodeURIComponent(antes.codigo) + '&eu=' + encodeURIComponent(antes.eu));
        let micAberto = false; try { micAberto = sessionStorage.getItem('ctai_sala_mic') === '1'; } catch (_) { /* ok */ }
        await abrir(info);
        if (micAberto && stream) alternarMicrofone(false); // voltou para a sala com o microfone como estava
        ui.som.hidden = false; ui.painel.hidden = false; aviso('Você voltou para a sala. Toque em "ativar o som" para voltar a ouvir.');
      } catch (_) { guardar(null); }
    }
  }
  /* ---------- convites ---------- */
  const vistos = new Set();
  async function verConvites() {
    if (est || document.hidden || !ui.botao || /^ctai-/.test(window.name)) return;
    let o; try { o = await api('GET', '/api/sala/convites'); } catch (_) { return; }
    const c = (o.convites || []).find((x) => !vistos.has(x.codigo)); if (!c) return;
    vistos.add(c.codigo);
    const cx = el('div', 'sg-convite'); cx.setAttribute('role', 'alertdialog');
    cx.append(el('strong', null, c.de + ' chamou você para uma Ajuda ao vivo'), el('p', null, 'Você vai ouvir a pessoa e ver o que ela mostrar. Seu microfone começa desligado.'));
    const l = el('div', 'sg-linha');
    const sim = el('button', null, 'Entrar agora'); sim.onclick = async () => { cx.remove(); preparar(); try { await abrir(await api('POST', '/api/sala/entrar', { codigo: c.codigo })); ui.painel.hidden = false; } catch (e) { ui.painel.hidden = false; aviso(e.message, true); } };
    const nao = el('button', 'sg-sec', 'Agora não'); nao.onclick = () => { cx.remove(); api('POST', '/api/sala/convites/recusar', { codigo: c.codigo }).catch(() => {}); };
    l.append(sim, nao); cx.appendChild(l); document.body.appendChild(cx);
  }
  setInterval(verConvites, 8000);

  // Para conferir se o áudio ligou de verdade (útil quando a rede da SES bloqueia): SalaGuiada.diagnostico() no console.
  function diagnostico() { return [...pcs.entries()].map(([id, r]) => ({ com: (lista.find((x) => x.id === id) || {}).nome || id, conexao: r.pc.connectionState, ice: r.pc.iceConnectionState, audio: estadoAudio(id) })); }
  // Bytes de áudio recebidos de cada pessoa (se ficar em 0 com a pessoa falando, o áudio não está chegando).
  async function recebido() { const o = []; for (const [id, r] of pcs.entries()) { let b = 0; try { (await r.pc.getStats()).forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'audio') b += x.bytesReceived || 0; }); } catch (_) { /* ok */ } o.push({ com: nomeDe(id), bytes: b }); } return o; }
  window.SalaGuiada = { iniciar, sair: sairLocal, diagnostico, recebido, estadoAudio };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
