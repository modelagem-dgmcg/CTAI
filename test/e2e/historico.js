'use strict';
// Histórico dos relatórios, de ponta a ponta no navegador: importar -> conferir -> confirmar -> aparecer na carteira, na unidade e no parecer.
const H = require('../helpers');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { chromium } = require('playwright');
const pdfCom = (texto) => new Promise((ok) => { const d = new PDFDocument(); const p = []; d.on('data', (x) => p.push(x)); d.on('end', () => ok(Buffer.concat(p))); d.text(texto); d.end(); });
(async () => {
  const S = await H.iniciar(); const base = S.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message));
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }); }
    await p.waitForSelector('#conteudo');
    const api = (m, u, b) => p.evaluate(([m, u, b]) => window.CTAI.api(m, u, b), [m, u, b]);
    // histórico anterior de demonstração (3 trimestres confirmados, com queda e achado repetido)
    for (const [tri, igq, pts] of [['2026-T1', 95, 9], ['2026-T2', 88, 7], ['2026-T3', 80, 5]]) {
      const r = await api('POST', '/api/historico/relatorios', { contrato_id: 'DEMO-UPA', trimestre: tri, documento_tipo: 'parecer', igq, indicadores: [{ indicador_id: '3.1', nome: 'Satisfação', pontos: pts, max: 10 }], achados: [{ tipo: 'Ouvidoria', descricao: 'Queixas respondidas fora do prazo', gravidade: 'MÉDIA' }] });
      await api('POST', '/api/historico/relatorios/' + r.hist_id + '/confirmar');
    }
    // carteira: mini-linha e sinal no cartão da unidade
    await p.evaluate(() => { location.hash = '#/unidades'; }); await p.waitForSelector('.un-linha .hi-sinal svg', { timeout: 8000 });
    assert.ok(await p.$('.un-linha .hi-sinal svg'), 'mini-linha no cartão da unidade');
    // tela do histórico
    await p.click('nav a:has-text("Histórico"), a[href="#/historico"]'); await p.waitForSelector('h1:has-text("Histórico das unidades")');
    await p.click('a:has-text("UPA Demonstração")'); await p.waitForSelector('h2:has-text("Linha do tempo")');
    assert.ok(await p.isVisible('.hi-aviso'), 'avisos do cruzamento na unidade');
    // importar pela tela: sem IA no teste, o rascunho vem para preencher à mão
    await p.click('button:has-text("Importar relatório anterior")'); await p.waitForSelector('dialog #hi-arq');
    await p.selectOption('#hi-tri', '2025-T4');
    await p.setInputFiles('#hi-arq', { name: 'parecer-demo.pdf', mimeType: 'application/pdf', buffer: await pdfCom('Parecer de demonstração do quarto trimestre. A nota total foi de 91 pontos. Recomenda-se melhorar a escala de plantões da equipe médica da unidade.') });
    await p.click('dialog button:has-text("Ler e montar o rascunho")');
    await p.waitForSelector('h1:has-text("Conferir o rascunho")', { timeout: 15000 });
    await p.fill('#hi-r-igq', '91');
    await p.click('button:has-text("Adicionar linha") >> nth=1'); // achados
    await p.fill('textarea[aria-label="O que foi constatado"]', 'Escala incompleta');
    await p.click('#hi-salvar'); await p.waitForSelector('.toast:has-text("Rascunho salvo")');
    await p.click('#hi-confirmar'); await p.click('dialog button:has-text("Sim, confirmar")');
    await p.waitForSelector('h2:has-text("Linha do tempo")', { timeout: 10000 });
    await p.waitForSelector('.hi-tempo:has-text("4º trimestre de 2025")');
    // bloco no parecer
    const cs = await api('GET', '/api/ctai/contratos'); const demo = cs.contratos.find((c) => c.contrato_id === 'DEMO-UPA');
    const pa = await api('POST', '/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T4', competencias: demo.competencias.map((k) => k.competencia_id).slice(0, 3) });
    await p.evaluate((id) => { location.hash = '#/p/' + id; }, pa.parecer_id); await p.waitForSelector('.hi-bloco:has-text("Do histórico desta unidade")', { timeout: 10000 });
    assert.ok(await p.isVisible('.hi-bloco .hi-aviso'), 'avisos no bloco do parecer');
    assert.deepEqual(erros, []);
    console.log('HISTÓRICO OK');
  } finally { await browser.close(); await S.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
