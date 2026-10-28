'use strict';
// Toda tela de detalhe tem um jeito de voltar (migalha, botão próprio ou "← Voltar" automático); telas do menu não ganham o botão.
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
    const api = (m, u, b) => p.evaluate(([m, u, b]) => window.CTAI.api(m, u, b), [m, u, b]);
    const cs = (await api('GET', '/api/ctai/contratos')).contratos; const demo = cs.find((c) => c.contrato_id === 'DEMO-UPA');
    const cid = demo.competencias[0].cid;
    const tem = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(700); return p.evaluate(() => !!document.querySelector('#conteudo .migalha, #conteudo .voltar') || Array.from(document.querySelectorAll('#conteudo a,#conteudo button')).some((x) => /^\s*(←\s*)?voltar/i.test(x.textContent))); };
    for (const h of ['#/c/' + cid, '#/c/' + cid + '/achados', '#/regras/DEMO-UPA', '#/historico/DEMO-UPA', '#/u/DEMO-UPA', '#/documentos/modelos', '#/rota-que-nao-existe']) assert.ok(await tem(h), 'sem voltar em ' + h);
    for (const h of ['#/historico', '#/mensageiro', '#/unidades', '#/gestao/usuarios']) { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(500); assert.equal(await p.locator('#conteudo .voltar').count(), 0, 'botão a mais em ' + h); }
    // o botão volta de verdade
    await p.evaluate(() => { location.hash = '#/unidades'; }); await p.waitForTimeout(400);
    await p.evaluate(() => { location.hash = '#/rota-que-nao-existe'; }); await p.waitForSelector('#conteudo .voltar');
    await p.click('#conteudo .voltar'); await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => location.hash), '#/unidades');
    assert.deepEqual(erros, []);
    console.log('VOLTAR OK');
  } finally { await browser.close(); await S.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
