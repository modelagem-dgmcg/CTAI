'use strict';
// Falar com a equipe: a mensagem enviada por outra pessoa aparece sozinha, sem recarregar a tela.
const H = require('../helpers');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const S = await H.iniciar(); const base = S.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message));
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#conteudo');
    await p.evaluate(() => { location.hash = '#/mensageiro'; });
    await p.waitForSelector('#msg-contatos .ct[data-login="colega1"]');
    // outra pessoa escreve para o Cleuton
    const outra = H.cliente(base); await outra.entrar('colega1');
    await outra.post('/api/mensageiro/enviar', { para: 'cleuton', texto: 'Primeira, chegando sozinha.' });
    await p.waitForSelector('#msg-contatos .ct[data-login="colega1"] .selo', { timeout: 8000 });   // selo de não lida no contato
    await p.click('#msg-contatos .ct[data-login="colega1"]');
    await p.waitForSelector('#msg-hist:has-text("Primeira, chegando sozinha.")');
    // com a conversa aberta, uma nova mensagem aparece sem clicar em nada
    await outra.post('/api/mensageiro/enviar', { para: 'cleuton', texto: 'Segunda, ao vivo.' });
    await p.waitForSelector('#msg-hist:has-text("Segunda, ao vivo.")', { timeout: 8000 });
    // o texto que a pessoa está digitando não é apagado pela atualização
    await p.fill('#msg-texto', 'rascunho que não pode sumir');
    await outra.post('/api/mensageiro/enviar', { para: 'cleuton', texto: 'Terceira.' });
    await p.waitForSelector('#msg-hist:has-text("Terceira.")', { timeout: 8000 });
    assert.equal(await p.inputValue('#msg-texto'), 'rascunho que não pode sumir');
    assert.deepEqual(erros, []);
    console.log('MENSAGEIRO OK');
  } finally { await browser.close(); await S.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
