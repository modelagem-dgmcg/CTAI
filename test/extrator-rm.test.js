'use strict';
// Leitura dos números do Anexo I (RM) e do ofício/despacho de justificativa, e o conferidor ofício x RM. Textos sintéticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../server/extrator-rm');
const X = require('../server/extrair-texto');
const F = require('./fixtures-gaveta');

test('números em formato brasileiro', () => {
  assert.equal(E.numeroBR('1.872'), 1872); assert.equal(E.numeroBR('43,29%'), 43.29); assert.equal(E.numeroBR('4.324'), 4324); assert.equal(E.numeroBR('138%'), 138);
  assert.equal(E.numeroBR('1512'), 1512); assert.equal(E.numeroBR('0'), 0); assert.equal(E.numeroBR('#DIV/0!'), null); assert.equal(E.numeroBR(''), null); assert.equal(E.numeroBR('abc'), null);
});

test('Anexo I: lê meta, ofertado, realizado e % por indicador, com o trecho de origem', () => {
  const n = E.extrairProducaoRM(F.rmTexto('2026-07'));
  assert.deepEqual(n.map((x) => x.chave), ['consultas_medicas', 'consultas_nao_medicas', 'sessoes_reabilitacao']);
  const cm = n[0];
  assert.equal(cm.meta, 4000); assert.equal(cm.ofertado, 3000); assert.equal(cm.realizado, 1800); assert.equal(cm.pct, 45);
  assert.match(cm.trecho, /jul\/26.*Consultas.*4\.000 3\.000 1\.800 45,00%/);
  assert.equal(n[1].pct, 122.22);
});

test('Anexo I: o quadro de qualidade e o texto solto não viram número; sem quadro, nada é inventado', () => {
  assert.deepEqual(E.extrairProducaoRM('Satisfação do usuário jul/26 100% 99,32%\nOutra linha jul/26 28 31\n'), []);
  assert.deepEqual(E.extrairProducaoRM('Relatório sem nenhum quadro de produção, só texto corrido sobre a unidade.'), []);
  assert.deepEqual(E.extrairProducaoRM(''), []);
});

test('Anexo I: segundo quadro com o mesmo indicador (TEA) ganha chave própria; #DIV/0! fica vazio', () => {
  const t = F.rmTexto('2026-07') + '\njul/26\nConsultas\nMédicas\nEspecializadas\nNeuropediatra\nTotal de\nAtendimentos/Mês 154 60 56 36,36%\njul/26\nConsultas de\nEspecialidades\nnão médicas\nTotal de\nAtendimentos/Mês 0 0 37 #DIV/0!\nFonte: x\n';
  const n = E.extrairProducaoRM(t);
  const tea = n.find((x) => x.chave === 'consultas_medicas_tea'); assert.equal(tea.realizado, 56);
  const nm2 = n.find((x) => x.chave === 'consultas_nao_medicas_tea'); assert.equal(nm2.realizado, 37); assert.equal(nm2.pct, null);
});

test('Anexo I no modelo novo (colunas meta, oferta, produção e %) também é lido', () => {
  const t = 'Período Indicador Especificação Meta Mensal Oferta Produção Mensal Percentual da Meta %\nset/26\nNúmero de Atendimentos\nAmbulatoriais Médicos\nRealizados.\nNúmero de atendimentos ambulatoriais médicos efetivamente realizados pela unidade.\n2.417 2.555 2.140 88,54%\nset/26\nPrograma Assistencial\nEspecializado: Pessoas com\nEstomia Acompanhadas\nNúmero de pessoas acompanhadas\n65 65 25 38,46%\n1. Indicadores de Produção UPAE ESCADA\n';
  const n = E.extrairProducaoRM(t);
  assert.deepEqual(n.map((x) => [x.chave, x.meta, x.ofertado, x.realizado, x.pct]), [['consultas_medicas', 2417, 2555, 2140, 88.54], ['ostomizados', 65, 65, 25, 38.46]]);
});

test('ofício em HTML (iso-8859-1, entidades) vira texto legível e os números são lidos', async () => {
  const r = await X.extrair('Oficio_25.html', F.oficioJustificativaHtml('2026-07'));
  assert.match(r.texto, /Justificativa para o não atingimento/); assert.match(r.texto, /SESSÕES DE REABILITAÇÃO/); assert.ok(!/<p>|&atilde;/.test(r.texto));
  const n = E.extrairOficio(r.texto);
  const por = Object.fromEntries(n.map((x) => [x.chave, x]));
  assert.equal(por.consultas_medicas.ofertado, 3000); assert.equal(por.consultas_medicas.regulado, 600); assert.equal(por.consultas_medicas.realizado, 1800);
  assert.equal(por.ostomizados.realizado, 102); assert.equal(por.ostomizados.pct, 19.29);
  assert.equal(por.sessoes_reabilitacao.ofertado, 2100); assert.equal(por.sessoes_reabilitacao.pct, 50);
  assert.match(por.ostomizados.trecho, /Ostomizados/);
});

test('ofício só com texto corrido não gera número', async () => {
  const r = await X.extrair('o.html', Buffer.from('<p>Mesmo com a unidade ofertando 118 a regulação, foram atendidos apenas 48 pacientes. Texto de enchimento para passar do mínimo de caracteres legíveis do arquivo da unidade.</p>'));
  assert.deepEqual(E.extrairOficio(r.texto), []);
});

test('conferidor ofício x RM: aponta só o que diverge e diz quem disse o quê', () => {
  const rm = E.extrairProducaoRM(F.rmTexto('2026-07'));
  const igual = E.extrairOficio('CONSULTAS MÉDICAS\n- Consultas Médicas Ofertadas pela UPAE: 3.000\n- Total de consultas realizadas: 1.800\n');
  assert.deepEqual(E.conferir(rm, igual, 'O ofício'), []);
  const dif = E.extrairOficio('CONSULTAS MÉDICAS\n- Consultas Médicas Ofertadas pela UPAE: 3.000\n- Total de consultas realizadas: 1.900\nSESSÕES DE REABILITAÇÃO\n- Total de Sessões de Fisioterapia realizada: 900\n- % de cumprimento de Sessões de Fisioterapia contratada x realizada: 46,69%\n');
  const d = E.conferir(rm, dif, 'O ofício');
  assert.equal(d.length, 2);
  const c = d.find((x) => x.chave === 'consultas_medicas');
  assert.equal(c.campo, 'realizado'); assert.equal(c.oficio, 1900); assert.equal(c.rm, 1800); assert.equal(c.diferenca, 100); assert.match(c.texto, /O ofício diz 1\.900 realizados e o Relatório Mensal diz 1\.800/);
  assert.equal(d.find((x) => x.chave === 'sessoes_reabilitacao').campo, 'pct');
  assert.deepEqual(E.conferir(rm, [], 'O ofício'), []); assert.deepEqual(E.conferir([], igual, 'O ofício'), []);
});
