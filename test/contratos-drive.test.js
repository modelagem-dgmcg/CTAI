'use strict';
// Contratos e TAs (Drive): chave opcional, só pelo servidor, lista por unidade, aviso de arquivo novo, leitura (rascunho -> confirmado),
// "o que vale hoje" e completude. Servidor falso do Apps Script, dados fictícios.
process.env.CTAI_SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres';
delete process.env.CONTRATOS_DRIVE_URL; delete process.env.CONTRATOS_DRIVE_CHAVE;
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const FD = require('./fake-drive');
const { criar } = require('../adapters/contratos-drive');
const CD = require('../server/contratos-drive');
const PC = require('../modules/analista/propor-contrato');
const COMP = require('../server/completude');

let S, fake, adm, a, colega2, gestor, cartao;
const usuario = (login) => S.db.get('SELECT * FROM usuarios WHERE login = ?', login);

test.before(async () => {
  fake = await FD.iniciar();
  S = await iniciar();
  adm = cliente(S.base); a = cliente(S.base); colega2 = cliente(S.base); gestor = cliente(S.base);
  await adm.entrar('admin'); await a.entrar('cleuton'); await colega2.entrar('colega2'); await gestor.entrar('gestor.demo');
  const CART = require('../server/carteira');
  CART.definir(S.db, 'teste', usuario('cleuton').usuario_id, ['DEMO-UPA']);
  CART.definir(S.db, 'teste', usuario('colega2').usuario_id, ['UPA-OLINDA']);
  S.db.run("UPDATE contratos SET unidade = 'UPAE Palmares' WHERE contrato_id = 'DEMO-UPA'");
});
test.after(async () => { await fake.fechar(); delete process.env.CONTRATOS_DRIVE_URL; delete process.env.CONTRATOS_DRIVE_CHAVE; await S.fechar(); });

// ---------- adaptador: a chave é opcional ----------
test('adaptador: só a URL é obrigatória; sem chave o parâmetro não é enviado; com chave, é', async () => {
  assert.equal(criar({}).ligada, false);
  assert.equal(criar({ CONTRATOS_DRIVE_URL: fake.url }).ligada, true, 'só a URL basta');
  await criar({ CONTRATOS_DRIVE_URL: fake.url }).listar('palmares');
  assert.equal(fake.estado.chamadas.pop().chave, null, 'sem chave: nenhum parâmetro chave');
  fake.estado.chave = 'chave-do-script-1234';
  await assert.rejects(() => criar({ CONTRATOS_DRIVE_URL: fake.url }).listar('palmares'), /recusou: Chave inválida/);
  const r = await criar({ CONTRATOS_DRIVE_URL: fake.url, CONTRATOS_DRIVE_CHAVE: 'chave-do-script-1234' }).listar('palmares');
  assert.equal(r.arquivos.length, 4);
  assert.equal(fake.estado.chamadas.pop().chave, 'chave-do-script-1234', 'com chave, ela vai');
  fake.estado.chave = null; fake.estado.chamadas.length = 0;
  await assert.rejects(() => criar({ CONTRATOS_DRIVE_URL: 'http://127.0.0.1:1/exec' }).listar('x'), (e) => !/127\.0\.0\.1/.test(e.message), 'o erro não mostra a URL');
});

