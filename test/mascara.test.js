'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mascarar } = require('../server/mascara');

test('mascara os dados pessoais comuns e conta por tipo, sem guardar o valor', () => {
  const m = mascarar('CPF 123.456.789-09, cartão SUS 898 0012 3456 7890, e-mail maria@x.com, tel (81) 99876-5432. Paciente: MARIA DA SILVA SANTOS, nascida em 12/03/1980, RG 1234567 SSP/PE, prontuário nº 456789.');
  assert.ok(!/123\.456|898|maria@|99876|MARIA|1980|1234567|456789/.test(m.texto), m.texto);
  for (const k of ['CPF', 'CNS', 'e-mail', 'telefone', 'nome', 'nascimento', 'RG', 'prontuário']) assert.ok(m.mascarados[k] >= 1, 'faltou ' + k + ': ' + JSON.stringify(m.mascarados));
  assert.ok(!JSON.stringify(m.mascarados).includes('MARIA'));
});

test('não mascara o que não é pessoal: processo SEI, CNPJ, valores, competência, anos, unidade, cargos', () => {
  const t = 'Processo SEI 2300002728.000106/2026-59, CNPJ 12.345.678/0001-90, valor R$ 1.234.567,89, competência 2026-T2, vigência 2025-2026, UPA Olinda, ISMEP. Sr. Secretário de Saúde decidiu. O paciente atendido ficou internado. Av. Agamenon Magalhães, 100.';
  const m = mascarar(t);
  assert.equal(m.texto, t);
  assert.equal(m.total, 0);
});

test('nome só é mascarado depois de rótulo de pessoa atendida, e a palavra-rótulo permanece', () => {
  const m = mascarar('A Sra. Ana Paula Lima e o usuário João Pereira relataram demora. O paciente relatou dor.');
  assert.ok(/Sra\. \[PACIENTE\]/.test(m.texto) && /usuário \[PACIENTE\]/.test(m.texto), m.texto);
  assert.ok(m.texto.includes('O paciente relatou dor.'));
});

test('endereço só é mascarado quando é residência de paciente', () => {
  const a = mascarar('Paciente residente na Rua das Flores, 123, Boa Viagem, Recife. Hospital fica na Av. Agamenon Magalhães, 100.');
  assert.ok(/\[ENDEREÇO\]/.test(a.texto) && /Agamenon/.test(a.texto), a.texto);
});

test('a extração já devolve o texto mascarado', async () => {
  const X = require('../server/extrair-texto');
  const txt = 'Relatório da UPA Demonstração, 2026-T2. Paciente: José Carlos Pereira Lima, CPF 111.222.333-44, telefone (81) 98888-7777. ' + 'Texto de enchimento do relatório para passar do mínimo de caracteres legíveis. '.repeat(3);
  const r = await X.extrair('rel.txt', Buffer.from(txt));
  assert.ok(!/José Carlos|111\.222|98888/.test(r.texto), r.texto);
  assert.ok(r.mascarados.CPF === 1 && r.mascarados.telefone === 1);
});
