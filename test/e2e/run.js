'use strict';
// Teste de ponta a ponta com navegador: unidade envia -> CTAI recebe -> minuta -> mesa -> SEI.
// Usa um banco temporário e o Chromium já instalado (não baixa nada).
const H = require('../helpers');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const mock = require('../../adapters/mv/mock-server');

const CAP = path.join(__dirname, '..', '..', 'docs', 'capturas');
const SENHA = 'Senha@12345';
const log = (m) => console.log('• ' + m);

const page_url = (p) => p.url();
async function entrar(browser, login, largura, jaTrocou) {
  const ctx = await browser.newContext({ viewport: { width: largura || 1280, height: 860 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.erros.push('console: ' + m.text()); });
  p.on('response', (r) => { if (r.status() >= 500) p.erros.push('HTTP ' + r.status() + ' ' + r.url()); });
  await p.goto(base + '/');
  await p.fill('#login', login);
  await p.fill('#senha', jaTrocou ? SENHA : 'Trocar@123');
  await p.click('button[type=submit]');
  await p.waitForSelector('#ts-a, #conteudo', { timeout: 8000 });
  if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', SENHA); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }); }
  await p.waitForSelector('#conteudo');
  return p;
}
const api = (p, m, u, b) => p.evaluate(([m, u, b]) => window.CTAI.api(m, u, b), [m, u, b]);
const ir = async (p, hash, espera, ms) => { await p.evaluate((x) => { location.hash = x; }, hash); await p.waitForSelector(espera || '#conteudo h1', { timeout: ms || 8000 }); await p.waitForTimeout(200); };
const limpa = (p) => p.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
const dialogo = async (p, rotulo) => { await p.waitForSelector('dialog[open]'); await p.click('dialog[open] button:has-text("' + rotulo + '")'); await p.waitForSelector('dialog', { state: 'detached' }); };

process.env.CTAI_SEGREDO = 'segredo-e2e-com-mais-de-16-caracteres';
process.env.CTAI_EXIGIR_JURIDICO = 'sim';
let base;
(async () => {
  const S = await H.iniciar(); base = S.base;
  const CFG = require('../../server/config'); CFG.painelAnalista = true; // as primeiras etapas usam o Painel do analista; a tela inicial padrão é testada no fim
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const paginas = [];
  const mockSrv = await new Promise((ok) => { const m = mock.criar(); m.listen(4010, '127.0.0.1', () => ok(m)); m.on('error', () => ok(null)); });
  try {
    const cid06 = S.db.get("SELECT cid FROM competencias WHERE contrato_id='DEMO-UPA' AND competencia_id='2026-06'").cid;

    // 0. O endereço da unidade abre a entrada da unidade (e não a da CTAI), mesmo para quem tem login da CTAI
    { const ctx = await browser.newContext({ locale: 'pt-BR' }); const pg = await ctx.newPage();
      await pg.goto(base + '/unidade'); await pg.waitForSelector('#titulo');
      assert.equal(await pg.textContent('#titulo'), 'Portal da Unidade'); assert.match(await pg.title(), /Unidade/);
      await pg.fill('#login', 'colega1'); await pg.fill('#senha', 'Trocar@123'); await pg.click('button[type=submit]');
      await pg.waitForFunction(() => /equipe da CTAI/.test(document.getElementById('erro').textContent)); assert.match(page_url(pg), /entrar=unidade/);
      await ctx.close(); }
    log('/unidade abre o Portal da Unidade; login da CTAI ali recebe aviso e link para o Console');

    // 1. Unidade: gestor revisa e envia
    const gest = await entrar(browser, 'gestor.demo'); paginas.push(gest);
    await gest.goto(base + '/unidade#/c/' + cid06); await gest.waitForSelector('#conteudo h1');
    assert.match(await gest.textContent('body'), /DEMONSTRAÇÃO – dados fictícios/);
    await limpa(gest); await gest.screenshot({ path: path.join(CAP, '1-unidade-resumo.png') });
    await gest.evaluate((c) => { location.hash = '#/c/' + c + '/enviar'; }, cid06); await gest.waitForSelector('text=Gerar o PDF e enviar para a CTAI');
    await gest.setViewportSize({ width: 1280, height: 1700 }); await limpa(gest); await gest.screenshot({ path: path.join(CAP, '2-unidade-enviar.png') }); await gest.setViewportSize({ width: 1280, height: 860 });
    await gest.click('text=Gerar o PDF e enviar para a CTAI'); await dialogo(gest, 'Gerar e enviar');
    await gest.waitForSelector('text=Enviado (versão 1)');
    const envio = S.db.get('SELECT envio_id, pdf_hash FROM envios WHERE cid = ? ORDER BY versao DESC', cid06);
    assert.ok(envio, 'envio gravado');
    const pdf = await gest.evaluate(async (id) => { const r = await fetch('/api/unidade/envios/' + id + '/pdf'); const b = new Uint8Array(await r.arrayBuffer()); return { ok: r.ok, ini: String.fromCharCode(...b.slice(0, 5)), n: b.length }; }, envio.envio_id);
    assert.equal(pdf.ini, '%PDF-'); log('unidade enviou; PDF de ' + pdf.n + ' bytes');

    // 1b. Unidade: aviso de SEI pendente, instrução no campo, número inválido recusado, número válido registrado
    await gest.evaluate((c) => { location.hash = '#/c/' + c; }, cid06); await gest.waitForSelector('#conteudo h1'); await gest.waitForSelector('text=SEI:');
    assert.match(await gest.textContent('#conteudo'), /ainda não foi registrado/);
    await gest.evaluate((c) => { location.hash = '#/c/' + c + '/envios'; }, cid06); await gest.waitForSelector('#conteudo >> text=Número do documento no SEI'); await gest.waitForTimeout(300);
    await gest.waitForSelector('#conteudo >> text=Depois de anexar e assinar no SEI', { timeout: 8000 });
    assert.match(await gest.textContent('#conteudo'), /Depois de anexar e assinar no SEI, registre aqui o número do documento, para a CTAI saber qual versão foi ao processo/);
    assert.match(await gest.textContent('#conteudo'), /Enviado ao sistema/);
    await gest.fill('#sei-' + envio.envio_id, '12AB'); await gest.click('button:has-text("Registrar")'); await gest.waitForSelector('.msg-erro:has-text("só dígitos")', { timeout: 6000 });
    await limpa(gest); await gest.screenshot({ path: path.join(CAP, '6-unidade-registro-sei.png') });
    await gest.fill('#sei-' + envio.envio_id, '98765432'); await gest.click('button:has-text("Registrar")'); await gest.waitForSelector('text=Registrado no SEI', { timeout: 6000 });
    assert.match(await gest.textContent('#conteudo'), /Documento no SEI nº 98765432/);
    assert.equal(S.db.get('SELECT sei_numero FROM envio_sei WHERE envio_id = ?', envio.envio_id).sei_numero, '98765432');
    log('unidade registrou o número do SEI (número inválido recusado antes)');

    // visão mobile do portal
    const mob = await entrar(browser, 'assistencia.demo', 390); paginas.push(mob);
    await mob.goto(base + '/unidade#/c/' + cid06); await mob.waitForSelector('#conteudo h1');
    await limpa(mob); await mob.screenshot({ path: path.join(CAP, '5-unidade-celular.png') });

    // 2. CTAI: criador vê a competência recebida e monta a minuta
    const cri = await entrar(browser, 'cleuton'); paginas.push(cri);
    await ir(cri, '#/c/' + cid06, 'text=Recálculo');
    await cri.setViewportSize({ width: 1280, height: 1500 }); await limpa(cri); await cri.screenshot({ path: path.join(CAP, '3-ctai-recalculo.png') }); await cri.setViewportSize({ width: 1280, height: 860 });
    await ir(cri, '#/c/' + cid06 + '/envios', 'text=Os dois canais, versão por versão');
    assert.match(await cri.textContent('#conteudo'), /SEI nº 98765432/);
    assert.match(await cri.textContent('#conteudo'), /Registrado no SEI/);
    assert.match(await cri.textContent('#conteudo'), /Comparar com o PDF que está no SEI \(opcional\)/);
    assert.match(await cri.textContent('#conteudo'), /não é exigido e não bloqueia nada/);
    await limpa(cri); await cri.screenshot({ path: path.join(CAP, '7-ctai-dois-canais.png') });
    const bytes = await cri.evaluate(async (id) => Array.from(new Uint8Array(await (await fetch('/api/ctai/envios/' + id + '/pdf')).arrayBuffer())), envio.envio_id);
    await cri.setInputFiles('#cmp-arq', { name: 'do-sei.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) }); await cri.click('button:has-text("Comparar")'); await cri.waitForSelector('text=Arquivo idêntico', { timeout: 8000 });
    await cri.setInputFiles('#cmp-arq', { name: 'do-sei.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from(bytes), Buffer.from('\n% carimbo\n')]) }); await cri.click('button:has-text("Comparar")'); await cri.waitForSelector('text=Arquivo diferente', { timeout: 8000 });
    assert.match(await cri.textContent('#cmp-res'), /o SEI pode alterar o arquivo/);
    log('CTAI viu os dois canais lado a lado e comparou o PDF (idêntico e diferente)');
    await ir(cri, '#/c/' + cid06, 'text=Recálculo');
    // 2b. Analista CTAI: fila, encaminhar à unidade, resposta, normas, acervo e relatório trimestral
    await api(cri, 'POST', '/api/analista/analisar', { cid: cid06, salvar: true, texto: 'O valor foi R$ 1.000,00 (dois mil reais). Foram 63 de 100 (70%) casos no tempo de espera do atendimento vermelho.' });
    await ir(cri, '#/analista', 'text=O que pede ação');
    assert.match(await cri.textContent('#conteudo'), /Editor de Documentos/); assert.equal(await cri.locator('#abas-redator a').count(), 6, 'abas unificadas do Redator');
    assert.equal(await cri.locator('.lateral a.nav', { hasText: 'Analista CTAI' }).count(), 0, 'sem item Analista CTAI no menu');
    await ir(cri, '#/analista/ler', '#an-importar'); await ir(cri, '#/analista', 'text=O que pede ação');
    await cri.setViewportSize({ width: 1280, height: 1300 }); await limpa(cri); await cri.screenshot({ path: path.join(CAP, '10-analista-fila.png') });
    await cri.click('button:has-text("Encaminhar à unidade") >> nth=0'); await cri.waitForSelector('dialog[open] #en-m');
    await cri.selectOption('#en-s', 'assistencia'); await cri.fill('#en-m', 'Explique a diferença entre o valor numérico e o escrito por extenso.');
    await dialogo(cri, 'Encaminhar'); await cri.waitForSelector('text=Aguardando a resposta da unidade', { timeout: 6000 });
    await gest.evaluate(() => { location.hash = '#/esclarecimentos'; }); await gest.waitForSelector('text=Pedido da CTAI');
    await gest.click('button:has-text("Responder")'); await gest.waitForSelector('dialog[open]'); await gest.fill('dialog[open] textarea', 'Foi erro de digitação; vale o valor numérico. Corrigido na próxima versão.');
    await dialogo(gest, 'Enviar resposta'); await gest.waitForSelector('text=Resposta:', { timeout: 6000 });
    await limpa(gest); await gest.screenshot({ path: path.join(CAP, '11-unidade-esclarecimentos.png') });
    await cri.reload(); await cri.waitForSelector('text=Resposta da unidade:', { timeout: 8000 });
    await limpa(cri); await cri.screenshot({ path: path.join(CAP, '12-analista-resposta.png') });
    await cri.click('button:has-text("Aceitar e fixar na mesa") >> nth=0'); await cri.waitForTimeout(500);
    log('Analista CTAI: achado encaminhado, respondido pela unidade e aceito');
    await ir(cri, '#/analista/normas', 'text=Nova norma'); await cri.fill('#nb', 'transparência'); await cri.waitForTimeout(600);
    assert.match(await cri.textContent('#conteudo'), /Transparência ao cidadão/);
    await limpa(cri); await cri.screenshot({ path: path.join(CAP, '13-analista-normas.png') });
    await ir(cri, '#/analista/conferencia', 'text=Conferir com o acervo');
    await cri.click('button:has-text("Conferir com o acervo") >> nth=0'); await cri.waitForSelector('text=Resultado', { timeout: 8000 });
    assert.match(await cri.textContent('#conteudo'), /divergente/);
    await cri.setViewportSize({ width: 1280, height: 1500 }); await limpa(cri); await cri.screenshot({ path: path.join(CAP, '14-analista-acervo.png') });
    await ir(cri, '#/analista/relatorio', '#rt-u'); await cri.selectOption('#rt-t', { index: 2 });
    await cri.click('button:has-text("Montar a minuta")'); await cri.waitForSelector('text=Abrir para editar e congelar', { timeout: 8000 });
    await cri.setViewportSize({ width: 1280, height: 860 }); await limpa(cri); await cri.screenshot({ path: path.join(CAP, '15-analista-relatorio.png') });
    log('Analista CTAI: normas, conferência com o acervo e relatório trimestral');
    await cri.setViewportSize({ width: 1280, height: 860 });
    // 2c. Prazos (SEI dia 20, SIMAS dia 25) e checklist de recebimento
    await gest.evaluate((c) => { location.hash = '#/c/' + c; }, cid06); await gest.waitForSelector('#conteudo >> text=Prazos de entrega'); await gest.waitForTimeout(300);
    assert.match(await gest.textContent('#conteudo'), /Prazo no SEI|SEI · até 20\/07\/2026/);
    assert.match(await gest.textContent('#conteudo'), /SIMAS · até 25\/07\/2026/);
    await gest.click('button:has-text("Informar o envio ao SIMAS")'); await gest.waitForSelector('dialog[open] #simas-d');
    await gest.fill('#simas-d', '2026-07-24'); await dialogo(gest, 'Registrar'); await gest.waitForSelector('#conteudo >> text=SIMAS: entregue no prazo', { timeout: 6000 });
    await gest.setViewportSize({ width: 1280, height: 1000 }); await limpa(gest); await gest.screenshot({ path: path.join(CAP, '16-unidade-prazos.png') });
    await gest.setViewportSize({ width: 1280, height: 860 });
    await ir(cri, '#/c/' + cid06 + '/checklist', 'text=Documentos e relatórios obrigatórios da UPA');
    assert.match(await cri.textContent('#conteudo'), /Responsável pelo envio/);
    assert.match(await cri.textContent('#conteudo'), /Prazo no SEI/);
    await cri.click('tr:has-text("Vigilância de óbito") button:has-text("Editar")'); await cri.waitForSelector('dialog[open] #ck-s');
    await cri.selectOption('#ck-v', 'com divergências'); await cri.fill('#ck-o', 'Relatório da comissão chegou sem a ata da revisão.');
    await dialogo(cri, 'Salvar'); await cri.waitForSelector('text=decidido por cleuton', { timeout: 6000 });
    await cri.setViewportSize({ width: 1280, height: 1500 }); await cri.evaluate(() => window.scrollTo(0, 0)); await limpa(cri); await cri.screenshot({ path: path.join(CAP, '17-ctai-checklist.png' ) }); await cri.setViewportSize({ width: 1280, height: 860 });
    await ir(cri, '#/', 'text=Unidades'); assert.ok(await cri.locator('a.un-linha').count() >= 1, 'lista de unidades'); await ir(cri, '#/u/DEMO-UPA', 'text=Receber'); assert.match(await cri.textContent('#conteudo'), /Prazos/);
    log('prazos informados pela unidade e checklist de recebimento editado pela CTAI');
    for (const [k, v] of [['desconto_modo', 'faixa'], ['vermelho', 'faixa']]) await api(cri, 'PUT', '/api/ctai/contratos/DEMO-UPA/decisoes/' + k, { valor: v, justificativa: 'Teste ponta a ponta' });
    await ir(cri, '#/pareceres', '.rec-cab:has-text("Novo parecer")');
    if (!(await cri.isVisible('#np-c'))) await cri.click('.rec-cab:has-text("Novo parecer")'); await cri.selectOption('#np-c', 'DEMO-UPA'); await cri.selectOption('#np-a', '2026'); await cri.selectOption('#np-t', '2'); await cri.fill('#np-n', '1/2026');
    await cri.click('text=Criar a minuta'); await cri.waitForSelector('#md-salvar');
    assert.match(await cri.inputValue('#md-introducao'), /Contrato de Gestão n\.º/);
    await cri.fill('#md-financeiro', 'Informações financeiras acostadas ao processo (demonstração).'); await cri.click('#md-salvar'); await cri.waitForSelector('#md-salvar'); await cri.waitForTimeout(500);
    await cri.click('#md-revisar'); await cri.waitForSelector('text=Busca externa (normas e jurisprudência)');
    assert.ok(await cri.isVisible('#md-conectar-q1'), 'aviso de dados não conectados no Quadro 01');
    assert.ok(await cri.isVisible('#md-gaocg'), 'botão do GAOCG no parecer');
    assert.ok(await cri.isVisible('#rel-importar'), 'importação de relatório no Redator');
    log('parecer: modelo padrão preenchido, editado e revisão completa rodada');
    const pid = Number(cri.url().split('#/p/')[1]);
    await cri.click('button:has-text("Ajustar") >> nth=0'); await cri.waitForSelector('dialog[open]');
    await cri.fill('#aj-j', 'Conferido na evidência anexada'); await dialogo(cri, 'Salvar'); await cri.waitForTimeout(500);
    await cri.click('text=Congelar e enviar para conferência'); await cri.waitForSelector('text=Mesa de conferência');
    const vid = Number(cri.url().split('#/v/')[1]);
    log('minuta criada e congelada (versão ' + vid + ')');

    // 3. Mesa: dois colegas e a superintendente
    for (const login of ['colega1', 'colega2', 'nathalia']) {
      const p = await entrar(browser, login); paginas.push(p);
      await ir(p, '#/v/' + vid, '.item-mesa');
      const nOk = await p.locator('.item-mesa button:text-is("OK")').count();
      if (nOk !== 8) console.log('DEBUG', login, (await p.textContent('#conteudo')).replace(/\s+/g,' ').slice(0,700));
      assert.equal(nOk, 8, login + ' vê 8 itens para conferir');
      assert.match(await p.textContent('#conteudo'), /Documento no SEI confere com a versão recebida no sistema/);
      assert.match(await p.textContent('.item-mesa details[open]'), /98765432/);
      if (login === 'colega1') { await p.setViewportSize({ width: 1280, height: 1150 }); await p.evaluate(() => window.scrollTo(0, 0)); await limpa(p); await p.screenshot({ path: path.join(CAP, '9-mesa-item-sei.png') }); await p.setViewportSize({ width: 1280, height: 860 }); }
      for (let i = 0; i < 8; i++) { await p.locator('.item-mesa button:text-is("OK")').first().click(); await p.waitForTimeout(250); }
      if (login === 'colega1') { await p.setViewportSize({ width: 1280, height: 1500 }); await p.evaluate(() => window.scrollTo(0, 0)); await limpa(p); await p.screenshot({ path: path.join(CAP, '4-mesa.png') }); await p.setViewportSize({ width: 1280, height: 860 }); }
      if (login === 'nathalia') {
        await p.waitForSelector('text=Autorizar esta versão');
        await p.click('button:has-text("Autorizar esta versão")'); await dialogo(p, 'Autorizar'); await p.waitForSelector('text=Autorizada por');
      }
      log(login + ' conferiu' + (login === 'nathalia' ? ' e autorizou' : ''));
    }
    // criador não confere o próprio trabalho
    await ir(cri, '#/v/' + vid, '.item-mesa'); assert.equal(await cri.locator('.item-mesa button:text-is("OK")').count(), 0);

    // 4. SEI
    await ir(cri, '#/p/' + pid, 'text=Anexar no SEI'); await cri.click('text=Registrar o número do SEI'); await cri.fill('#perg-campo', '12345678'); await dialogo(cri, 'Registrar');
    await cri.waitForSelector('text=Anexado ao SEI');
    const pdfMin = await cri.evaluate(async (id) => { const r = await fetch('/api/ctai/versoes/' + id + '/pdf'); const b = new Uint8Array(await r.arrayBuffer()); return String.fromCharCode(...b.slice(0, 5)); }, vid);
    assert.equal(pdfMin, '%PDF-');
    const trilha = await api(cri, 'GET', '/api/ctai/trilha/verificar'); assert.equal(trilha.ok, true); log('trilha íntegra (' + trilha.total + ' eventos)');
    // 4b. Portal da unidade, interações: ficha com erro por campo, CSV recusado e aceito, integração (prévia)
    const cid07 = S.db.get("SELECT cid FROM competencias WHERE contrato_id='DEMO-UPA' AND competencia_id='2026-07'").cid;
    await gest.evaluate((c) => { location.hash = '#/c/' + c + '/ficha/assistencia'; }, cid07);
    await gest.waitForSelector('#f-i2_1_valor');
    await gest.fill('#f-i2_1_valor', 'abc'); await gest.click('button:has-text("Salvar rascunho")');
    await gest.waitForSelector('.campo.erro', { timeout: 6000 });
    await gest.fill('#f-i2_1_valor', '22,5'); await gest.click('button:has-text("Salvar rascunho")'); await gest.waitForSelector('text=Ficha salva.');
    await gest.evaluate((c) => { location.hash = '#/c/' + c + '/lista/retorno'; }, cid07);
    await gest.waitForSelector('#arq');
    await gest.setInputFiles('#arq', { name: 'ruim.csv', mimeType: 'text/csv', buffer: Buffer.from('protocolo;nome;retornou_24h\nA1;Maria;sim\n') });
    await gest.waitForSelector('text=Arquivo recusado', { timeout: 6000 });
    await gest.setInputFiles('#arq', { name: 'bom.csv', mimeType: 'text/csv', buffer: Buffer.from('protocolo;retornou_24h\nDEMO-1;sim\nDEMO-2;não\nDEMO-3;não\n') });
    await gest.waitForSelector('text=3 linha(s) no rascunho', { timeout: 6000 });
    S.db.run("UPDATE integracoes SET ativo = 1 WHERE contrato_id = 'DEMO-UPA'");
    await gest.evaluate(() => { location.hash = '#/integracao'; }); await gest.waitForSelector('text=Ver prévia (não grava)');
    await gest.selectOption('#ic', String(cid07)); await gest.click('button:has-text("Ver prévia")'); await gest.waitForSelector('text=Prévia: nada foi gravado.', { timeout: 10000 });
    await gest.click('button:has-text("Buscar e guardar como lote pendente")'); await gest.waitForSelector('text=lote pendente', { timeout: 10000 });
    await gest.evaluate((c) => { location.hash = '#/c/' + c; }, cid07); await gest.waitForSelector('button:has-text("Confirmar")', { timeout: 8000 });
    await gest.click('button:has-text("Confirmar") >> nth=0'); await gest.waitForSelector('text=Lote confirmado.');
    log('unidade: ficha com erro por campo, CSV recusado/aceito, integração em prévia e lote confirmado');

    // 4c. Console da CTAI, interações: decidir regra, decidir divergência, Achados do Analista
    await ir(cri, '#/regras/DEMO-UPA', '#q-iam_meta');
    await cri.selectOption('#q-iam_meta', '30'); await cri.fill('#j-iam_meta', 'Ficha do contrato, item 6.6.2');
    await cri.locator('div.cartao', { has: cri.locator('#q-iam_meta') }).locator('button:has-text("Registrar decisão")').click(); await cri.waitForSelector('text=Decisão registrada.');
    try { await cri.waitForTimeout(1200); await ir(cri, '#/c/' + cid06 + '/divergencias', 'select[id^="dv"]', 20000); } catch (e) { console.log('DBGX', cri.url(), (await cri.textContent('#conteudo')).replace(/\s+/g, ' ').slice(0, 500)); throw e; }
    await cri.waitForTimeout(800); const dv = cri.locator('select[id^="dv"]').first(); await dv.selectOption('aceita');
    await dv.locator('xpath=ancestor::div[contains(@class,"cartao")]').locator('button:has-text("Registrar")').click();
    await cri.fill('#perg-campo', 'Conferido com a evidência da unidade'); await dialogo(cri, 'Confirmar'); await cri.waitForSelector('text=Registrado.');
    await ir(cri, '#/c/' + cid06 + '/achados', 'text=O Analista lê o texto do relatório enviado');
    await cri.click('button:has-text("Analisar o relatório enviado")').catch(() => cri.click('#conteudo button.sec >> nth=0')); await cri.waitForTimeout(1500);
    log('console: decisão de regra, divergência aceita com observação, achados');

    // 4d. Nova versão no sistema depois do SEI: a unidade reenvia e a CTAI vê o alerta (nada é bloqueado)
    await gest.evaluate((c) => { location.hash = '#/c/' + c + '/enviar'; }, cid06); await gest.waitForSelector('#motivo');
    await gest.fill('#motivo', 'Correção do tempo médio depois da assinatura no SEI');
    await gest.click('text=Gerar o PDF e enviar para a CTAI'); await dialogo(gest, 'Gerar e enviar'); await gest.waitForSelector('text=Enviado (versão 2)', { timeout: 20000 });
    await ir(cri, '#/c/' + cid06 + '/envios', 'text=Os dois canais, versão por versão');
    await cri.waitForSelector('text=Nova versão no sistema depois do SEI');
    await limpa(cri); await cri.screenshot({ path: path.join(CAP, '8-ctai-alerta-sei.png') });
    await ir(cri, '#/c/' + cid06, 'text=Recálculo'); assert.match(await cri.textContent('#conteudo'), /Sistema × SEI/);
    await ir(cri, '#/u/DEMO-UPA', 'text=Receber'); await cri.selectOption('#un-tri', '2026-T2'); await cri.waitForSelector('text=SEI: 1 alerta(s)');
    // Configurações da unidade: senha errada não derruba a sessão; com a senha certa e o motivo, grava
    await cri.click('button:has-text("Configurações") >> nth=0'); await cri.waitForSelector('dialog[open] .cfg');
    await cri.fill('dialog textarea[placeholder^="Ex.:"]', 'TA 5 mudou a meta'); await cri.fill('dialog input[type=password]', 'errada'); await cri.click('dialog button:has-text("Salvar alteração")');
    await cri.waitForSelector('dialog .msg-erro:has-text("Senha incorreta.")'); assert.match(cri.url(), /#\/u\/DEMO-UPA/, 'senha errada não derruba a sessão');
    await cri.fill('dialog input[type=password]', SENHA); await cri.click('dialog button:has-text("Salvar alteração")'); await cri.waitForSelector('dialog', { state: 'detached' });
    log('Configurações da unidade: senha e motivo');
    await gest.evaluate((c) => { location.hash = '#/c/' + c; }, cid06); await gest.waitForSelector('text=Você enviou a v2 depois de registrar o SEI da v1');
    log('nova versão depois do SEI gerou o alerta na CTAI e o aviso na unidade');

    // 5. Telas do administrador: Analista, trilha, usuários, integrações
    const adm = await entrar(browser, 'admin'); paginas.push(adm);
    await ir(adm, '#/analista/ler', '#an-t');
    await adm.fill('#an-t', 'No mês de junho de 2026 foram realizados 22 (vinte) atendimentos de dor torácica.');
    await adm.click('button:has-text("Analisar")'); await adm.waitForTimeout(1500); if (process.env.DBG) console.log((await adm.textContent('#conteudo')).replace(/\s+/g,' ').slice(-700)); await adm.waitForSelector('text=Valor por extenso diferente do numérico', { timeout: 8000 });
    log('Analista (regras locais) apontou o extenso diferente do numérico');
    await ir(adm, '#/trilha', 'text=Cadeia íntegra');
    await ir(adm, '#/admin', '#nu-l');
    await adm.fill('#nu-l', 'colega.novo'); await adm.fill('#nu-n', 'Colega Novo'); await adm.click('#novo-usuario .seg button:has-text("Colega")');
    await adm.fill('#nu-busca', 'Olinda'); await adm.locator('#novo-usuario .lista-un input[type=checkbox]').first().check(); await adm.click('#nu-criar');
    await adm.waitForSelector('td:has-text("colega.novo")', { timeout: 8000 });
    await adm.fill('#nu-l', 'setor.novo'); await adm.fill('#nu-n', 'Setor Novo'); await adm.click('#novo-usuario .seg.grande button:has-text("Unidade")');
    assert.equal(await adm.locator('#nu-criar').isDisabled(), true, 'unidade é obrigatória para usuário de unidade');
    await adm.click('#novo-usuario .seg button:has-text("Responsável de setor")'); await adm.fill('#nu-busca', 'Demonstra'); await adm.locator('#novo-usuario .lista-un input[type=radio]').first().check();
    await adm.click('#novo-usuario .seg button:has-text("Qualidade")'); await adm.click('#nu-criar');
    await adm.waitForSelector('td:has-text("setor.novo")', { timeout: 8000 });
    await ir(adm, '#/integracoes', 'text=Testar a conexão');
    const cartaoDemo = adm.locator('div.cartao', { hasText: 'API de teste' }).last();
    await cartaoDemo.locator('button:has-text("Testar a conexão")').click(); await adm.waitForSelector('text=Conectou em', { timeout: 8000 });
    await ir(adm, '#/regras', '#conteudo h1'); await ir(adm, '#/c/' + cid06 + '/divergencias', 'text=Divergências');
    log('telas do administrador percorridas');

    // 6. Gestão CTAI (superintendente): carteira, painel, produção, usuários, IA e PDF do painel
    const sup = await entrar(browser, 'nathalia', 1280, true); paginas.push(sup);
    await sup.waitForSelector('a.nav:has-text("Gestão")');
    await ir(sup, '#/gestao/carteira', 'text=Quem acompanha cada unidade');
    await sup.click('#cart-ed-colega1'); await sup.waitForSelector('dialog[open] #ck-DEMO-UPA'); await sup.check('#ck-DEMO-UPA'); await sup.fill('#ck-motivo', 'Distribuição inicial'); await dialogo(sup, 'Salvar carteira'); await sup.waitForSelector('text=Carteira atualizada.');
    await sup.click('#cart-ed-cleuton'); await sup.waitForSelector('dialog[open] #ck-UPA-OLINDA'); await sup.check('#ck-UPA-OLINDA'); await sup.check('#ck-DEMO-UPA'); await dialogo(sup, 'Salvar carteira'); await sup.waitForSelector('text=Carteira atualizada.');
    for (const lg of ['colega1', 'cleuton']) S.db.run('INSERT OR REPLACE INTO alimentar_liberacao (usuario_id, liberado_em, por, motivo) SELECT usuario_id, ?, ?, ? FROM usuarios WHERE login = ?', new Date().toISOString(), 'e2e', 'fluxo do Console sem o primeiro acesso (testado em alimentar.js)', lg);
    await sup.waitForSelector('#conteudo >> text=Histórico de mudanças'); await limpa(sup); await sup.setViewportSize({ width: 1280, height: 1000 }); await sup.screenshot({ path: path.join(CAP, '19-gestao-carteira.png') });
    await ir(sup, '#/gestao', 'text=Alertas'); await sup.waitForSelector('.un-card');
    assert.match(await sup.textContent('#conteudo'), /Responsável: .*Colega conferente 1/);
    await sup.setViewportSize({ width: 1280, height: 1500 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '18-gestao-painel.png') });
    await sup.selectOption('#gp-func', { label: 'Cleuton' }); await sup.waitForTimeout(500); await sup.waitForSelector('.un-card');
    assert.equal(await sup.locator('.un-card').count(), 2);
    await sup.selectOption('#gp-un', { index: 1 }); await sup.waitForTimeout(500); assert.equal(await sup.locator('.un-card').count(), 1);
    await sup.selectOption('#gp-un', { value: '' }); await sup.selectOption('#gp-func', { value: '' }); await sup.waitForTimeout(500);
    const pdfPainel = await sup.evaluate(async () => { const r = await fetch(document.querySelector('#gp-pdf').getAttribute('href')); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return { ok: r.ok, b64: btoa(s) }; });
    assert.ok(pdfPainel.ok); const bufPainel = Buffer.from(pdfPainel.b64, 'base64'); assert.equal(bufPainel.slice(0, 5).toString(), '%PDF-'); fs.writeFileSync(path.join(CAP, '23-painel-superintendencia.pdf'), bufPainel);
    await ir(sup, '#/gestao/producao', 'text=Por funcionário'); await sup.setViewportSize({ width: 1280, height: 900 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '20-gestao-producao.png') });
    await ir(sup, '#/gestao/usuarios', '#nu-l');
    await sup.fill('#nu-l', 'colega.gestao'); await sup.fill('#nu-n', 'Colega pela Gestão'); await sup.click('#novo-usuario .seg button:has-text("Colega")'); await sup.click('#nu-criar');
    await sup.waitForSelector('td:has-text("colega.gestao")', { timeout: 8000 }); await sup.setViewportSize({ width: 1280, height: 1000 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '21-gestao-usuarios.png') });
    await ir(sup, '#/gestao/ia', '#ri-nova');
    await sup.click('#ri-nova'); await sup.waitForSelector('dialog[open] #ri-chave'); await sup.selectOption('#ri-serv', 'kimi'); await sup.fill('#ri-rotulo', 'Kimi de demonstração'); await sup.fill('#ri-chave', 'sk-demo-NAO-REAL-9876'); await sup.check('#ri-jur'); await dialogo(sup, 'Salvar'); await sup.waitForSelector('text=••••9876');
    await sup.click('#ri-nova'); await sup.waitForSelector('dialog[open] #ri-chave'); await sup.selectOption('#ri-serv', 'gemini'); await sup.fill('#ri-chave', 'chave-demo-NAO-REAL-1234'); await sup.check('#ri-jur'); await dialogo(sup, 'Salvar'); await sup.waitForSelector('text=••••1234');
    assert.equal(await sup.locator('#rack-ia button[data-testar]').count(), 2, 'cada chave tem o botão Testar');
    assert.doesNotMatch(await sup.content(), /sk-demo-NAO-REAL/, 'a chave nunca aparece na tela');
    await sup.setViewportSize({ width: 1280, height: 1500 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '22-gestao-ia.png') });
    const colegaCart = await entrar(browser, 'colega1', 1280, true); paginas.push(colegaCart);
    await colegaCart.waitForSelector('#conteudo h1'); assert.doesNotMatch(await colegaCart.textContent('#conteudo'), /Olinda/); assert.equal(await colegaCart.locator('a.nav:has-text("Gestão")').count(), 0);
    log('Gestão CTAI: carteira, painel com filtros, PDF, produção, usuários e IA; o colega só vê a carteira dele');

    // 7. Portal da Unidade: o gestor cuida da equipe; Gestão CTAI: aba Acessos
    await ir(gest, '#/equipe', '#eq-l'); await gest.waitForSelector('text=Responsável por ficha');
    await gest.fill('#eq-l', 'ouvidoria.nova'); await gest.fill('#eq-n', 'Nova da Ouvidoria'); await gest.check('#nv-ouvidoria'); await gest.check('#nv-educacao'); await gest.click('#eq-criar');
    await gest.waitForSelector('td:has-text("ouvidoria.nova")', { timeout: 8000 });
    await gest.selectOption('#rf-rh', { label: 'Nova da Ouvidoria' }); await gest.click('#rf-btn-rh'); await gest.waitForSelector('text=Responsável trocado.');
    assert.equal(S.db.get("SELECT contrato_id, perfil FROM usuarios WHERE login='ouvidoria.nova'").contrato_id, 'DEMO-UPA');
    await gest.setViewportSize({ width: 1280, height: 1500 }); await limpa(gest); await gest.screenshot({ path: path.join(CAP, '24-unidade-equipe.png') });
    const respSetor = await entrar(browser, 'assistencia.demo', 1280, true); paginas.push(respSetor);
    assert.equal(await respSetor.locator('a.nav:has-text("Equipe da unidade")').count(), 0, 'responsável de setor não vê o menu da equipe');
    await ir(sup, '#/gestao/acessos', 'text=Registro somente de leitura'); await sup.waitForSelector('#conteudo tbody tr');
    const txtAc = await sup.textContent('#conteudo'); assert.match(txtAc, /cadastro \(gestor\)/); assert.match(txtAc, /entrada/);
    await sup.selectOption('#ga-ev', 'cadastro'); await sup.waitForTimeout(500);
    await sup.setViewportSize({ width: 1280, height: 1000 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '25-gestao-acessos.png') });
    const csvAc = await sup.evaluate(async () => { const r = await fetch(document.querySelector('#ga-csv').getAttribute('href')); return { ok: r.ok, t: (await r.text()).slice(0, 80) }; });
    assert.ok(csvAc.ok && /data_hora;evento/.test(csvAc.t));
    log('equipe da unidade pelo gestor e aba Acessos (CSV/PDF)');
    // Importação em lote de unidades e carteira (arquivo fictício)
    const arqImp = path.join(S.dir, 'lote-ficticio.csv');
    fs.writeFileSync(arqImp, ['tipo;unidade;municipio;analista', 'UPA;Exemplo Alfa;Cidade Alfa;colega1', 'UPAE;Exemplo Alfa;Cidade Alfa;colega1', 'Hospital;Exemplo Beta;Cidade Beta;colega2', 'UPA;Exemplo Beta;Cidade Beta;Pessoa Nova Ficticia',
      'UPA;Exemplo Gama;Cidade Gama;colega1', 'UPA;Exemplo Gama;Cidade Gama;colega2', 'Clinica;Exemplo Erro;;colega1'].join('\n'));
    await ir(sup, '#/gestao/importar', '#imp-arquivo');
    await sup.setInputFiles('#imp-arquivo', arqImp);
    await sup.waitForSelector('#imp-conflitos', { timeout: 8000 });
    assert.equal(await sup.locator('#imp-gravar').isDisabled(), true, 'não grava com decisões pendentes');
    await sup.selectOption('.imp-dec-analista', 'criar'); await sup.waitForSelector('.imp-dec-conflito', { timeout: 8000 });
    await sup.selectOption('.imp-dec-conflito', 'dividir'); await sup.waitForTimeout(400);
    await sup.check('#imp-ignorar'); await sup.waitForFunction(() => !document.querySelector('#imp-gravar').disabled, null, { timeout: 8000 });
    await sup.setViewportSize({ width: 1280, height: 1700 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '26-gestao-importar.png') });
    await sup.click('#imp-gravar'); await sup.waitForSelector('.aviso.ok >> text=Importação #', { timeout: 8000 });
    await ir(sup, '#/gestao', 'text=Alertas'); await sup.waitForSelector('#fila-sem-gestor');
    assert.match(await sup.textContent('#fila-sem-gestor'), /Exemplo Alfa/);
    log('importação em lote da carteira e fila de unidades aguardando gestor');
    // Caixa de entrada, minhas unidades e entregas por carteira
    const CXs = require('../../server/caixa');
    const uCol = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega1'").usuario_id;
    await sup.evaluate(async (id) => { await fetch('/api/gestao/carteira/' + id, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-ctai': '1' }, body: JSON.stringify({ unidades: ['DEMO-UPA'] }) }); }, uCol);
    for (const e of S.db.all('SELECT envio_id, cid, versao FROM envios WHERE recebido_em IS NOT NULL ORDER BY envio_id DESC LIMIT 2')) { S.db.run("DELETE FROM caixa_destinos WHERE item_id IN (SELECT item_id FROM caixa_itens WHERE chave = ?)", 'envio:' + e.envio_id); S.db.run('DELETE FROM caixa_itens WHERE chave = ?', 'envio:' + e.envio_id); CXs.eventoEnvio(S.db, e); }
    CXs.sincronizar(S.db, { forcar: true });
    await colegaCart.goto(colegaCart.url().split('#')[0] + '#/caixa'); await colegaCart.waitForSelector('#cx-lista .cx-item', { timeout: 8000 });
    assert.ok(await colegaCart.locator('#caixa-contador').count() >= 1, 'contador de não lidos no menu');
    await colegaCart.setViewportSize({ width: 1280, height: 1500 }); await limpa(colegaCart); await colegaCart.screenshot({ path: path.join(CAP, '27-caixa-entrada.png') });
    await colegaCart.locator('.cx-tratar').first().click(); await colegaCart.fill('#perg-campo', 'Conferido'); await colegaCart.click('dialog button:has-text("Confirmar")');
    await colegaCart.waitForFunction(() => document.querySelectorAll('.cx-item').length >= 0, null, { timeout: 5000 }); await colegaCart.waitForTimeout(500);
    await colegaCart.goto(colegaCart.url().split('#')[0] + '#/minhas-unidades'); await colegaCart.waitForSelector('#cx-lista .un-bloco', { timeout: 8000 });
    assert.match(colegaCart.url(), /#\/caixa$/, 'o endereço antigo de Minhas unidades leva à caixa única');
    assert.ok(await colegaCart.locator('.un-bloco .interruptor').count() >= 1, 'cada unidade mostra quem a acompanha');
    assert.ok(await colegaCart.locator('#sb-ativar').count() === 1, 'ausência desligada com botão para ativar');
    await colegaCart.setViewportSize({ width: 1280, height: 1000 }); await limpa(colegaCart); await colegaCart.screenshot({ path: path.join(CAP, '28-caixa-por-unidade.png') });
    await ir(sup, '#/gestao/entregas', '#en-pdf'); await sup.waitForSelector('[data-analista="colega1"]', { timeout: 8000 });
    await sup.setViewportSize({ width: 1280, height: 1100 }); await limpa(sup); await sup.screenshot({ path: path.join(CAP, '29-gestao-entregas.png') });
    log('caixa de entrada única por unidade e entregas por carteira');
    // Tela inicial por perfil e configuração de volta (CTAI_PAINEL_ANALISTA)
    CFG.painelAnalista = false;
    const an = await entrar(browser, 'colega1', 1280, true); paginas.push(an);
    await an.waitForSelector('#cx-resumo', { timeout: 8000 });
    assert.match(an.url(), /#\/caixa$/, 'analista começa na Caixa de entrada');
    assert.equal(await an.locator('a.nav:text-is("Unidades")').count(), 1, 'o analista sempre tem o item Unidades (o início dele é a Caixa)');
    assert.ok(await an.isVisible('#cx-resumo'), 'quadro de resumo da caixa');
    await an.setViewportSize({ width: 1280, height: 900 }); await limpa(an); await an.screenshot({ path: path.join(CAP, '30-inicio-analista-caixa.png') });
    await an.goto(base + '/ctai#/'); await an.waitForSelector('#cx-resumo', { timeout: 8000 }); assert.match(an.url(), /#\/caixa$/, 'link antigo do Painel redireciona sem erro');
    const sup2 = await entrar(browser, 'nathalia', 1280, true); paginas.push(sup2);
    await sup2.waitForSelector('#conteudo h1', { timeout: 8000 }); assert.match(await sup2.textContent('#conteudo h1'), /Unidades/, 'inicio superintendente: ' + sup2.url()); assert.equal(await sup2.locator('a.nav:text-is("Unidades")').count(), 1, 'superintendente mantém o Painel');
    CFG.painelAnalista = true;
    await an.goto(base + '/ctai?v=2#/'); await an.waitForSelector('#conteudo h1', { timeout: 8000 }); assert.match(await an.textContent('#conteudo h1'), /Unidades/, 'painel de volta: ' + an.url());
    assert.equal(await an.locator('a.nav:text-is("Unidades")').count(), 1, 'com a configuração ligada, o analista começa em Unidades');
    CFG.painelAnalista = false;
    log('tela inicial por perfil: analista na Caixa de entrada, superintendente no Painel, configuração de volta');
    // Documentos: ensinar um modelo, montar um ofício, pedir conferência e gerar PDF
    await an.goto(base + '/ctai#/documentos/modelos'); await an.waitForSelector('.rec-cab:has-text("Ensinar um modelo novo")', { timeout: 8000 });
    await an.click('.rec-cab:has-text("Ensinar um modelo novo")');
    await an.fill('#en-n', 'Ofício de teste'); await an.fill('#en-x', 'Ofício nº 123/2024\nRecife, 10/03/2024\nSenhor Gestor, encaminhamos o processo 0012345678.000123/2024-11 para as providências.');
    await an.click('button:has-text("Aprender este modelo")'); await an.waitForSelector('#en-corpo', { timeout: 8000 });
    await an.click('button:has-text("Guardar modelo")'); await an.waitForSelector('td:has-text("Ofício de teste")', { timeout: 8000 });
    await an.goto(base + '/ctai#/d/novo/-/-'); await an.waitForSelector('#nd-t', { timeout: 8000 });
    await an.selectOption('#nd-t', 'oficio'); await an.selectOption('#nd-m', { label: 'Ofício de teste' });
    await an.click('button:has-text("Montar o rascunho")'); await an.waitForSelector('#dc-tx', { timeout: 8000 });
    assert.ok((await an.inputValue('#dc-tx')).includes('Senhor Gestor'), 'rascunho veio do modelo');
    await an.setViewportSize({ width: 1280, height: 900 }); await limpa(an); await an.screenshot({ path: path.join(CAP, '31-documento-editor.png') });
    log('documentos: modelo ensinado e rascunho montado');
    await an.goto(base + '/ctai#/ensinar'); await an.waitForSelector('#en-tx', { timeout: 8000 });
    await an.fill('#en-tx', 'Quando faltar o relatório, avisar a unidade no mesmo dia.'); await an.click('#en-enviar');
    await an.waitForSelector('td:has-text("Quando faltar o relatório")', { timeout: 8000 });
    log('ensinar ao sistema: pedido enviado');
    for (const p of paginas) assert.deepEqual(p.erros, [], 'erros de JavaScript na tela: ' + p.erros.join(' | '));
    console.log('\nE2E OK');
  } catch (e) {
    console.error('\nE2E FALHOU:', e.message);
    for (const p of paginas) if (p.erros.length) console.error(p.erros);
    process.exitCode = 1;
  } finally { await browser.close(); if (mockSrv) mockSrv.close(); await S.fechar(); }
})();