// ---------- configuração ----------
test('configuração: só a administração guarda; https; chave opcional, cifrada e nunca devolvida', async () => {
  const url = 'https://script.google.com/macros/s/FAKE-CONTRATOS/exec';
  assert.equal((await a.put('/api/contratos-drive/config', { url })).status, 403);
  assert.equal((await gestor.get('/api/contratos-drive/estado')).status, 403, 'a unidade nunca acessa');
  assert.equal((await adm.put('/api/contratos-drive/config', { url: 'http://x/exec' })).status, 400);
  assert.equal((await adm.put('/api/contratos-drive/config', { url, chave: 'curta' })).status, 400);
  assert.equal((await adm.get('/api/contratos-drive/estado')).json.configurada, false);
  let r = await adm.put('/api/contratos-drive/config', { url });
  assert.equal(r.status, 200); assert.equal(r.json.com_chave, false);
  let e = (await adm.get('/api/contratos-drive/estado')).json;
  assert.equal(e.configurada, true); assert.equal(e.com_chave, false); assert.equal(e.origem, 'tela');
  assert.equal(S.db.get('SELECT chave_cifrada FROM contratos_drive_config WHERE id = 1').chave_cifrada, null);
  r = await adm.put('/api/contratos-drive/config', { url, chave: 'chave-do-script-9876' });
  assert.equal(r.json.final, '9876');
  e = (await adm.get('/api/contratos-drive/estado')).json;
  assert.ok(e.com_chave); assert.ok(!JSON.stringify(e).includes('chave-do-script') && !JSON.stringify(e).includes('FAKE-CONTRATOS'), 'nem a chave nem o endereço voltam para a tela');
  const linha = S.db.get('SELECT chave_cifrada FROM contratos_drive_config WHERE id = 1');
  assert.ok(linha.chave_cifrada.startsWith('v1:') && !linha.chave_cifrada.includes('chave-do-script'), 'cifrada no banco');
  const t = S.db.all("SELECT valor_novo FROM trilha_auditoria WHERE tabela = 'contratos_drive'").map((x) => x.valor_novo).join(' ');
  assert.ok(t.includes('9876') && !t.includes('chave-do-script'), 'a trilha só tem o final');
  // daqui em diante o servidor falso (http) é o destino
  process.env.CONTRATOS_DRIVE_URL = fake.url; delete process.env.CONTRATOS_DRIVE_CHAVE;
});

// ---------- termos de busca e classificação ----------
test('termos de busca e classificação dos arquivos', () => {
  assert.deepEqual(CD.termosDaUnidade('UPAE Palmares'), ['upae palmares', 'palmares']);
  assert.deepEqual(CD.termosDaUnidade('Hospital Geral de Areias'), ['hospital geral areias', 'areias']);
  assert.deepEqual(CD.classificar('1º Termo Aditivo - UPAE Palmares', 'x'), { tipo: 'aditivo', numero: 1 });
  assert.deepEqual(CD.classificar('Segundo aditivo TA 2', 'x').tipo, 'aditivo');
  assert.deepEqual(CD.classificar('11º TA UPAE', 'x'), { tipo: 'aditivo', numero: 11 });
  assert.deepEqual(CD.classificar('Contrato de Gestão 011/2023', 'x'), { tipo: 'contrato', numero: null });
  assert.deepEqual(CD.classificar('Controle', 'pasta / Termos Aditivos'), { tipo: 'aditivo', numero: null });
  assert.equal(CD.classificar('Planilha', 'x').tipo, 'outro');
});

