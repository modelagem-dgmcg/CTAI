'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
process.env.ANALISTA_ENVIAR_NUVEM = 'sim';
const analista = require('../modules/analista');
const providers = require('../modules/analista/providers');
const { extensoParaNumero } = require('../modules/analista/extenso');
const { mascarar } = require('../modules/analista/mascara');

test('valor por extenso', () => {
  assert.equal(extensoParaNumero('um milhão, seiscentos e quarenta e sete mil, quatrocentos e sessenta e quatro reais e dezessete centavos'), 1647464.17);
  assert.equal(extensoParaNumero('sessenta e três por cento'), 63);
  assert.equal(extensoParaNumero('dois mil reais'), 2000);
  assert.equal(extensoParaNumero('palavra qualquer'), null);
});

test('regras locais: extenso errado, soma de tabela, proporção, mês e cor trocada', async () => {
  const r = await analista.analisar({
    texto: 'O valor foi R$ 1.000,00 (dois mil reais). Foram 63 de 100 (70%) casos. Este relatório de maio de 2026 informa o tempo vermelho de 26,73 minutos. Transparência nível Moderado.',
    tabelas: [{ titulo: 'Produção', colunas: ['Turno', 'Total'], linhas: [['Manhã', '10'], ['Tarde', '20'], ['Total', '35']] }],
    contexto: { competencia: '2026-06', valores: { verde: 26.73, amarelo: 26.28, vermelho: 23.51 }, transparencia: 'Desejado' },
  });
  const tipos = r.achados.map((a) => a.tipo).join(' | ');
  for (const esperado of ['Valor por extenso', 'Percentual', 'Soma da tabela', 'Mês citado', 'outra cor', 'transparência']) assert.ok(new RegExp(esperado, 'i').test(tipos), 'faltou: ' + esperado + ' em ' + tipos);
  assert.equal(r.provedor, 'local-regras');
  assert.ok(r.achados.every((a) => ['ALTA', 'MÉDIA', 'BAIXA'].includes(a.gravidade)));
});

test('texto correto não gera achado de extenso', async () => {
  const r = await analista.analisar({ texto: 'O valor foi R$ 1.647.464,17 (um milhão, seiscentos e quarenta e sete mil, quatrocentos e sessenta e quatro reais e dezessete centavos).' });
  assert.equal(r.achados.length, 0);
});

test('cópia entre documentos', async () => {
  const frase = 'A equipe realizou as atividades de educação permanente conforme o cronograma previsto no plano anual, com ampla participação dos setores assistenciais e administrativos da unidade.';
  const r = await analista.analisar({ texto: frase, contexto: { outrosTextos: [{ id: 'relatório de março', texto: 'Texto. ' + frase }] } });
  assert.ok(r.achados.some((a) => /copiado/i.test(a.tipo)));
});

test('máscara tira CPF, CNS, e-mail, telefone e nome rotulado', () => {
  const m = mascarar('CPF 123.456.789-09, cartão 898001234567890, e-mail a.b@c.com, tel (81) 99876-5432, paciente José da Silva Souza.');
  assert.ok(!/123\.456|898001|a\.b@c|99876|José/.test(m.texto), m.texto);
  assert.ok(m.total >= 5);
});

test('provedor de nuvem recebe só texto mascarado, e achado com trecho inventado é descartado', async () => {
  let recebido = null;
  const antes = providers.PROVEDORES.groq;
  providers.PROVEDORES.groq = {
    nome: 'groq', nuvem: true, ativo: () => true,
    async chamar({ usuario }) {
      recebido = usuario;
      return '```json\n[{"gravidade":"alta","tipo":"Teste","trecho":"Uma frase que existe no documento","risco":"r","sugestao":"s"},{"gravidade":"alta","tipo":"Inventado","trecho":"isto não está no texto","risco":"r","sugestao":"s"}]\n```';
    },
  };
  process.env.ANALISTA_ORDEM = 'groq';
  try {
    var r = await analista.analisar({ texto: 'Abertura. CPF 123.456.789-09 no texto. Uma frase que existe no documento aqui.' });
  } finally { providers.PROVEDORES.groq = antes; delete process.env.ANALISTA_ORDEM; }
  assert.ok(recebido, 'o provedor não foi chamado');
  const tipos = r.achados.map((a) => a.tipo);
  assert.ok(tipos.includes('Teste'), 'o achado com trecho real deveria ficar');
  assert.ok(!tipos.includes('Inventado'), 'o achado com trecho inventado deveria ser descartado');
  assert.equal(r.provedor, 'local-regras + groq');
  assert.ok(!recebido.includes('123.456.789-09'), 'o CPF vazou para a nuvem');
  assert.ok(recebido.includes('[CPF]'));
});

test('sem chave nada vai para a nuvem e o módulo ainda responde', async () => {
  const r = await analista.analisar({ texto: 'Sem problemas.' });
  assert.equal(r.provedor, 'local-regras');
  assert.ok(r.tentativas.every((t) => t.ok === false));
});
