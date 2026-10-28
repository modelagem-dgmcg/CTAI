'use strict';
// Gaveta por mês: lote enviado pelo navegador (um arquivo por vez), catálogo da UPAE, lacunas, trimestre calculado, números e conferidor ofício x RM.
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const JSZip = require('jszip');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
const F = require('./fixtures-gaveta');
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
// Faz o que a tela faz: registra o lote e manda os arquivos um por vez, esperando a leitura de cada um.
async function enviarLote(arquivos, zip, extra) {
  const reg = await a.post('/api/alimentar/lote', { zip: zip || null, arquivos: arquivos.map((f) => ({ nome: f.nome, tamanho: f.buf.length })).concat(extra || []) });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  const respostas = [];
  for (let i = 0; i < arquivos.length; i++) {
    const it = reg.json.itens[i];
    if (it.estado !== 'espera') continue;
    const r = await a.req('POST', '/api/alimentar/arquivo', undefined, { raw: arquivos[i].buf, headers: { 'content-type': 'application/octet-stream', 'x-nome-arquivo': encodeURIComponent(arquivos[i].nome), 'x-fila-id': String(it.id) } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); respostas.push(r.json);
  }
  return { reg: reg.json, respostas };
}
const gaveta = (mes) => S.db.all('SELECT codigo, parte, mes, nome_arquivo, hash, versao, caracteres, length(texto) AS len FROM gaveta_documentos WHERE contrato_id = ? AND mes = ? ORDER BY id', UN, mes);

test('julho completo: o navegador manda um por vez, tudo vira documento da gaveta e o sistema diz que está completo', async () => {
  const arqs = F.mesCompleto('2026-07');
  const { reg } = await enviarLote(arqs, 'SEI_RM_07_2026___UPAE_TESTE.zip');
  assert.equal(reg.itens.length, arqs.length);
  assert.ok(reg.itens.every((i) => i.estado === 'espera'));
  const e = await estado();
  assert.equal(e.resumo.pendentes, 0);
  assert.equal(e.itens.filter((i) => i.estado === 'lido').length, arqs.length, JSON.stringify(e.itens.filter((i) => i.estado !== 'lido').map((i) => [i.nome, i.estado, i.motivo])));
  const docs = gaveta('2026-07');
  assert.equal(docs.length, arqs.length);
  assert.deepEqual(docs.slice(0, 3).map((d) => d.codigo), ['oficio_envio', 'oficio_justificativa', 'anexo_I'], 'ofícios identificados pelo texto, mês pelo texto');
  assert.ok(docs.every((d) => d.mes === '2026-07' && d.hash.length === 64 && d.len === d.caracteres));
  const p = e.painel;
  assert.equal(p.concluido, true); assert.equal(p.unidade, 'UPAE Teste'); assert.equal(p.mes, '2026-07'); assert.equal(p.mesRotulo, 'Julho/2026'); assert.equal(p.catalogo, true);
  assert.equal(p.arquivos.total, arqs.length); assert.equal(p.arquivos.feitos, arqs.length);
  assert.deepEqual(p.faltam, []);
  assert.match(p.resumo, /^Julho: 21 de 21 lidos\.$/);
  assert.ok(p.itens.every((i) => i.estado === 'lido'));
  assert.equal(p.avisoTrimestre, 'Chegou julho, faltam agosto e setembro.');
});

test('o texto completo fica guardado, já mascarado, e o original some da memória e do banco', async () => {
  const cpf = 'Paciente: Maria da Silva Souza, CPF 123.456.789-09, telefone (81) 99876-5432. ';
  await enviarLote([{ nome: 'Anexo_5_Reuniao_Ordinaria_Comissao_de_Obito___UPAE_Teste_082026.txt', buf: Buffer.from(cpf + 'Ata da reunião ordinária de agosto de 2026 com texto de enchimento suficiente para passar do mínimo de caracteres legíveis. '.repeat(20)) }]);
  const d = S.db.get("SELECT texto, mascarados FROM gaveta_documentos WHERE codigo = 'anexo_5' AND mes = '2026-08'");
  assert.ok(!/123\.456|99876|Maria da Silva/.test(d.texto), 'nada pessoal no banco');
  assert.match(d.texto, /\[CPF\]/); assert.ok(JSON.parse(d.mascarados).CPF >= 1);
  assert.ok(d.texto.length > 2000, 'texto inteiro, não resumo');
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL AND estado = 'lido'").n, 0);
  assert.ok(!JSON.stringify(S.db.all("SELECT * FROM trilha_auditoria WHERE tabela = 'gaveta_documentos'")).match(/123\.456|Maria da Silva/));
});

test('lacuna: agosto chega sem o Anexo 5 e sem o Anexo 8 e o sistema diz o que falta', async () => {
  // o Anexo 5 de agosto já entrou no teste anterior; aqui vão os demais, menos 5 e 8 (e o 5 anterior é de outro texto)
  S.db.run("DELETE FROM gaveta_documentos WHERE codigo = 'anexo_5' AND mes = '2026-08'");
  const arqs = F.mesCompleto('2026-08', { sem: ['anexo_5', 'anexo_8'], oficio: { cmRe: '1.700', ostPct: '30,00%' } });
  await enviarLote(arqs, 'SEI_RM_08_2026___UPAE_TESTE.zip');
  const p = (await estado()).painel;
  assert.equal(p.mes, '2026-08'); assert.equal(p.concluido, true);
  assert.deepEqual(p.faltam.map((f) => f.codigo), ['anexo_5', 'anexo_8']);
  assert.match(p.resumo, /^Agosto: 19 de 21 lidos — falta Anexo 5 e Anexo 8\.$/);
  const falta5 = p.itens.find((i) => i.codigo === 'anexo_5'); assert.equal(falta5.estado, 'falta');
  assert.equal(p.avisoTrimestre, 'Chegaram julho e agosto, falta setembro.');
  const m = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-08')).json;
  assert.deepEqual(m.faltam.map((f) => f.nome), ['Anexo 5 - Comissão de Óbito', 'Anexo 8 - CCIH']);
  assert.equal(m.itens.find((i) => i.codigo === 'anexo_5').estado, 'falta');
});

test('trimestre calculado: junta os meses, avisa o que falta e muda quando um mês é corrigido', async () => {
  let t = (await a.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).json;
  assert.equal(t.aviso, 'Chegaram julho e agosto, falta setembro.');
  assert.deepEqual(t.meses.map((m) => m.chegou), [true, true, false]);
  assert.equal(t.completo, false);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%trimestre%' AND type = 'table'").n, 0, 'não existe tabela de trimestre');
  // números lidos do Anexo I: propostos, ainda sem total
  const cm = t.producao.find((x) => x.chave === 'consultas_medicas');
  assert.equal(cm.por_mes['2026-07'].realizado, 1800); assert.equal(cm.por_mes['2026-07'].estado, 'proposto');
  assert.equal(cm.total.realizado, null, 'proposto não entra no total');
  assert.ok(t.numeros_a_conferir > 0);
  // a analista confere e confirma julho e agosto
  const ids = t.producao.flatMap((p) => Object.values(p.por_mes).map((v) => v.id));
  const ok = await a.post('/api/gaveta/numeros/confirmar', { ids });
  assert.equal(ok.json.confirmados, ids.length);
  t = (await a.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).json;
  const cm2 = t.producao.find((x) => x.chave === 'consultas_medicas');
  assert.equal(cm2.total.meses_confirmados, 2); assert.equal(cm2.total.realizado, 3600); assert.equal(cm2.total.meta, 8000); assert.equal(cm2.total.pct_realizado, 45);
  // corrigir agosto (RM reenviado com outro valor) atualiza o trimestre e volta a pedir conferência
  const rmNovo = { nome: '[03]-9000003_Relatorio_ANEXO_I___RM___UPAE_Teste_082026.txt', buf: Buffer.from(F.rmTexto('2026-08', { cm: [4000, 3000, 2000, '50,00%'] })) };
  const { respostas } = await enviarLote([rmNovo]);
  assert.equal(respostas[0].estado, 'lido');
  assert.match((await estado()).itens.slice(-1)[0].motivo, /Substituiu a versão anterior \(agora versão 2\)/);
  t = (await a.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).json;
  const cm3 = t.producao.find((x) => x.chave === 'consultas_medicas');
  assert.equal(cm3.por_mes['2026-08'].realizado, 2000); assert.equal(cm3.por_mes['2026-08'].estado, 'proposto');
  assert.equal(cm3.total.meses_confirmados, 1); assert.equal(cm3.total.realizado, 1800, 'só julho segue confirmado');
  assert.equal(gaveta('2026-08').filter((d) => d.codigo === 'anexo_I').length, 1, 'substitui, não duplica');
  await a.post('/api/gaveta/numeros/confirmar', { ids: [cm3.por_mes['2026-08'].id] });
  t = (await a.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).json;
  assert.equal(t.producao.find((x) => x.chave === 'consultas_medicas').total.realizado, 3800);
});

test('a analista pode corrigir o valor ao confirmar; valor que não é número é recusado', async () => {
  const t = (await a.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).json;
  const sr = t.producao.find((x) => x.chave === 'consultas_nao_medicas').por_mes['2026-07'];
  const ruim = await a.post('/api/gaveta/numeros/confirmar', { ids: [sr.id], edicoes: { [sr.id]: { realizado: 'abc' } } });
  assert.equal(ruim.status, 400);
  const bom = await a.post('/api/gaveta/numeros/confirmar', { ids: [sr.id], edicoes: { [sr.id]: { realizado: '1.000' } } });
  assert.equal(bom.status, 200);
  assert.equal(S.db.get('SELECT realizado FROM gaveta_numeros WHERE id = ?', sr.id).realizado, 1000);
  assert.equal(S.db.get('SELECT estado FROM gaveta_numeros WHERE id = ?', sr.id).estado, 'confirmado');
  assert.ok(S.db.all("SELECT * FROM trilha_auditoria WHERE tabela = 'gaveta_numeros' AND campo = 'confirmado'").length >= 1);
});

test('conferidor ofício x RM: agosto tem divergência de realizados e de %, julho não', async () => {
  const ago = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-08')).json;
  const c = ago.divergencias.find((d) => d.chave === 'consultas_medicas' && d.campo === 'realizado');
  assert.ok(c, JSON.stringify(ago.divergencias));
  assert.equal(c.oficio, 1700); assert.equal(c.rm, 2000); assert.match(c.texto, /ofício de justificativa diz 1\.700 realizados e o Relatório Mensal diz 2\.000/);
  const jul = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-07')).json;
  assert.deepEqual(jul.divergencias, []);
  // sem número no ofício (só texto corrido), nada é inventado
  const semNum = { nome: '[02]-9000009_GOVPE___Oficio_99.html', buf: Buffer.from('<p>Assunto: Justificativa para o não atingimento de metas, RM 09/2026. Ofertamos 118 e atendemos 48 pacientes, texto de enchimento para o mínimo de caracteres legíveis.</p>') };
  await enviarLote([semNum, { nome: '[03]-9000003_Relatorio_ANEXO_I___RM___UPAE_Teste_092026.txt', buf: Buffer.from(F.rmTexto('2026-09')) }]);
  const set = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-09')).json;
  assert.equal(set.numeros.filter((n) => n.fonte === 'oficio_justificativa').length, 0);
  assert.deepEqual(set.divergencias, []);
});

test('setembro: anexos 12 a 15 passam a ser esperados; trimestre fecha os três meses mas aponta o que falta', async () => {
  const set = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-09')).json;
  const faltam = set.faltam.map((f) => f.codigo);
  for (const k of ['anexo_12', 'anexo_13', 'anexo_14', 'anexo_15']) assert.ok(faltam.includes(k), k);
  const jul = (await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-07')).json;
  assert.ok(!jul.itens.some((i) => i.codigo === 'anexo_12'), 'não cobra anexo 12 de julho');
  const t = (await a.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).json;
  assert.equal(t.aviso, 'Os três meses chegaram.'); assert.equal(t.completo, false);
  assert.ok(t.incompletos.some((m) => m.mes === '2026-09'));
});

test('mesmo documento de novo vira duplicado e não entra duas vezes', async () => {
  const antes = S.db.get('SELECT COUNT(*) AS n FROM gaveta_documentos').n;
  const f = F.mesCompleto('2026-07').slice(5, 7);
  const r1 = await enviarLote(f);
  assert.ok(r1.respostas.every((x) => x.estado === 'duplicado'), 'conteúdo igual: o servidor reconhece depois de ler');
  // mesmo conteúdo com outro nome: o hash pega
  const copia = [{ nome: 'Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios___UPAE_Teste_copia_072026.txt', buf: f[0].buf }];
  const r2 = await enviarLote(copia);
  assert.equal(r2.respostas[0].estado, 'duplicado');
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM gaveta_documentos').n, antes);
});

test('arquivo sem mês espera a pessoa indicar; arquivo fora do catálogo vira avulso; ZIP pequeno ainda funciona', async () => {
  const { respostas, reg } = await enviarLote([{ nome: 'Anexo_5_Reuniao_Ordinaria_Comissao_de_Obito___UPAE_Teste.txt', buf: F.anexoTxt('Ata sem mês no nome', '2026-07').toString().replace(/Julho\/2026/g, 'período').replace(/^/, '') && Buffer.from('Ata de reunião sem indicação do período. '.repeat(10)) }]);
  assert.equal(respostas[0].estado, 'precisa_dados');
  const id = reg.itens[0].id;
  const e = await estado();
  assert.equal(e.painel.arquivos.atencao, 1); assert.equal(e.unidades.find((u) => u.contrato_id === UN).fluxo, 'gaveta');
  assert.equal((await a.post('/api/alimentar/' + id + '/identificar', { contrato_id: UN })).status, 400, 'pede o mês');
  assert.equal((await a.post('/api/alimentar/' + id + '/identificar', { contrato_id: UN, mes: '2026-10' })).status, 200);
  const d = S.db.get("SELECT codigo, mes FROM gaveta_documentos WHERE nome_arquivo LIKE 'Anexo_5_Reuniao%UPAE_Teste.txt'");
  assert.deepEqual([d.codigo, d.mes], ['anexo_5', '2026-10']);
  assert.equal(S.db.get('SELECT texto FROM alimentar_fila WHERE id = ?', id).texto, null, 'texto sai da fila depois de guardado');
  // fora do catálogo
  const av = await enviarLote([{ nome: 'Planilha_extra_de_testes_UPAE_Teste_072026.txt', buf: Buffer.from('Planilha extra da unidade com conteúdo qualquer e texto de enchimento para passar do mínimo de caracteres. '.repeat(3)) }]);
  assert.equal(av.respostas[0].estado, 'lido');
  assert.match((await estado()).itens.slice(-1)[0].motivo, /Não está no catálogo da UPAE/);
  // ZIP inteiro enviado como arquivo (caminho antigo, ZIP pequeno)
  const z = new JSZip(); z.file('Anexo_7_Reuniao_Ordinaria_CFTP___UPAE_Teste_112026.txt', 'Ata da CFTP de novembro de 2026 com texto de enchimento para passar do mínimo de caracteres legíveis. '.repeat(3)); z.file('foto.png', 'x'); z.file('dados.db', 'x');
  const r = await a.upload('/api/alimentar/arquivo', 'SEI_RM_11_2026___UPAE_TESTE.zip', await z.generateAsync({ type: 'nodebuffer' }));
  assert.equal(r.json.ids.length, 1, 'imagem e .db são ignorados');
  for (let i = 0; i < 60 && (await estado()).resumo.pendentes; i++) await new Promise((ok) => setTimeout(ok, 80));
  assert.equal(S.db.get("SELECT mes FROM gaveta_documentos WHERE codigo = 'anexo_7' AND mes = '2026-11'").mes, '2026-11');
});

test('PDF com página só imagem: avisa quais páginas ficaram de fora', async () => {
  const pdf = await new Promise((ok) => {
    const d = new PDFDocument(); const parts = []; d.on('data', (c) => parts.push(c)); d.on('end', () => ok(Buffer.concat(parts)));
    d.text('Relatório da CCIH de dezembro de 2026. Texto da primeira página, longo o bastante para valer como página lida pelo sistema, com bastante conteúdo escrito aqui.'); d.addPage(); d.rect(50, 50, 200, 200).fill('#888'); d.addPage(); d.text('Terceira página também com texto suficiente para ser considerada lida normalmente pelo sistema de leitura.'); d.end();
  });
  const { respostas } = await enviarLote([{ nome: 'Anexo_8_Relatorio_CCIH___UPAE_Teste_122026.pdf', buf: pdf }]);
  assert.equal(respostas[0].estado, 'lido');
  const e = await estado();
  const it = e.itens.slice(-1)[0];
  assert.deepEqual(it.paginasImagem, [2]); assert.match(it.motivo, /1 página\(s\) parecem só imagem.*: 2/);
  assert.deepEqual(e.painel.paginasImagem.map((x) => x.paginas), [[2]]);
  assert.equal(e.painel.paginas, 3);
  assert.deepEqual(S.db.get("SELECT paginas_imagem FROM gaveta_documentos WHERE codigo = 'anexo_8' AND mes = '2026-12'"), { paginas_imagem: '2' });
});

test('arquivo grande demais, tipo não aceito e arquivo ilegível avisam sem travar o resto', async () => {
  const bom = { nome: 'Anexo_9_Relatorio_NSP___UPAE_Teste_072026.txt', buf: Buffer.from('Relatório do NSP, conteúdo de enchimento para passar do mínimo de caracteres legíveis do arquivo. '.repeat(3)) };
  const reg = await a.post('/api/alimentar/lote', { zip: 'SEI_RM_07_2026___UPAE_TESTE.zip', arquivos: [
    { nome: 'Anexo_2_Relatorio_Matriciamento___UPAE_Teste.pdf', tamanho: 70 * 1024 * 1024 }, { nome: 'planilha.xls', tamanho: 1000 }, { nome: 'quebrado.pdf', tamanho: 500, motivo: 'Não consegui abrir este arquivo dentro do ZIP.' }, { nome: bom.nome, tamanho: bom.buf.length }] });
  assert.equal(reg.status, 200);
  const [grande, tipo, quebrado, ok] = reg.json.itens;
  assert.equal(grande.estado, 'problema'); assert.equal(tipo.estado, 'problema'); assert.equal(quebrado.estado, 'problema'); assert.equal(ok.estado, 'espera');
  const e = await estado();
  const m = Object.fromEntries(e.itens.slice(-4).map((i) => [i.nome, i.motivo]));
  assert.match(m['Anexo_2_Relatorio_Matriciamento___UPAE_Teste.pdf'], /grande demais \(70 MB; o limite é 60 MB\)/);
  assert.match(m['planilha.xls'], /Tipo não aceito/);
  assert.match(m['quebrado.pdf'], /Não consegui abrir/);
  // PDF inválido (texto no lugar de PDF) vira problema e o próximo arquivo segue
  const lixo = { nome: 'Anexo_10_Relatorio_Projeto_de_Cuidadores___UPAE_Teste_072026.pdf', buf: Buffer.from('isto não é um pdf '.repeat(20)) };
  const seguinte = { nome: 'Anexo_6_Reuniao_Ordinaria_Comissao_de_Prontuarios___UPAE_Teste_072026_v2.txt', buf: Buffer.from('Ata nova de prontuários de julho de 2026, conteúdo diferente e texto de enchimento para o mínimo legível. '.repeat(3)) };
  const { respostas } = await enviarLote([lixo, seguinte]);
  assert.equal(respostas[0].estado, 'problema'); assert.equal(respostas[1].estado, 'lido');
});

test('reenviar um arquivo já recebido é inofensivo (rede que caiu na volta); lote parado vira interrompido', async () => {
  const f = { nome: 'Anexo_4_Relatorio_dos_Programas_Especiais___UPAE_Teste_072026_novo.txt', buf: Buffer.from('Programas especiais de julho, versão corrigida com conteúdo diferente e texto de enchimento suficiente. '.repeat(3)) };
  const reg = (await a.post('/api/alimentar/lote', { arquivos: [{ nome: f.nome, tamanho: f.buf.length }, { nome: 'Anexo_3_Relatorio_Supervisao_do_Cuidado___UPAE_Teste_072026_novo.txt', tamanho: 100 }] })).json;
  const hdr = { 'content-type': 'application/octet-stream', 'x-fila-id': String(reg.itens[0].id) };
  const r1 = await a.req('POST', '/api/alimentar/arquivo', undefined, { raw: f.buf, headers: hdr });
  const r2 = await a.req('POST', '/api/alimentar/arquivo', undefined, { raw: f.buf, headers: hdr });
  assert.equal(r1.json.estado, 'lido'); assert.equal(r2.json.repetido, true);
  assert.equal(gaveta('2026-07').filter((d) => d.codigo === 'anexo_4').length, 1);
  // o segundo arquivo nunca chegou: depois do prazo vira interrompido, com instrução clara
  S.db.run("UPDATE alimentar_fila SET atualizado_em = '2020-01-01T00:00:00.000Z' WHERE lote = ?", reg.lote);
  const e = await estado();
  const parado = e.itens.find((i) => i.id === reg.itens[1].id);
  assert.equal(parado.estado, 'problema'); assert.match(parado.motivo, /Solte o ZIP de novo/);
  // arquivo de outra pessoa não se envia
  assert.equal((await outro.req('POST', '/api/alimentar/arquivo', undefined, { raw: f.buf, headers: hdr })).status, 404);
});

test('permissão: só quem tem a unidade na carteira vê a gaveta dela', async () => {
  assert.equal((await outro.get('/api/gaveta/unidade/' + UN)).status, 403);
  assert.equal((await outro.get('/api/gaveta/unidade/' + UN + '/trimestre/2026-T3')).status, 403);
  assert.equal((await outro.post('/api/gaveta/numeros/confirmar', { ids: [S.db.get('SELECT id FROM gaveta_numeros').id] })).status, 403);
  const v = (await a.get('/api/gaveta/unidade/' + UN)).json;
  assert.ok(v.meses.length >= 3); assert.deepEqual(v.trimestres.slice(0, 1), ['2026-T4']);
  assert.equal((await a.get('/api/gaveta/unidade/' + UN + '/mes/2026-7')).status, 400);
  const doc = (await a.get('/api/gaveta/documento/' + S.db.get("SELECT id FROM gaveta_documentos WHERE codigo = 'anexo_I' LIMIT 1").id + '?texto=1')).json;
  assert.match(doc.texto, /INDICADORES DE PRODUÇÃO/);
  const cat = (await a.get('/api/gaveta/catalogo')).json;
  assert.equal(cat.tipos.UPAE.documentos.length, 27); assert.match(cat.tipos.Hospital.a_confirmar, /analista da carteira/);
});

test('unidade UPA segue o fluxo antigo (parecer por trimestre) e não usa a gaveta', async () => {
  const r = await enviarLote([{ nome: 'parecer-demo-2026-T2.txt', buf: Buffer.from('Parecer da UPA Demonstração (dados fictícios), 2026-T2. Nota total do trimestre: 88 pontos. Texto de enchimento para passar do mínimo de caracteres legíveis do arquivo. '.repeat(2)) }]);
  assert.equal(r.respostas[0].estado, 'pronto');
  const e = await estado();
  assert.equal(e.painel.catalogo, false); assert.match(e.painel.resumo, /1 de 1 arquivos lidos/);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM gaveta_documentos WHERE contrato_id = 'DEMO-UPA'").n, 0);
});