// ---------- lista por unidade ----------
test('testar: lista a pasta de uma unidade e registra o resultado', async () => {
  fake.estado.chamadas.length = 0;
  const t = (await a.post('/api/contratos-drive/testar', {})).json;
  assert.equal(t.ok, true, JSON.stringify(t)); assert.match(t.mensagem, /4 arquivo\(s\) para "upae palmares"/);
  assert.equal(fake.estado.chamadas[0].chave, null);
  assert.equal((await a.get('/api/contratos-drive/estado')).json.teste.ok, true);
  assert.equal((await gestor.post('/api/contratos-drive/testar', {})).status, 403);
});
test('lista da unidade: ordem contrato -> aditivos, pasta atualizada em, só Docs lidos; cópia de 1 h', async () => {
  const l = (await a.get('/api/contratos-drive/unidade/DEMO-UPA')).json;
  assert.deepEqual(l.arquivos.map((x) => x.nome), ['Contrato de Gestão 011/2023 - UPAE Palmares', '1º Termo Aditivo - UPAE Palmares', '2º Termo Aditivo - UPAE Palmares', '3º Termo Aditivo - UPAE Palmares.pdf']);
  assert.deepEqual(l.arquivos.map((x) => x.tipo_doc + (x.numero_aditivo || '')), ['contrato', 'aditivo1', 'aditivo2', 'aditivo3']);
  assert.equal(l.pasta_atualizada_em, '2026-09-20T12:15:00.000Z'); assert.equal(l.arquivos[3].e_doc, false); assert.equal(l.termo, 'upae palmares'); assert.equal(l.amplo, false);
  assert.ok(l.arquivos.every((x) => x.url.startsWith('https://')));
  const n = fake.estado.chamadas.length;
  await a.get('/api/contratos-drive/unidade/DEMO-UPA');
  assert.equal(fake.estado.chamadas.length, n, 'a segunda consulta vem da cópia');
  await a.get('/api/contratos-drive/unidade/DEMO-UPA?atualizar=1');
  assert.equal(fake.estado.chamadas.length, n + 1, '"atualizar" força nova consulta');
});
test('termo alternativo quando o nome completo não acha; termo digitado à mão', async () => {
  S.db.run("UPDATE contratos SET unidade = 'UPAE Regional de Palmares' WHERE contrato_id = 'DEMO-UPA'");
  const l = (await a.get('/api/contratos-drive/unidade/DEMO-UPA?atualizar=1')).json;
  assert.equal(l.termo, 'palmares'); assert.equal(l.amplo, true); assert.equal(l.arquivos.length, 4);
  S.db.run("UPDATE contratos SET unidade = 'UPAE Palmares' WHERE contrato_id = 'DEMO-UPA'");
  const m = (await a.get('/api/contratos-drive/unidade/DEMO-UPA?termo=caruaru')).json;
  assert.equal(m.termo_manual, true); assert.deepEqual(m.arquivos.map((x) => x.id), ['doc-contrato-caruaru']);
  assert.equal(m.novidades.length, 0);
});
test('carteira manda: outra pessoa e a unidade não consultam', async () => {
  assert.equal((await colega2.get('/api/contratos-drive/unidade/DEMO-UPA')).status, 403);
  assert.equal((await colega2.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-contrato-palmares' })).status, 403);
  assert.equal((await gestor.get('/api/contratos-drive/unidade/DEMO-UPA')).status, 403);
  assert.equal((await cliente(S.base).get('/api/contratos-drive/unidade/DEMO-UPA')).status, 401);
});

// ---------- aviso de arquivo novo ----------
test('arquivo novo ou alterado vira item na Caixa de entrada de quem tem a unidade; a primeira consulta só fixa a base', async () => {
  const antes = S.db.get("SELECT COUNT(*) AS n FROM caixa_itens WHERE tipo = 'aditivo_novo'").n;
  assert.equal(antes, 0, 'a primeira consulta não avisa');
  fake.adicionar({ id: 'doc-ta4-palmares', nome: '4º Termo Aditivo - UPAE Palmares', caminho: FD.RAIZ + ' / UPAE / Palmares / Termos Aditivos', atualizado_em: '2026-10-20T12:00:00.000Z', texto: 'QUARTO TERMO ADITIVO.' });
  const l = (await a.get('/api/contratos-drive/unidade/DEMO-UPA?atualizar=1')).json;
  assert.deepEqual(l.novidades.map((x) => x.nome), ['4º Termo Aditivo - UPAE Palmares']); assert.equal(l.novidades[0].novo, true);
  const it = S.db.get("SELECT * FROM caixa_itens WHERE tipo = 'aditivo_novo'");
  assert.ok(it && it.contrato_id === 'DEMO-UPA' && it.link === '#/u/DEMO-UPA');
  assert.deepEqual(S.db.all('SELECT usuario_id FROM caixa_destinos WHERE item_id = ?', it.item_id).map((x) => x.usuario_id), [usuario('cleuton').usuario_id]);
  assert.doesNotMatch(it.texto + it.titulo, /R\$|CPF/, 'sem dado sensível na caixa');
  await a.get('/api/contratos-drive/unidade/DEMO-UPA?atualizar=1');
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM caixa_itens WHERE tipo = 'aditivo_novo'").n, 1, 'sem repetir o mesmo aviso');
  const caixa = (await a.get('/api/caixa')).json;
  assert.ok(caixa.itens.some((i) => i.tipo === 'aditivo_novo' && i.tipo_rotulo === 'Novo aditivo na pasta'));
  fake.alterar('doc-ta2-palmares', { atualizado_em: '2026-10-21T08:00:00.000Z' });
  const l2 = (await a.get('/api/contratos-drive/unidade/DEMO-UPA?atualizar=1')).json;
  assert.equal(l2.novidades.length, 1); assert.equal(l2.novidades[0].novo, false);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM caixa_itens WHERE tipo = 'aditivo_novo'").n, 2);
});

// ---------- leitura: rascunho -> confirmado ----------
test('ler sem IA: rascunho em branco, texto mascarado, só Google Doc, só arquivo desta unidade', async () => {
  const r = await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-contrato-palmares' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ia.ok, false); assert.ok(r.json.mascarados >= 1);
  const d = (await a.get('/api/contratos-drive/docs/' + r.json.doc_id + '?texto=1')).json;
  assert.equal(d.estado, 'rascunho'); assert.equal(d.tipo, 'contrato'); assert.equal(d.origem, 'manual'); assert.equal(d.pontos.length, 0);
  assert.ok(d.texto.includes('CONTRATO DE GESTÃO') && !d.texto.includes('123.456.789-09'), 'CPF mascarado antes de guardar');
  assert.equal((await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'pdf-ta3-palmares' })).status, 422, 'PDF não é lido');
  assert.equal((await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-contrato-caruaru' })).status, 400, 'arquivo de outra unidade');
  assert.equal((await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'inventado' })).status, 400);
  const outra = await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-contrato-palmares' });
  assert.equal(outra.json.doc_id, d.doc_id, 'ler de novo o rascunho o refaz, sem duplicar');
});
test('conferir à mão e confirmar: depois de confirmado não edita; nada vale antes', async () => {
  const id = S.db.get("SELECT doc_id FROM contrato_docs WHERE drive_id = 'doc-contrato-palmares'").doc_id;
  assert.equal((await a.post('/api/contratos-drive/docs/' + id + '/confirmar')).status, 400, 'vazio não se confirma');
  assert.equal((await a.put('/api/contratos-drive/docs/' + id, { tipo: 'contrato', vigencia_inicio: '01/03/2024', vigencia_fim: '01/03/2023' })).status, 400, 'vigência invertida');
  assert.equal((await a.put('/api/contratos-drive/docs/' + id, { tipo: 'contrato', vigencia_fim: '31/02x' })).status, 400, 'data inválida');
  const q0 = (await a.get('/api/contratos-drive/unidade/DEMO-UPA/quadro')).json;
  assert.equal(q0.vale_hoje.tudo_confirmado, false); assert.equal(q0.vale_hoje.proposta, true);
  const s = await a.put('/api/contratos-drive/docs/' + id, { tipo: 'contrato', objeto: 'Gerenciamento da UPAE Palmares', vigencia_inicio: '01/03/2023', vigencia_fim: '28/02/2024', valor_total: 'R$ 12.000.000,00', pontos: [
    { categoria: 'repasse', titulo: 'Repasse mensal', valor: 'R$ 1.000.000,00', efeito: 'novo', trecho: 'Repasse mensal de R$ 1.000.000,00', verificada: true },
    { categoria: 'meta', titulo: 'Consultas médicas', valor: '3.000 por mês', efeito: 'novo', trecho: 'Meta: 3.000 consultas médicas por mês' },
    { categoria: 'art15a', titulo: 'Desconto por descumprimento', valor: '', descricao: 'Seguirá o art. 15-A', efeito: 'novo' }] });
  assert.equal(s.status, 200, JSON.stringify(s.json)); assert.equal(s.json.vigencia_fim, '2024-02-28'); assert.equal(s.json.pontos.length, 3);
  const c = await a.post('/api/contratos-drive/docs/' + id + '/confirmar');
  assert.equal(c.status, 200); assert.equal(c.json.estado, 'confirmado'); assert.equal(c.json.tem_texto, false, 'o texto lido some ao confirmar');
  assert.equal((await a.put('/api/contratos-drive/docs/' + id, { tipo: 'contrato', objeto: 'x' })).status, 409);
  assert.equal((await a.post('/api/contratos-drive/docs/' + id + '/confirmar')).status, 409);
  assert.equal((await a.del('/api/contratos-drive/docs/' + id)).status, 409);
  assert.equal((await colega2.get('/api/contratos-drive/docs/' + id)).status, 403);
  assert.equal((await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-contrato-palmares' })).status, 409, 'já confirmado e sem mudança no Drive');
  const t = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela = 'contrato_docs'").map((x) => x.campo);
  assert.ok(t.includes('leitura') && t.includes('rascunho_salvo') && t.includes('confirmado'));
});

test('IA propõe o aditivo (simulada): trechos verificados, "o que vale hoje" aplica em ordem, proposta até confirmar', async () => {
  const u = usuario('cleuton');
  const prop = (texto, o) => async () => Object.assign({ ok: true, provedor: 'simulada' }, PC.normalizar(o, texto));
  const ta1 = fake.estado.arquivos.find((x) => x.id === 'doc-ta1-palmares').texto;
  const r1 = await CD.lerDocumento(S.db, u, 'DEMO-UPA', 'doc-ta1-palmares', { propor: prop(ta1, { tipo: 'aditivo', numero_aditivo: 1, objeto: 'Prorroga a vigência e reajusta o repasse', vigencia_fim: '2025-02-28', muda: 'Prorroga a vigência e aumenta o repasse e a meta', pontos: [
    { categoria: 'repasse', titulo: 'Repasse mensal', valor: 'R$ 1.100.000,00', efeito: 'altera', trecho: 'O repasse mensal passa a ser de R$ 1.100.000,00' },
    { categoria: 'meta', titulo: 'Consultas médicas', valor: '3.200 por mês', efeito: 'altera', trecho: 'Meta: 3.200 consultas médicas por mês' },
    { categoria: 'outro', titulo: 'Ponto inventado', valor: 'R$ 9.999,00', efeito: 'novo', trecho: 'Esta frase não existe no documento' }] }) });
  assert.equal(r1.ia.ok, true);
  const d1 = (await a.get('/api/contratos-drive/docs/' + r1.doc_id)).json;
  assert.equal(d1.tipo, 'aditivo'); assert.equal(d1.numero_aditivo, 1); assert.equal(d1.origem, 'ia'); assert.equal(d1.provedor, 'simulada');
  assert.deepEqual(d1.pontos.map((p) => p.verificada), [true, true, false], 'trecho que não existe no texto fica sem a marca de conferido');
  // 2º aditivo: revoga a meta de 3.200 e fixa 3.500
  const ta2 = fake.estado.arquivos.find((x) => x.id === 'doc-ta2-palmares').texto;
  const r2 = await CD.lerDocumento(S.db, u, 'DEMO-UPA', 'doc-ta2-palmares', { propor: prop(ta2, { tipo: 'aditivo', numero_aditivo: 2, vigencia_fim: '2026-02-28', muda: 'Nova meta de consultas', pontos: [
    { categoria: 'meta', titulo: 'Consultas médicas', valor: '3.500 por mês', efeito: 'altera', trecho: 'fixa 3.500 consultas médicas por mês' }] }) });
  let q = (await a.get('/api/contratos-drive/unidade/DEMO-UPA/quadro')).json;
  assert.deepEqual(q.documentos.map((d) => d.rotulo), ['Contrato', '1º Termo Aditivo', '2º Termo Aditivo']);
  assert.equal(q.vale_hoje.proposta, true); assert.equal(q.vale_hoje.tudo_confirmado, false);
  let rep = q.vale_hoje.pontos.find((p) => p.titulo === 'Repasse mensal'), meta = q.vale_hoje.pontos.find((p) => p.titulo === 'Consultas médicas');
  assert.equal(rep.valor, 'R$ 1.100.000,00'); assert.equal(rep.doc, '1º Termo Aditivo'); assert.equal(rep.confirmado, false, 'veio de rascunho: é proposta');
  assert.equal(meta.valor, '3.500 por mês'); assert.equal(meta.doc, '2º Termo Aditivo');
  assert.equal(q.vale_hoje.vigencia_fim.valor, '2026-02-28'); assert.equal(q.vale_hoje.vigencia_fim.confirmado, false);
  assert.ok(q.vale_hoje.pontos.find((p) => p.categoria === 'art15a').confirmado, 'o que só veio do contrato confirmado continua confirmado');
  // confirma os dois (o ponto inventado é removido pela pessoa antes)
  const limpos = d1.pontos.filter((p) => p.verificada);
  assert.equal((await a.put('/api/contratos-drive/docs/' + r1.doc_id, Object.assign({}, d1, { pontos: limpos }))).status, 200);
  assert.equal((await a.post('/api/contratos-drive/docs/' + r1.doc_id + '/confirmar')).status, 200);
  assert.equal((await a.post('/api/contratos-drive/docs/' + r2.doc_id + '/confirmar')).status, 200);
  q = (await a.get('/api/contratos-drive/unidade/DEMO-UPA/quadro')).json;
  assert.equal(q.vale_hoje.tudo_confirmado, true); assert.equal(q.vale_hoje.proposta, false);
  assert.ok(q.vale_hoje.pontos.every((p) => p.confirmado)); assert.equal(q.confirmados, 3);
});
test('"o que vale hoje": aditivo que revoga retira o ponto (função pura)', () => {
  const docs = [{ doc_id: 1, tipo: 'contrato', estado: 'confirmado', vigencia_fim: '2024-01-01' }, { doc_id: 2, tipo: 'aditivo', numero_aditivo: 1, estado: 'confirmado', vigencia_fim: null }];
  const v = CD.valeHoje(docs, { 1: [{ categoria: 'meta', titulo: 'Partos', valor: '10', efeito: 'novo' }, { categoria: 'meta', titulo: 'Cirurgias', valor: '5', efeito: 'novo' }], 2: [{ categoria: 'meta', titulo: 'PARTOS', efeito: 'revoga' }] });
  assert.deepEqual(v.pontos.map((p) => p.titulo), ['Cirurgias']); assert.equal(v.revogados.length, 1); assert.equal(v.vigencia_fim.valor, '2024-01-01'); assert.equal(v.tudo_confirmado, true);
  assert.equal(CD.valeHoje([], {}).tudo_confirmado, false);
});

test('arquivo que mudou no Drive depois de confirmado: novo rascunho que substitui o antigo ao confirmar', async () => {
  fake.alterar('doc-ta1-palmares', { atualizado_em: '2026-10-22T10:00:00.000Z', texto: fake.estado.arquivos.find((x) => x.id === 'doc-ta1-palmares').texto + ' Correção de redação.' });
  const l = (await a.get('/api/contratos-drive/unidade/DEMO-UPA?atualizar=1')).json;
  assert.equal(l.arquivos.find((x) => x.id === 'doc-ta1-palmares').mudou_depois_da_leitura, true);
  const antigo = S.db.get("SELECT doc_id FROM contrato_docs WHERE drive_id = 'doc-ta1-palmares'").doc_id;
  const r = await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-ta1-palmares' });
  assert.equal(r.status, 200); assert.notEqual(r.json.doc_id, antigo);
  assert.equal(S.db.get('SELECT estado FROM contrato_docs WHERE doc_id = ?', antigo).estado, 'confirmado', 'o antigo continua valendo até confirmar o novo');
  assert.equal((await a.put('/api/contratos-drive/docs/' + r.json.doc_id, { tipo: 'aditivo', numero_aditivo: 1, objeto: 'Redação corrigida', vigencia_fim: '28/02/2025' })).status, 200);
  assert.equal((await a.post('/api/contratos-drive/docs/' + r.json.doc_id + '/confirmar')).status, 200);
  assert.equal(S.db.get('SELECT estado FROM contrato_docs WHERE doc_id = ?', antigo).estado, 'substituido');
  const q = (await a.get('/api/contratos-drive/unidade/DEMO-UPA/quadro')).json;
  assert.equal(q.documentos.filter((d) => d.numero_aditivo === 1).length, 1, 'só um 1º aditivo vale');
});

test('descartar rascunho', async () => {
  const r = await a.post('/api/contratos-drive/unidade/DEMO-UPA/ler', { drive_id: 'doc-ta4-palmares' });
  assert.equal(r.status, 200);
  assert.equal((await a.del('/api/contratos-drive/docs/' + r.json.doc_id)).status, 200);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM contrato_docs WHERE doc_id = ?', r.json.doc_id).n, 0);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM contrato_pontos WHERE doc_id = ?', r.json.doc_id).n, 0);
});

