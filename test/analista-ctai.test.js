'use strict';
// Analista CTAI: encaminhar achados à unidade, resposta, normas por unidade, conferência com o acervo e relatório trimestral.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, gestor, setorAssist, setorOuv, cleuton, colega, nath, admin, cid06, achadoId;

test.before(async () => {
  S = await iniciar();
  gestor = cliente(S.base); setorAssist = cliente(S.base); setorOuv = cliente(S.base); cleuton = cliente(S.base); colega = cliente(S.base); nath = cliente(S.base); admin = cliente(S.base);
  await gestor.entrar('gestor.demo'); await setorAssist.entrar('assistencia.demo'); await setorOuv.entrar('ouvidoria.demo'); await cleuton.entrar('cleuton'); await colega.entrar('colega1'); await nath.entrar('nathalia'); await admin.entrar('admin');
  cid06 = (await gestor.get('/api/unidade/competencias')).json.competencias.find((c) => c.competencia_id === '2026-06').cid;
  const env = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', {});
  assert.equal(env.status, 200, JSON.stringify(env.json));
  // Um achado guardado na competência, vindo de texto colado.
  const a = await cleuton.post('/api/analista/analisar', { cid: cid06, salvar: true, texto: 'O valor foi R$ 1.000,00 (dois mil reais). Foram 63 de 100 (70%) casos no tempo de espera.' });
  assert.equal(a.status, 200);
  assert.ok(a.json.salvos > 0, 'achados guardados');
  achadoId = (await cleuton.get('/api/analista/achados?cid=' + cid06)).json.achados[0].achado_id;
});
test.after(async () => { await S.fechar(); });

test('painel do Analista CTAI mostra a fila e as contagens', async () => {
  const r = await cleuton.get('/api/analista/painel');
  assert.equal(r.status, 200);
  assert.ok(r.json.contagens.novo >= 1);
  assert.ok(r.json.fila.length >= 1);
  assert.ok(r.json.contratos.some((c) => c.acervo && c.acervo.ativo));
  assert.equal((await gestor.get('/api/analista/painel')).status, 403, 'a unidade não entra no Analista da CTAI');
});

test('encaminhar à unidade: só a equipe, com mensagem; a unidade vê e responde; a CTAI aceita', async () => {
  assert.equal((await colega.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: 'x' })).status, 403, 'colega não encaminha');
  assert.equal((await cleuton.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: '  ' })).status, 400);
  assert.equal((await cleuton.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: 'ok', setor: 'inexistente' })).status, 400);
  const ok = await cleuton.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: 'Explique a diferença entre o valor numérico e o escrito por extenso.', setor: 'assistencia', prazo: '2026-12-31' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await cleuton.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: 'de novo' })).status, 409, 'já encaminhado');

  const vista = await gestor.get('/api/unidade/achados');
  assert.equal(vista.json.achados.length, 1);
  assert.equal(vista.json.achados[0].setor, 'assistencia');
  assert.equal(vista.json.achados[0].provedor, undefined, 'a unidade não vê dados internos da CTAI');
  assert.equal((await setorAssist.get('/api/unidade/achados')).json.achados.length, 1);
  assert.equal((await setorOuv.get('/api/unidade/achados')).json.achados.length, 0, 'outro setor não vê');
  assert.equal((await setorOuv.post('/api/unidade/achados/' + achadoId + '/responder', { resposta: 'não é meu' })).status, 403);
  assert.equal((await setorAssist.post('/api/unidade/achados/' + achadoId + '/responder', { resposta: '' })).status, 400);
  assert.equal((await cleuton.post('/api/unidade/achados/' + achadoId + '/responder', { resposta: 'x' })).status, 403, 'CTAI não responde pela unidade');

  const resp = await setorAssist.post('/api/unidade/achados/' + achadoId + '/responder', { resposta: 'Foi erro de digitação; o valor correto é o numérico.' });
  assert.equal(resp.status, 200);
  const pdfR = await setorAssist.get('/api/unidade/achados/' + achadoId + '/pdf');
  assert.equal(pdfR.status, 200); assert.equal(pdfR.buffer.slice(0, 4).toString(), '%PDF');
  assert.equal((await setorOuv.get('/api/unidade/achados/' + achadoId + '/pdf')).status, 404, 'outro setor não baixa');
  assert.equal((await gestor.post('/api/unidade/achados/' + achadoId + '/responder', { resposta: 'outra' })).status, 409, 'já respondido');
  const a = (await cleuton.get('/api/analista/achados?cid=' + cid06)).json.achados.find((x) => x.achado_id === achadoId);
  assert.equal(a.status, 'respondido');
  assert.match(a.resposta, /erro de digitação/);
  assert.equal((await cleuton.patch('/api/analista/achados/' + achadoId, { status: 'fixado' })).status, 200);
  const painel = (await cleuton.get('/api/analista/painel')).json.contagens;
  assert.equal(painel.encaminhado, 0);
});

test('trilha registra encaminhamento e resposta e continua íntegra', async () => {
  const t = await admin.get('/api/ctai/trilha?tabela=achados');
  const campos = t.json.eventos.map((e) => e.campo);
  assert.ok(campos.includes('encaminhado') && campos.includes('resposta'));
  const v = (await admin.get('/api/ctai/trilha/verificar')).json;
  assert.ok(v.ok === true || v.integra === true || v.integro === true, JSON.stringify(v));
});

