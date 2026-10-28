'use strict';
// Importar Arquivos (etapa 1 da página da unidade), de ponta a ponta no navegador. Tudo SINTÉTICO.
// Sem relatório anterior (lista padrão) -> sobe o relatório-modelo (PDF) -> confere e confirma a lista -> solta PDFs, um ZIP e Word
// do trimestre -> checks 1/3, 2/3, 3/3 -> avulso -> fonte externa -> concluir (com e sem faltas) -> reabrir -> recarregar.
const H = require('../helpers');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const CART = require('../../server/carteira');
const F = require('../fixtures-importar');
const { chromium } = require('playwright');

const MANTER = ['anexo_I', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_1', 'anexo_1_1', 'anexo_5', 'simas', 'despacho_financeiro', 'prestacao_contas'];

(async () => {
  const S = await H.iniciar(); const base = S.base;
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-TESTE','UPAE Teste','OSS Teste','UPAE',0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['UPAE-TESTE'], 'e2e');
  S.db.run("INSERT INTO alimentar_liberacao (usuario_id, liberado_em, por, motivo) VALUES (?, ?, 'teste', 'e2e')", cle.usuario_id, new Date().toISOString()); // fora do primeiro acesso
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ctai-imp-'));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = []; const enviados = [];
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    p.on('request', (r) => { if (/\/api\/alimentar\/(arquivo|texto)$/.test(r.url())) { const b = r.postDataBuffer(); enviados.push({ rota: r.url().split('/').pop(), pdf: !!(b && b.slice(0, 5).toString('latin1') === '%PDF-') }); } });
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#conteudo');

    const ver = (sel) => p.waitForFunction((x) => { const d = document.querySelector('#etapa-0'); if (d) d.open = true; const e = document.querySelector(x); return !!(e && e.offsetParent); }, sel, { timeout: 15000, polling: 200 });
    const abrir0 = async () => { await p.waitForSelector('#etapa-0', { state: 'attached' }); await p.evaluate(() => { const d = document.querySelector('#etapa-0'); if (d) d.open = true; }); };
    // ---------- 1) sem relatório anterior: lista padrão, nada de "a unidade enviou" ----------
    await p.evaluate(() => { location.hash = '#/u/UPAE-TESTE'; });
    await p.waitForSelector('#imp-resumo', { timeout: 15000 }).catch(async (e) => { console.error((await p.innerText('body')).slice(0, 1500), erros); throw e; });
    const T = await p.inputValue('#un-tri'); const ano = Number(T.slice(0, 4)); const q = Number(T.slice(-1));
    const MM = [0, 1, 2].map((i) => String(3 * (q - 1) + 1 + i).padStart(2, '0'));
    assert.equal((await p.innerText('#imp-aviso-lista')).trim(), 'Sem relatório anterior: usando a lista padrão da UPAE.');
    assert.ok(await p.isVisible('#imp-zona-modelo'));
    assert.match(await p.innerText('#imp-resumo'), /^0 de \d+ itens recebidos — falta /);
    const corpo1 = await p.innerText('#conteudo');
    for (const velho of ['Recebido em', 'não enviou', 'ainda não abriu']) assert.ok(!corpo1.includes(velho), 'texto antigo: ' + velho);
    assert.ok(!/\bnull\b|undefined/.test(corpo1));
    assert.ok(await p.isVisible('#imp-zona'));

    // ---------- 2) relatório-modelo em PDF: só o texto sobe ----------
    const txt = F.textoParecer() + '\nPaciente: Maria da Silva Souza, CPF 123.456.789-09, telefone (81) 99876-5432.';
    await p.setInputFiles('#imp-modelo-arquivo', { name: 'Parecer_Tecnico_999.pdf', mimeType: 'application/pdf', buffer: await F.pdfDe(txt) });
    await p.waitForSelector('#imp-proposta', { timeout: 30000 });
    assert.match(await p.innerText('#imp-proposta'), /lista proposta com \d+ itens/);
    assert.equal(S.db.get('SELECT COUNT(*) AS n FROM imp_modelos').n, 1);
    assert.match(await p.innerText('#imp-modelo-legenda'), new RegExp('Modelo: parecer do ' + (q === 1 ? (ano - 1) + '-T4' : ano + '-T' + (q - 1))));
    const hoje = new Date(); const encerrado = Math.ceil((hoje.getMonth() + 1) / 3) === 1 ? (hoje.getFullYear() - 1) + '-T4' : hoje.getFullYear() + '-T' + (Math.ceil((hoje.getMonth() + 1) / 3) - 1);
    assert.equal(T, encerrado, 'abre no último trimestre encerrado');
    assert.ok(!/123\.456|99876|Maria da Silva/.test(S.db.get('SELECT texto FROM imp_modelos').texto), 'texto guardado mascarado');
    assert.deepEqual(enviados.filter((e) => e.pdf), [], 'o PDF não saiu da máquina');
    assert.ok(enviados.some((e) => e.rota === 'texto'));
    await p.click('#imp-ver-estrutura'); await p.waitForSelector('dialog .imp-est');
    assert.match(await p.innerText('dialog'), /Quadro 01/);
    await p.click('dialog button:has-text("Fechar")'); await p.waitForSelector('dialog', { state: 'detached' });

    // ---------- 3) conferir a lista: renomear, tirar, adicionar, confirmar ----------
    await p.click('#imp-conferir-lista'); await p.waitForSelector('dialog .imp-ed-item');
    const codigos = await p.$$eval('dialog .imp-ed-item', (els) => els.map((e) => e.getAttribute('data-codigo')));
    for (const c of codigos) if (c && !MANTER.includes(c)) await p.locator('dialog .imp-ed-item[data-codigo="' + c + '"] button:has-text("Tirar")').click();
    await p.locator('dialog .imp-ed-item[data-codigo="anexo_VI"] .imp-ed-nome input').fill('Anexo VI - Cadastro CNES (modelo)');
    await p.locator('dialog .imp-ed-item[data-codigo="prestacao_contas"] input[type=checkbox]').first().uncheck(); // opcional
    // tudo que a unidade manda vira mensal
    for (const c of ['anexo_I', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_1', 'anexo_1_1', 'anexo_5']) await p.locator('dialog .imp-ed-item[data-codigo="' + c + '"] select').first().selectOption('mensal');
    await p.click('#imp-ed-novo'); await p.locator('dialog .imp-ed-nome input').last().fill('Planilha de leitos');
    await p.click('dialog button:has-text("Confirmar a lista")'); await p.waitForSelector('dialog', { state: 'detached' });
    await p.waitForFunction(() => !document.querySelector('#imp-proposta'), null, { timeout: 8000 });
    assert.equal(S.db.get("SELECT COUNT(*) AS n FROM imp_listas WHERE estado = 'confirmada'").n, 1);
    assert.match(await p.innerText('#imp-i-anexo_VI'), /Anexo VI - Cadastro CNES \(modelo\)/);
    assert.match(await p.innerText('#imp-i-prestacao_contas'), /opcional/);

    // ---------- 4) mês 1 em PDF, mês 2 em ZIP, mês 3 em Word ----------
    const m1 = await F.mesEmPdf(MM[0], { ano }, 'pdf');
    await p.setInputFiles('#imp-arquivos', m1.map((a) => ({ name: a.nome, mimeType: 'application/pdf', buffer: a.buf })));
    await p.waitForFunction(() => /1\/3/.test((document.querySelector('#imp-i-anexo_IV .imp-cont') || {}).textContent || ''), null, { timeout: 60000 });
    const z = new JSZip(); for (const a of F.mes(MM[1], { ano })) z.file(a.nome.replace(/\.txt$/, '.html'), '<html><body>' + a.buf.toString('utf8') + '</body></html>');
    const zipPath = path.join(pasta, 'SEI_' + MM[1] + '.zip'); fs.writeFileSync(zipPath, await z.generateAsync({ type: 'nodebuffer' }));
    await p.setInputFiles('#imp-arquivos', zipPath);
    await p.waitForFunction(() => /2\/3/.test((document.querySelector('#imp-i-anexo_IV .imp-cont') || {}).textContent || ''), null, { timeout: 60000 });
    const m3 = await F.mesEmPdf(MM[2], { ano, sem: ['obito'] }, 'docx');
    await p.setInputFiles('#imp-arquivos', m3.map((a) => ({ name: a.nome, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: a.buf })));
    await p.waitForFunction(() => /3\/3/.test((document.querySelector('#imp-i-anexo_IV .imp-cont') || {}).textContent || ''), null, { timeout: 60000 });
    assert.match(await p.innerText('#imp-i-anexo_5 .imp-cont'), /2\/3/);
    assert.deepEqual(enviados.filter((e) => e.pdf), [], 'nenhum PDF inteiro subiu');
    assert.equal(S.db.get('SELECT COUNT(*) AS n FROM imp_arquivos WHERE texto LIKE \'%PDF-%\'').n, 0);

    // ---------- 5) avulso: um arquivo que o sistema não reconhece ----------
    await p.setInputFiles('#imp-arquivos', { name: 'Planilha_misteriosa_' + MM[0] + '.pdf', mimeType: 'application/pdf', buffer: await F.pdfDe('Conteúdo qualquer sem relação com os itens. ' + F.ENCHIMENTO) });
    await p.waitForSelector('.imp-avulso', { timeout: 60000 });
    const av = p.locator('.imp-avulso').first();
    await av.locator('select').first().selectOption('anexo_I'); await av.locator('select').nth(1).selectOption(ano + '-' + MM[0]);
    await av.locator('button:has-text("Apontar")').click();
    await p.waitForFunction(() => !document.querySelector('.imp-avulso'), null, { timeout: 8000 });

    // ---------- 6) fonte externa: check manual com observação ----------
    const slot = p.locator('#imp-i-simas .imp-slot').first();
    await slot.locator('input[type=text]').fill('Despacho 123'); await slot.locator('input[type=checkbox]').check();
    await p.waitForFunction(() => /Despacho 123/.test(document.querySelector('#imp-i-simas .imp-obs').value), null, { timeout: 8000 });
    assert.ok(S.db.get("SELECT 1 AS x FROM imp_checks WHERE observacao = 'Despacho 123'"));

    // ---------- 7) concluir com faltas -> pergunta; reabrir; fechar a lista com checks ----------
    await p.click('#imp-concluir'); await p.waitForSelector('dialog:has-text("Concluir mesmo assim?")');
    await p.fill('#imp-obs-conclusao', 'Faltam fontes externas'); await p.click('dialog button:has-text("Concluir mesmo assim")');
    await ver('#imp-reabrir');
    assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'imp_conclusoes'"));
    assert.match(await p.innerText('.etapa-chip:first-child'), /✔|✓/);
    await p.click('#imp-reabrir'); await ver('#imp-concluir');
    // marca à mão o que falta (anexo 5 de dezembro, simas e despacho nos demais meses)
    const caixas = p.locator('#imp-lista-host .imp-slot input[type=checkbox]');
    for (let i = 0; i < await caixas.count(); i++) { const c = caixas.nth(i); if (!(await c.isChecked())) { await c.check(); await p.waitForTimeout(150); } }
    // o que for mensal e faltar de arquivo: apontar não há; então conclui pelo botão
    await p.click('#imp-concluir');
    const dlg = p.locator('dialog:has-text("Concluir mesmo assim?")');
    if (await dlg.count()) await p.click('dialog button:has-text("Concluir mesmo assim")');
    await ver('#imp-reabrir');

    // ---------- 8) persiste ao recarregar; sem erros ----------
    await p.reload(); await ver('#imp-resumo');
    assert.ok(await p.isVisible('#imp-reabrir'));
    assert.match(await p.innerText('#imp-i-anexo_IV .imp-cont'), /3\/3/);
    assert.ok(!/\bnull\b|undefined/.test(await p.innerText('#conteudo')));
    assert.deepEqual(erros, []);
    await ctx.close();
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await browser.close().catch(() => {}); await S.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); }
  if (!process.exitCode) console.log('e2e importar-arquivos: ok');
})().catch((e) => { console.error(e); process.exit(1); });
