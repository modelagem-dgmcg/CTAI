'use strict';
// Histórico dos relatórios: cruzamentos (puros), leitura proposta pela IA (simulada), rascunho -> confirmação, carteira e espelho desligado. Só dados de demonstração.
process.env.ANALISTA_ENVIAR_NUVEM = 'sim'; process.env.ANALISTA_ORDEM = 'gemini'; process.env.GEMINI_API_KEY = 'chave-fake';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const PDFDocument = require('pdfkit');
const { iniciar, cliente } = require('./helpers');
const CRUZ = require('../server/historico-cruzamentos');
const PH = require('../modules/analista/propor-historico');

// ---------- cruzamentos puros ----------
const R = (hist_id, trimestre, extra) => Object.assign({ hist_id, trimestre, documento_tipo: 'parecer', igq: null, indicadores: [], achados: [], recomendacoes: [] }, extra);

test('achado repetido em 2 ou mais trimestres (redação diferente, mesmo assunto)', () => {
  const av = CRUZ.achadoRepetido([
    R(1, '2026-T1', { achados: [{ tipo: 'Ouvidoria', descricao: 'Queixas respondidas fora do prazo na ouvidoria' }, { tipo: 'RH', descricao: 'Escala incompleta' }] }),
    R(2, '2026-T2', { achados: [{ tipo: 'Ouvidoria', descricao: 'Queixas da ouvidoria respondidas fora do prazo' }] }),
    R(3, '2026-T3', { achados: [{ tipo: 'Ouvidoria', descricao: 'Queixas respondidas fora do prazo (ouvidoria)' }] }),
  ]);
  assert.equal(av.length, 1);
  assert.deepEqual(av[0].trimestres, ['2026-T1', '2026-T2', '2026-T3']);
  assert.equal(av[0].gravidade, 'ALTA');
  assert.equal(CRUZ.achadoRepetido([R(1, '2026-T1', { achados: [{ tipo: 'RH', descricao: 'Escala incompleta' }] }), R(2, '2026-T2', { achados: [{ tipo: 'Estoque', descricao: 'Falta de insumos na farmácia' }] })]).length, 0, 'assuntos diferentes não se juntam');
});

test('indicador em queda por 2 trimestres seguidos (e a nota total)', () => {
  const ind = (p) => [{ indicador_id: '3.1', nome: 'Satisfação', pontos: p, max: 10 }, { indicador_id: '3.2', nome: 'Queixas', pontos: 8, max: 10 }];
  const av = CRUZ.indicadorEmQueda([R(1, '2026-T1', { igq: 92, indicadores: ind(9) }), R(2, '2026-T2', { igq: 88, indicadores: ind(7) }), R(3, '2026-T3', { igq: 81, indicadores: ind(5) })]);
  assert.deepEqual(av.map((a) => a.indicador_id).sort(), ['3.1', 'IGQ']);
  assert.equal(av.find((a) => a.indicador_id === 'IGQ').gravidade, 'ALTA');
  assert.equal(CRUZ.indicadorEmQueda([R(1, '2026-T1', { igq: 92, indicadores: ind(9) }), R(2, '2026-T2', { igq: 88, indicadores: ind(7) })]).length, 0, 'uma queda só não avisa');
  assert.equal(CRUZ.indicadorEmQueda([R(1, '2026-T1', { igq: 80, indicadores: ind(5) }), R(2, '2026-T2', { igq: 88, indicadores: ind(7) }), R(3, '2026-T3', { igq: 85, indicadores: ind(7) })]).length, 0, 'recuperou: sem aviso');
});

