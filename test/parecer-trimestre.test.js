'use strict';
// Leitor do Anexo II (planilha de monitoramento) e apuração do trimestre para o Parecer CTAI: só número confirmado entra,
// recálculo independente, descontos, campos manuais, bloqueio do "pronto para conferência". Fixtures SINTÉTICAS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
const G = require('../server/gaveta');
const P = require('../server/extrator-planilha');
const PT = require('../server/parecer-trimestre');
const F = require('./fixtures-planilha');

let S, cle, c2;
const TRI = '2026-T4', MESES = ['2026-10', '2026-11', '2026-12'];
const U = { login: 'cleuton', perfil: 'criador' };
const url = (c, suf) => '/api/importar/unidade/' + c + '/' + TRI + '/parecer' + (suf || '');

test.before(async () => {
  S = await iniciar(); cle = cliente(S.base); c2 = cliente(S.base);
  await cle.entrar('cleuton'); await c2.entrar('colega2');
  for (const id of ['PT-1', 'PT-2', 'PT-3', 'PT-4', 'PT-PL']) S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES (?,?,'OSS Teste','UPAE',0)", id, 'UPAE ' + id);
  const u = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', u.usuario_id, ['PT-1', 'PT-2', 'PT-3', 'PT-4', 'PT-PL'], 'teste');
  const u2 = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega2'");
  CART.definir(S.db, 'admin', u2.usuario_id, ['UPA-OLINDA'], 'teste');
});
test.after(async () => { await S.fechar(); });

