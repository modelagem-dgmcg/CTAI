'use strict';
// PDF lido NO NAVEGADOR: a tela abre o ZIP, lê cada PDF na "máquina da analista" (PDF.js local, sem CDN), mascara e manda só o texto.
// O PDF inteiro só segue quando não há texto (só imagem) ou o navegador não consegue ler. Todos os arquivos aqui são SINTÉTICOS.
const H = require('../helpers');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const CART = require('../../server/carteira');
const F = require('../fixtures-gaveta');
const { chromium } = require('playwright');

const montar = (fn) => new Promise((ok) => { const d = new PDFDocument({ margin: 40 }); const p = []; d.on('data', (x) => p.push(x)); d.on('end', () => ok(Buffer.concat(p))); fn(d); d.end(); });
const COLUNAS = [40, 250, 330, 410, 490];
// Anexo I sintético: quadro de produção de 4 colunas (meta, ofertado, realizado, %), célula a célula, com o rótulo em 3 linhas centrada na linha.
const anexoI = () => montar((d) => {
  d.fontSize(10).text('UPAE Teste. Relatório Mensal Julho/2026. Texto de apresentação da unidade, suficiente para passar do mínimo de caracteres legíveis.', 40, 40, { width: 500 });
  d.addPage(); d.fontSize(11).text('1. INDICADORES DE PRODUÇÃO', 40, 40);
  d.fontSize(8).text('Período', COLUNAS[0], 70, { lineBreak: false }); d.text('Indicador', COLUNAS[1] - 160, 70, { lineBreak: false });
  ['Meta Mensal', 'Ofertados', 'Produção', '% da Meta'].forEach((t, i) => d.text(t, COLUNAS[i + 1], 70, { lineBreak: false }));
  const linhas = [['Consultas', 'Médicas', 'Especializadas', 4324, 3170, 1872, '43,29%'], ['Consultas de', 'Especialidades', 'não médicas', 960, 1786, 1216, '126,67%'], ['Sessões de', 'Reabilitação', 'Sessões/Mês', 1848, 2112, 986, '53,35%']];
  linhas.forEach((l, k) => {
    const y = 100 + k * 50; const br = (n) => Number(n).toLocaleString('pt-BR');
    d.text('jul/26', COLUNAS[0], y + 10, { lineBreak: false });
    d.text(l[0], 100, y, { lineBreak: false }); d.text(l[1], 100, y + 10, { lineBreak: false }); d.text(l[2], 100, y + 20, { lineBreak: false });
    d.text('Total de', 160, y + 10, { lineBreak: false }); d.text('Atendimentos/Mês', 160, y + 20, { lineBreak: false });
    d.text(br(l[3]), COLUNAS[1], y + 10, { lineBreak: false }); d.text(br(l[4]), COLUNAS[2], y + 10, { lineBreak: false }); d.text(br(l[5]), COLUNAS[3], y + 10, { lineBreak: false }); d.text(l[6], COLUNAS[4], y + 10, { lineBreak: false });
  });
  d.text('Fonte: Agenda Médica/BID/Planilha Monitoramento', 40, 270, { lineBreak: false });
  d.addPage(); d.fontSize(10).text('2. INDICADORES DE QUALIDADE. Satisfação do usuário jul/26 100% 99,32%. Texto de enchimento para a página passar do mínimo de caracteres.', 40, 40, { width: 500 });
});
const textoSimples = (titulo, extra) => montar((d) => { d.fontSize(10).text(titulo + ' da UPAE Teste, julho de 2026. ' + (extra || '') + ' Texto de enchimento do anexo para passar do mínimo de caracteres legíveis do arquivo da unidade. '.repeat(3), 40, 40, { width: 500 }); });
const soImagem = () => montar((d) => { d.rect(40, 40, 300, 200).fill('#888'); d.addPage(); d.circle(200, 200, 80).fill('#444'); }); // sem nenhum texto: "escaneado"
const meioImagem = () => montar((d) => { d.fontSize(10).text('Ata da reunião da CFTP da UPAE Teste, julho de 2026, com texto bastante para passar do mínimo de caracteres legíveis. '.repeat(3), 40, 40, { width: 500 }); d.addPage(); d.rect(40, 40, 300, 200).fill('#888'); d.addPage(); d.fontSize(10).text('Segunda parte da ata com mais texto de enchimento para esta página não ser tratada como imagem de jeito nenhum.', 40, 40, { width: 500 }); });
const quebrado = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('isto não é um pdf de verdade '.repeat(40))]);

