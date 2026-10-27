'use strict';
// Ajuda ao vivo: duas pessoas, áudio/tela simulados, e uma opera o sistema da outra (só a aba, só com permissão).
const H = require('../helpers');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const SENHA = 'Senha@12345';
(async () => {
  const S = await H.iniciar(); const base = S.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required'] });
  let p0;
  const abrir = async (login, semMic) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'pt-BR' });
    if (!semMic) await ctx.grantPermissions(['microphone']).catch(() => {});
    p0 = ctx;
    const p = await ctx.newPage(); p.erros = [];
    if (semMic) await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let n = 0; navigator.mediaDevices.getUserMedia = (c) => (n++ === 0 ? Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) : g(c)); }); // 1ª tentativa: bloqueado
    p.on('pageerror', (e) => p.erros.push(e.message));
    await p.goto(base + '/'); await p.fill('#login', login); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 8000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', SENHA); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }); }
    await p.waitForSelector('.sg-botao');
    p.ctx = ctx; return p;
  };
  try {
    const eu = await abrir('cleuton', true), ela = await abrir('colega1');
    assert.equal(await eu.textContent('.sg-botao'), 'Ajuda ao vivo');
    await eu.click('.sg-botao'); await eu.click('.sg-painel button:has-text("Criar sala")');
    await eu.waitForSelector('.sg-codigo'); const codigo = await eu.textContent('.sg-codigo');
    await eu.waitForSelector('.sg-barra:not([hidden])');
    // microfone bloqueado no navegador: aparece o motivo e o botão para tentar de novo
    await eu.waitForSelector('.sg-chave.sg-falta button:has-text("Permitir microfone")');
    assert.match(await eu.textContent('.sg-chave.sg-falta'), /bloqueou o microfone/);
    await eu.ctx.grantPermissions(['microphone']); await eu.click('.sg-chave.sg-falta button');
    await eu.waitForSelector('.sg-chave:has-text("Microfone") button:has-text("Ligar")', { timeout: 8000 });
    assert.match(await eu.textContent('.sg-barra'), /Ao vivo/);
    await ela.click('.sg-botao'); await ela.fill('.sg-painel input', codigo); await ela.click('.sg-painel button:has-text("Entrar")');
    await ela.waitForSelector('.sg-codigo');
    await eu.waitForSelector('.sg-chave:has-text("Operar a tela de")', { timeout: 10000 });
    // apontador: quem acompanha recebe o aviso forte e vê a bolinha
    await eu.mouse.move(400, 300); await eu.mouse.move(420, 320);
    await ela.waitForSelector('.sg-barra .sg-siga:has-text("Siga a bolinha")', { timeout: 8000 });
    await ela.waitForFunction(() => getComputedStyle(document.querySelector('.sg-ponteiro')).opacity === '1', null, { timeout: 5000 });
    // o microfone liberado depois chega mesmo a quem está na sala (áudio recebido pela outra pessoa)
    await eu.click('.sg-chave:has-text("Microfone") button:has-text("Ligar")');
    await ela.waitForFunction(async () => (await window.SalaGuiada.recebido()).some((x) => x.bytes > 1000), null, { timeout: 15000 });
    // indicador de áudio: as duas pessoas veem "Áudio conectado" e o som está tocando de verdade
    for (const pg of [eu, ela]) {
      await pg.waitForSelector('.sg-barra .sg-chip.sg-on:has-text("Áudio conectado")', { timeout: 15000 });
      await pg.waitForFunction(() => { const a = document.querySelector('audio'); return a && a.srcObject && !a.paused && a.srcObject.getAudioTracks().some((t) => t.readyState === 'live'); }, null, { timeout: 8000 });
    }
    assert.match(await ela.textContent('.sg-painel'), /áudio conectado/);
    // alvo de teste na tela dela
    await ela.evaluate(() => { const i = document.createElement('input'); i.id = 'alvo-teste'; i.style.cssText = 'position:fixed;left:300px;top:200px;width:300px;height:40px;z-index:10;font-size:20px'; document.body.appendChild(i); window.__c = 0; i.addEventListener('click', () => { window.__c++; }); });
    // pede a permissão
    await eu.click('.sg-chave:has-text("Operar a tela de") button');
    await ela.waitForSelector('.sg-convite:has-text("pede para operar")', { timeout: 8000 });
    await ela.click('.sg-convite button:has-text("Permitir")');
    await eu.waitForSelector('.sg-barra .sg-chip:has-text("Você opera")', { timeout: 15000 }).catch(async (e) => { console.log('ELA:', await ela.textContent('.sg-msg'), '| EU:', await eu.textContent('.sg-msg'), '| barra ela:', await ela.textContent('.sg-barra')); throw e; });
    await ela.waitForSelector('.sg-barra.sg-alerta:has-text("operando o seu sistema")');
    await eu.waitForFunction(() => { const v = document.querySelector('.sg-tela video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    // clica no campo pela imagem
    const pos = async (x, y) => eu.evaluate(([x, y]) => { const v = document.querySelector('.sg-tela video'), b = v.getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight, e = Math.min(b.width / vw, b.height / vh), w = vw * e, h = vh * e; return { x: b.left + (b.width - w) / 2 + x * w, y: b.top + (b.height - h) / 2 + y * h }; }, [x, y]);
    const alvo = await pos((300 + 150) / 1200, (200 + 20) / 800);
    await eu.mouse.move(alvo.x, alvo.y); await eu.mouse.click(alvo.x, alvo.y);
    await ela.waitForFunction(() => window.__c === 1 && document.activeElement && document.activeElement.id === 'alvo-teste', null, { timeout: 8000 });
    await eu.keyboard.type('Oi');
    await ela.waitForFunction(() => document.getElementById('alvo-teste').value === 'Oi', null, { timeout: 8000 });
    // senha nunca é digitada à distância
    await ela.evaluate(() => { const i = document.createElement('input'); i.type = 'password'; i.id = 'senha-teste'; i.style.cssText = 'position:fixed;left:300px;top:300px;width:300px;height:40px;z-index:10'; document.body.appendChild(i); i.focus(); });
    await eu.keyboard.type('x'); await ela.waitForTimeout(600);
    assert.equal(await ela.inputValue('#senha-teste'), '', 'senha não é digitada por quem opera');
    // ela corta a operação
    await ela.click('.sg-barra button:has-text("PARAR AGORA")');
    await eu.waitForFunction(() => !/Você opera/.test(document.querySelector('.sg-barra').textContent), null, { timeout: 8000 });
    await eu.keyboard.type('z'); await ela.waitForTimeout(500);
    assert.equal(await ela.inputValue('#alvo-teste'), 'Oi', 'depois de parar, nada mais chega');
    const trilha = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela='ajuda_ao_vivo'").map((x) => x.campo);
    assert.ok(trilha.includes('operacao_autorizada') && trilha.includes('operacao_iniciada'), 'trilha: ' + trilha.join(','));
    assert.deepEqual([...eu.erros, ...ela.erros], []);
    console.log('AJUDA AO VIVO OK');
  } finally { await browser.close(); await S.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
