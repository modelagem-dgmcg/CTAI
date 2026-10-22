'use strict';
// Importação de relatórios no Redator: extração (PDF, Word, Excel, CSV), proposta de quadros pela IA (simulada) e conferência dos números.
process.env.ANALISTA_ENVIAR_NUVEM = 'sim'; process.env.ANALISTA_ORDEM = 'gemini'; process.env.GEMINI_API_KEY = 'chave-fake';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const { iniciar, cliente } = require('./helpers');

let S, a, srv, id, resposta;
const pdfCom = (texto) => new Promise((ok) => { const d = new PDFDocument(); const p = []; d.on('data', (x) => p.push(x)); d.on('end', () => ok(Buffer.concat(p))); d.text(texto); d.end(); });
const b64 = (b) => Buffer.from(b).toString('base64');

test.before(async () => {
  resposta = { q1: [['1.1', 'Consultas médicas', '1.000', '1.020 / 980 / 1.010', '100,33%', 'Meta cumprida'], ['1.2', 'Cirurgias', '50', '47 / 45 / 99999', '', 'A analisar']], q2: [], q3: [['3.99', 'Indicador extra do relatório', '≥ 80%', '91% / 92% / 90%', '91%', 'Meta cumprida']] };
  srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(resposta) }] } }] })); }); });
  await new Promise((r) => srv.listen(0, r));
  process.env.GEMINI_URL = 'http://127.0.0.1:' + srv.address().port + '/g';
  S = await iniciar();
  a = cliente(S.base); await a.entrar('cleuton');
  const cs = (await a.get('/api/ctai/contratos')).json.contratos.find((c) => c.contrato_id === 'DEMO-UPA');
  id = (await a.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T1', competencias: cs.competencias.map((k) => k.competencia_id).slice(0, 3) })).json.parecer_id;
  await a.post('/api/ctai/pareceres/' + id + '/modelo', { modo: 'padrao' });
});
test.after(async () => { srv.close(); await S.fechar(); });

const U = (n) => '/api/ctai/pareceres/' + id + '/relatorios' + (n || '');

test('importa PDF com texto, Word, Excel e CSV; recusa tipo, vazio, escaneado e repetido', async () => {
  const texto = 'Relatório assistencial. Consultas médicas (meta mensal 1.000): janeiro 1.020, fevereiro 980, março 1.010. Satisfação do usuário 91% 92% 90%. Cirurgias 47 45 40. '.repeat(3);
  const pdf = await pdfCom(texto);
  assert.equal((await a.post(U(), { nome: 'rel.pdf', base64: b64(pdf) })).status, 200);
  assert.equal((await a.post(U(), { nome: 'rel.pdf', base64: b64(pdf) })).status, 409);
  const z = new JSZip(); z.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Educação permanente: 8 atividades previstas e 8 executadas no mês de janeiro de 2026 conforme relatório mensal da unidade.</w:t></w:r></w:p></w:body></w:document>');
  assert.equal((await a.post(U(), { nome: 'rel.docx', base64: b64(await z.generateAsync({ type: 'nodebuffer' })) })).status, 200);
  const x = new JSZip(); x.file('xl/sharedStrings.xml', '<sst><si><t>Indicador</t></si><si><t>Taxa de infecção hospitalar abaixo da meta pactuada para o período</t></si></sst>'); x.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>2,5</v></c><c><v>1,8</v></c></row></sheetData></worksheet>');
  assert.equal((await a.post(U(), { nome: 'rel.xlsx', base64: b64(await x.generateAsync({ type: 'nodebuffer' })) })).status, 200);
  assert.equal((await a.post(U(), { nome: 'rel.csv', base64: b64('indicador;jan;fev;mar\nTaxa de ocupação dos leitos clínicos;80;82;85\nTempo médio de permanência;4;5;4\n') })).status, 200);
  assert.equal((await a.post(U(), { nome: 'x.exe', base64: b64('abc') })).status, 400);
  assert.equal((await a.post(U(), { nome: 'v.txt', base64: '' })).status, 400);
  assert.equal((await a.post(U(), { nome: 'curto.txt', base64: b64('oi') })).status, 422);
  assert.equal((await a.post(U(), { nome: 'falso.pdf', base64: b64('isto não é pdf '.repeat(20)) })).status, 400);
  const l = (await a.get(U())).json.relatorios;
  assert.equal(l.length, 4); assert.ok(l.every((r) => r.caracteres > 50));
});

test('a IA propõe os quadros; linhas com números fora do texto ficam não verificadas; nada entra sem aplicar', async () => {
  const p = (await a.post(U('/propor'), {})).json;
  assert.equal(p.ok, true);
  const q1 = p.quadros.q1;
  assert.equal(q1.find((l) => l.celulas[1] === 'Consultas médicas').verificada, true);
  assert.equal(q1.find((l) => l.celulas[1] === 'Cirurgias').verificada, false, '99999 não está no relatório');
  assert.equal((await a.get('/api/ctai/pareceres/' + id)).json.conteudoAtual.modelo.quadros.q1.length, 0);
  const ap = (await a.post(U('/aplicar'), { quadros: { q1: [q1[0].celulas], q3: [p.quadros.q3[0].celulas] } })).json;
  assert.equal(ap.aplicadas, 2);
  assert.equal((await a.post(U('/aplicar'), { quadros: { q1: [q1[0].celulas] } })).json.aplicadas, 0, 'não repete o mesmo indicador');
  const m = (await a.get('/api/ctai/pareceres/' + id)).json.conteudoAtual.modelo;
  assert.equal(m.quadros.q1[0][1], 'Consultas médicas'); assert.equal(m.quadros.q3.some((l) => l[1] === 'Indicador extra do relatório'), true);
});

test('revisão completa acusa número do quadro que não está nos relatórios; só o criador importa', async () => {
  await a.put('/api/ctai/pareceres/' + id + '/modelo', { quadros: { q1: [['1.1', 'Consultas médicas', '1.000', '7.777 / 8.888', '', 'Meta cumprida']] } });
  const r = (await a.post('/api/analista/pareceres/' + id + '/revisao-completa', {})).json;
  assert.equal(r.relatorios.usado, true);
  assert.ok(r.achados.some((x) => x.tipo === 'Número fora dos relatórios'));
  const outro = cliente(S.base); await outro.entrar('colega1');
  assert.equal((await outro.post(U(), { nome: 'a.txt', base64: b64('texto qualquer '.repeat(20)) })).status, 403);
  assert.equal((await a.del(U('/' + (await a.get(U())).json.relatorios[0].rel_id))).status, 200);
});
