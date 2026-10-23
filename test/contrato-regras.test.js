'use strict';
// Regras descritivas do contrato (hospital/UPAE): importação por unidade e em lote, conferência (dados fictícios).
process.env.CTAI_SEMENTE = 'equipe'; process.env.CTAI_SENHA_TEMPORARIA = '123'; process.env.CTAI_TROCA_SENHA_OBRIGATORIA = 'nao';
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, adm;
test.before(async () => {
  S = await iniciar(); adm = cliente(S.base);
  assert.equal((await adm.post('/api/auth/login', { login: 'admin', senha: '123' })).status, 200);
  const csv = ['tipo;unidade;municipio;analista', 'Hospital;Exemplo Gama;Cidade C;juliana.rocha', 'Hospital;Exemplo Delta;Cidade D;cecilia', 'UPAE;Exemplo Gama;Cidade C;cecilia'].join('\n');
  assert.equal((await adm.post('/api/gestao/carteira/importar/gravar', { csv, modo: 'substituir' })).status, 200);
});
test.after(async () => { await S.fechar(); });

const item = (unidade, chaves, n) => ({ unidade, chaves, contrato_numero: '001/2020', tipo: 'HOSPITAL', fixa_pct: 70, variavel_pct: 30, valor_mensal: '1.000,00',
  indicadores: Array.from({ length: n }, (_, i) => ({ tipo: i ? 'qualidade' : 'producao', nome: 'Indicador ' + (i + 1), peso_pct_total: 5, meta: 'Meta ' + (i + 1) })) });

test('lote casa pelo nome, aponta ambíguo e sem par; unidade mostra a regra a conferir; conferir marca', async () => {
  const r = await adm.post('/api/ctai/regras/importar-lote', { lista: [item('Hospital Delta', ['delta'], 3), Object.assign(item('Gama', ['exemplo gama'], 2), { tipo: '' }), item('Zeta', ['zeta'], 1)] });
  assert.equal(r.status, 200);
  assert.equal(r.json.importadas.length, 1);
  assert.equal(r.json.duvida.length, 1, 'Gama existe como Hospital e como UPAE');
  assert.equal(r.json.semPar.length, 1);
  const c = (await adm.get('/api/ctai/contratos')).json.contratos.find((x) => /Delta/.test(x.unidade));
  assert.equal(c.regra.tem, true); assert.equal(c.regra.descritiva, true); assert.equal(c.regra.conferida, false); assert.equal(c.semRegras, false);
  const d = (await adm.get('/api/ctai/contratos/' + c.contrato_id + '/decisoes')).json;
  assert.equal(d.descritiva, true); assert.equal(d.contratoRegras.conteudo.indicadores.length, 3);
  const ok = await adm.post('/api/ctai/contratos/' + c.contrato_id + '/regras/conferida', {});
  assert.equal(ok.json.regra.conferida, true);
});

test('importação por unidade e permissão do lote', async () => {
  const g = (await adm.get('/api/ctai/contratos')).json.contratos.find((x) => /Gama/.test(x.unidade) && x.tipo === 'HOSPITAL');
  const r = await adm.post('/api/ctai/contratos/' + g.contrato_id + '/regras/importar', { regras: item('Gama', [], 2) });
  assert.equal(r.status, 200);
  const jr = cliente(S.base); await jr.post('/api/auth/login', { login: 'juliana.rocha', senha: '123' });
  assert.equal((await jr.post('/api/ctai/regras/importar-lote', { lista: [item('X', ['x'], 1)] })).status, 403);
});

test('regras que acompanham o sistema entram sozinhas ao importar a carteira, sem sobrescrever', async () => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', 'regras', 'contratos');
  const arq = path.join(dir, 'zz-teste.json');
  fs.writeFileSync(arq, JSON.stringify({ unidades: [item('Hospital Teste Sigma', ['sigma teste'], 2)] }));
  try {
    const csv = ['tipo;unidade;municipio;analista', 'Hospital;Sigma Teste;Cidade S;cecilia'].join('\n');
    assert.equal((await adm.post('/api/gestao/carteira/importar/gravar', { csv, modo: 'acrescentar' })).status, 200);
    const c = (await adm.get('/api/ctai/contratos')).json.contratos.find((x) => /Sigma/.test(x.unidade));
    assert.ok(c, 'unidade criada');
    assert.equal(c.regra.tem, true); assert.equal(c.regra.descritiva, true);
    assert.equal(c.numero_cg, '001/2020', 'número do contrato preenchido onde estava vazio');
  } finally { fs.unlinkSync(arq); }
});

test('configuração na unidade: analista da carteira altera a regra com senha e motivo; sem eles ou fora da carteira, não', async () => {
  const cec = cliente(S.base); assert.equal((await cec.post('/api/auth/login', { login: 'cecilia', senha: '123' })).status, 200);
  const jul = cliente(S.base); assert.equal((await jul.post('/api/auth/login', { login: 'juliana.rocha', senha: '123' })).status, 200);
  const delta = (await adm.get('/api/ctai/contratos')).json.contratos.find((c) => /Delta/.test(c.unidade) && c.tipo === 'HOSPITAL');
  assert.ok(delta);
  const url = '/api/ctai/configuracao/' + delta.contrato_id + '/regras';
  const regra = { unidade: delta.unidade, indicadores: [{ tipo: 'qualidade', nome: 'Indicador de teste', meta: '90%' }], observacoes: ['linha 1'] };
  assert.equal((await cec.put(url, { conteudo: regra, motivo: 'TA 03 mudou a meta', senha: '123' })).status, 200);
  assert.equal((await cec.put(url, { conteudo: regra, motivo: '', senha: '123' })).status, 400, 'motivo obrigatório');
  assert.equal((await cec.put(url, { conteudo: regra, motivo: 'TA 03 mudou a meta' })).status, 400, 'senha obrigatória');
  assert.equal((await cec.put(url, { conteudo: regra, motivo: 'TA 03 mudou a meta', senha: 'errada' })).status, 401, 'senha errada');
  assert.ok([403, 404].includes((await jul.put(url, { conteudo: regra, motivo: 'TA 03 mudou a meta', senha: '123' })).status), 'fora da carteira não altera');
  const lido = (await cec.get('/api/ctai/contratos/' + delta.contrato_id + '/decisoes')).json;
  assert.equal(lido.contratoRegras.conteudo.indicadores[0].nome, 'Indicador de teste');
  assert.equal(lido.contratoRegras.conferida, false, 'depois de alterar, volta a "a conferir"');
  assert.ok(S.db.all("SELECT motivo FROM trilha_auditoria WHERE tabela = 'contrato_regras' AND campo = 'configuração'").some((x) => x.motivo === 'TA 03 mudou a meta'), 'motivo na trilha');
});