// ---------- leitor da planilha ----------
test('planilha: lê mês, consultas, programas, sessões, mamografia e PE Acessível; confere % com executado ÷ meta', () => {
  const r = P.extrairPlanilha(F.planilhaTexto('2026-10'));
  assert.equal(r.periodo, '2026-10');
  const n = (c) => r.numeros.find((x) => x.chave === c);
  assert.deepEqual([n('consultas_medicas').meta, n('consultas_medicas').ofertado, n('consultas_medicas').regulado, n('consultas_medicas').realizado], [2000, 2200, 2150, 1850]);
  assert.equal(n('consultas_medicas').pct, 92.5);
  assert.deepEqual([n('ostomizados_pessoas').meta, n('ostomizados_pessoas').realizado], [70, 30], 'ostomizados = pessoas');
  assert.equal(n('ostomizados_pessoas').pct, 42.8571);
  assert.deepEqual([n('bexiga_neurogenica_pessoas').meta, n('bexiga_neurogenica_pessoas').realizado], [20, 10]);
  assert.deepEqual([n('sessoes_reabilitacao').meta, n('sessoes_reabilitacao').realizado], [380, 340]);
  assert.equal(n('mamografia').realizado, 250);
  assert.deepEqual([n('neuropediatra').regulado, n('neuropediatra').realizado], [20, 22]);
  assert.match(n('neuropediatra').trecho, /confira.*executado maior que agendado/);
  assert.equal(n('pe_acessivel_total').meta, 154);
  assert.deepEqual(r.faltou, []);
  assert.ok(r.numeros.every((x) => x.trecho && x.trecho.length > 5), 'todo número leva o trecho de origem');
});
test('planilha: percentual impresso que não fecha vira aviso; % sem vírgula do OCR é recalculado; nada é inventado quando falta', () => {
  const r1 = P.extrairPlanilha(F.planilhaTexto('2026-10', { pctMedicas: '9250%' }));
  const m = r1.numeros.find((x) => x.chave === 'consultas_medicas');
  assert.equal(m.pct, 92.5); assert.match(m.trecho, /^\[confira: percentual impresso sem vírgula/);
  const r2 = P.extrairPlanilha(F.planilhaTexto('2026-10', { pctMedicas: '50,00%' }));
  const d = r2.numeros.find((x) => x.chave === 'consultas_medicas');
  assert.equal(d.pct, null, 'percentual que diverge não vira valor'); assert.match(d.trecho, /diverge de executado ÷ meta/);
  const r3 = P.extrairPlanilha(F.planilhaTexto('2026-10', { ostomizados: 'ausente', mamografia: false }));
  assert.ok(!r3.numeros.some((x) => /^ostomizados/.test(x.chave)) && !r3.numeros.some((x) => x.chave === 'mamografia'));
  assert.deepEqual(r3.faltou.sort(), ['mamografia', 'ostomizados']);
});
test('planilha: antes do termo aditivo traz ATENDIMENTOS de ostomizados, que não são pacientes', () => {
  const r = P.extrairPlanilha(F.planilhaTexto('2026-08', { ostomizados: 'atendimentos' }));
  const a = r.numeros.find((x) => x.chave === 'ostomizados_atendimentos');
  assert.ok(a && /NÃO é número de pacientes/.test(a.rotulo));
  assert.ok(!r.numeros.some((x) => x.chave === 'ostomizados_pessoas'));
});
test('planilha na gaveta: o Anexo II guardado vira números PROPOSTOS com trecho; mês diferente do impresso é avisado', () => {
  const g = G.gravar(S.db, U, { contrato_id: 'PT-PL', mes: '2026-10', codigo: 'anexo_II', nome_arquivo: 'planilha-outubro.pdf', texto: F.planilhaTexto('2026-10') });
  assert.ok(g.numeros >= 10);
  const ns = S.db.all("SELECT * FROM gaveta_numeros WHERE contrato_id = 'PT-PL' AND fonte = 'anexo_II'");
  assert.ok(ns.every((x) => x.estado === 'proposto' && x.trecho));
  G.gravar(S.db, U, { contrato_id: 'PT-PL', mes: '2026-11', codigo: 'anexo_II', nome_arquivo: 'planilha-errada.pdf', texto: F.planilhaTexto('2026-10', { pctMedicas: '92,50%' }) + '\n ' });
  const aviso = S.db.get("SELECT trecho FROM gaveta_numeros WHERE contrato_id = 'PT-PL' AND mes = '2026-11' AND chave = 'consultas_medicas'");
  assert.match(aviso.trecho, /a planilha diz 2026-10 mas foi guardada em 2026-11/);
});

// ---------- apuração do trimestre ----------
let seq = 0;
function semear(cid, dados) {
  // dados: { chave: { fonte, metas:[3], reais:[3] } }; estado 'confirmado' ou 'proposto'
  const docs = {};
  for (const mes of MESES) for (const fonte of ['anexo_I', 'anexo_II']) docs[mes + fonte] = Number(S.db.run("INSERT INTO gaveta_documentos (contrato_id, mes, codigo, parte, nome_arquivo, hash, caracteres, texto, versao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,'',?,?,1,'x',1,'t','2026-10-01','2026-10-01')", cid, mes, fonte, fonte + '-' + mes + '.pdf', 'h' + (++seq)).lastInsertRowid);
  for (const [chave, d] of Object.entries(dados)) MESES.forEach((mes, k) => S.db.run("INSERT INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, meta, realizado, trecho, estado, confirmado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)", docs[mes + d.fonte], cid, mes, d.fonte, chave, chave, d.metas[k], d.reais[k], 'trecho sintético ' + chave + ' ' + mes, d.estado || 'confirmado', (d.estado || 'confirmado') === 'confirmado' ? 'cleuton' : null));
}
const BASE = () => ({
  consultas_medicas: { fonte: 'anexo_I', metas: [1200, 1200, 1200], reais: [560, 540, 500] },       // 1.600 / 3.600 = 44,44%
  consultas_nao_medicas: { fonte: 'anexo_I', metas: [300, 300, 300], reais: [310, 320, 330] },      // 106,67%
  sessoes_reabilitacao: { fonte: 'anexo_I', metas: [400, 400, 400], reais: [400, 400, 400] },       // 100,00%
  mamografia: { fonte: 'anexo_I', metas: [100, 100, 100], reais: [50, 50, 50] },                    // 50,00%
  ostomizados: null, // vem da planilha como ostomizados_pessoas
  ostomizados_pessoas: { fonte: 'anexo_II', metas: [70, 70, 70], reais: [80, 80, 80] },             // 114,29%
  matriciamento: { fonte: 'anexo_I', metas: [8, 8, 8], reais: [8, 9, 8] },                          // 104,17%
  supervisao_cuidado: { fonte: 'anexo_I', metas: [8, 8, 8], reais: [9, 9, 9] },                     // 112,50%
  consultas_medicas_tea: { fonte: 'anexo_I', metas: [154, 154, 154], reais: [100, 100, 100] },      // 64,94%
});
const semNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
const put = (c, cid, corpo) => c.put(url(cid), corpo);
const completar = async (cid) => (await put(cle, cid, { repasses: { '2026-10': 100000.1, '2026-11': 100000.1, '2026-12': 100000.1 }, repasse_fonte: 'Contrato de Gestão, cláusula teste', descontos_pct: { consultas_medicas: 3, mamografia: 4 }, qualidade_desconto: 0, s7: 'Informações financeiras do trimestre anterior: texto da analista.', s8: 'Parecer da CMA do trimestre anterior: texto da analista.' })).json;

test('só número CONFIRMADO entra: proposto aparece como pendência, nunca como valor, e bloqueia o pronto', async () => {
  semear('PT-1', semNulos(Object.assign(BASE(), { consultas_medicas: { fonte: 'anexo_I', metas: [1200, 1200, 1200], reais: [560, 540, 500], estado: 'proposto' } })));
  const v = (await cle.get(url('PT-1'))).json;
  const q = v.quadro1.find((x) => x.chave === 'consultas_medicas');
  assert.equal(q.pct_bp, null); assert.equal(q.soma_realizado, null); assert.equal(q.status, 'Pendente');
  assert.ok(q.linhas.every((l) => l.meta === null && l.realizado === null), 'nenhum valor proposto vira valor');
  assert.ok(v.bloqueios.some((b) => /há número LIDO mas NÃO confirmado \(1\.200\)/.test(b)));
  assert.ok(v.documento.quadro1.linhas.some((l) => l[3] === 'PENDENTE' && l[4] === 'PENDENTE'));
  assert.ok(!JSON.stringify(v.documento.quadro1.linhas.slice(0, 3)).includes('1.200') && !JSON.stringify(v.documento.frases).includes('Consultas Médicas'));
  const r = await cle.post(url('PT-1', '/pronto'), {});
  assert.equal(r.status, 409); assert.ok(r.json.bloqueios.length >= 1);
  assert.equal((await cle.get(url('PT-1', '/pdf'))).status, 409, 'sem pronto, sem PDF');
});
test('percentual trimestral = soma dos meses ÷ (meta × 3) e desconto = % × repasse total: refeitos por outro caminho', () => {
  assert.equal(PT.pctA(1600, 1200 * 3), 4444); assert.equal(PT.pctB(1600, 1200 * 3), 4444, '44,44% = (560+540+500)/(1.200×3)');
  assert.equal(PT.descA(30000030, 300), 900001); assert.equal(PT.descB(30000030, 300), 900001, '3% do repasse total de 300.000,30 = 9.000,01');
  assert.equal(PT.descB(30000030, 400), 1200001);
  for (const [s, m] of [[1, 3], [2, 3], [7, 9], [1234, 4321], [999999, 1000000]]) assert.equal(PT.pctA(s, m), PT.pctB(s, m), s + '/' + m);
  assert.equal(PT.lerBR('R$ 1.234.567,89'), 1234567.89); assert.equal(PT.lerBR('44,44%'), 44.44);
});
test('apuração completa: quadros, percentuais, status e descontos corretos; pendente até a analista definir o % de desconto', async () => {
  semear('PT-2', semNulos(BASE()));
  let v = (await cle.get(url('PT-2'))).json;
  const pct = (c) => v.quadro1.find((x) => x.chave === c).pct_txt;
  assert.equal(pct('consultas_medicas'), '44,44%'); assert.equal(pct('consultas_nao_medicas'), '106,67%'); assert.equal(pct('sessoes_reabilitacao'), '100,00%');
  assert.equal(pct('mamografia'), '50,00%'); assert.equal(pct('ostomizados'), '114,29%');
  assert.equal(v.quadro1.find((x) => x.chave === 'consultas_medicas').status, 'Meta não cumprida');
  assert.equal(v.quadro1.find((x) => x.chave === 'sessoes_reabilitacao').status, 'Meta cumprida');
  assert.equal(v.quadro2[0].pct_txt, '64,94%');
  assert.deepEqual(v.descontos.filter((d) => d.aplicavel).map((d) => d.chave), ['consultas_medicas', 'mamografia']);
  assert.ok(v.bloqueios.some((b) => /Consultas Médicas.*percentual de desconto a definir pela analista/.test(b)), 'sem % definido, não adivinha');
  assert.ok(v.descontos.every((d) => d.valor_cent === null));
  assert.ok(v.bloqueios.some((b) => /repasse mensal não informado/.test(b)));
  v = await completar('PT-2');
  assert.deepEqual(v.bloqueios, [], JSON.stringify(v.bloqueios));
  const d = (c) => v.descontos.find((x) => x.chave === c);
  assert.equal(v.repasse.total_cent, 30000030);
  assert.equal(d('consultas_medicas').valor_cent, 900001); assert.equal(d('consultas_medicas').valor_cent_verificacao, 900001);   // 3% de 300.000,30 = 9.000,009
  assert.equal(d('mamografia').valor_cent, 1200001);                                                                              // 4% = 12.000,012
  assert.equal(v.total_producao_cent, 2100002); assert.equal(v.total_geral_cent, 2100002);
  assert.deepEqual(v.documento.total.linhas, [['PRODUÇÃO', 'R$ 21.000,02'], ['QUALIDADE', 'R$ 0,00'], ['TOTAL', 'R$ 21.000,02']]);
  assert.equal(v.documento.descontos[0].valor, 'R$ 9.000,01'); assert.equal(v.documento.descontos[0].repasse_total, 'R$ 300.000,30');
  assert.ok(d('consultas_medicas').peso_contrato_pct === null || typeof d('consultas_medicas').peso_contrato_pct === 'number');
});
test('diferença de arredondamento entre a soma das linhas e o total exato bloqueia até a analista escolher', async () => {
  semear('PT-3', semNulos(Object.assign(BASE(), { mamografia: { fonte: 'anexo_I', metas: [100, 100, 100], reais: [50, 50, 50] } })));
  let v = (await put(cle, 'PT-3', { repasses: { '2026-10': 100000.05, '2026-11': 100000.05, '2026-12': 100000.05 }, repasse_fonte: 'teste', descontos_pct: { consultas_medicas: 3, mamografia: 3 }, qualidade_desconto: 0, s7: 'a', s8: 'b' })).json;
  assert.equal(v.total_producao_cent, null, 'linhas 9.000,00 + 9.000,00 = 18.000,00 mas o exato é 18.000,01');
  assert.ok(v.bloqueios.some((b) => /18\.000,00.*18\.000,01/.test(b)));
  v = (await put(cle, 'PT-3', { arredondamento: 'exato' })).json;
  assert.equal(v.total_producao_cent, 1800001); assert.deepEqual(v.bloqueios, []);
  v = (await put(cle, 'PT-3', { arredondamento: 'linhas' })).json;
  assert.equal(v.total_producao_cent, 1800000);
  assert.equal((await put(cle, 'PT-3', { arredondamento: 'qualquer' })).status, 400);
});
test('verificação independente lê de volta o texto: percentual, repasse, desconto e citações adulterados são pegos', async () => {
  const v = (await cle.get(url('PT-2'))).json;
  const ref = { q1: v.quadro1, q2: v.quadro2, repTotal: v.repasse.total_cent, descontos: v.descontos, totalProducao: v.total_producao_cent, qualidade: v.qualidade_cent, totalGeral: v.total_geral_cent };
  assert.deepEqual(PT.verificarTextos(v.documento, ref), []);
  const clone = () => JSON.parse(JSON.stringify(v.documento));
  let d = clone(); d.quadro1.linhas[0][5] = '45,44%';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /percentual escrito no quadro \(45,44%\) difere do recálculo/.test(e)));
  d = clone(); d.quadro1.linhas[1][4] = '999';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /difere do recálculo a partir dos meses escritos/.test(e)));
  d = clone(); d.descontos[0].valor = 'R$ 9.000,02';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /desconto escrito difere do recálculo/.test(e)));
  d = clone(); d.descontos[0].repasses[0][1] = 'R$ 100.001,10';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /soma dos repasses mensais escritos difere do total/.test(e)));
  d = clone(); d.total.linhas[2][1] = 'R$ 21.000,03';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /produção \+ qualidade não é igual ao total/.test(e)));
  d = clone(); d.frases = d.frases.map((f) => f.replace('44,44%', '44,45%'));
  assert.ok(PT.verificarTextos(d, ref).some((e) => /texto do parecer não repete o percentual do quadro/.test(e)));
  // consideração final editada à mão com número que nenhum cálculo produz
  const r = await put(cle, 'PT-2', { consideracoes_finais: ['A Unidade alcançou 45,00% no indicador de consultas médicas.', 'O desconto foi de R$ 9.999,99.'] });
  assert.ok(r.json.bloqueios.some((b) => /cita 45,00%/.test(b)) && r.json.bloqueios.some((b) => /cita R\$ 9\.999,99/.test(b)));
  const ok = await put(cle, 'PT-2', { consideracoes_finais: ['A Unidade alcançou 44,44% em consultas médicas e o desconto é de R$ 9.000,01.'] });
  assert.deepEqual(ok.json.bloqueios, []);
});
test('campos manuais: seções 7 e 8 e "impossibilitado de análise" vêm da observação da lista de conferência ou do que a analista digita', async () => {
  semear('PT-4', semNulos(BASE()));
  let v = (await put(cle, 'PT-4', { repasses: { '2026-10': 1000, '2026-11': 1000, '2026-12': 1000 }, repasse_fonte: 't', descontos_pct: { consultas_medicas: 3, mamografia: 3 }, qualidade_desconto: 0 })).json;
  assert.ok(v.bloqueios.some((b) => /Seção 7.*vazio/.test(b)) && v.bloqueios.some((b) => /Seção 8.*vazio/.test(b)), 'nada é redigido sozinho');
  S.db.run("INSERT INTO imp_checks (contrato_id, trimestre, item_codigo, mes, observacao, marcado_por, marcado_em) VALUES ('PT-4',?,'financeiro','','Informação 12/2099 acostada ao processo.','cleuton','2026-10-02')", TRI);
  v = (await cle.get(url('PT-4'))).json;
  assert.equal(v.manual.s7.texto, 'Informação 12/2099 acostada ao processo.'); assert.match(v.manual.s7.origem, /lista de conferência/);
  assert.ok(v.bloqueios.some((b) => /Seção 8/.test(b)) && !v.bloqueios.some((b) => /Seção 7/.test(b)));
  v = (await put(cle, 'PT-4', { s8: 'Texto digitado sobre a CMA.', impossibilitados: [{ indicador: 'Registro SIA/SUS', motivo: 'Dados divergentes no anexo técnico.' }] })).json;
  assert.equal(v.manual.s8.origem, 'digitado pela analista'); assert.equal(v.manual.impossibilitados.length, 1);
  assert.deepEqual(v.bloqueios, []);
});
test('termo aditivo na metade do trimestre: aviso de meta mudada, percentual pela soma das metas de cada mês', async () => {
  S.db.run("UPDATE gaveta_numeros SET meta = 600 WHERE contrato_id = 'PT-4' AND mes = '2026-12' AND chave = 'consultas_medicas'");
  const v = (await cle.get(url('PT-4'))).json;
  assert.ok(v.avisos.some((a) => /Consultas Médicas.*A meta mudou dentro do trimestre.*Outubro\/2026 1\.200.*Dezembro\/2026 600.*termo aditivo/.test(a)));
  assert.equal(v.quadro1.find((x) => x.chave === 'consultas_medicas').pct_txt, '53,33%', '1.600 / (1.200+1.200+600)');
});
test('número digitado pela analista exige motivo e aparece na conferência como "digitado"; ostomizados só por pacientes', async () => {
  S.db.run("DELETE FROM gaveta_numeros WHERE contrato_id = 'PT-4' AND chave = 'ostomizados_pessoas' AND mes = '2026-11'");
  S.db.run("INSERT INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, meta, realizado, trecho, estado) SELECT id, 'PT-4', '2026-11', 'anexo_II', 'ostomizados_atendimentos', 'a', 70, 15, 'sessões', 'confirmado' FROM gaveta_documentos WHERE contrato_id = 'PT-4' AND mes = '2026-11' AND codigo = 'anexo_II'");
  let v = (await cle.get(url('PT-4'))).json;
  assert.ok(v.bloqueios.some((b) => /Ostomizados.*Novembro\/2026 — meta/.test(b)), 'atendimentos não substituem pacientes');
  assert.ok(v.avisos.some((a) => /Ostomizados: em Novembro\/2026 a planilha traz ATENDIMENTOS/.test(a)));
  const semMotivo = await put(cle, 'PT-4', { ajustes: [{ chave: 'ostomizados', mes: '2026-11', campo: 'meta', valor: 70, motivo: '' }, { chave: 'ostomizados', mes: '2026-11', campo: 'realizado', valor: 75, motivo: '' }] });
  assert.equal(semMotivo.status, 400); assert.match(semMotivo.json.erro, /motivo/);
  v = (await put(cle, 'PT-4', { ajustes: [{ chave: 'ostomizados', mes: '2026-11', campo: 'meta', valor: 70, motivo: 'planilha de novembro, linha Pessoas com estomia' }, { chave: 'ostomizados', mes: '2026-11', campo: 'realizado', valor: 75, motivo: 'planilha de novembro, linha Pessoas com estomia' }] })).json;
  assert.deepEqual(v.bloqueios, []);
  const dig = v.conferencia.filter((c) => c.estado === 'digitado');
  assert.equal(dig.length, 2); assert.match(dig[0].trecho, /Motivo informado: planilha de novembro/);
  assert.ok(v.conferencia.some((c) => c.estado === 'confirmado' && c.arquivo && /anexo_I-2026-10\.pdf/.test(c.arquivo) && c.trecho), 'cada número mostra arquivo e trecho de origem');
});
test('achado "A CONFERIR" sem decisão bloqueia; fixado vira sugestão de consideração final; nada entra sem aceitar', async () => {
  S.db.run("INSERT INTO achados (origem_tipo, origem_id, contrato_id, trimestre, chave, gravidade, tipo, trecho, status, criado_em) VALUES ('simas', 1, 'PT-4', ?, 'k1', 'A CONFERIR', 'SIMAS × RM: Mamografia', 'SIMAS 815 x RM 800', 'novo', '2026-10-05')", TRI);
  let v = (await cle.get(url('PT-4'))).json;
  assert.ok(v.bloqueios.some((b) => /Achado "A CONFERIR" ainda sem decisão/.test(b)));
  S.db.run("UPDATE achados SET status = 'fixado' WHERE chave = 'k1'");
  v = (await cle.get(url('PT-4'))).json;
  assert.ok(!v.bloqueios.some((b) => /Achado/.test(b)));
  assert.ok(v.sugestoes.some((s) => s.marca === 'sugestão, revisar' && /Mamografia/.test(s.texto)));
  assert.ok(v.sugestoes.some((s) => s.origem === 'cálculo' && /53,33%/.test(s.texto)));
  assert.deepEqual(v.consideracoes_finais, [], 'sugestão não entra sozinha');
});
test('pronto para conferência: grava hash e trilha; mudar um número depois derruba o pronto; PDF só com pronto', async () => {
  let r = await cle.post(url('PT-4', '/pronto'), {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.pronto, true);
  const trilha = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela = 'par_apuracao' AND registro = 'PT-4/" + TRI + "'").map((x) => x.campo);
  for (const c of ['pronto_para_conferencia', 's8', 'impossibilitados', 'ajustes', 'descontos_pct']) assert.ok(trilha.includes(c), 'trilha sem ' + c + ': ' + trilha.join(','));
  const pdf = await cle.req('GET', url('PT-4', '/pdf'));
  assert.equal(pdf.status, 200); 
  S.db.run("UPDATE gaveta_numeros SET realizado = 501 WHERE contrato_id = 'PT-4' AND chave = 'consultas_medicas' AND mes = '2026-10'");
  const v = (await cle.get(url('PT-4'))).json;
  assert.equal(v.pronto, false); assert.equal(v.desatualizado, true);
  assert.equal((await cle.get(url('PT-4', '/pdf'))).status, 409);
  r = await cle.post(url('PT-4', '/pronto'), {});
  assert.equal(r.status, 200); assert.equal(r.json.pronto, true);
});
test('carteira: colega sem a unidade não vê nem altera; o modelo anterior aparece com trechos a revisar', async () => {
  assert.ok([403, 404].includes((await c2.get(url('PT-4'))).status));
  assert.ok([403, 404].includes((await put(c2, 'PT-4', { s7: 'x' })).status));
  S.db.run("INSERT INTO imp_modelos (contrato_id, trimestre, nome_arquivo, hash, texto, estrutura, ativo, criado_por, criado_em) VALUES ('PT-4','2026-T3','modelo.txt','hm','PARECER\n1. INTRODUÇÃO\nNo 3º trimestre de 2026 a Unidade teve R$ 100,00 e 45,50% de meta.\n2. FUNDAMENTAÇÃO\nLei 15.210.',?,1,'t','2026-10-01')", JSON.stringify({ secoes: [{ numero: '1', titulo: 'INTRODUÇÃO', nivel: 1, linha: 2 }, { numero: '2', titulo: 'FUNDAMENTAÇÃO', nivel: 1, linha: 4 }] }));
  const v = (await cle.get(url('PT-4'))).json;
  assert.equal(v.modelo.trimestre, '2026-T3');
  const s1 = v.modelo.secoes.find((s) => s.numero === '1');
  assert.match(s1.texto, /45,50%/); for (const t of ['R$ 100,00', '45,50%']) assert.ok(s1.revisar.includes(t), 'revisar: ' + t);
});

test('conferidor SIMAS × planilha: compara pacientes e neuropediatria somados; mês faltando ou só atendimentos vira "pendente" explicado', () => {
  const SIM = require('../server/simas');
  const c = { contrato_id: 'PT-PL' };
  S.db.run("DELETE FROM gaveta_numeros WHERE contrato_id = 'PT-PL'");
  const doc = (mes) => Number((S.db.get("SELECT id FROM gaveta_documentos WHERE contrato_id = 'PT-PL' AND mes = ? AND codigo = 'anexo_II'", mes) || { id: S.db.run("INSERT INTO gaveta_documentos (contrato_id, mes, codigo, parte, nome_arquivo, hash, caracteres, texto, versao, criado_por, criado_em, atualizado_em) VALUES ('PT-PL',?,'anexo_II','','p.pdf',?,1,'x',1,'t','2026-10-01','2026-10-01')", mes, 'hp' + mes).lastInsertRowid }).id);
  const num = (mes, chave, real) => S.db.run("INSERT INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, meta, realizado, estado) VALUES (?,?,?,?,?,?,70,?,'proposto')", doc(mes), 'PT-PL', mes, 'anexo_II', chave, chave, real);
  const sim = [{ tipo: 'producao', chave: 'ostomizados', descricao: 'Ostomizados', previsto: 210, realizado: 240, trecho: 'x' }, { tipo: 'producao', chave: 'consultas_medicas_tea', descricao: 'Neuropediatria', previsto: 462, realizado: 66, trecho: 'y' }];
  const por = (t, ch) => SIM.conferir(S.db, c, TRI, sim).filter((d) => d.tipo === t && d.chave === ch);
  assert.equal(por('planilha_pendente', 'ostomizados').length, 1, 'sem nada lido');
  num('2026-10', 'ostomizados_pessoas', 80); num('2026-11', 'ostomizados_atendimentos', 15);
  const pend = por('planilha_pendente', 'ostomizados')[0];
  assert.match(pend.detalhe, /sem pacientes com estomia lido em: Novembro\/2026, Dezembro\/2026/); assert.match(pend.detalhe, /ATENDIMENTOS \(Novembro\/2026 15\)/); assert.match(pend.detalhe, /Outubro\/2026 80 \(proposto\)/);
  num('2026-11', 'ostomizados_pessoas', 80); num('2026-12', 'ostomizados_pessoas', 80);
  assert.equal(por('planilha', 'ostomizados').length, 0, '80+80+80 = 240 = SIMAS');
  S.db.run("UPDATE gaveta_numeros SET realizado = 70 WHERE contrato_id = 'PT-PL' AND mes = '2026-12' AND chave = 'ostomizados_pessoas'");
  const d = por('planilha', 'ostomizados')[0];
  assert.equal(d.b.valor, 230); assert.match(d.detalhe, /Dezembro\/2026 70/); assert.match(d.aviso, /Só sinaliza/);
  num('2026-10', 'neuropediatra', 22); num('2026-11', 'neuropediatra', 22); num('2026-12', 'neuropediatra', 22);
  assert.equal(por('planilha', 'consultas_medicas_tea').length, 0, '3 × 22 = 66');
});