test('recomendação aberta que reaparece; se a mais recente já está atendida, não avisa', () => {
  const rec = (t, s) => ({ texto: t, situacao: s });
  const av = CRUZ.recomendacaoReaparece([R(1, '2026-T1', { recomendacoes: [rec('Regularizar a escala de plantões da equipe médica', 'aberta')] }), R(2, '2026-T2', { recomendacoes: [rec('Regularizar a escala dos plantões da equipe médica', 'repetida')] })]);
  assert.equal(av.length, 1); assert.equal(av[0].gravidade, 'ALTA');
  assert.equal(CRUZ.recomendacaoReaparece([R(1, '2026-T1', { recomendacoes: [rec('Regularizar a escala de plantões da equipe médica', 'aberta')] }), R(2, '2026-T2', { recomendacoes: [rec('Regularizar a escala de plantões da equipe médica', 'atendida')] })]).length, 0);
  assert.equal(CRUZ.recomendacaoReaparece([R(1, '2026-T1', { recomendacoes: [rec('Regularizar a escala de plantões da equipe médica', 'aberta')] })]).length, 0, 'uma vez só não é reaparição');
});

test('número que diverge entre dois relatórios do mesmo trimestre', () => {
  const av = CRUZ.numeroDiverge([
    R(1, '2026-T2', { documento_tipo: 'relatório da OSS', igq: 95, indicadores: [{ indicador_id: '1.1', pontos: 10 }, { indicador_id: '1.2', pontos: 5 }] }),
    R(2, '2026-T2', { documento_tipo: 'parecer', igq: 88.5, indicadores: [{ indicador_id: '1.1', pontos: 10 }, { indicador_id: '1.2', pontos: 3 }] }),
    R(3, '2026-T1', { igq: 90 }),
  ]);
  assert.equal(av.length, 2);
  assert.ok(av.some((a) => a.assunto === 'Nota total (IGQ)') && av.some((a) => a.assunto === 'Indicador 1.2'));
  assert.equal(CRUZ.numeroDiverge([R(1, '2026-T2', { igq: 90 }), R(2, '2026-T2', { igq: 90 })]).length, 0);
});

test('tendência: uma nota por trimestre, preferindo o parecer', () => {
  const t = CRUZ.tendencia([R(1, '2026-T1', { igq: 90 }), R(2, '2026-T2', { documento_tipo: 'relatório da OSS', igq: 95 }), R(3, '2026-T2', { igq: 88 }), R(4, '2026-T3', { igq: null })]);
  assert.deepEqual(t, [{ trimestre: '2026-T1', igq: 90 }, { trimestre: '2026-T2', igq: 88 }]);
});

test('leitura proposta: marca o que não está no texto como não verificado, com a página de origem', () => {
  const texto = '--- página 1 ---\nO IGQ do trimestre foi de 88,5 pontos.\n--- página 2 ---\nO indicador 3.1 obteve 7 pontos de 10. A ouvidoria respondeu fora do prazo.';
  const o = PH.normalizar({ igq: 88.5, igq_trecho: 'O IGQ do trimestre foi de 88,5 pontos.', indicadores: [{ indicador_id: '3.1', nome: 'Satisfação', pontos: 7, max: 10, trecho: 'O indicador 3.1 obteve 7 pontos de 10.' }, { indicador_id: '9.9', nome: 'Inventado', pontos: 4321, max: 10, trecho: 'frase que não existe' }],
    achados: [{ tipo: 'Ouvidoria', descricao: 'Resposta fora do prazo', gravidade: 'alta', trecho: 'A ouvidoria respondeu fora do prazo.' }, { descricao: 'Coisa inventada', trecho: 'não está no texto' }], recomendacoes: [] }, texto);
  assert.equal(o.igq_verificada, true); assert.match(o.igq_origem, /^página 1:/);
  assert.equal(o.indicadores[0].verificada, true); assert.match(o.indicadores[0].trecho, /^página 2:/);
  assert.equal(o.indicadores[1].verificada, false);
  assert.equal(o.achados[0].verificada, true); assert.equal(o.achados[0].gravidade, 'ALTA'); assert.equal(o.achados[1].verificada, false);
});

