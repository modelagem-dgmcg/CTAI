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
const EST = require('../server/importar-estrutura');

let S, cle, c2;
const TRI = '2026-T4', MESES = ['2026-10', '2026-11', '2026-12'];
const U = { login: 'cleuton', perfil: 'criador' };
const url = (c, suf) => '/api/importar/unidade/' + c + '/' + TRI + '/parecer' + (suf || '');

test.before(async () => {
  S = await iniciar(); cle = cliente(S.base); c2 = cliente(S.base);
  await cle.entrar('cleuton'); await c2.entrar('colega2');
  for (const id of ['PT-1', 'PT-2', 'PT-3', 'PT-4', 'PT-5', 'PT-6', 'PT-7', 'PT-8', 'PT-PL']) S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES (?,?,'OSS Teste','UPAE',0)", id, 'UPAE ' + id);
  const u = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', u.usuario_id, ['PT-1', 'PT-2', 'PT-3', 'PT-4', 'PT-5', 'PT-6', 'PT-7', 'PT-8', 'PT-PL'], 'teste');
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
  ostomizados_pessoas: { fonte: 'anexo_II', metas: [70, 70, 70], reais: [80, 80, 80] },             // 114,29%
  matriciamento: { fonte: 'anexo_I', metas: [8, 8, 8], reais: [8, 9, 8] },                          // 104,17%
  supervisao_cuidado: { fonte: 'anexo_I', metas: [8, 8, 8], reais: [9, 9, 9] },                     // 112,50%
  consultas_medicas_tea: { fonte: 'anexo_I', metas: [154, 154, 154], reais: [100, 100, 100] },      // 64,94%
});
function semearModelo(cid) {
  if (S.db.get('SELECT 1 AS x FROM imp_modelos WHERE contrato_id = ?', cid)) return;
  const texto = F.modeloTexto(); const est = EST.extrairEstrutura(texto, { periodicidadePadrao: 'mensal', tipo: 'UPAE' });
  S.db.run("INSERT INTO imp_modelos (contrato_id, trimestre, nome_arquivo, hash, texto, estrutura, ativo, criado_por, criado_em) VALUES (?,?,'modelo.txt',?,?,?,1,'t','2026-10-01')", cid, est.trimestre, 'hm' + cid, texto, JSON.stringify(est));
}
function ind(cid, chave, nome, regra, valor, atingido, mes, estado) {
  S.db.run("INSERT INTO imp_simas_numeros (contrato_id, trimestre, tipo, descricao, chave, realizado, regra, atingido, ocorrencia, mes, mes_estado, estado, confirmado_por, trecho) VALUES (?,?,'indicador',?,?,?,?,?,?,?,?,?,?,?)",
    cid, TRI, nome, chave, valor, regra, atingido, MESES.indexOf(mes) + 1, mes, estado || 'confirmado', estado || 'confirmado', (estado || 'confirmado') === 'confirmado' ? 'cleuton' : null, nome + ' | ' + regra + ' | ' + valor + ' | ' + atingido);
}
function semearQualidade(cid) {
  for (const m of MESES) { ind(cid, 'qualidade_do_preenchimento_de_prontuarios', 'Qualidade do Preenchimento de Prontuários', 'Maior ou igual a 85', 90, 'Sim', m); ind(cid, 'indice_de_satisfacao_do_usuario', 'Índice de Satisfação do Usuário', 'Maior ou igual a 90', 95, 'Sim', m); }
}
function linhaSimas(cid, chave, grupo, previsto, realizado, estado) {
  S.db.run("INSERT INTO imp_simas_numeros (contrato_id, trimestre, tipo, grupo, descricao, chave, previsto, realizado, estado, confirmado_por, trecho) VALUES (?,?,'producao',?,?,?,?,?,?,?,?)", cid, TRI, grupo, chave, chave, previsto, realizado, estado || 'confirmado', (estado || 'confirmado') === 'confirmado' ? 'cleuton' : null, chave + ' ' + previsto + ' ' + realizado);
}
const put = (c, cid, corpo) => c.put(url(cid), corpo);
const CORPO = () => ({ numero_parecer: '202/2026', repasses: { '2026-10': 100000.1, '2026-11': 100000.1, '2026-12': 100000.1 }, repasse_fonte: 'Contrato de Gestão, cláusula teste', descontos_pct: { consultas_medicas: 3, mamografia: 4 }, qualidade_desconto: 0, s7: 'Informações financeiras do trimestre anterior: texto da analista.', s8: 'Parecer da CMA do trimestre anterior: texto da analista.' });
// deixa a unidade completa (modelo, SIMAS de qualidade, campos) e marca as seções de texto como revisadas
async function completo(cid, extra, opc) {
  semearModelo(cid); if (!(opc && opc.semQualidade)) semearQualidade(cid);
  let v = (await put(cle, cid, Object.assign(CORPO(), extra || {}))).json;
  const ack = Object.keys(v.textos).filter((k) => v.textos[k].exige_revisao && !v.textos[k].revisada);
  if (ack.length) v = (await put(cle, cid, { revisar_secoes: ack })).json;
  return v;
}

