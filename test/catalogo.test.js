'use strict';
// Catálogo por tipo de unidade, identificação de mês e de documento, lacunas e trimestre calculado (funções puras, sem banco).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../server/catalogo');

test('o catálogo tem os três tipos; a UPAE traz os documentos da amostra e o Hospital é só esqueleto', () => {
  const c = C.carregar();
  assert.deepEqual(Object.keys(c.tipos), ['UPAE', 'UPA', 'Hospital']);
  const upae = c.tipos.UPAE;
  assert.equal(upae.periodicidade, 'mensal');
  const cod = upae.documentos.map((d) => d.codigo);
  for (const k of ['oficio_envio', 'oficio_justificativa', 'despacho', 'anexo_I', 'anexo_II', 'anexo_III', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_VII', 'anexo_1', 'anexo_1_1', 'anexo_1_2']) assert.ok(cod.includes(k), k);
  for (let i = 2; i <= 15; i++) assert.ok(cod.includes('anexo_' + i), 'anexo_' + i);
  assert.equal(new Set(cod).size, cod.length, 'códigos únicos');
  for (const d of upae.documentos) { assert.equal(typeof d.obrigatorio, 'boolean', d.codigo); assert.ok(d.nome && d.extrair, d.codigo); for (const p of [...d.padroes_nome, ...d.padroes_texto]) new RegExp(p); }
  assert.equal(c.tipos.UPA.fluxo, 'parecer_trimestral');
  assert.equal(c.tipos.Hospital.documentos.length, 0);
  assert.match(c.tipos.Hospital.a_confirmar, /analista da carteira/);
});

test('o tipo da unidade vem da coluna tipo ou do nome', () => {
  assert.equal(C.tipoDaUnidade({ tipo: 'UPAE', unidade: 'X' }), 'UPAE');
  assert.equal(C.tipoDaUnidade({ tipo: 'HOSPITAL', unidade: 'X' }), 'Hospital');
  assert.equal(C.tipoDaUnidade({ unidade: 'UPAE Escada' }), 'UPAE');
  assert.equal(C.tipoDaUnidade({ unidade: 'UPA Olinda' }), 'UPA');
  assert.equal(C.tipoDaUnidade({ unidade: 'Hospital Nossa Senhora das Graças' }), 'Hospital');
  assert.equal(C.tipoDaUnidade({ unidade: 'Qualquer coisa' }), null);
});

test('mês pelo nome do arquivo: 072026, 07.2026, 07_2026, jul/26, SET_26; ignora o número do SEI', () => {
  assert.equal(C.mesDoNome('[03]-92339724_Relatorio_ANEXO_I___RM___UPAE_Escada_072026.pdf'), '2026-07');
  assert.equal(C.mesDoNome('Anexo_9._Relatorio_NSP___UPAE_Escada_07.2026.pdf'), '2026-07');
  assert.equal(C.mesDoNome('SEI_RM_08_2026___UPAE_ESCADA.zip'), '2026-08');
  assert.equal(C.mesDoNome('Anexo_14_Relatorio_Tempo_de_Execucao_de_Exame___SET_26.pdf'), '2026-09');
  assert.equal(C.mesDoNome('Relatorio julho 2026.pdf'), '2026-07');
  assert.equal(C.mesDoNome('[01]-95850837_GOVPE___Oficio_30.html'), null, 'só o número do SEI e do ofício: sem mês');
  assert.equal(C.mesDoNome('Anexo_III___Escala_Medica__OCI_2026___UPAE_Escada.pdf'), null);
  assert.equal(C.mesDoNome('Anexo_V___Relatorio_SIA_SUS___OCI___UPAE_Escada_07.pdf'), null, 'sem o ano não arrisca');
});

test('mês pelo texto: a competência vale mais que a data do documento', () => {
  const oficio = 'Ofício Nº 24/2026\nEscada, 20 de agosto de 2026\nAssunto: RM 07/2026 - UPAE ESCADA\nencaminhar o Relatório Mensal – Julho/2026 e seus anexos. Assinado em 20/08/2026, às 15:40.';
  const r = C.mesDoTexto(oficio);
  assert.equal(r.mes, '2026-07'); assert.equal(r.forte, true);
  assert.equal(C.mesDoTexto('Ofício Nº 10/2026 sem mais nada de período, apenas texto.'), null, 'número do ofício não é mês');
  assert.equal(C.mesDoTexto('Período de 01/09/2026 a 30/09/2026, produção do mês de setembro de 2026.').mes, '2026-09');
  assert.equal(C.mesDoTexto('nada aqui'), null);
});

test('identifica o documento do catálogo pelo nome e, para ofícios, pelo texto', () => {
  const cat = C.catalogoDoTipo('UPAE');
  const id = (n, t) => { const r = C.identificar(cat, n, t); return r ? r.codigo + (r.parte ? '/' + r.parte : '') : null; };
  assert.equal(id('[03]-92339724_Relatorio_ANEXO_I___RM___UPAE_Escada_072026.pdf'), 'anexo_I');
  assert.equal(id('Anexo_ANEXO_II___Planilha_de_Monitoramento___UPAE_Escada.pdf'), 'anexo_II', 'II não vira I');
  assert.equal(id('Anexo_ANEXO_VII___Planilha_Profissionais_CNES.pdf'), 'anexo_VII');
  assert.equal(id('Anexo_ANEXO_V___Relatorio_SIA_SUS___OCI.pdf'), 'anexo_V');
  assert.equal(id('Anexo_1_Relatorio_das_Atividades_da_Ouvidoria_SES.pdf'), 'anexo_1');
  assert.equal(id('Anexo_1.1_NPS___CSAT_Ouvidoria.pdf'), 'anexo_1_1');
  assert.equal(id('Anexo_1.1_Relatorio_Geral_da_Ouvidoria.pdf'), 'anexo_1_1');
  assert.equal(id('Anexo_1.2_Relatorio_de_Comentarios.pdf'), 'anexo_1_2');
  assert.equal(id('Anexo_10_Relatorio_Projeto_de_Cuidadores.pdf'), 'anexo_10', '10 não vira 1');
  assert.equal(id('Anexo_11._Relatorio_de_Educacao_Permanente_I___UPAE.pdf'), 'anexo_11/I');
  assert.equal(id('Anexo_11._Relatorio_de_Educacao_Permanente_II___UPAE.pdf'), 'anexo_11/II');
  assert.equal(id('Anexo_11_Relatorio_de_Educacao_Permanente___UPAE_Escada.pdf'), 'anexo_11');
  assert.equal(id('Anexo_15_Relatorio_Tempo_de_Entrega_de_Laudo___SET_26.pdf'), 'anexo_15');
  assert.equal(id('[03]-94092596_GOVPE___Despacho_37.html'), 'despacho');
  assert.equal(id('GOVPE___Oficio_25.html', 'Assunto: Justificativa para o não atingimento de metas contratuais'), 'oficio_justificativa');
  assert.equal(id('GOVPE___Oficio_24.html', 'A Fundação vem por meio deste, encaminhar o Relatório Mensal – Julho/2026'), 'oficio_envio');
  assert.equal(id('GOVPE___Oficio_99.html', 'texto qualquer'), null);
  assert.equal(id('foto.pdf', ''), null);
});

test('lacunas: o que chegou, o que falta e o que só vale a partir de set/2026', () => {
  const cat = C.catalogoDoTipo('UPAE');
  const todos = cat.documentos.filter((d) => d.obrigatorio && !d.a_partir_de).map((d) => ({ codigo: d.codigo, parte: '' }));
  const jul = C.lacunas(cat, '2026-07', todos);
  assert.equal(jul.faltam.length, 0);
  assert.ok(!jul.esperados.some((d) => d.codigo === 'anexo_12'), 'anexo 12 ainda não é esperado em julho');
  const set = C.lacunas(cat, '2026-09', todos);
  assert.deepEqual(set.faltam.map((d) => d.codigo), ['anexo_12', 'anexo_13', 'anexo_14', 'anexo_15']);
  const sem5 = C.lacunas(cat, '2026-07', todos.filter((p) => p.codigo !== 'anexo_5'));
  assert.deepEqual(sem5.faltam.map((d) => d.codigo), ['anexo_5']);
  assert.equal(C.frase(sem5.faltam), 'Anexo 5');
  const dois = C.lacunas(cat, '2026-07', todos.filter((p) => !['anexo_5', 'anexo_8'].includes(p.codigo)));
  assert.equal(C.frase(dois.faltam), 'Anexo 5 e Anexo 8');
  assert.ok(C.lacunas(cat, '2026-07', todos).opcionais.some((d) => d.codigo === 'despacho'), 'despacho é opcional');
  assert.equal(C.lacunas(cat, '2026-07', [{ codigo: 'anexo_11', parte: 'II' }]).chegaram[0].codigo, 'anexo_11', 'basta uma das partes');
});

test('o trimestre é derivado do mês', () => {
  assert.equal(C.trimestreDoMes('2026-07'), '2026-T3'); assert.equal(C.trimestreDoMes('2026-09'), '2026-T3');
  assert.equal(C.trimestreDoMes('2026-10'), '2026-T4'); assert.equal(C.trimestreDoMes('2026-01'), '2026-T1');
  assert.equal(C.trimestreDoMes('2026-13'), null);
  assert.deepEqual(C.mesesDoTrimestre('2026-T3'), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(C.mesesDoTrimestre('2026-T1'), ['2026-01', '2026-02', '2026-03']);
  assert.equal(C.rotuloMes('2026-07'), 'Julho/2026'); assert.equal(C.rotuloMesCurto('2026-09'), 'set/26');
});
