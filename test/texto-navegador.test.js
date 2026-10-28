'use strict';
// Leitura no navegador: o PDF (ou HTML) é lido e mascarado na máquina da analista e o servidor recebe SÓ O TEXTO.
// O servidor não confia: valida tipo, tamanho e hash, mascara de novo e soma os dois contadores. O PDF inteiro só vem como último recurso.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
const F = require('./fixtures-gaveta');
const M = require('../server/mascara');
const X = require('../server/extrair-texto');
const E = require('../server/extrator-rm');
const L = require('../public/js/leitor-pdf');
const T = require('../public/js/texto-comum');

// Carrega os módulos de public/js do jeito que o NAVEGADOR carrega (script solto, sem "module"), para provar que o resultado é o mesmo.
function comoNavegador(...arquivos) {
  const ctx = { TextDecoder, Uint8Array, console }; ctx.self = ctx; vm.createContext(ctx);
  for (const a of arquivos) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', a), 'utf8'), ctx, { filename: a });
  return ctx;
}
const nav = comoNavegador('mascara-comum.js', 'texto-comum.js', 'leitor-pdf.js');
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

const CORPUS = [
  'CPF 123.456.789-09, cartão SUS 898 0012 3456 7890, e-mail maria@x.com, tel (81) 99876-5432. Paciente: MARIA DA SILVA SANTOS, nascida em 12/03/1980, RG 1234567 SSP/PE, prontuário nº 456789.',
  'Processo SEI 2300002728.000106/2026-59, CNPJ 12.345.678/0001-90, valor R$ 1.234.567,89, competência 2026-T2, vigência 2025-2026, UPA Olinda, ISMEP. Sr. Secretário de Saúde decidiu.',
  'A Sra. Ana Paula Lima e o usuário João Pereira relataram demora. O paciente relatou dor.',
  'Paciente residente na Rua das Flores, 123, Boa Viagem, Recife. CEP: 50000-000 do paciente. Hospital fica na Av. Agamenon Magalhães, 100.',
  'Contato: 81 98888-7777\tTel: 3333-4444\tCPF 11122233344 e Nome completo: José Carlos Pereira Lima.',
  '--- página 1 ---\nAnexo\tI\n4.324\t3.170\t1.872\t43,29%\n--- página 2 ---\nPaciente: Pedro Alves Lima\tCNS 700 0000 0000 0000',
  '',
];

test('o módulo que roda no navegador e o do servidor mascaram igual, com a mesma lista de padrões e as mesmas contagens', () => {
  assert.equal(nav.CTAI_MASCARA.REGRAS.length, M.REGRAS.length);
  const lista = (rs) => JSON.stringify(Array.from(rs, (r) => [r.nome, r.re.source, r.re.flags, r.troca, !!r.soSe && String(r.soSe), !!r.soSeNome]));
  assert.equal(lista(nav.CTAI_MASCARA.REGRAS), lista(M.REGRAS));
  for (const t of CORPUS) {
    const a = nav.CTAI_MASCARA.mascarar(t), b = M.mascarar(t);
    assert.equal(a.texto, b.texto); assert.deepEqual(JSON.parse(JSON.stringify(a.mascarados)), b.mascarados); assert.equal(a.total, b.total);
  }
  assert.ok(M.mascarar(CORPUS[0]).total >= 8);
});

test('máscara repetida não muda nada (o servidor mascara de novo o que o navegador já mascarou)', () => {
  for (const t of CORPUS) { const um = M.mascarar(t); const dois = M.mascarar(um.texto); assert.equal(dois.texto, um.texto, t); assert.equal(dois.total, 0, t); }
});

test('HTML do SEI vira o mesmo texto no navegador e no servidor', () => {
  for (const b of [F.oficioEnvioHtml('2026-07'), F.oficioJustificativaHtml('2026-08'), Buffer.from('<p>Ol&aacute; &amp; at&eacute; &#233;&ndash;</p><br><b>x</b>', 'utf8')]) {
    assert.equal(nav.CTAI_TEXTO.htmlDeBytes(b), X.html(b).texto);
  }
  assert.match(X.html(F.oficioJustificativaHtml('2026-07')).texto, /Ofício Nº 25\/2026/);
});

