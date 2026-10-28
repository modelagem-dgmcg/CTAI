'use strict';
// Soltar um ZIP do SEI (sintético, vários arquivos): o navegador abre o ZIP, envia um por vez e o painel mostra o andamento até o resumo do mês.
const H = require('../helpers');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const CART = require('../../server/carteira');
const F = require('../fixtures-gaveta');
const { chromium } = require('playwright');
const SHOT = process.env.CTAI_SHOTS || null; // pasta opcional para guardar capturas de conferência visual (fora do repositório)

(async () => {
  const S = await H.iniciar(); const base = S.base;
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-TESTE','UPAE Teste','OSS Teste','UPAE',0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['UPAE-TESTE'], 'e2e');
  // ZIP de julho sem o Anexo 5, com imagem solta e banco de dados que devem ser ignorados
  const arqs = F.mesCompleto('2026-07', { sem: ['anexo_5'] });
  const z = new JSZip();
  for (const a of arqs) z.file(a.nome, a.buf);
  z.file('foto-recepcao.png', Buffer.from('89504e470d0a1a0a', 'hex')); z.file('cache/Thumbs.db', 'x'); z.file('pasta/dados.db', 'x');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ctai-zip-'));
  const zipPath = path.join(pasta, 'SEI_RM_07_2026___UPAE_TESTE.zip');
  fs.writeFileSync(zipPath, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    const jszipBaixado = []; p.on('request', (r) => { if (/jszip/.test(r.url())) jszipBaixado.push(r.url()); });
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#al-zona', { timeout: 8000 });
    assert.ok(await p.isHidden('#al-painel'), 'sem arquivos, o painel não aparece');

    // cada envio demora um pouco, para dar tempo de ver o andamento
    await p.route('**/api/alimentar/arquivo', async (route) => { await new Promise((r) => setTimeout(r, 180)); await route.continue(); });
    // registra o que o painel mostra ao longo do tempo
    await p.evaluate(() => {
      window.__log = { docs: [], estados: new Set(), pct: [] };
      setInterval(() => {
        const d = document.querySelector('#al-n-docs'); if (d && (!window.__log.docs.length || window.__log.docs[window.__log.docs.length - 1] !== d.textContent)) window.__log.docs.push(d.textContent);
        document.querySelectorAll('.al-item').forEach((li) => window.__log.estados.add(li.getAttribute('data-estado')));
        const pc = document.querySelector('#al-pct'); if (pc) window.__log.pct.push(pc.textContent);
      }, 40);
    });
    await p.setInputFiles('#al-arquivos', zipPath);
    await p.waitForSelector('#al-painel:not([hidden])', { timeout: 15000 });
    // topo: unidade e mês
    await p.waitForFunction(() => /UPAE Teste/.test(document.querySelector('#al-un').textContent), null, { timeout: 15000 });
    await p.waitForFunction(() => /Julho\/2026/.test(document.querySelector('#al-sub').textContent), null, { timeout: 15000 });
    if (SHOT) await p.screenshot({ path: path.join(SHOT, 'andamento.png') });
    // até o fim
    await p.waitForSelector('#al-resumo-mes', { timeout: 60000 });
    const resumo = (await p.innerText('#al-resumo-mes')).trim();
    assert.match(resumo, /^Julho: 20 de 21 lidos — falta Anexo 5\.$/, resumo);
    assert.match(await p.innerText('#al-aviso-tri'), /Chegou julho, faltam agosto e setembro\./);
    assert.ok(!/\bnull\b|undefined/.test(await p.innerText('#al-raiz')), 'nenhum "null" solto na tela');
    assert.equal(jszipBaixado.length, 1, 'o leitor de ZIP vem do próprio sistema');
    assert.ok(jszipBaixado[0].startsWith(base + '/vendor/jszip'), jszipBaixado[0]);

    // o andamento passou por "cinza -> lendo -> lido", os contadores só cresceram e o anel chegou a 100%
    const log = await p.evaluate(() => ({ docs: window.__log.docs, estados: [...window.__log.estados], pct: window.__log.pct }));
    assert.ok(log.estados.includes('lendo'), 'algum item apareceu como "lendo": ' + log.estados);
    assert.ok(log.estados.includes('lido') && (log.estados.includes('espera') || log.estados.includes('aguardando')), log.estados.join(','));
    assert.ok(log.docs.length >= 6, 'o contador andou aos poucos: ' + log.docs.join(' | '));
    const lidos = log.docs.map((t) => Number(t.split(' de ')[0]));
    assert.deepEqual(lidos, [...lidos].sort((a, b) => a - b), 'contador nunca volta: ' + log.docs.join(' | '));
    assert.equal(await p.innerText('#al-pct'), '100%');
    assert.equal(await p.getAttribute('#al-painel', 'data-estado'), 'pronto');
    // checklist: 20 lidos + 1 faltou (o anexo 5)
    assert.equal(await p.locator('.al-item[data-estado=lido]').count(), 20);
    assert.equal(await p.locator('.al-item[data-estado=falta]').count(), 1);
    assert.match(await p.innerText('.al-item[data-estado=falta]'), /Anexo 5/);
    assert.match(await p.innerText('#al-n-docs'), /^20 de 21$/);
    // arquivos ignorados não viram linha e o texto completo está na gaveta
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM alimentar_fila WHERE nome LIKE '%.png' OR nome LIKE '%.db'").n, 0);
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM gaveta_documentos WHERE mes = '2026-07'").n, 20);
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL").n, 0);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, 'resumo.png'), fullPage: false });

    // conferir os números: a leitura só propõe; a analista confirma
    await p.click('#al-abrir-conf');
    await p.waitForSelector('#al-conferir');
    assert.ok(await p.isVisible('text=Consultas médicas especializadas'));
    assert.match(await p.innerText('#al-aviso-tri2'), /Chegou julho, faltam agosto e setembro\./);
    await p.click('#al-confirmar-nums');
    await p.waitForSelector('#al-conferir .selo.ok', { timeout: 8000 });
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM gaveta_numeros WHERE estado = 'proposto'").n, 0);
    assert.ok(S.db.get("SELECT COUNT(*) AS n FROM gaveta_numeros WHERE estado = 'confirmado'").n >= 6);
    if (SHOT) await p.screenshot({ path: path.join(SHOT, 'conferir.png'), fullPage: true });

    // soltar o mesmo ZIP de novo: tudo vira "já importado" e nada é guardado duas vezes
    await p.setInputFiles('#al-arquivos', zipPath);
    await p.waitForFunction(() => { const r = document.querySelector('#al-resumo'); return r && /\b4[0-9] lidos/.test(r.textContent); }, null, { timeout: 60000 });
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM gaveta_documentos WHERE mes = '2026-07'").n, 20);
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM alimentar_fila WHERE estado = 'duplicado'").n, 20);

    // movimento reduzido: sem animação, só a troca de estado
    const anim = await p.evaluate(() => { const li = document.createElement('li'); li.className = 'al-item'; li.setAttribute('data-estado', 'lendo'); const ic = document.createElement('span'); ic.className = 'al-ic'; li.appendChild(ic); document.querySelector('#al-lista').appendChild(li); const n = getComputedStyle(ic).animationName; li.remove(); return n; });
    assert.equal(anim, 'al-pulso', 'com movimento normal, o item "lendo" pulsa de leve');
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', reducedMotion: 'reduce' });
    const p2 = await ctx2.newPage();
    await p2.goto(base + '/'); await p2.fill('#login', 'cleuton'); await p2.fill('#senha', 'Senha@12345'); await p2.click('button[type=submit]');
    await p2.waitForSelector('#conteudo', { timeout: 8000 }); await p2.evaluate(() => { location.hash = '#/alimentar'; });
    await p2.waitForSelector('#al-zona', { timeout: 8000 });
    const anim2 = await p2.evaluate(() => { const li = document.createElement('li'); li.className = 'al-item'; li.setAttribute('data-estado', 'lendo'); const ic = document.createElement('span'); ic.className = 'al-ic'; li.appendChild(ic); document.body.appendChild(li); const r = { a: getComputedStyle(ic).animationName, t: getComputedStyle(document.body).transitionDuration }; li.remove(); return r; });
    assert.equal(anim2.a, 'none', 'com "reduzir movimento", não há animação');
    const trans = await p2.evaluate(() => { const b = document.createElement('i'); b.id = 'al-barra-i'; const w = document.createElement('div'); w.className = 'al-barra'; w.appendChild(b); document.body.appendChild(w); const t = getComputedStyle(b).transitionDuration; w.remove(); return t; });
    assert.match(trans, /^0s(, 0s)*$/, 'e a barra só troca de valor: ' + trans);
    assert.deepEqual(erros, []);
    console.log('ALIMENTAR ZIP OK');
  } finally { await browser.close(); await S.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