// ---------- fluxo pela API ----------
let S, srv, resposta, cleuton, colega1, colega2, nathalia;
const pdfCom = (texto) => new Promise((ok) => { const d = new PDFDocument(); const p = []; d.on('data', (x) => p.push(x)); d.on('end', () => ok(Buffer.concat(p))); d.text(texto); d.end(); });
const b64 = (b) => Buffer.from(b).toString('base64');
const TEXTO = 'Parecer de demonstração do segundo trimestre. A nota total da unidade (IGQ) foi de 88,5 pontos. O indicador 3.1, satisfação do usuário, obteve 7 pontos de 10 possíveis. A ouvidoria respondeu queixas fora do prazo. Recomenda-se regularizar a escala de plantões da equipe médica. O desconto aplicado foi de 6% sobre a base mensal.';

test.before(async () => {
  resposta = { igq: 88.5, igq_trecho: 'A nota total da unidade (IGQ) foi de 88,5 pontos.', desconto_pct: 6, desconto_valor: null,
    indicadores: [{ indicador_id: '3.1', nome: 'Satisfação do usuário', pontos: 7, max: 10, trecho: 'O indicador 3.1, satisfação do usuário, obteve 7 pontos de 10 possíveis.' }],
    achados: [{ tipo: 'Ouvidoria', descricao: 'Queixas respondidas fora do prazo', gravidade: 'MÉDIA', trecho: 'A ouvidoria respondeu queixas fora do prazo.' }],
    recomendacoes: [{ texto: 'Regularizar a escala de plantões da equipe médica', tema: 'RH', trecho: 'Recomenda-se regularizar a escala de plantões da equipe médica.' }] };
  srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(resposta) }] } }] })); }); });
  await new Promise((r) => srv.listen(0, r));
  process.env.GEMINI_URL = 'http://127.0.0.1:' + srv.address().port + '/g';
  S = await iniciar();
  cleuton = cliente(S.base); colega1 = cliente(S.base); colega2 = cliente(S.base); nathalia = cliente(S.base);
  await cleuton.entrar('cleuton'); await colega1.entrar('colega1'); await colega2.entrar('colega2'); await nathalia.entrar('nathalia');
  const CART = require('../server/carteira');
  const id = (l) => S.db.get('SELECT usuario_id FROM usuarios WHERE login = ?', l).usuario_id;
  CART.definir(S.db, 'teste', id('cleuton'), ['DEMO-UPA']);
  CART.definir(S.db, 'teste', id('colega2'), ['UPA-OLINDA']);
});
test.after(async () => { srv.close(); await S.fechar(); });