test('montarLinhas: linha de tabela de 4 colunas sai inteira, com tabulação entre colunas e espaço entre palavras', () => {
  const it = (str, x, y, w) => ({ str, transform: [9, 0, 0, 9, x, y], width: w, height: 9 });
  const linhas = L.montarLinhas([
    it('Indicador', 50, 700, 40), it('Meta', 200, 700, 20), it('Ofertado', 280, 700, 38), it('Realizado', 360, 700, 42), it('%', 450, 700, 5),
    it('Consultas', 50, 680, 40), it('médicas', 93, 680, 32), it('4.324', 200, 680, 24), it('3.170', 280, 680, 24), it('1.872', 360, 680, 24), it('43,29%', 450, 680, 28),
    it('Sessões', 50, 660, 30), it('de', 83, 660, 10), it('reab', 96, 660, 18), it('ilitação', 114, 660, 32), it('1.848', 200, 660, 24), it('2.112', 280, 660, 24), it('986', 360, 660, 14), it('53,35%', 450, 660, 28),
    it('ﬁm', 50, 640, 10),
  ]);
  assert.deepEqual(linhas.split('\n'), ['Indicador\tMeta\tOfertado\tRealizado\t%', 'Consultas médicas\t4.324\t3.170\t1.872\t43,29%', 'Sessões de reabilitação\t1.848\t2.112\t986\t53,35%', 'fim']);
});

test('montarLinhas: texto de várias linhas na ordem de leitura, sem linhas vazias, e extrator do Anexo I acha as 4 colunas mesmo com o rótulo em várias linhas', () => {
  const it = (str, x, y, w) => ({ str, transform: [9, 0, 0, 9, x, y], width: w, height: 9 });
  // célula a célula, como o PDF do Relatório Mensal: período, rótulo em 3 linhas, "Total de Atendimentos/Mês", e os 4 números na linha do meio
  const itens = [it('jul/26', 40, 500, 26), it('Consultas', 90, 510, 40), it('Médicas', 90, 500, 36), it('Especializadas', 90, 490, 60), it('Total de', 160, 500, 28), it('Atendimentos/Mês', 160, 491, 70),
    it('4.324', 300, 500, 24), it('3.170', 360, 500, 24), it('1.872', 420, 500, 24), it('43,29%', 480, 500, 28), it('', 0, 0, 0), it('Fonte: Agenda Médica', 40, 460, 90)];
  const texto = '--- página 1 ---\n' + L.montarLinhas(itens);
  const n = E.extrairProducaoRM(texto);
  assert.equal(n.length, 1, texto);
  assert.equal(n[0].chave, 'consultas_medicas'); assert.deepEqual([n[0].meta, n[0].ofertado, n[0].realizado, n[0].pct], [4324, 3170, 1872, 43.29]);
});

test('paginasDoTexto acha páginas com pouco texto e o total de páginas', () => {
  const pg = T.paginasDoTexto('--- página 1 ---\n' + 'texto de verdade nesta página, bastante longo. '.repeat(3) + '\n--- página 2 ---\n\n--- página 3 ---\nfig 1\n--- página 4 ---\n' + 'outra página com texto suficiente para contar. '.repeat(2));
  assert.deepEqual(pg, { total: 4, imagem: [2, 3] });
});

// ---------- o servidor ----------
let S, a, outro;
const UN = 'UPAE-TESTE';
test.before(async () => {
  S = await iniciar(); a = cliente(S.base); outro = cliente(S.base);
  await a.entrar('cleuton'); await outro.entrar('colega1');
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES (?,?,?,?,0)", UN, 'UPAE Teste', 'OSS Teste', 'UPAE');
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, [UN, 'DEMO-UPA'], 'teste');
  const c1 = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega1'");
  CART.definir(S.db, 'admin', c1.usuario_id, ['DEMO-UPA'], 'teste');
});
test.after(async () => { await S.fechar(); });

