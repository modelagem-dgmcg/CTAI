'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const L = require('../core/linhas');
const sintetico = require('../core/sintetico');
const F = require('../core/formularios');

test('arquivo com coluna de nome, CPF, prontuário ou nascimento é recusado inteiro', () => {
  for (const col of ['nome', 'Nome do Paciente', 'CPF', 'prontuário', 'data_nascimento', 'e-mail']) {
    const v = L.validarLinhas('retorno', ['protocolo', 'retornou_24h', col], [{ protocolo: 'A1', retornou_24h: 'sim', [col]: 'x' }]);
    assert.equal(v.recusado, true, 'devia recusar a coluna ' + col);
    assert.equal(v.linhas.length, 0);
  }
});

test('valor que parece CPF, CNS, e-mail ou nome de pessoa é recusado na linha', () => {
  const v = L.validarLinhas('retorno', ['protocolo', 'retornou_24h'], [
    { protocolo: '123.456.789-09', retornou_24h: 'sim' }, { protocolo: '898001234567890', retornou_24h: 'sim' }, { protocolo: 'maria@x.com', retornou_24h: 'sim' }, { protocolo: 'Maria da Silva', retornou_24h: 'sim' }, { protocolo: 'DEMO-1', retornou_24h: 'sim' },
  ]);
  assert.equal(v.ok, false);
  assert.equal(v.erros.length, 4);
  assert.equal(v.linhas.length, 1);
});

test('os modelos de CSV de todas as fontes passam pelo leitor e os dados fictícios são aceitos', () => {
  const g = sintetico.gerar('2026-06');
  for (const fonte of Object.keys(F.FONTES)) {
    const modelo = L.lerCSV(L.modeloCSV(fonte));
    assert.ok(modelo.cabecalho.length > 1, fonte);
    const regs = g[fonte];
    const v = L.validarLinhas(fonte, Object.keys(regs[0]), regs, { competencia: '2026-06' });
    assert.equal(v.ok, true, fonte + ': ' + JSON.stringify(v.erros.slice(0, 2)));
  }
});

test('minutos são calculados das datas e horas, e fim antes do início é erro', () => {
  const ok = L.validarLinhas('dor_toracica', ['protocolo', 'data_chegada', 'hora_chegada', 'data_ecg', 'hora_ecg'], [{ protocolo: 'P1', data_chegada: '2026-06-01', hora_chegada: '10:00', data_ecg: '2026-06-01', hora_ecg: '10:09' }]);
  assert.equal(ok.linhas[0].minutos, 9);
  const ruim = L.validarLinhas('dor_toracica', ['protocolo', 'data_chegada', 'hora_chegada', 'data_ecg', 'hora_ecg'], [{ protocolo: 'P1', data_chegada: '2026-06-01', hora_chegada: '10:00', data_ecg: '2026-06-01', hora_ecg: '09:00' }]);
  assert.equal(ruim.ok, false);
});

test('CSV com ponto e vírgula, aspas e BOM', () => {
  const p = L.lerCSV('﻿protocolo;retornou_24h\r\n"A;1";sim\r\n');
  assert.deepEqual(p.cabecalho, ['protocolo', 'retornou_24h']);
  assert.equal(p.registros[0].protocolo, 'A;1');
});
