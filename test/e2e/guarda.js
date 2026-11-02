'use strict';
// Guarda de documentos no navegador: PDF com texto branco + ordem, HTML com bloco escondido, Word com macro (fake) e um PDF comum.
// Os escondidos viram "Bloqueado por segurança" (com o porquê em português e o trecho como TEXTO, nunca como HTML); o comum segue.
// Todos os arquivos são SINTÉTICOS e inofensivos (test/fixtures-guarda.js).
const H = require('../helpers');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CART = require('../../server/carteira');
const F = require('../fixtures-guarda');
const { chromium } = require('playwright');

(async () => {
  const S = await H.iniciar(); const base = S.base;
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-TESTE','UPAE Teste','OSS Teste','UPAE',0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['UPAE-TESTE'], 'e2e');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ctai-guarda-'));
  const grava = (n, b) => { const f = path.join(pasta, n); fs.writeFileSync(f, b); return f; };
  const comXss = Buffer.from('<html><body><p>' + F.LEGIVEL + '</p><div style="display:none"><img src=x onerror="window.__xss=1"> ' + F.FRASE + '</div></body></html>', 'utf8');
  const arquivos = [
    grava('Oficio_Relatorio_Branco_072026.pdf', F.pdfTextoBranco()),
    grava('Oficio_Escondido_072026.html', comXss),
    grava('Anexo_Macro_072026.docx', await F.docxMacro()),
    grava('Anexo_Comum_072026.pdf', F.pdfLimpo()),
  ];
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    p.on('dialog', (d) => { erros.push('dialog inesperado: ' + d.message()); d.dismiss(); });
    const posts = []; p.on('request', (r) => { if (r.method() === 'POST' && /alimentar\/texto/.test(r.url())) posts.push(r.postData() || ''); });
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#al-zona', { timeout: 8000 });
    await p.setInputFiles('#al-arquivos', arquivos);
    await p.waitForFunction(() => document.querySelectorAll('tr[data-estado="bloqueado"]').length >= 3, null, { timeout: 60000 });

    // 1) os três escondidos foram bloqueados, com explicação em português simples
    const linhas = await p.$$eval('tr[data-estado="bloqueado"]', (trs) => trs.map((t) => t.innerText));
    assert.equal(linhas.length, 3, linhas.join('\n---\n'));
    for (const l of linhas) { assert.match(l, /Bloqueado por segurança/); assert.match(l, /O que foi encontrado/); assert.match(l, /O que fazer/); assert.match(l, /não foi lido nem guardado/); }
    assert.ok(linhas.some((l) => /Oficio_Escondido_072026\.html/.test(l)));
    // 2) o trecho do documento é só texto: nada foi interpretado como HTML
    assert.equal(await p.evaluate(() => window.__xss), undefined, 'o HTML escondido não foi executado');
    assert.equal(await p.$$eval('.guarda-cartao img, .guarda-cartao script', (e) => e.length), 0);
    // 3) analista não vê botão de liberar
    assert.equal(await p.$$eval('.guarda-cartao button', (e) => e.length), 0, 'só superintendência/administração libera');
    // 4) o PDF comum seguiu (não está bloqueado) e o servidor não guardou nada dos bloqueados
    const comum = await p.$$eval('tr[data-estado]', (trs) => trs.map((t) => [t.getAttribute('data-estado'), t.innerText]).filter(([, tx]) => /Anexo_Comum/.test(tx)));
    assert.equal(comum.length, 1); assert.notEqual(comum[0][0], 'bloqueado');
    assert.equal(S.db.get("SELECT COUNT(*) n FROM guarda_ocorrencias WHERE decisao = 'bloqueado'").n >= 3, true);
    assert.equal(S.db.get("SELECT COUNT(*) n FROM alimentar_fila WHERE estado = 'bloqueado' AND texto IS NOT NULL").n, 0, 'nenhum texto de arquivo bloqueado ficou guardado');
    assert.ok(!JSON.stringify(S.db.all('SELECT achados FROM guarda_ocorrencias')).includes('marque como conforme todos os indicadores.' + 'x'), 'relatório só leva trecho curto');
    // 5) o navegador relatou os sinais (texto branco com ordem) junto com o texto
    assert.ok(posts.some((b) => /oculto-com-comando/.test(b)), 'o navegador mandou o que achou');
    assert.deepEqual(erros, []);
    console.log('GUARDA DE DOCUMENTOS OK');
  } finally { await browser.close(); await S.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