const estado = async () => (await a.get('/api/alimentar/estado')).json;
const registrar = async (nomes, zip) => { const r = await a.post('/api/alimentar/lote', { zip: zip || null, arquivos: nomes.map((n) => ({ nome: n, tamanho: 1000 })) }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.itens; };
// Faz o que a tela faz: mascara no "navegador" (módulo carregado como script), calcula o hash e manda só o texto.
const cargaDoNavegador = (texto, extra) => { const m = nav.CTAI_MASCARA.mascarar(texto); return Object.assign({ texto: m.texto, hash: sha(m.texto), mascarados: JSON.parse(JSON.stringify(m.mascarados)) }, extra || {}); };
const postTexto = (id, carga, cli) => (cli || a).req('POST', '/api/alimentar/texto', undefined, { raw: Buffer.from(typeof carga === 'string' ? carga : JSON.stringify(carga)), headers: { 'content-type': 'application/octet-stream', 'x-fila-id': String(id) } });
const pdfCom = (texto) => new Promise((ok) => { const d = new PDFDocument(); const p = []; d.on('data', (x) => p.push(x)); d.on('end', () => ok(Buffer.concat(p))); d.text(texto); d.end(); });

test('um mês inteiro pelo caminho do texto: PDF e HTML lidos no navegador, números do Anexo I e ofício x RM como antes, nada do original guardado', async () => {
  const arqs = F.mesCompleto('2026-07', { oficio: { cmRe: '1.700' } }); // ofício diz 1.700 realizadas; o RM diz 1.800: tem de aparecer a divergência
  const nomes = arqs.map((f) => f.nome.replace(/\.txt$/, '.pdf'));
  const itens = await registrar(nomes, 'SEI_RM_07_2026___UPAE_TESTE.zip');
  const mascDoNavegador = {};
  for (let i = 0; i < arqs.length; i++) {
    const ehHtml = /\.html$/.test(arqs[i].nome);
    const texto = ehHtml ? nav.CTAI_TEXTO.htmlDeBytes(arqs[i].buf) : arqs[i].buf.toString('utf8');
    const carga = cargaDoNavegador(i === 5 ? 'Paciente: Maria da Silva Souza, CPF 123.456.789-09. ' + texto : texto, ehHtml ? {} : { paginas: 3, paginasSemTexto: [] });
    if (i === 5) mascDoNavegador.cpf = carga.mascarados.CPF;
    const r = await postTexto(itens[i].id, carga);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  // os dois primeiros e o terceiro eram .html/.txt no fixture: aqui o nome diz .pdf/.html, e o HTML segue como HTML
  const e = await estado();
  const naoLidos = e.itens.filter((i) => i.estado !== 'lido');
  assert.equal(naoLidos.length, 0, JSON.stringify(naoLidos.map((i) => [i.nome, i.estado, i.motivo])));
  assert.ok(e.itens.every((i) => i.origem === 'navegador'));
  assert.match(e.painel.resumo, /^Julho: 21 de 21 lidos\.$/);
  const nums = S.db.all("SELECT fonte, chave, meta, ofertado, realizado, pct, estado FROM gaveta_numeros WHERE mes = '2026-07'");
  const rm = nums.filter((n) => n.fonte === 'anexo_I'); assert.equal(rm.length, 3);
  assert.deepEqual(rm.find((n) => n.chave === 'consultas_medicas').realizado, 1800);
  assert.ok(nums.some((n) => n.fonte === 'oficio_justificativa'), 'números do ofício lidos do HTML que veio como texto');
  assert.ok(nums.every((n) => n.estado === 'proposto'));
  const conf = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-07')).json;
  assert.ok(conf.divergencias.some((d) => /1\.700/.test(d.texto) && /1\.800/.test(d.texto)), JSON.stringify(conf.divergencias));
  // nada pessoal no banco; o texto do PDF veio com marcador de página
  const banco = JSON.stringify(S.db.all('SELECT texto, mascarados FROM gaveta_documentos WHERE mes = ?', '2026-07'));
  assert.ok(!/123\.456\.789|Maria da Silva/.test(banco));
  assert.equal(S.db.get('SELECT paginas FROM gaveta_documentos WHERE codigo = ? AND mes = ?', 'anexo_I', '2026-07').paginas, 3);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL").n, 0);
  assert.equal(mascDoNavegador.cpf, 1);
});

test('defesa em profundidade: texto que chegou SEM máscara é mascarado no servidor, e o contador soma navegador e servidor', async () => {
  const base = 'Anexo 5 ata de agosto de 2026 UPAE Teste, texto de enchimento para passar do mínimo de caracteres legíveis do arquivo. '.repeat(3);
  const [it] = await registrar(['Anexo_5_Reuniao_Ordinaria_Comissao_de_Obito___UPAE_Teste_082026.pdf']);
  // o navegador mascarou 2 e-mails (contagem dele); o texto ainda traz um CPF que escapou e um telefone
  const texto = '--- página 1 ---\n' + base + 'CPF [CPF] e [E-MAIL] e [E-MAIL]. Escapou o CPF 987.654.321-00 e o tel (81) 98765-4321.\n--- página 2 ---\n' + base;
  const r = await postTexto(it.id, { texto, hash: sha(texto), paginas: 2, paginasSemTexto: [], mascarados: { CPF: 1, 'e-mail': 2, inventado: 99, telefone: -4 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = S.db.get("SELECT texto, mascarados FROM gaveta_documentos WHERE codigo = 'anexo_5' AND mes = '2026-08'");
  assert.ok(!/987\.654|98765/.test(d.texto));
  assert.deepEqual(JSON.parse(d.mascarados), { CPF: 2, 'e-mail': 2, telefone: 1 }, 'soma: navegador (1 CPF, 2 e-mails) + servidor (1 CPF, 1 telefone); tipo inventado e número negativo ignorados');
  const e = await estado();
  assert.ok(e.painel.protegidos >= 5);
});

test('o servidor recusa o que não confere: hash diferente, tipo que não é PDF/HTML, corpo vazio, JSON ruim, corpo grande demais, arquivo de outra pessoa', async () => {
  const [pdf, docx, outroTipo] = await registrar(['Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios___UPAE_Teste_082026.pdf', 'Anexo_7_Reuniao_Ordinaria_CFTP___UPAE_Teste_082026.docx', 'Anexo_8_Relatorio_CCIH___UPAE_Teste_082026.pdf']);
  const texto = '--- página 1 ---\n' + 'Ata da reunião ordinária de agosto de 2026 com texto de enchimento para passar do mínimo de caracteres legíveis. '.repeat(4);
  let r = await postTexto(pdf.id, { texto, hash: sha(texto + 'x'), paginas: 1 });
  assert.equal(r.status, 400); assert.match(r.json.erro, /alterado/);
  r = await postTexto(pdf.id, { texto, hash: 'não é hash', paginas: 1 });
  assert.equal(r.status, 400);
  r = await postTexto(docx.id, { texto, hash: sha(texto) });
  assert.equal(r.status, 400); assert.match(r.json.erro, /PDF e HTML/);
  r = await postTexto(pdf.id, { texto: '', hash: sha('') });
  assert.equal(r.status, 400);
  r = await postTexto(pdf.id, '{isto não é json');
  assert.equal(r.status, 400);
  r = await postTexto(pdf.id, JSON.stringify({ texto: 'a'.repeat(9 * 1024 * 1024) }));
  assert.equal(r.status, 413);
  r = await postTexto(pdf.id, { texto, hash: sha(texto) }, outro);
  assert.equal(r.status, 404, 'ninguém manda texto para a fila de outra pessoa');
  assert.equal(S.db.get('SELECT estado FROM alimentar_fila WHERE id = ?', pdf.id).estado, 'espera', 'recusado: a linha continua esperando (o navegador ainda pode mandar o arquivo inteiro)');
  // sem hash também é aceito (navegador sem crypto.subtle), e mandar de novo o que já foi recebido é inofensivo
  r = await postTexto(pdf.id, { texto, paginas: 1, mascarados: {} });
  assert.equal(r.status, 200); assert.equal(r.json.estado, 'lido');
  r = await postTexto(pdf.id, { texto, paginas: 1 });
  assert.equal(r.status, 200); assert.equal(r.json.repetido, true);
  await a.req('DELETE', '/api/alimentar/' + outroTipo.id);
});

test('páginas só imagem: o servidor refaz a conta pelo texto e avisa; texto que é só imagem vira problema com mensagem clara', async () => {
  const [um, dois] = await registrar(['Anexo_9_Relatorio_NSP___UPAE_Teste_082026.pdf', 'Anexo_10_Relatorio_Projeto_de_Cuidadores___UPAE_Teste_082026.pdf']);
  const bom = 'Relatório do NSP de agosto de 2026 da UPAE Teste, com texto bastante para passar do mínimo de caracteres legíveis. '.repeat(3);
  const t1 = '--- página 1 ---\n' + bom + '\n--- página 2 ---\n\n--- página 3 ---\n' + bom + '\n--- página 4 ---\nfoto';
  assert.equal((await postTexto(um.id, { texto: t1, hash: sha(t1), paginas: 4, paginasSemTexto: [9999, 'x'] })).status, 200);
  const doc = S.db.get("SELECT paginas, paginas_imagem FROM gaveta_documentos WHERE codigo = 'anexo_9' AND mes = '2026-08'");
  assert.equal(doc.paginas, 4); assert.equal(doc.paginas_imagem, '2,4');
  const e = await estado();
  assert.deepEqual(e.painel.paginasImagem.find((x) => x.arquivo.includes('NSP')).paginas, [2, 4]);
  assert.match(e.itens.find((i) => i.id === um.id).motivo, /2 página\(s\) parecem só imagem/);
  const t2 = '--- página 1 ---\n\n--- página 2 ---\nfig\n';
  assert.equal((await postTexto(dois.id, { texto: t2, hash: sha(t2), paginas: 2 })).status, 200);
  const e2 = (await estado()).itens.find((i) => i.id === dois.id);
  assert.equal(e2.estado, 'problema'); assert.match(e2.motivo, /não tem texto legível/);
});

test('último recurso: PDF inteiro com a origem do fallback; o aviso aparece no item e no painel, e uma origem inventada é ignorada', async () => {
  const [ok, ruim] = await registrar(['Anexo_11_Relatorio_de_Educacao_Permanente___UPAE_Teste_082026.pdf', 'Anexo_4_Relatorio_dos_Programas_Especiais___UPAE_Teste_082026.pdf']);
  const pdf = await pdfCom('Relatório de educação permanente de agosto de 2026 da UPAE Teste. Texto para passar do mínimo de caracteres legíveis do arquivo da unidade. '.repeat(3));
  let r = await a.req('POST', '/api/alimentar/arquivo', undefined, { raw: pdf, headers: { 'content-type': 'application/octet-stream', 'x-nome-arquivo': 'x.pdf', 'x-fila-id': String(ok.id), 'x-origem': 'fallback-erro' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await a.req('POST', '/api/alimentar/arquivo', undefined, { raw: pdf, headers: { 'content-type': 'application/octet-stream', 'x-nome-arquivo': 'x.pdf', 'x-fila-id': String(ruim.id), 'x-origem': '<script>' } });
  assert.equal(r.status, 200);
  const e = await estado();
  const i1 = e.itens.find((i) => i.id === ok.id), i2 = e.itens.find((i) => i.id === ruim.id);
  assert.equal(i1.estado, 'lido'); assert.equal(i1.origem, 'fallback-erro'); assert.match(i1.motivo, /navegador não conseguiu ler este PDF/);
  assert.equal(i2.origem, null); assert.ok(!/navegador/.test(i2.motivo || ''));
  assert.ok(e.painel.fallback.some((x) => x.id === ok.id && /não conseguiu ler/.test(x.motivo)));
  assert.ok(!e.painel.fallback.some((x) => x.id === ruim.id));
});

test('o mesmo texto de novo vira "já importado"; texto com limite de caracteres é cortado e avisa', async () => {
  const texto = '--- página 1 ---\n' + 'Ata da reunião de setembro de 2026 da UPAE Teste, texto de enchimento para passar do mínimo de caracteres. '.repeat(5);
  const [p1] = await registrar(['Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios___UPAE_Teste_092026.pdf']);
  assert.equal((await postTexto(p1.id, { texto, hash: sha(texto), paginas: 1 })).json.estado, 'lido');
  const [p2] = await registrar(['Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios___UPAE_Teste_092026_copia.pdf']);
  assert.equal((await postTexto(p2.id, { texto, hash: sha(texto), paginas: 1 })).json.estado, 'duplicado');
  const [p3] = await registrar(['Anexo_7_Reuniao_Ordinaria_CFTP___UPAE_Teste_092026.pdf']);
  const longo = '--- página 1 ---\n' + 'Ata do mês de setembro de 2026 da UPAE Teste com texto de enchimento. '.repeat(2000);
  assert.equal((await postTexto(p3.id, { texto: longo, hash: sha(longo), paginas: 1, cortado: true })).status, 200);
  assert.match((await estado()).itens.find((i) => i.id === p3.id).motivo, /Texto cortado/);
});

test('trilha mensal x trimestral intacta: PDF de parecer de unidade sem gaveta (UPA) também entra pelo texto e vira rascunho no Histórico', async () => {
  const [it] = await registrar(['parecer-demo-2026-T2.pdf']);
  const texto = '--- página 1 ---\nParecer da UPA Demonstração, 2026-T2. Nota total do trimestre: 88 pontos. Paciente: Maria da Silva Souza, CPF 123.456.789-09. ' + 'Texto de enchimento para passar do mínimo de caracteres legíveis do arquivo. '.repeat(2);
  const carga = cargaDoNavegador(texto, { paginas: 1, paginasSemTexto: [] });
  const r = await postTexto(it.id, carga);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const lin = (await estado()).itens.find((i) => i.id === it.id);
  assert.ok(['pronto', 'precisa_dados'].includes(lin.estado), lin.estado + ' ' + lin.motivo);
  assert.ok(!/123\.456\.789|Maria da Silva/.test(JSON.stringify(S.db.all('SELECT texto FROM hist_relatorios'))));
});