test('normas: criar, buscar, revogar e sugerir junto do achado', async () => {
  assert.equal((await colega.post('/api/analista/normas', { titulo: 'x', texto: 'y' })).status, 403);
  assert.equal((await cleuton.post('/api/analista/normas', { titulo: '', texto: 'y' })).status, 400);
  const nova = await cleuton.post('/api/analista/normas', { contrato_id: 'DEMO-UPA', titulo: 'Percentual de casos no prazo (exemplo)', referencia: 'Item de exemplo', tema: 'prazo', texto: 'O percentual de casos atendidos no tempo de espera previsto é apurado por mês.' });
  assert.equal(nova.status, 200);
  const busca = await cleuton.get('/api/analista/normas?q=transparência');
  assert.ok(busca.json.normas.some((n) => /Transparência/.test(n.titulo)));
  const achados = (await cleuton.get('/api/analista/achados?cid=' + cid06 + '&normas=1')).json.achados;
  assert.ok(achados.every((a) => Array.isArray(a.normas)));
  assert.equal((await cleuton.patch('/api/analista/normas/' + nova.json.norma_id, { vigente: false, motivo: 'teste' })).status, 200);
  const vig = await cleuton.get('/api/analista/normas?vigentes=1');
  assert.ok(!vig.json.normas.some((n) => n.norma_id === nova.json.norma_id), 'revogada some das vigentes');
});

test('conferência com o acervo gera divergências de origem acervo e é repetível', async () => {
  assert.equal((await colega.post('/api/analista/competencias/' + cid06 + '/acervo/conferir', {})).status, 403);
  const r = await cleuton.post('/api/analista/competencias/' + cid06 + '/acervo/conferir', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.comparados >= 3);
  assert.ok(r.json.divergentes >= 1, 'o acervo fictício difere em ao menos um item');
  const d1 = S.db.all("SELECT * FROM divergencias WHERE cid = ? AND origem = 'acervo'", cid06);
  assert.equal(d1.length, r.json.divergentes);
  assert.ok(d1.every((d) => /Fonte:/.test(d.observacao)));
  await cleuton.post('/api/analista/competencias/' + cid06 + '/acervo/conferir', {});
  assert.equal(S.db.all("SELECT * FROM divergencias WHERE cid = ? AND origem = 'acervo'", cid06).length, d1.length, 'repetir não duplica');
  const sem = (await gestor.get('/api/unidade/competencias')).json.competencias.find((c) => c.competencia_id === '2026-07').cid;
  assert.equal((await cleuton.post('/api/analista/competencias/' + sem + '/acervo/conferir', {})).status, 409, 'sem envio não confere');
});

test('relatório trimestral: abre a minuta com as competências e o texto sugerido, editável', async () => {
  assert.equal((await colega.post('/api/analista/relatorio-trimestral', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2' })).status, 403);
  assert.equal((await cleuton.post('/api/analista/relatorio-trimestral', { contrato_id: 'DEMO-UPA', trimestre: 'T2' })).status, 400);
  assert.equal((await cleuton.post('/api/analista/relatorio-trimestral', { contrato_id: 'DEMO-UPA', trimestre: '2025-T1' })).status, 404);
  const r = await cleuton.post('/api/analista/relatorio-trimestral', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', numero_parecer: 'DEMO/1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.competencias, ['2026-06']);
  assert.deepEqual(r.json.faltam, ['2026-04', '2026-05']);
  const p = (await cleuton.get('/api/ctai/pareceres/' + r.json.parecer_id)).json;
  const texto = (p.parecer || p).blocos.texto;
  assert.ok(texto.abertura && texto.analise && texto.conclusao, 'texto sugerido preenchido');
  // Edição antes de fechar.
  assert.equal((await cleuton.put('/api/ctai/pareceres/' + r.json.parecer_id + '/texto', { texto: { conclusao: 'Conclusão editada pela equipe.' } })).status, 200);
  // Chamar de novo não apaga a edição.
  const de_novo = await cleuton.post('/api/analista/relatorio-trimestral', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2' });
  assert.equal(de_novo.json.jaExistia, true);
  const p2 = (await cleuton.get('/api/ctai/pareceres/' + r.json.parecer_id)).json;
  assert.equal((p2.parecer || p2).blocos.texto.conclusao, 'Conclusão editada pela equipe.');
  // Congelar torna a versão imutável (gatilho do banco) e o PDF sai.
  const c = await cleuton.post('/api/ctai/pareceres/' + r.json.parecer_id + '/congelar', { convocados: [S.db.get("SELECT usuario_id FROM usuarios WHERE login='colega1'").usuario_id] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.throws(() => S.db.run('UPDATE versoes_minuta SET conteudo = ? WHERE versao_id = ?', '{}', c.json.versao_id), /congelada/i);
  const pdf = await cleuton.get('/api/ctai/versoes/' + c.json.versao_id + '/pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.slice(0, 5).toString(), '%PDF-');
});

test('apagar a demonstração limpa normas e achados', async () => {
  const r = await admin.post('/api/admin/demo/apagar', { confirmar: 'APAGAR' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM normas WHERE contrato_id = 'DEMO-UPA'").n, 0);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM achados').n, 0);
});