test('importa o relatório: vira rascunho com a leitura da IA; nada é confirmado sozinho', async () => {
  const pdf = await pdfCom(TEXTO);
  const r = await cleuton.post('/api/historico/importar', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', documento_tipo: 'parecer', nome: 'parecer-demo.pdf', base64: b64(pdf) });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ia.ok, true);
  const d = (await cleuton.get('/api/historico/relatorios/' + r.json.hist_id)).json;
  assert.equal(d.estado, 'rascunho'); assert.equal(d.igq, 88.5); assert.equal(d.origem, 'ia');
  assert.equal(d.indicadores.length, 1); assert.equal(d.indicadores[0].verificada, true); assert.equal(d.achados.length, 1); assert.equal(d.recomendacoes[0].situacao, 'aberta');
  const t = (await cleuton.get('/api/historico/relatorios/' + r.json.hist_id + '?texto=1')).json.texto;
  assert.match(t, /88,5/);
  assert.equal((await cleuton.post('/api/historico/importar', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', nome: 'de-novo.pdf', base64: b64(pdf) })).status, 409, 'mesmo arquivo na mesma unidade');
  // o rascunho não aparece nos avisos nem na tendência
  const u = (await cleuton.get('/api/historico/unidades/DEMO-UPA')).json;
  assert.equal(u.tendencia.length, 0); assert.equal(u.relatorios.length, 1);
  globalThis.__h = r.json.hist_id;
});

test('conferir, corrigir e confirmar; depois de confirmado não se edita, só a situação da recomendação', async () => {
  const id = globalThis.__h;
  let d = (await cleuton.get('/api/historico/relatorios/' + id)).json;
  d.igq = 88; d.indicadores[0].pontos = 7;
  assert.equal((await cleuton.put('/api/historico/relatorios/' + id, d)).status, 200);
  assert.equal((await cleuton.put('/api/historico/relatorios/' + id, Object.assign({}, d, { igq: 150 }))).status, 400, 'nota acima de 100');
  assert.equal((await cleuton.put('/api/historico/relatorios/' + id, Object.assign({}, d, { trimestre: '2026-2' }))).status, 400, 'trimestre fora do formato');
  assert.equal((await cleuton.post('/api/historico/relatorios/' + id + '/confirmar')).status, 200);
  assert.equal((await cleuton.put('/api/historico/relatorios/' + id, d)).status, 409);
  assert.equal((await cleuton.del('/api/historico/relatorios/' + id)).status, 409, 'confirmado não se apaga');
  const rec = (await cleuton.get('/api/historico/relatorios/' + id)).json.recomendacoes[0];
  assert.equal((await cleuton.put('/api/historico/recomendacoes/' + rec.id, { situacao: 'atendida', nota: 'escala regularizada em julho' })).status, 200);
  assert.equal((await cleuton.put('/api/historico/recomendacoes/' + rec.id, { situacao: 'xx' })).status, 400);
  const trilha = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela IN ('hist_relatorios','hist_recomendacoes')").map((x) => x.campo);
  for (const c of ['importacao', 'rascunho_salvo', 'confirmado', 'situacao']) assert.ok(trilha.includes(c), 'trilha: ' + c);
});

test('lançamento à mão (sem IA) e cruzamentos pela API', async () => {
  const mk = (tri, igq, pontos, extra) => cleuton.post('/api/historico/relatorios', Object.assign({ contrato_id: 'DEMO-UPA', trimestre: tri, documento_tipo: 'parecer', igq, indicadores: [{ indicador_id: '3.1', nome: 'Satisfação', pontos, max: 10 }],
    achados: [{ tipo: 'Ouvidoria', descricao: 'Queixas respondidas fora do prazo', gravidade: 'MÉDIA' }], recomendacoes: [{ texto: 'Regularizar a escala de plantões da equipe médica' }] }, extra));
  for (const [tri, igq, p] of [['2026-T1', 95, 9], ['2026-T3', 84, 5], ['2026-T4', 80, 3]]) {
    const r = await mk(tri, igq, p); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await cleuton.post('/api/historico/relatorios/' + r.json.hist_id + '/confirmar')).status, 200);
  }
  const a = (await cleuton.get('/api/historico/unidades/DEMO-UPA/avisos')).json;
  const codigos = new Set(a.avisos.map((x) => x.codigo));
  assert.ok(codigos.has('achado_repetido') && codigos.has('indicador_em_queda') && codigos.has('recomendacao_reaparece'), [...codigos].join(','));
  assert.equal(a.ultimo, '2026-T4');
  const c = (await cleuton.get('/api/historico/carteira')).json.unidades;
  assert.equal(c.length, 1, 'cleuton só vê as unidades da carteira'); assert.equal(c[0].contrato_id, 'DEMO-UPA');
  assert.deepEqual(c[0].tendencia.map((x) => x.igq), [95, 88, 84, 80]);
  assert.ok(c[0].avisosAltos >= 1);
});

test('carteira manda: quem não tem a unidade não vê nem importa; superintendência vê tudo', async () => {
  assert.equal((await colega2.get('/api/historico/unidades/DEMO-UPA')).status, 403);
  assert.equal((await colega2.post('/api/historico/relatorios', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', igq: 80 })).status, 403);
  const id = S.db.get("SELECT hist_id FROM hist_relatorios WHERE contrato_id = 'DEMO-UPA' LIMIT 1").hist_id;
  assert.equal((await colega2.get('/api/historico/relatorios/' + id)).status, 403);
  assert.equal((await colega2.get('/api/historico/carteira')).json.unidades.map((u) => u.contrato_id).join(','), 'UPA-OLINDA');
  assert.ok((await nathalia.get('/api/historico/carteira')).json.unidades.length >= 2);
  assert.equal((await nathalia.get('/api/historico/unidades/DEMO-UPA')).status, 200);
  assert.equal((await S.db.get('SELECT 1 AS x') && (await cliente(S.base).get('/api/historico/carteira')).status), 401, 'sem login não entra');
});

test('sem IA configurada o rascunho vem vazio para lançar à mão; espelho do Drive desligado por padrão', async () => {
  const antes = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const pdf = await pdfCom(TEXTO.replace('88,5', '77,0'));
  const r = await cleuton.post('/api/historico/importar', { contrato_id: 'DEMO-UPA', trimestre: '2025-T4', nome: 'sem-ia.pdf', base64: b64(pdf), semIA: true });
  process.env.GEMINI_API_KEY = antes;
  assert.equal(r.status, 200); assert.equal(r.json.ia.ok, false);
  const d = (await cleuton.get('/api/historico/relatorios/' + r.json.hist_id)).json;
  assert.equal(d.origem, 'manual'); assert.equal(d.indicadores.length, 0);
  assert.equal((await cleuton.del('/api/historico/relatorios/' + r.json.hist_id)).status, 200, 'rascunho pode ser descartado');
  const m = (await cleuton.get('/api/historico/meta')).json;
  assert.equal(m.espelho.ligado, false);
  assert.equal((await cleuton.post('/api/historico/espelho/enviar')).status, 403, 'só administração/superintendência');
  const e = (await nathalia.post('/api/historico/espelho/enviar')).json; assert.equal(e.ok, false); assert.equal(e.desligado, true);
  const ESP = require('../server/espelho-drive');
  const reg = ESP.registrosConfirmados(S.db);
  assert.ok(reg.hist_relatorios.length >= 4 && reg.hist_relatorios.every((x) => x.estado === 'confirmado'));
  assert.ok(Object.keys(ESP.ABAS).every((a) => Array.isArray(reg[a])));
});

test('espelho no Drive: envia o confirmado (com código secreto) e restaura só num banco vazio', async () => {
  let recebido = null, guardado = null;
  const web = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') { recebido = JSON.parse(b); guardado = recebido.abas; res.end(JSON.stringify({ ok: true, linhas: 1 })); }
      else if (!/token=segredo-de-teste/.test(req.url)) res.end(JSON.stringify({ ok: false, erro: 'código errado' }));
      else res.end(JSON.stringify({ ok: true, abas: JSON.parse(JSON.stringify(guardado)) }));
    });
  });
  await new Promise((r) => web.listen(0, r));
  process.env.CTAI_ESPELHO_URL = 'http://127.0.0.1:' + web.address().port + '/exec'; process.env.CTAI_ESPELHO_TOKEN = 'segredo-de-teste';
  try {
    const e = (await nathalia.post('/api/historico/espelho/enviar')).json;
    assert.equal(e.ok, true, JSON.stringify(e));
    assert.equal(recebido.token, 'segredo-de-teste'); assert.equal(recebido.acao, 'substituir');
    assert.ok(recebido.abas.hist_relatorios.length >= 4 && recebido.abas.hist_indicadores.length >= 4);
    assert.equal((await nathalia.post('/api/historico/espelho/restaurar')).status, 409, 'banco com histórico não é sobrescrito');
    for (const t of ['hist_recomendacoes', 'hist_achados', 'hist_indicadores', 'hist_relatorios']) S.db.run('DELETE FROM ' + t);
    const r = (await nathalia.post('/api/historico/espelho/restaurar')).json;
    assert.equal(r.ok, true); assert.ok(r.relatorios >= 4);
    const u = (await nathalia.get('/api/historico/unidades/DEMO-UPA')).json;
    assert.equal(u.tendencia.length, 4); assert.ok(u.avisos.length >= 1, 'os cruzamentos voltam depois de restaurar');
  } finally { delete process.env.CTAI_ESPELHO_URL; delete process.env.CTAI_ESPELHO_TOKEN; web.close(); }
});
