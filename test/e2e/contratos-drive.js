'use strict';
// Contratos e TAs (Drive), de ponta a ponta no navegador, com um servidor falso do Apps Script e a UPAE Palmares:
// abrir a unidade -> ver contrato e aditivos da pasta -> ler e montar o quadro -> conferir -> confirmar -> "o que vale hoje" -> aviso de arquivo novo na Caixa -> completude.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const FD = require('../fake-drive');
const { chromium } = require('playwright');
const SHOTS = process.env.CTAI_SHOTS || '';

(async () => {
  const fake = await FD.iniciar();
  process.env.CONTRATOS_DRIVE_URL = fake.url; // como na hospedagem: variável do servidor
  const H = require('../helpers');
  const S = await H.iniciar(); const base = S.base;
  S.db.run("UPDATE contratos SET unidade = 'UPAE Palmares' WHERE contrato_id = 'DEMO-UPA'");
  require('../../server/carteira').definir(S.db, 'teste', S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'").usuario_id, ['DEMO-UPA']);
  S.db.run("INSERT INTO alimentar_liberacao (usuario_id, liberado_em, por, motivo) SELECT usuario_id, ?, 'teste', 'e2e' FROM usuarios WHERE login = 'cleuton'", new Date().toISOString()); // fora do primeiro acesso
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const foto = async (p, nome) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, nome + '.png'), fullPage: true }); } };
  const entrar = async (login) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); p.erros = [];
    p.on('pageerror', (e) => p.erros.push(e.message));
    await p.goto(base + '/'); await p.fill('#login', login); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }); }
    await p.waitForSelector('#conteudo');
    return p;
  };
  try {
    const p = await entrar('cleuton');
    // tela da unidade: bloco "Contrato e atualizações"
    await p.evaluate(() => { location.hash = '#/u/DEMO-UPA'; });
    await p.waitForSelector('#ct-bloco table', { timeout: 10000 }).catch(async (e) => { console.error('BLOCO:', await p.innerText('#conteudo').catch(() => '?')); throw e; });
    const linhas = await p.$$('#ct-bloco table tbody tr');
    assert.equal(linhas.length, 4, 'contrato + 3 aditivos da UPAE Palmares');
    const texto = await p.innerText('#ct-bloco');
    assert.match(texto, /Pasta atualizada em 20\/09\/2026/); assert.match(texto, /só atualiza a pasta no dia 20/);
    assert.match(texto, /1º Termo Aditivo/); assert.match(texto, /não é Google Doc/);
    assert.ok((await p.$$('#ct-bloco a:has-text("Abrir no Drive")')).length >= 4, 'link para abrir no Drive em cada arquivo');
    await foto(p, 'unidade-contrato');
    // ler o contrato: sem IA no teste, abre em branco para preencher à mão
    await p.click('#ct-bloco tr:has-text("Contrato de Gestão") button.ct-ler');
    await p.waitForSelector('h1:has-text("Conferir o quadro")', { timeout: 15000 });
    await p.fill('#ct-obj', 'Gerenciamento da UPAE Palmares');
    await p.fill('#ct-vi', '01/03/2023'); await p.fill('#ct-vf', '28/02/2024'); await p.fill('#ct-vt', 'R$ 12.000.000,00');
    await p.click('#ct-add');
    await p.fill('input[aria-label="Ponto"]', 'Repasse mensal'); await p.fill('input[aria-label="Valor ou meta"]', 'R$ 1.000.000,00');
    await p.selectOption('select[aria-label="Assunto"]', 'repasse');
    await p.click('#ct-salvar'); await p.waitForSelector('.toast:has-text("Rascunho salvo")');
    await p.click('button:has-text("Mostrar o texto lido")'); await p.waitForSelector('.hi-texto');
    const lido = await p.innerText('.hi-texto'); assert.ok(lido.includes('CONTRATO DE GESTÃO') && !lido.includes('123.456.789-09'), 'o texto lido vem mascarado');
    await foto(p, 'conferir-quadro');
    await p.click('#ct-confirmar'); await p.click('dialog button:has-text("Sim, confirmar")');
    await p.waitForSelector('#ct-vale-hoje', { timeout: 10000 });
    const vale = await p.innerText('#ct-vale-hoje');
    assert.match(vale, /O que vale hoje/); assert.match(vale, /Repasse mensal/); assert.match(vale, /28\/02\/2024/); assert.match(vale, /todos os quadros confirmados/);
    // novo arquivo na pasta: aviso na unidade e item na Caixa de entrada
    fake.adicionar({ id: 'doc-ta4-palmares', nome: '4º Termo Aditivo - UPAE Palmares', caminho: FD.RAIZ + ' / UPAE / Palmares / Termos Aditivos', atualizado_em: '2026-10-20T12:00:00.000Z', texto: 'QUARTO TERMO ADITIVO.' });
    await p.click('#ct-atualizar');
    await p.waitForSelector('#ct-bloco:has-text("Mudou na pasta desde a última consulta")', { timeout: 10000 });
    await p.evaluate(() => { location.hash = '#/caixa'; });
    await p.waitForSelector('text=Novo arquivo na pasta de contratos: UPAE Palmares', { timeout: 10000 });
    // Integrações: cartão, chave opcional e teste
    await p.evaluate(() => { location.hash = '#/integracoes'; });
    await p.waitForSelector('#cd-cartao', { timeout: 10000 });
    assert.match(await p.innerText('#cd-cartao'), /Contratos e TAs \(Drive\)/);
    await p.click('#cd-testar'); await p.waitForSelector('#cd-saida:has-text("Conectado. ")', { timeout: 15000 });
    await foto(p, 'integracoes');
    assert.deepEqual(p.erros, []);
    // painel de completude (superintendência)
    const n = await entrar('nathalia');
    await n.evaluate(() => { location.hash = '#/gestao/completude'; });
    await n.waitForSelector('h3:has-text("Cleuton"), h3:has-text("Unidades sem carteira")', { timeout: 10000 });
    const comp = await n.innerText('#conteudo'); assert.match(comp, /Completude/); assert.match(comp, /UPAE Palmares/); assert.match(comp, /contrato lido/);
    await foto(n, 'completude');
    assert.deepEqual(n.erros, []);
    // quem ainda está no primeiro acesso não vê "Página não encontrada": recebe a explicação e o caminho de volta
    require('../../server/carteira').definir(S.db, 'teste', S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega1'").usuario_id, ['UPA-OLINDA']);
    const c1 = await entrar('colega1');
    await c1.evaluate(() => { location.hash = '#/u/UPA-OLINDA'; });
    await c1.waitForSelector('#conteudo:has-text("Esta tela abre depois que você alimentar o Analista")', { timeout: 10000 });
    assert.ok(!(await c1.innerText('#conteudo')).includes('Página não encontrada'));
    console.log('CONTRATOS E TAs (DRIVE) OK');
  } finally { await browser.close(); await S.fechar(); await fake.fechar(); }
})().catch((e) => { console.error(e); process.exit(1); });