test('só número CONFIRMADO entra: proposto aparece como pendência, nunca como valor, e bloqueia o pronto', async () => {
  semear('PT-1', Object.assign(BASE(), { consultas_medicas: { fonte: 'anexo_I', metas: [1200, 1200, 1200], reais: [560, 540, 500], estado: 'proposto' } }));
  const v = (await cle.get(url('PT-1'))).json;
  const q = v.quadro1.find((x) => x.chave === 'consultas_medicas');
  assert.equal(q.pct_bp, null); assert.equal(q.soma_realizado, null); assert.equal(q.status, 'Pendente');
  assert.ok(q.linhas.every((l) => l.meta === null && l.realizado === null), 'nenhum valor proposto vira valor');
  assert.ok(v.bloqueios.some((b) => /há número LIDO mas NÃO confirmado \(1\.200\)/.test(b)));
  assert.ok(v.documento.quadro1.linhas.some((l) => l[3] === 'PENDENTE' && l[4] === 'PENDENTE'));
  assert.ok(!JSON.stringify(v.documento.quadro1.linhas.slice(0, 4)).includes('1.200') && !JSON.stringify(v.documento.frases).includes('Consultas Médicas'));
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
  semear('PT-2', BASE());
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
  v = await completo('PT-2');
  assert.deepEqual(v.bloqueios, [], JSON.stringify(v.bloqueios));
  const d = (c) => v.descontos.find((x) => x.chave === c);
  assert.equal(v.repasse.total_cent, 30000030);
  assert.equal(d('consultas_medicas').valor_cent, 900001); assert.equal(d('consultas_medicas').valor_cent_verificacao, 900001);   // 3% de 300.000,30 = 9.000,009
  assert.equal(d('mamografia').valor_cent, 1200001);                                                                              // 4% = 12.000,012
  assert.equal(v.total_producao_cent, 2100002); assert.equal(v.total_geral_cent, 2100002);
  assert.deepEqual(v.documento.total.linhas, [['PRODUÇÃO', 'R$ 21.000,02'], ['QUALIDADE', 'R$ 0,00'], ['TOTAL', 'R$ 21.000,02']]);
  assert.equal(v.documento.descontos[0].valor, 'R$ 9.000,01'); assert.equal(v.documento.descontos[0].repasse_total, 'R$ 300.000,30');
  const tri = v.documento.quadro1.linhas[3];
  assert.deepEqual(tri.slice(1, 8), ['Trimestre', '', '3.600', '1.600', '44,44%', 'Meta não cumprida', 'RM']);
  assert.ok(d('consultas_medicas').peso_contrato_pct === null || typeof d('consultas_medicas').peso_contrato_pct === 'number');
});
test('a analista decide o % de desconto, o critério de arredondamento e a faixa 85-100%: o sistema não decide', async () => {
  semear('PT-3', BASE());
  let v = await completo('PT-3', { descontos_pct: { consultas_medicas: 3, mamografia: 3 }, repasses: { '2026-10': 100000.05, '2026-11': 100000.05, '2026-12': 100000.05 } });
  assert.equal(v.total_producao_cent, null, 'linhas 9.000,00 + 9.000,00 = 18.000,00 mas o exato é 18.000,01');
  assert.ok(v.bloqueios.some((b) => /18\.000,00.*18\.000,01/.test(b)));
  v = (await put(cle, 'PT-3', { arredondamento: 'exato' })).json;
  assert.equal(v.total_producao_cent, 1800001); assert.deepEqual(v.bloqueios, []);
  v = (await put(cle, 'PT-3', { arredondamento: 'linhas' })).json;
  assert.equal(v.total_producao_cent, 1800000);
  assert.equal((await put(cle, 'PT-3', { arredondamento: 'qualquer' })).status, 400);
  // faixa entre 85% e 100%: sem regra carregada, só a analista define; o sistema avisa e bloqueia até ela informar
  S.db.run("UPDATE gaveta_numeros SET realizado = 1100 WHERE contrato_id = 'PT-3' AND chave = 'consultas_medicas'");
  v = (await put(cle, 'PT-3', { descontos_pct: { mamografia: 3 } })).json;
  const dm = v.descontos.find((d) => d.chave === 'consultas_medicas');
  assert.equal(dm.faixa, 'entre_85_e_100'); assert.match(dm.aviso, /não dizem se há desconto nesta faixa/);
  assert.ok(v.bloqueios.some((b) => /Consultas Médicas.*percentual de desconto a definir pela analista/.test(b)));
  v = (await put(cle, 'PT-3', { descontos_pct: { consultas_medicas: 0, mamografia: 3 } })).json;
  assert.equal(v.descontos.find((d) => d.chave === 'consultas_medicas').valor_cent, 0, 'a analista disse 0%: zero');
});
test('verificação independente lê de volta o texto: percentual, repasse, desconto e citações adulterados são pegos', async () => {
  const v = (await cle.get(url('PT-2'))).json;
  const ref = { q1: v.quadro1, q2: v.quadro2, repTotal: v.repasse.total_cent, descontos: v.descontos, totalProducao: v.total_producao_cent, qualidade: v.qualidade_cent, totalGeral: v.total_geral_cent };
  assert.deepEqual(PT.verificarTextos(v.documento, ref), []);
  const clone = () => JSON.parse(JSON.stringify(v.documento));
  let d = clone(); d.quadro1.linhas[3][5] = '45,44%';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /percentual escrito no quadro \(45,44%\) difere do recálculo/.test(e)));
  d = clone(); d.quadro1.linhas[1][4] = '999';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /total do trimestre escrito difere da soma dos meses escritos/.test(e)));
  d = clone(); d.descontos[0].valor = 'R$ 9.000,02';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /desconto escrito difere do recálculo/.test(e)));
  d = clone(); d.descontos[0].repasses[0][1] = 'R$ 100.001,10';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /soma dos repasses mensais escritos difere do total/.test(e)));
  d = clone(); d.total.linhas[2][1] = 'R$ 21.000,03';
  assert.ok(PT.verificarTextos(d, ref).some((e) => /produção \+ qualidade não é igual ao total/.test(e)));
  d = clone(); d.frases = d.frases.map((f) => f.replace('44,44%', '44,45%'));
  assert.ok(PT.verificarTextos(d, ref).some((e) => /texto do parecer não repete o percentual do quadro/.test(e)));
  d = clone(); d.texto['10'] = ['A Unidade alcançou 12,34% e o desconto foi de R$ 1.234,56.'];
  assert.equal(PT.verificarTextos(d, ref).filter((e) => /Texto cita/.test(e)).length, 2, 'números soltos nas seções 9 e 10');
  const r = await put(cle, 'PT-2', { consideracoes_finais: ['A Unidade alcançou 45,00% no indicador de consultas médicas.', 'O desconto foi de R$ 9.999,99.'] });
  assert.ok(r.json.bloqueios.some((b) => /cita 45,00%/.test(b)) && r.json.bloqueios.some((b) => /cita R\$ 9\.999,99/.test(b)));
  const ok = await put(cle, 'PT-2', { consideracoes_finais: ['A Unidade alcançou 44,44% em consultas médicas e o desconto é de R$ 9.000,01.'] });
  assert.deepEqual(ok.json.bloqueios, []);
});
test('campos manuais: seções 7 e 8 e "impossibilitado de análise" vêm da observação da lista de conferência ou do que a analista digita', async () => {
  semear('PT-4', BASE());
  let v = await completo('PT-4', { s7: '', s8: '' });
  assert.ok(v.bloqueios.some((b) => /Seção 7.*vazio/.test(b)) && v.bloqueios.some((b) => /Seção 8.*vazio/.test(b)), 'nada é redigido sozinho');
  S.db.run("INSERT INTO imp_checks (contrato_id, trimestre, item_codigo, mes, observacao, marcado_por, marcado_em) VALUES ('PT-4',?,'financeiro','','Informação 12/2099 acostada ao processo.','cleuton','2026-10-02')", TRI);
  v = (await cle.get(url('PT-4'))).json;
  assert.equal(v.manual.s7.texto, 'Informação 12/2099 acostada ao processo.'); assert.match(v.manual.s7.origem, /lista de conferência/);
  assert.ok(v.bloqueios.some((b) => /Seção 8/.test(b)) && !v.bloqueios.some((b) => /Seção 7/.test(b)));
  v = (await put(cle, 'PT-4', { s8: 'Texto digitado sobre a CMA.' })).json;
  assert.equal(v.manual.s8.origem, 'digitado pela analista');
  assert.deepEqual(v.bloqueios, []);
});
test('termo aditivo na metade do trimestre: aviso de meta mudada, percentual pela soma das metas e descrição do termo obrigatória na seção 3', async () => {
  S.db.run("UPDATE gaveta_numeros SET meta = 600 WHERE contrato_id = 'PT-4' AND mes = '2026-12' AND chave = 'consultas_medicas'");
  let v = (await cle.get(url('PT-4'))).json;
  assert.ok(v.avisos.some((a) => /Consultas Médicas.*A meta mudou dentro do trimestre.*Outubro\/2026 1\.200.*Dezembro\/2026 600.*termo aditivo/.test(a)));
  assert.equal(v.quadro1.find((x) => x.chave === 'consultas_medicas').pct_txt, '53,33%', '1.600 / (1.200+1.200+600)');
  assert.ok(v.bloqueios.some((b) => /meta de algum indicador mudou.*descreva o termo aditivo/.test(b)), 'não adivinha o termo aditivo');
  v = (await put(cle, 'PT-4', { s3_tas: 'Em dezembro foi assinado o 3º Termo Aditivo, que reduziu a meta de consultas médicas.' })).json;
  assert.ok(!v.bloqueios.some((b) => /termo aditivo/.test(b)));
  assert.ok(v.documento.texto['3'].some((p) => /3º Termo Aditivo/.test(p)));
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
  assert.ok(v.sugestoes.some((s) => /^modelo/.test(s.origem) && /outubro a dezembro/.test(s.texto)), 'itens do modelo viram sugestões, com o período trocado');
  assert.deepEqual(v.consideracoes_finais, [], 'sugestão não entra sozinha');
});
test('pronto para conferência: grava hash e trilha; mudar um número depois derruba o pronto; PDF só com pronto', async () => {
  let r = await cle.post(url('PT-4', '/pronto'), {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.pronto, true);
  const trilha = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela = 'par_apuracao' AND registro = 'PT-4/" + TRI + "'").map((x) => x.campo);
  for (const c of ['pronto_para_conferencia', 's8', 'ajustes', 'descontos_pct', 'numero_parecer', 'revisoes']) assert.ok(trilha.includes(c), 'trilha sem ' + c + ': ' + trilha.join(','));
  const pdf = await cle.req('GET', url('PT-4', '/pdf'));
  assert.equal(pdf.status, 200);
  S.db.run("UPDATE gaveta_numeros SET realizado = 501 WHERE contrato_id = 'PT-4' AND chave = 'consultas_medicas' AND mes = '2026-10'");
  const v = (await cle.get(url('PT-4'))).json;
  assert.equal(v.pronto, false); assert.equal(v.desatualizado, true);
  assert.equal((await cle.get(url('PT-4', '/pdf'))).status, 409);
  r = await cle.post(url('PT-4', '/pronto'), {});
  assert.equal(r.status, 200); assert.equal(r.json.pronto, true);
});
test('carteira: colega sem a unidade não vê nem altera', async () => {
  assert.ok([403, 404].includes((await c2.get(url('PT-4'))).status));
  assert.ok([403, 404].includes((await put(c2, 'PT-4', { s7: 'x' })).status));
});

// ---------- texto corrido a partir do modelo ----------
test('texto: período e trimestre trocados e destacados; texto jurídico fixo; o que não se sabe trocar fica destacado para revisar', async () => {
  const v = (await cle.get(url('PT-2'))).json;
  const segs = (k) => v.textos[k].paragrafos.flatMap((p) => p.segs);
  const tr = segs('1').find((s) => s.k === 'trocado');
  assert.equal(tr.de, 'julho a setembro de 2026'); assert.equal(tr.t, 'outubro a dezembro de 2026');
  assert.ok(segs('1').some((s) => s.k === 'trocado' && s.de === '3º trimestre' && s.t === '4º trimestre'), 'trimestre sem ano também troca');
  assert.deepEqual(segs('1').filter((s) => s.k === 'revisar').map((s) => s.t), ['agosto', '45,50%'], 'mês e percentual do trimestre anterior ficam para revisar');
  assert.equal(v.textos['2'].fixo, true); assert.equal(v.textos['2'].n_trocas + v.textos['2'].n_revisar, 0);
  assert.ok(segs('2').every((s) => s.k === 'fixo'));
  assert.equal(segs('3').find((s) => s.k === 'trocado' && /Julho/.test(s.de)).t, 'Outubro a dezembro de 2026', 'caixa alta preservada');
  assert.ok(segs('3').some((s) => s.k === 'revisar' && /31 de dezembro de 2026/.test(s.t)), 'data de vigência dentro do trimestre ou depois é revisada');
  assert.ok(!segs('3').some((s) => /18 de agosto de 2022/.test(s.t) && s.k === 'revisar'), 'data antiga não faz barulho');
  assert.ok(segs('4').every((s) => s.k !== 'revisar') && segs('4').some((s) => s.k === 'igual' && /1º trimestre de 2024/.test(s.t)), 'seção 4: outro trimestre citado fica como está');
  assert.ok(v.documento.texto.cab[0].includes('202/2026') && v.documento.texto.cab[2].includes('n.º 001/2020'), 'só o título leva o número do parecer');
  assert.ok(v.documento.texto.cab[2].includes('4° trimestre de 2026 (outubro a dezembro)'));
  assert.match(v.documento.texto.titulos['3'], /^3\. DA IDENTIFICAÇÃO/);
  assert.ok(!v.documento.texto['1'].join(' ').includes('julho a setembro'));
});
test('texto: o repasse confirmado troca o valor (com extenso) só quando difere do modelo e é único no trimestre', async () => {
  semear('PT-6', BASE());
  let v = await completo('PT-6', { repasses: { '2026-10': 101000, '2026-11': 101000, '2026-12': 101000 } });
  const s3 = v.textos['3'].paragrafos.flatMap((p) => p.segs);
  const tr = s3.find((s) => s.k === 'trocado' && /R\$/.test(s.de));
  assert.equal(tr.de, 'R$ 100.000,10 (cem mil reais e dez centavos)'); assert.equal(tr.t, 'R$ 101.000,00 (cento e um mil reais)');
  assert.ok(s3.some((s) => s.k === 'revisar' && /90\.000,00/.test(s.t)), 'os demais valores em reais ficam para revisão');
  // repasse mudou no trimestre: não troca, avisa
  v = (await put(cle, 'PT-6', { repasses: { '2026-10': 101000, '2026-11': 101000, '2026-12': 102000 } })).json;
  assert.ok(!v.textos['3'].paragrafos.flatMap((p) => p.segs).some((s) => s.k === 'trocado' && /R\$/.test(s.de)));
  assert.ok(v.avisos.some((a) => /repasse mensal mudou dentro do trimestre/.test(a)));
  assert.ok(v.textos['3'].paragrafos.flatMap((p) => p.segs).some((s) => s.k === 'revisar' && /100\.000,10/.test(s.t)));
});
test('texto: seção com trocas/revisões só passa depois de revisada; mudar o texto gerado derruba a revisão; texto editado vale', async () => {
  semear('PT-7', BASE());
  let v = await completo('PT-7', null, null);
  assert.deepEqual(v.bloqueios, []);
  v = (await put(cle, 'PT-7', { numero_parecer: '999/2026' })).json;
  assert.ok(v.bloqueios.some((b) => /^Abertura: \d+ trecho\(s\) trocado\(s\)/.test(b)), 'a abertura mudou: precisa ler de novo');
  v = (await put(cle, 'PT-7', { revisar_secoes: ['cab'] })).json;
  assert.deepEqual(v.bloqueios, []);
  S.db.run("UPDATE imp_modelos SET texto = REPLACE(texto, 'Esta Comissão observou', 'Esta Comissão registrou') WHERE contrato_id = 'PT-7'");
  S.db.run("UPDATE imp_modelos SET texto = REPLACE(texto, 'Chegam a esta Comissão', 'Chegaram a esta Comissão') WHERE contrato_id = 'PT-7'");
  v = (await cle.get(url('PT-7'))).json;
  assert.ok(v.bloqueios.some((b) => /^Seção 1:/.test(b)), 'o modelo mudou: a revisão antiga não vale');
  v = (await put(cle, 'PT-7', { texto_editado: { '1': 'Texto da introdução escrito pela analista para este trimestre.' } })).json;
  assert.ok(!v.bloqueios.some((b) => /^Seção 1:/.test(b)));
  assert.equal(v.textos['1'].origem, 'editado pela analista'); assert.deepEqual(v.documento.texto['1'], ['Texto da introdução escrito pela analista para este trimestre.']);
  v = (await put(cle, 'PT-7', { texto_editado: { '10': 'A Unidade alcançou 12,34% de tudo.' } })).json;
  assert.ok(v.bloqueios.some((b) => /Texto cita 12,34%/.test(b)), 'número solto no texto da conclusão bloqueia');
  assert.equal((await put(cle, 'PT-7', { revisar_secoes: ['2'] })).status, 400, 'seção fixa não tem revisão');
});
test('texto: sem relatório-modelo ou sem número do parecer, não gera nem chuta', async () => {
  semear('PT-5', BASE());
  const v = (await put(cle, 'PT-5', CORPO())).json;
  assert.ok(v.bloqueios.some((b) => /Sem relatório-modelo ativo/.test(b)));
  assert.equal(v.modelo, null); assert.deepEqual(v.documento.texto['1'], []);
  const w = (await put(cle, 'PT-5', { numero_parecer: '' })).json;
  assert.ok(w.bloqueios.some((b) => /número do parecer/.test(b)));
});

// ---------- SIMAS como fonte principal ----------
test('SIMAS confirmado é a fonte principal; RM e planilha conferem; divergência é mostrada e a analista escolhe a fonte', async () => {
  linhaSimas('PT-5', 'consultas_medicas', 'Ambulatorial', 3600, 1600);
  let v = await completo('PT-5');
  const q = (c) => v.quadro1.find((x) => x.chave === c);
  assert.equal(q('consultas_medicas').fonte, 'SIMAS (RM confere)'); assert.equal(q('consultas_medicas').pct_txt, '44,44%');
  assert.deepEqual(v.bloqueios, [], JSON.stringify(v.bloqueios));
  assert.equal(v.documento.quadro1.linhas[3][7], 'SIMAS (RM confere)');
  // SIMAS diverge do RM: mostra os dois lados, bloqueia e não decide
  S.db.run("UPDATE imp_simas_numeros SET realizado = 1500 WHERE contrato_id = 'PT-5' AND chave = 'consultas_medicas'");
  v = (await cle.get(url('PT-5'))).json;
  assert.ok(v.bloqueios.some((b) => /SIMAS e RM divergem \(SIMAS 1\.500 de 3\.600; RM somado 1\.600 de 3\.600\).*escolha a fonte/.test(b)));
  assert.equal(q('consultas_medicas').pct_bp, null, 'sem escolha não há percentual');
  const lado = v.lado_a_lado.find((x) => x.chave === 'consultas_medicas');
  assert.equal(lado.diverge, true); assert.equal(lado.simas.realizado, 1500); assert.equal(lado.rm_planilha.realizado, 1600);
  v = (await put(cle, 'PT-5', { fontes: { consultas_medicas: 'simas' } })).json;
  assert.equal(q('consultas_medicas').pct_txt, '41,67%'); assert.match(q('consultas_medicas').fonte, /^SIMAS \(escolhida pela analista/);
  assert.equal((await put(cle, 'PT-5', { fontes: { consultas_medicas: 'x' } })).status, 400);
  v = (await put(cle, 'PT-5', { fontes: { consultas_medicas: 'rm' } })).json;
  assert.equal(q('consultas_medicas').pct_txt, '44,44%'); assert.match(q('consultas_medicas').fonte, /^RM \(escolhida pela analista/);
  assert.deepEqual(v.bloqueios.filter((b) => /Consultas Médicas/.test(b)), []);
  // mamografia em dois grupos do SIMAS: não dá para escolher uma linha pelo sistema
  linhaSimas('PT-5', 'mamografia', 'SADT UPAE', 300, 150); linhaSimas('PT-5', 'mamografia', 'SADT Especial', 300, 150);
  v = (await cle.get(url('PT-5'))).json;
  assert.ok(v.bloqueios.some((b) => /mamografia.*mais de um grupo/i.test(b)));
  v = (await put(cle, 'PT-5', { fontes: { mamografia: 'rm' } })).json;
  assert.ok(!v.bloqueios.some((b) => /Mamografia/.test(b)));
  // ostomizados: o SIMAS conta procedimentos; só referência
  linhaSimas('PT-5', 'ostomizados', 'Ambulatorial', 210, 500);
  v = (await cle.get(url('PT-5'))).json;
  assert.equal(q('ostomizados').fonte, 'Planilha de monitoramento'); assert.equal(q('ostomizados').pct_txt, '114,29%');
  assert.ok(v.avisos.some((a) => /conta procedimentos e atendimentos, e o indicador conta pacientes/.test(a)));
  // SIMAS lido mas não confirmado: usa o RM e avisa
  linhaSimas('PT-5', 'supervisao_cuidado', 'Ambulatorial', 24, 27, 'proposto');
  v = (await cle.get(url('PT-5'))).json;
  assert.ok(v.avisos.some((a) => /Supervisão.*SIMAS lido mas NÃO confirmado/.test(a)));
});

// ---------- Quadro 03 ----------
test('Quadro 03: SIMAS confirmado, recálculo do "atingido", impossibilitado de análise manual com motivo, divergência SIMAS x planilha só mostrada', async () => {
  semear('PT-8', BASE());
  let v = await completo('PT-8', null, { semQualidade: true });
  assert.ok(v.bloqueios.some((b) => /Quadro 03.*não foi lido\/confirmado/.test(b)));
  semearQualidade('PT-8');
  v = (await cle.get(url('PT-8'))).json;
  assert.equal(v.quadro3.length, 2); assert.ok(v.quadro3.every((q) => q.status === 'Meta cumprida'));
  assert.deepEqual(v.bloqueios.filter((b) => /Quadro 03/.test(b)), []);
  assert.deepEqual(v.documento.quadro3.linhas[0].slice(1), ['Outubro/2026', 'Qualidade do Preenchimento de Prontuários', 'Maior ou igual a 85', '90', 'Meta cumprida']);
  // o SIMAS diz "Não" para 95 contra "Maior ou igual a 90": o sistema recalcula e aponta
  S.db.run("UPDATE imp_simas_numeros SET atingido = 'Não' WHERE contrato_id = 'PT-8' AND mes = '2026-11' AND chave = 'indice_de_satisfacao_do_usuario'");
  v = (await cle.get(url('PT-8'))).json;
  assert.ok(v.bloqueios.some((b) => /Quadro 03.*Satisfação.*Novembro\/2026: o SIMAS diz "Não", mas 95 contra a regra "Maior ou igual a 90" dá "Sim"/.test(b)));
  S.db.run("UPDATE imp_simas_numeros SET atingido = 'Sim' WHERE contrato_id = 'PT-8' AND chave = 'indice_de_satisfacao_do_usuario'");
  // regra que o sistema não interpreta: vale o "Atingido" do SIMAS, com aviso
  S.db.run("UPDATE imp_simas_numeros SET regra = 'N/A 0' WHERE contrato_id = 'PT-8' AND chave = 'qualidade_do_preenchimento_de_prontuarios'");
  v = (await cle.get(url('PT-8'))).json;
  assert.ok(v.avisos.some((a) => /Quadro 03.*regra "N\/A 0" não interpretável/.test(a)));
  // mês do SIMAS não confirmado: pendente, a menos que a analista marque impossibilitado de análise com motivo
  S.db.run("UPDATE imp_simas_numeros SET estado = 'proposto' WHERE contrato_id = 'PT-8' AND mes = '2026-12' AND chave = 'indice_de_satisfacao_do_usuario'");
  v = (await cle.get(url('PT-8'))).json;
  assert.ok(v.bloqueios.some((b) => /Quadro 03.*Satisfação.*Dezembro\/2026: há número do SIMAS lido mas NÃO confirmado/.test(b)));
  assert.equal(v.quadro3.find((q) => /Satisfação/.test(q.nome)).status, 'Pendente');
  v = (await put(cle, 'PT-8', { impossibilitados: [{ indicador: 'Índice de Satisfação do Usuário', motivo: 'ok' }] })).json;
  assert.ok(v.bloqueios.some((b) => /Satisfação.*exige o motivo/.test(b)));
  v = (await put(cle, 'PT-8', { impossibilitados: [{ indicador: 'Índice de Satisfação do Usuário', motivo: 'Dados do SIMAS divergentes no anexo técnico.' }] })).json;
  assert.deepEqual(v.bloqueios.filter((b) => /Quadro 03/.test(b)), []);
  const sat = v.quadro3.find((q) => /Satisfação/.test(q.nome));
  assert.equal(sat.status, 'Impossibilitado de análise'); assert.equal(sat.motivo, 'Dados do SIMAS divergentes no anexo técnico.');
  assert.ok(v.documento.quadro3.linhas.some((l) => l[4] === 'Impossibilitado de análise'));
  assert.deepEqual(v.documento.quadro3.impossibilitados.map((x) => x.indicador), ['Índice de Satisfação do Usuário']);
  // satisfação do SIMAS x planilha: mostra a divergência sem decidir
  S.db.run("UPDATE imp_simas_numeros SET estado = 'confirmado' WHERE contrato_id = 'PT-8'");
  v = (await put(cle, 'PT-8', { impossibilitados: [] })).json;
  const doc = Number(S.db.get("SELECT id FROM gaveta_documentos WHERE contrato_id = 'PT-8' AND mes = '2026-10' AND codigo = 'anexo_II'").id);
  S.db.run("INSERT INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, pct, trecho, estado, confirmado_por) VALUES (?,'PT-8','2026-10','anexo_II','satisfacao','s',80,'satisfação','confirmado','cleuton')", doc);
  v = (await cle.get(url('PT-8'))).json;
  assert.ok(v.avisos.some((a) => /Satisfação.*Outubro\/2026: SIMAS 95 x planilha 80.*não decide/.test(a)));
  assert.equal(v.lado_qualidade[0].diverge, true);
  assert.ok(!v.bloqueios.some((b) => /planilha 80/.test(b)), 'divergência entre fontes é mostrada, não decidida');
});

// ---------- fluxo da minuta: congelar, conferir, autorizar, PDF ----------
test('integra ao fluxo minuta -> congelar -> conferir -> autorizar: só congela com "pronto"; mudar depois derruba; PDF final do parecer', async () => {
  const M = require('../server/minuta');
  const us = (login) => S.db.get('SELECT usuario_id, login, perfil, nome FROM usuarios WHERE login = ?', login);
  const eu = us('cleuton'), colega = us('colega2'), sup = us('nathalia');
  S.db.run("INSERT INTO regras (regra_id, versao, contrato_id, vigente_de, conteudo) SELECT 'R-PT-7', versao, 'PT-7', vigente_de, conteudo FROM regras WHERE contrato_id = (SELECT contrato_id FROM regras ORDER BY regra_id LIMIT 1) LIMIT 1");
  const pid = M.criar(S.db, eu, { contrato_id: 'PT-7', trimestre: TRI, competencias: MESES });
  const c0 = M.conteudoAtual(S.db, pid);
  assert.ok(c0.apuracao && c0.apuracao.trimestre === TRI, 'a apuração entra no conteúdo da minuta (UPAE)');
  // tira o pronto: sem pronto não congela
  await put(cle, 'PT-7', { texto_editado: { '1': 'Texto da introdução, versão da analista.' } });
  assert.throws(() => M.congelar(S.db, pid, eu, { convocados: [colega.usuario_id] }), /apuração do trimestre não está pronta/);
  let r = await cle.post(url('PT-7', '/pronto'), {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const vid = M.congelar(S.db, pid, eu, { convocados: [colega.usuario_id] });
  let est = M.estadoDaVersao(S.db, vid);
  assert.ok(est.itens.some((i) => i.id === 'apuracao'), 'a mesa confere a apuração como item próprio');
  assert.equal((await cle.get(url('PT-7'))).json.versao_congelada.numero, 1);
  // o conteúdo congelado traz o documento inteiro e o hash
  const congelado = JSON.parse(S.db.get('SELECT conteudo FROM versoes_minuta WHERE versao_id = ?', vid).conteudo).apuracao;
  assert.equal(congelado.pronto, true); assert.equal(congelado.hash, (await cle.get(url('PT-7'))).json.hash);
  // mudar um número depois de congelado derruba o pronto e a versão fica defasada
  S.db.run("UPDATE gaveta_numeros SET realizado = 777 WHERE contrato_id = 'PT-7' AND chave = 'consultas_nao_medicas' AND mes = '2026-10'");
  const w = (await cle.get(url('PT-7'))).json;
  assert.equal(w.pronto, false); assert.equal(w.versao_congelada.mudou, true);
  assert.ok(w.avisos.some((a) => /mudaram depois da versão 1 congelada/.test(a)));
  assert.equal(M.detalhe(S.db, pid, eu).conteudoAtual.apuracao.pronto, false);
  assert.throws(() => M.congelar(S.db, pid, eu, { convocados: [colega.usuario_id], motivo: 'novo número' }), /não está pronta/);
  r = await cle.post(url('PT-7', '/pronto'), {});
  assert.equal(r.status, 200);
  const vid2 = M.congelar(S.db, pid, eu, { convocados: [colega.usuario_id], motivo: 'Corrigido o realizado de consultas não médicas.' });
  assert.notEqual(vid2, vid);
  // conferência de todos os itens, inclusive o da apuração, e autorização
  est = M.estadoDaVersao(S.db, vid2);
  for (const it of est.itens) { M.conferir(S.db, vid2, colega, it.id, 'ok'); }
  for (const it of est.itens) { M.conferir(S.db, vid2, sup, it.id, 'ok'); }
  M.autorizar(S.db, vid2, sup);
  // PDF final: o parecer completo (títulos das seções, quadros, descontos, campos manuais), só do que foi congelado
  const pdf = await cle.req('GET', '/api/ctai/versoes/' + vid2 + '/pdf');
  assert.equal(pdf.status, 200);
  const blocos = require('../server/pdf/minuta').blocosDoParecer ? null : null;
  void blocos;
  const B = PT.blocosDoParecer(JSON.parse(S.db.get('SELECT conteudo FROM versoes_minuta WHERE versao_id = ?', vid2).conteudo).apuracao.documento);
  const txt = JSON.stringify(B);
  for (const t of ['1. DA INTRODUÇÃO', '5.1 Dos Indicadores de Produção', 'Quadro 03', '6. DOS APONTAMENTOS DE DESCONTOS', '7. DAS INFORMAÇÕES FINANCEIRAS', '10. DA CONCLUSÃO', 'Texto da introdução, versão da analista.']) assert.ok(txt.includes(t), 'PDF sem ' + t);
  assert.ok(!txt.includes('julho a setembro'), 'nada do período antigo no documento final');
});
