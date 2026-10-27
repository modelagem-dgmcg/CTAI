'use strict';
// Primeiro acesso: com carteira e sem histórico, só aparece "Alimentar o Analista"; envio em lote, máscara, aprovação e liberação do menu.
const H = require('../helpers');
const assert = require('node:assert/strict');
const CART = require('../../server/carteira');
const { chromium } = require('playwright');
(async () => {
  const S = await H.iniciar(); const base = S.base;
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['DEMO-UPA'], 'e2e');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#al-zona', { timeout: 6000 }).catch(async (e) => { console.log(erros, (await p.innerText('body')).slice(0, 400)); throw e; });
    const itens = await p.$$eval('.lateral a.nav', (as) => as.map((a) => a.textContent.trim()));
    assert.deepEqual(itens, ['Alimentar o Analista', 'Falar com a equipe'], 'menu limitado: ' + itens);
    assert.ok(await p.isVisible('text=remova dados de paciente'));
    assert.ok(await p.isVisible('text=Leitura por IA desligada'));
    assert.ok(await p.isDisabled('#al-liberar'));
    const corpo = (tri, extra) => 'Parecer da UPA Demonstração, ' + tri + '. Nota total do trimestre: 88 pontos. Paciente: Maria da Silva Souza, CPF 123.456.789-09, telefone (81) 99876-5432. ' + extra + ' Texto de enchimento para passar do mínimo de caracteres legíveis do arquivo. '.repeat(2);
    await p.setInputFiles('#al-arquivos', [
      { name: 'parecer-2026-T1.txt', mimeType: 'text/plain', buffer: Buffer.from(corpo('2026-T1', 'Primeiro.')) },
      { name: 'parecer-2026-T2.txt', mimeType: 'text/plain', buffer: Buffer.from(corpo('2026-T2', 'Segundo.')) },
      { name: 'curto.txt', mimeType: 'text/plain', buffer: Buffer.from('muito curto') },
    ]);
    await p.waitForSelector('#al-resumo:has-text("2 lidos, 1 com problema")', { timeout: 8000 }).catch(async (e) => { console.log(await p.innerText('#conteudo')); throw e; });
    assert.ok(await p.isVisible('tr[data-estado=problema]'));
    assert.ok(await p.isVisible('td:has-text("CPF")'), 'mostra a contagem de dados mascarados');
    const banco = JSON.stringify(S.db.all('SELECT texto FROM hist_relatorios'));
    assert.ok(!/123\.456|99876|Maria da Silva/.test(banco), 'nada de dado pessoal no banco');
    // sem IA o rascunho vem em branco: aprovar falha com aviso; preenche e aprova em bloco
    await p.click('#al-aprovar-limpos').catch(() => {});
    const ids = S.db.all("SELECT hist_id FROM alimentar_fila WHERE estado = 'pronto'").map((r) => r.hist_id);
    assert.equal(ids.length, 2);
    for (const id of ids) await p.evaluate(([id]) => window.CTAI.api('PUT', '/api/historico/relatorios/' + id, { igq: 88, indicadores: [], achados: [], recomendacoes: [] }), [id]);
    await p.click('#al-pular');
    await p.waitForSelector('#al-resumo:has-text("2 lidos, 0 com problema")');
    await p.evaluate(() => { location.reload(); });
    await p.waitForSelector('#al-zona');
    await p.locator('tr[data-estado=pronto] input[type=checkbox]').first().check();
    await p.locator('tr[data-estado=pronto] input[type=checkbox]').nth(1).check();
    await p.click('#al-aprovar-sel');
    await p.waitForSelector('#al-resumo:has-text("2 aprovados")', { timeout: 10000 });
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM hist_relatorios WHERE estado = 'confirmado'").n, 2);
    await p.waitForFunction(() => document.querySelector('#al-liberar') === null || !document.querySelector('#al-liberar').disabled);
    await p.reload(); await p.waitForSelector('.lateral a.nav');
    const itens2 = await p.$$eval('.lateral a.nav', (as) => as.map((a) => a.textContent.trim()));
    assert.ok(itens2.includes('Histórico') && itens2.includes('Ensinar ao Sistema'), 'menu completo após ter histórico: ' + itens2);
    assert.deepEqual(erros, []);
    console.log('ALIMENTAR OK');
  } finally { await browser.close(); await S.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