(async () => {
  const S = await H.iniciar(); const base = S.base;
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-TESTE','UPAE Teste','OSS Teste','UPAE',0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['UPAE-TESTE'], 'e2e');
  const z = new JSZip();
  z.file('[01]-9000001_GOVPE___Oficio_24.html', F.oficioEnvioHtml('2026-07'));
  z.file('[02]-9000002_GOVPE___Oficio_25.html', F.oficioJustificativaHtml('2026-07'));
  z.file('[03]-9000003_Relatorio_ANEXO_I___RM___UPAE_Teste_072026.pdf', await anexoI());
  z.file('[04]-9000004_Anexo_2_Relatorio_Matriciamento___UPAE_Teste_072026.pdf', await textoSimples('Relatório de matriciamento', 'Paciente: Maria da Silva Souza, CPF 123.456.789-09, telefone (81) 99876-5432.'));
  z.file('[05]-9000005_Anexo_5_Reuniao_Ordinaria_Comissao_de_Obito___UPAE_Teste_072026.pdf', await soImagem());
  z.file('[06]-9000006_Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios___UPAE_Teste_072026.pdf', quebrado());
  z.file('[07]-9000007_Anexo_7_Reuniao_Ordinaria_CFTP___UPAE_Teste_072026.pdf', await meioImagem());
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ctai-pdf-'));
  const zipPath = path.join(pasta, 'SEI_RM_07_2026___UPAE_TESTE.zip');
  fs.writeFileSync(zipPath, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'pt-BR' });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    if (process.env.CTAI_DEBUG) p.on('console', (m) => console.log('[nav]', m.type(), m.text()));
    const pedidos = []; p.on('request', (r) => pedidos.push({ url: r.url(), metodo: r.method(), corpo: r.method() === 'POST' ? (r.postData() || '') : null, bytes: r.method() === 'POST' ? (r.postDataBuffer() || Buffer.alloc(0)).length : 0 }));
    await p.goto(base + '/'); await p.fill('#login', 'cleuton'); await p.fill('#senha', 'Trocar@123'); await p.click('button[type=submit]');
    await p.waitForSelector('#ts-a, #conteudo', { timeout: 10000 });
    if (await p.$('#ts-a')) { await p.fill('#ts-a', 'Trocar@123'); await p.fill('#ts-n', 'Senha@12345'); await p.click('dialog button'); await p.waitForSelector('dialog', { state: 'detached' }).catch(() => {}); }
    await p.waitForSelector('#al-zona', { timeout: 8000 });
    await p.evaluate(() => {
      window.__rot = new Set();
      setInterval(() => { document.querySelectorAll('.al-et').forEach((e) => window.__rot.add(e.textContent)); const s = document.querySelector('#al-andamento'); if (s && s.textContent) window.__rot.add('STATUS:' + s.textContent); }, 30);
    });
    await p.setInputFiles('#al-arquivos', zipPath);
    await p.waitForSelector('#al-resumo-mes', { timeout: 90000 });

    // 1) o painel mostrou "lendo na sua máquina" -> "enviando texto" -> "lido"
    const rot = await p.evaluate(() => [...window.__rot]);
    assert.ok(rot.some((t) => /^Lendo na sua máquina/.test(t)), rot.join(' | '));
    assert.ok(rot.some((t) => t === 'Enviando texto'), rot.join(' | '));
    assert.ok(rot.some((t) => t === 'Lido'));
    assert.ok(rot.some((t) => /^Lendo na sua máquina \(página \d+ de \d+\)/.test(t)), 'andamento página a página: ' + rot.join(' | '));

    // 2) o PDF NÃO subiu: só texto, e já mascarado. Só os dois PDFs sem texto/ilegível foram inteiros.
    const posts = pedidos.filter((r) => r.metodo === 'POST' && /\/api\/alimentar\/(texto|arquivo)/.test(r.url));
    const texto = posts.filter((r) => /\/texto$/.test(r.url)), arquivo = posts.filter((r) => /\/arquivo$/.test(r.url));
    assert.equal(texto.length, 5, 'ofício x2, Anexo I, Anexo 2 e Anexo 7 (com 1 página só imagem) foram como texto: ' + posts.map((r) => r.url.split('/').pop() + ':' + r.bytes));
    if (process.env.CTAI_DEBUG) console.log(posts.map((r) => r.url + ' ' + r.bytes));
    assert.equal(arquivo.length, 2, 'PDF só imagem e PDF quebrado foram como arquivo inteiro');
    assert.ok(texto.every((r) => r.bytes < 20000), 'o corpo é só texto, pequeno');
    const todoTexto = texto.map((r) => r.corpo).join('\n');
    assert.ok(!/123\.456\.789|99876|Maria da Silva/.test(todoTexto), 'mascarado ANTES de sair da máquina');
    assert.ok(/\[CPF\]/.test(todoTexto) && /\[TELEFONE\]/.test(todoTexto) && /\[PACIENTE\]/.test(todoTexto));
    assert.ok(!/\bpdf\b.*%PDF-/.test(todoTexto) && !todoTexto.includes('%PDF-'), 'nenhum PDF no corpo do texto');
    const sha = JSON.parse(texto[2].corpo); assert.match(sha.hash, /^[0-9a-f]{64}$/); assert.equal(sha.paginas, 3);
    // PDF.js e o worker vêm do próprio sistema; nada de CDN
    assert.ok(pedidos.some((r) => r.url === base + '/vendor/pdf.min.js') && pedidos.some((r) => r.url === base + '/vendor/pdf.worker.min.js'), 'PDF.js e worker locais');
    assert.deepEqual(pedidos.filter((r) => !r.url.startsWith(base) && !/^(data|blob):/.test(r.url)).map((r) => r.url), [], 'nenhum pedido a outro endereço');

    // 3) a tabela de 4 colunas do Anexo I chegou legível e o extrator do servidor achou os números
    const d1 = S.db.get("SELECT texto FROM gaveta_documentos WHERE codigo = 'anexo_I' AND mes = '2026-07'").texto;
    if (process.env.CTAI_DEBUG) console.log(JSON.stringify(d1.slice(d1.indexOf('jul/26'), d1.indexOf('jul/26') + 260)));
    assert.match(d1, /\nMédicas\nEspecializadas\nTotal de\nAtendimentos\/Mês\n4\.324\t3\.170\t1\.872\t43,29%\n/, 'a linha de números do quadro sai inteira, com tabulação entre as colunas');
    assert.match(d1, /--- página 2 ---\n1\. INDICADORES DE PRODUÇÃO\nPeríodo\tIndicador\tMeta Mensal/);
    const nums = S.db.all("SELECT chave, meta, ofertado, realizado, pct FROM gaveta_numeros WHERE mes = '2026-07' AND fonte = 'anexo_I' ORDER BY id");
    assert.deepEqual(nums.map((n) => [n.chave, n.meta, n.ofertado, n.realizado, n.pct]), [['consultas_medicas', 4324, 3170, 1872, 43.29], ['consultas_nao_medicas', 960, 1786, 1216, 126.67], ['sessoes_reabilitacao', 1848, 2112, 986, 53.35]]);
    assert.ok(S.db.get("SELECT COUNT(*) AS n FROM gaveta_numeros WHERE fonte = 'oficio_justificativa'").n >= 3, 'ofício HTML lido como texto no navegador');

    // 4) avisos: PDF enviado inteiro (sem texto / quebrado) e páginas só imagem
    const fim = await p.innerText('#al-painel .al-fim');
    assert.match(fim, /PDF enviado inteiro/); assert.match(fim, /Anexo 5/i); assert.match(fim, /Anexo 6/i);
    assert.match(fim, /Páginas que parecem só imagem/); assert.match(fim, /Anexo_7.*pág\. 2/is);
    const q = S.db.all("SELECT nome, estado, origem, motivo FROM alimentar_fila WHERE nome LIKE '%Anexo_5%' OR nome LIKE '%Anexo_6%'");
    assert.deepEqual(q.map((x) => [x.estado, x.origem]).sort(), [['problema', 'fallback-erro'], ['problema', 'fallback-sem-texto']]);
    assert.ok(q.every((x) => /legível|Não consegui ler/.test(x.motivo)), JSON.stringify(q));
    assert.equal(S.db.get("SELECT origem FROM alimentar_fila WHERE nome LIKE '%Anexo_2_%'").origem, 'navegador');

    // 5) contador "dados protegidos" soma o que foi mascarado; nada de original guardado
    assert.ok(Number((await p.innerText('#al-n-prot')).replace(/\D/g, '')) >= 3);
    assert.equal(S.db.get('SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL').n, 0);
    assert.ok(!/123\.456\.789|Maria da Silva|99876/.test(JSON.stringify(S.db.all('SELECT texto FROM gaveta_documentos'))));
    assert.ok(!/\bnull\b|undefined/.test(await p.innerText('#al-raiz')));

    // 6) o service worker guarda os arquivos do leitor para a próxima vez
    const emCache = await p.evaluate(async () => { const r = []; for (const u of ['/vendor/pdf.min.js', '/vendor/pdf.worker.min.js', '/js/leitor-pdf.js', '/js/mascara-comum.js']) r.push(!!(await caches.match(u))); return r; });
    assert.deepEqual(emCache, [true, true, true, true], 'service worker guardou o leitor');
    // 7) limite de tempo por arquivo: estourou, o leitor para com um código claro (a tela então manda o arquivo inteiro, com o aviso)
    const b64 = (await textoSimples('Relatório', 'Teste de tempo')).toString('base64');
    const tempo = await p.evaluate(async (b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); try { await window.CTAI_LEITOR_PDF.lerPdf(new Blob([u]), { limiteMs: 1 }); return 'leu'; } catch (e) { return e.codigo + ':' + e.message; } }, b64);
    assert.match(tempo, /^tempo:/, tempo);
    const normal = await p.evaluate(async (b) => { const u = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)); const r = await window.CTAI_LEITOR_PDF.lerPdf(new Blob([u]), {}); return [r.paginas, r.suficiente]; }, b64);
    assert.deepEqual(normal, [1, true], 'depois de um tempo estourado, o leitor continua funcionando');
    assert.deepEqual(erros, []);
    console.log('ALIMENTAR PDF NO NAVEGADOR OK');
  } finally { await browser.close(); await S.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