// ---------- leitura pela IA: pura ----------
test('normalizar: categoria e efeito inválidos viram padrão; número e trecho precisam existir no texto', () => {
  const texto = 'O repasse mensal será de R$ 2.500,00 a partir de 01/01/2025.';
  const n = PC.normalizar({ tipo: 'aditivo', numero_aditivo: '3', data_doc: '2025-01-02', pontos: [
    { categoria: 'estranha', titulo: 'Repasse', valor: 'R$ 2.500,00', efeito: 'esquisito', trecho: 'repasse mensal será de R$ 2.500,00' },
    { categoria: 'valor', titulo: 'Outro', valor: 'R$ 7.777,00', trecho: 'repasse mensal será de R$ 2.500,00' }, { titulo: '' }] }, texto);
  assert.equal(n.numero_aditivo, 3); assert.equal(n.tipo, 'aditivo'); assert.equal(n.pontos.length, 2);
  assert.equal(n.pontos[0].categoria, 'outro'); assert.equal(n.pontos[0].efeito, 'novo'); assert.equal(n.pontos[0].verificada, true);
  assert.equal(n.pontos[1].verificada, false, 'o valor R$ 7.777,00 não está no texto');
  assert.deepEqual(PC.normalizar(null, 'x').pontos, []);
});

// ---------- completude ----------
test('completude por carteira: trimestres do histórico e contrato lido', async () => {
  assert.deepEqual(COMP.ultimosTrimestres(4, '2026-10-27'), ['2026-T3', '2026-T2', '2026-T1', '2025-T4']);
  assert.deepEqual(COMP.ultimosTrimestres(2, '2026-01-05'), ['2025-T4', '2025-T3']);
  const u = usuario('cleuton');
  const mk = (tri, estado) => S.db.run("INSERT INTO hist_relatorios (contrato_id, trimestre, documento_tipo, estado, origem, criado_por, criado_em, atualizado_em) VALUES ('DEMO-UPA', ?, 'parecer', ?, 'manual', ?, ?, ?)", tri, estado, u.login, new Date().toISOString(), new Date().toISOString());
  mk('2026-T3', 'confirmado'); mk('2026-T2', 'rascunho');
  const p = (await adm.get('/api/gestao/completude')).json;
  const f = p.funcionarios.find((x) => x.nome === u.nome);
  const un = f.unidades.find((x) => x.contrato_id === 'DEMO-UPA');
  assert.deepEqual(un.trimestres, { '2026-T3': 'confirmado', '2026-T2': 'rascunho', '2026-T1': 'falta', '2025-T4': 'falta' });
  assert.equal(un.contrato.situacao, 'confirmado'); assert.ok(un.contrato.aditivos_confirmados >= 2); assert.equal(un.completo, false);
  assert.ok(p.sem_carteira.length >= 0 && p.resumo.unidades >= 2);
  assert.equal((await a.get('/api/gestao/completude')).status, 403, 'só a superintendência e a administração');
});

// ---------- "Zerar dados" ----------
test('zerar inclui as tabelas novas', () => {
  const Z = require('../server/zerar');
  const c = Z.contar(S.db, usuario('admin'));
  const nomes = c.apagar.map((x) => x.tabela);
  for (const t of ['contrato_docs', 'contrato_pontos', 'contrato_pasta', 'contrato_pasta_estado']) assert.ok(nomes.includes(t), t + ' deve entrar na limpeza');
  assert.ok(c.mantidos.some((m) => /Contratos e TAs/.test(m)), 'a configuração do Drive é mantida');
});
