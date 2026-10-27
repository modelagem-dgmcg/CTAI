'use strict';
// Administração > Zerar dados de demonstração, pela tela: prévia, confirmação, resultado com a cópia para baixar.
const H = require('../helpers');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const S = await H.iniciar(); const base = S.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message));
    await p.goto(base + '/'); await p.fill('#login', 'admin'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#conteudo');
    await p.evaluate(() => { location.hash = '#/admin'; });
    await p.waitForSelector('#zr-abrir'); await p.click('#zr-abrir');
    await p.waitForSelector('dialog h3:has-text("Será apagado")');
    assert.ok(await p.isVisible('dialog:has-text("Será mantido")'));
    await p.click('dialog button:has-text("Apagar e começar do zero")');           // sem confirmar: não apaga
    assert.ok(await p.isVisible('#zr-msg:has-text("ZERAR")'));
    await p.fill('#zr-conf', 'ZERAR'); await p.click('dialog button:has-text("Apagar e começar do zero")');
    assert.ok(await p.isVisible('#zr-msg:has-text("senha")'));
    await p.fill('#zr-senha', 'Senha@12345'); await p.click('dialog button:has-text("Apagar e começar do zero")');
    await p.waitForSelector('dialog:has-text("Dados zerados")', { timeout: 15000 });
    assert.ok(await p.isVisible('#zr-baixar'));
    assert.equal(S.db.get('SELECT COUNT(*) AS n FROM competencias').n, 0);
    assert.deepEqual(erros, []);
    console.log('ZERAR OK');
  } finally { await browser.close(); await S.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
