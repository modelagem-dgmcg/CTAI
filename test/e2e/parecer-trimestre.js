'use strict';
// Apuração do trimestre (etapa Produzir da página da unidade), no navegador. Tudo SINTÉTICO.
// Números só confirmados entram; pendência destacada bloqueia; preenche repasse, % de desconto e campos manuais; pronto; PDF.
const H = require('../helpers');
const assert = require('node:assert/strict');
const CART = require('../../server/carteira');
const C = require('../../server/catalogo');
const { chromium } = require('playwright');

(async () => {
  const S = await H.iniciar(); const base = S.base;
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-APU','UPAE Apuração','OSS Teste','UPAE',0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['UPAE-APU'], 'e2e');
  S.db.run("INSERT INTO alimentar_liberacao (usuario_id, liberado_em, por, motivo) VALUES (?, ?, 'teste', 'e2e')", cle.usuario_id, new Date().toISOString());
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#conteudo');
    await p.evaluate(() => { location.hash = '#/u/UPAE-APU'; });
    await p.waitForSelector('#un-tri', { timeout: 15000 });
    const T = await p.inputValue('#un-tri'); const meses = C.mesesDoTrimestre(T);
    // números sintéticos: consultas médicas proposto (não confirmado), o resto confirmado
    const dados = { consultas_medicas: [1200, [560, 540, 500]], consultas_nao_medicas: [300, [310, 320, 330]], sessoes_reabilitacao: [400, [400, 400, 400]], mamografia: [100, [50, 50, 50]], matriciamento: [8, [8, 9, 8]], supervisao_cuidado: [8, [9, 9, 9]], consultas_medicas_tea: [154, [100, 100, 100]] };
    const doc = {}; for (const m of meses) for (const f of ['anexo_I', 'anexo_II']) doc[m + f] = Number(S.db.run("INSERT INTO gaveta_documentos (contrato_id, mes, codigo, parte, nome_arquivo, hash, caracteres, texto, versao, criado_por, criado_em, atualizado_em) VALUES ('UPAE-APU',?,?,'',?,?,1,'x',1,'t','2026-10-01','2026-10-01')", m, f, f + '-' + m + '.pdf', 'h' + m + f).lastInsertRowid);
    const num = (m, f, chave, meta, real, estado) => S.db.run("INSERT INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, meta, realizado, trecho, estado, confirmado_por) VALUES (?,'UPAE-APU',?,?,?,?,?,?,?,?,?)", doc[m + f], m, f, chave, chave, meta, real, 'trecho sintético ' + chave, estado, estado === 'confirmado' ? 'cleuton' : null);
    for (const [chave, [meta, reais]] of Object.entries(dados)) meses.forEach((m, k) => num(m, 'anexo_I', chave, meta, reais[k], chave === 'consultas_medicas' ? 'proposto' : 'confirmado'));
    meses.forEach((m) => num(m, 'anexo_II', 'ostomizados_pessoas', 70, 80, 'confirmado'));
    // abre a etapa Produzir
    await p.evaluate(() => { location.hash = '#/u/UPAE-APU'; location.reload(); });
    await p.waitForSelector('#pt-raiz', { state: 'attached', timeout: 15000 });
    const abrir = () => p.waitForFunction(() => { document.querySelectorAll('details.etapa').forEach((d) => { d.open = true; }); const e = document.querySelector('#pt-raiz'); return !!(e && e.offsetParent); }, null, { timeout: 15000 });
    await abrir();
    let bloq = await p.innerText('#pt-bloq');
    assert.match(bloq, /há número LIDO mas NÃO confirmado \(1\.200\)/);
    assert.ok(await p.locator('#pt-raiz td.pt-pend').count() >= 2, 'pendências destacadas');
    assert.ok(!(await p.innerText('#pt-raiz table')).includes('44,44'), 'valor proposto não aparece como resultado');
    // confirma a leitura (como em Alimentar) e recarrega
    S.db.run("UPDATE gaveta_numeros SET estado = 'confirmado', confirmado_por = 'cleuton' WHERE contrato_id = 'UPAE-APU'");
    await p.reload(); await abrir();
    assert.match(await p.innerText('#pt-raiz'), /44,44%/);
    assert.match(await p.innerText('#pt-bloq'), /percentual de desconto a definir pela analista/);
    // preenche
    for (const m of meses) await p.fill('#rep-' + m, '100.000,10');
    await p.fill('#pt-fonte', 'Contrato de Gestão, cláusula teste');
    await p.fill('#pct-consultas_medicas', '3'); await p.fill('#pct-mamografia', '4'); await p.fill('#pt-qual', '0,00');
    await p.fill('#pt-s7', 'Informações financeiras: texto da analista.'); await p.fill('#pt-s8', 'Parecer da CMA: texto da analista.');
    await p.click('#pt-salvar'); await p.waitForFunction(() => /R\$ 21\.000,02/.test(document.querySelector('#pt-total').textContent), null, { timeout: 8000 });
    assert.equal((await p.locator('#pt-bloq').count()), 0, 'sem pendências');
    assert.match(await p.innerText('#pt-conf'), /anexo_I-.*\.pdf/);
    await p.click('#pt-pronto'); await p.waitForSelector('#pt-pdf', { timeout: 8000 });
    const href = await p.getAttribute('#pt-pdf', 'href');
    const r = await p.evaluate(async (u) => { const x = await fetch(u); return { s: x.status, t: x.headers.get('content-type') }; }, href);
    assert.equal(r.s, 200); assert.match(r.t, /pdf/);
    assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'par_apuracao' AND campo = 'pronto_para_conferencia'"));
    assert.ok(!/\bnull\b|undefined/.test(await p.innerText('#pt-raiz')));
    assert.deepEqual(erros, []);
    await ctx.close();
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await browser.close().catch(() => {}); await S.fechar(); }
  if (!process.exitCode) console.log('e2e parecer-trimestre: ok');
})().catch((e) => { console.error(e); process.exit(1); });
