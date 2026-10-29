'use strict';
// Importação em lote de unidades e carteira (dados só fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, nath, admin, cleuton;
test.before(async () => {
  S = await iniciar();
  nath = cliente(S.base); admin = cliente(S.base); cleuton = cliente(S.base);
  await nath.entrar('nathalia'); await admin.entrar('admin'); await cleuton.entrar('cleuton');
  await nath.post('/api/gestao/usuarios', { login: 'analista.um', nome: 'Analista Um', perfil: 'criador' });
  await nath.post('/api/gestao/usuarios', { login: 'analista.dois', nome: 'Analista Dois', perfil: 'colega' });
});
test.after(async () => { await S.fechar(); });

const IMP = '/api/gestao/carteira/importar/';
const csv = (...l) => ['tipo;unidade;municipio;analista'].concat(l).join('\n');
async function post(rota, corpo) { const r = await nath.post(IMP + rota, corpo); return { status: r.status, d: r.corpo || r.body || r.json || r.data }; }

test('o modelo CSV é baixável e só tem dados fictícios; só superintendente/admin usam', async () => {
  const r = await nath.get(IMP + 'modelo.csv');
  assert.equal(r.status, 200);
  assert.equal((await nath.get(IMP + 'atual.csv')).status, 200);
  assert.equal((await cleuton.get(IMP + 'modelo.csv')).status, 403);
  assert.equal((await cleuton.post(IMP + 'previa', { csv: 'x' })).status, 403);
  assert.equal((await post('previa', {})).status, 400, 'sem arquivo');
});

test('prévia: contagens por tipo e analista, tipo inválido, linha vazia, repetida; nada é gravado', async () => {
  const c = csv('UPA;UPA Exemplo Alfa;Cidade Alfa;analista.um', 'UPAE;Exemplo Alfa;Cidade Alfa;analista.um', 'Hospital;Hospital Exemplo Beta;Cidade Beta;analista.dois',
    ';;;', 'Clinica;Exemplo Gama;;analista.um', 'UPA;Exemplo Alfa;Cidade Alfa;analista.um', 'UPA;;;analista.um');
  const { status, d } = await post('previa', { csv: c });
  assert.equal(status, 200);
  assert.deepEqual(d.porTipo, { UPA: 1, UPAE: 1, HOSPITAL: 1 });
  assert.equal(d.resumo.vazias, 1);
  assert.equal(d.erros.length, 2);
  assert.ok(d.erros.some((e) => /Tipo inválido/.test(e.motivo)) && d.erros.some((e) => /Unidade em branco/.test(e.motivo)));
  const a1 = d.porAnalista.find((a) => a.login === 'analista.um');
  assert.equal(a1.total, 2); assert.equal(a1.UPA, 1); assert.equal(a1.UPAE, 1);
  assert.ok(d.avisos.some((a) => /Repetida|repetida/.test(a.motivo)));
  assert.ok(d.avisos.some((a) => /diferentes/.test(a.motivo)), 'Exemplo Alfa em UPA e UPAE são distintas');
  assert.equal(d.podeGravar, false, 'há linhas com erro');
  const u = (await nath.get('/api/gestao/carteira')).json.unidades;
  assert.ok(!u.some((x) => /Exemplo/.test(x.unidade)), 'prévia não grava');
});

test('UPA e UPAE com o mesmo nome são unidades diferentes; gravar cria com status aguardando gestor', async () => {
  const c = csv('UPA;Exemplo Alfa;Cidade Alfa;analista.um', 'UPAE;Exemplo Alfa;Cidade Alfa;analista.um', 'Hospital;Exemplo Beta;Cidade Beta;analista.dois');
  const r = await post('gravar', { csv: c });
  assert.equal(r.status, 200, JSON.stringify(r.d));
  assert.equal(r.d.unidades_novas, 3);
  const dados = (await nath.get('/api/gestao/carteira')).json;
  const novas = dados.unidades.filter((x) => /Exemplo/.test(x.unidade));
  assert.equal(novas.length, 3);
  assert.ok(novas.every((x) => x.sem_gestor && x.responsaveis.length === 1));
  assert.ok(dados.unidades.some((x) => x.contrato_id === 'UPA-EXEMPLO-ALFA-CIDADE-ALFA') && dados.unidades.some((x) => x.contrato_id === 'UPAE-EXEMPLO-ALFA-CIDADE-ALFA'));
  const painel = (await nath.get('/api/gestao/painel')).json;
  assert.ok(painel.sem_gestor.some((x) => /Exemplo Alfa/.test(x.unidade)));
  const un = painel.unidades.find((x) => x.contrato_id === 'UPA-EXEMPLO-ALFA-CIDADE-ALFA');
  assert.equal(un.fase, 'Aguardando gestor');
  assert.ok(painel.cartoes.sem_gestor >= 3);
  // as telas de unidades sem regras não quebram
  assert.equal((await cleuton.get('/api/ctai/contratos')).status, 200);
  assert.equal((await cleuton.get('/api/ctai/contratos/UPA-EXEMPLO-ALFA-CIDADE-ALFA/decisoes')).status, 200);
});

test('reimportar o mesmo arquivo não duplica nada', async () => {
  const c = csv('UPA;Exemplo Alfa;Cidade Alfa;analista.um', 'UPAE;Exemplo Alfa;Cidade Alfa;analista.um', 'Hospital;Exemplo Beta;Cidade Beta;analista.dois');
  const antes = S.db.get('SELECT COUNT(*) AS n FROM contratos').n, cartAntes = S.db.get('SELECT COUNT(*) AS n FROM carteira').n;
  const r = await post('gravar', { csv: c });
  assert.equal(r.status, 200);
  assert.equal(r.d.unidades_novas, 0); assert.equal(r.d.entradas, 0); assert.equal(r.d.saidas, 0);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM contratos').n, antes);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM carteira').n, cartAntes);
  const r2 = await post('gravar', { csv: c, modo: 'substituir' });
  assert.equal(r2.status, 200); assert.equal(r2.d.entradas, 0); assert.equal(r2.d.saidas, 0, 'substituir com o mesmo arquivo não muda nada');
});

test('conflito: unidade em duas carteiras exige decisão (dividir ou manter uma)', async () => {
  const c = csv('UPA;Exemplo Alfa;Cidade Alfa;analista.dois', 'UPA;Exemplo Teta;Cidade Teta;analista.um', 'UPA;Exemplo Teta;Cidade Teta;analista.dois');
  const p = (await post('previa', { csv: c })).d;
  assert.equal(p.conflitos.length, 2);
  assert.equal(p.podeGravar, false);
  assert.equal((await post('gravar', { csv: c })).status, 409);
  const alfa = p.conflitos.find((x) => /Alfa/.test(x.unidade)), teta = p.conflitos.find((x) => /Teta/.test(x.unidade));
  assert.deepEqual(alfa.opcoes.slice(0, 1), ['dividir']);
  const r = await post('gravar', { csv: c, decisoes: { conflitos: { [alfa.key]: 'dividir', [teta.key]: 'analista.um' } } });
  assert.equal(r.status, 200, JSON.stringify(r.d));
  const resp = (id) => S.db.all('SELECT u.login FROM carteira w JOIN usuarios u ON u.usuario_id = w.usuario_id WHERE w.contrato_id = ? AND w.ate IS NULL ORDER BY u.login', id).map((x) => x.login);
  assert.deepEqual(resp('UPA-EXEMPLO-ALFA-CIDADE-ALFA'), ['analista.dois', 'analista.um'], 'dividida');
  assert.deepEqual(resp('UPA-EXEMPLO-TETA-CIDADE-TETA'), ['analista.um'], 'mantida só uma');
  // depois de resolvido, reimportar a mesma coisa não pede decisão de novo
  const p2 = (await post('previa', { csv: c, decisoes: {} })).d;
  assert.equal(p2.conflitos.filter((x) => /Alfa/.test(x.unidade)).length, 0);
});

test('analista inexistente: criar (criador, senha temporária) ou pular; nomes sem acento/caixa casam', async () => {
  const c = csv('UPAE;Exemplo Omega;Cidade Omega;Maria Fictícia', 'UPA;Exemplo Omega;Cidade Omega;ANALISTA UM');
  const p = (await post('previa', { csv: c })).d;
  assert.equal(p.pendencias.filter((x) => x.tipo === 'analista').length, 1);
  assert.equal((await post('gravar', { csv: c })).status, 409);
  const pular = await post('gravar', { csv: c, decisoes: { analistas: { 'Maria Fictícia': 'pular' } } });
  assert.equal(pular.status, 200);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM usuarios WHERE login LIKE 'maria%'").n, 0);
  assert.ok(S.db.get("SELECT 1 AS x FROM contratos WHERE contrato_id = 'UPAE-EXEMPLO-OMEGA-CIDADE-OMEGA'"), 'unidade criada mesmo sem o analista');
  const criar = await post('gravar', { csv: c, decisoes: { analistas: { 'Maria Fictícia': 'criar' } } });
  assert.equal(criar.status, 200, JSON.stringify(criar.d));
  const u = S.db.get("SELECT * FROM usuarios WHERE login = 'maria.ficticia'");
  assert.ok(u && u.perfil === 'criador' && u.trocar_senha === 1);
  assert.ok(criar.d.senhaTemporaria);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM carteira WHERE usuario_id = ? AND ate IS NULL', u.usuario_id).n, 1);
});

test('analista que é gestor de unidade não recebe carteira (bloqueia)', async () => {
  const p = (await post('previa', { csv: csv('UPA;Exemplo Sigma;;gestor.demo') })).d;
  assert.equal(p.podeGravar, false);
  assert.equal((await post('gravar', { csv: csv('UPA;Exemplo Sigma;;gestor.demo') })).status, 409);
});

test('modo substituir tira da carteira o que não está no arquivo; acrescentar mantém', async () => {
  const antes = (id) => S.db.all('SELECT contrato_id FROM carteira WHERE usuario_id = (SELECT usuario_id FROM usuarios WHERE login = ?) AND ate IS NULL', id).map((x) => x.contrato_id).sort();
  const base = antes('analista.dois');
  assert.ok(base.length >= 2);
  const r1 = await post('gravar', { csv: csv('UPA;Exemplo Novo;Cidade Nova;analista.dois') });
  assert.equal(r1.status, 200); assert.equal(antes('analista.dois').length, base.length + 1, 'acrescentar mantém');
  const r2 = await post('gravar', { csv: csv('UPA;Exemplo Novo;Cidade Nova;analista.dois'), modo: 'substituir' });
  assert.equal(r2.status, 200);
  assert.deepEqual(antes('analista.dois'), ['UPA-EXEMPLO-NOVO-CIDADE-NOVA']);
  assert.equal(r2.d.saidas, base.length);
  const h = (await nath.get('/api/gestao/carteira/historico')).json.historico;
  assert.ok(h.some((x) => /Importação em lote/.test(x.motivo || '')));
});

test('ignorar linhas com erro grava só as boas; tudo é atômico; trilha registra quem importou', async () => {
  const c = csv('UPA;Exemplo Pi;Cidade Pi;analista.um', 'Foo;Exemplo Ruim;;analista.um');
  assert.equal((await post('gravar', { csv: c })).status, 409);
  assert.ok(!S.db.get("SELECT 1 AS x FROM contratos WHERE contrato_id = 'UPA-EXEMPLO-PI-CIDADE-PI'"));
  const r = await post('gravar', { csv: c, ignorarErros: true });
  assert.equal(r.status, 200);
  assert.ok(S.db.get("SELECT 1 AS x FROM contratos WHERE contrato_id = 'UPA-EXEMPLO-PI-CIDADE-PI'"));
  const ev = S.db.all("SELECT usuario FROM trilha_auditoria WHERE tabela = 'importacoes'");
  assert.ok(ev.length >= 1 && ev.every((e) => e.usuario === 'nathalia'));
  assert.ok((await nath.get(IMP + 'historico')).json.importacoes.length >= 1);
  assert.ok(require('../server/trilha').verificar(S.db).ok);
});

test('falha no meio da gravação desfaz tudo (atômico)', async () => {
  const CART = require('../server/carteira');
  const original = CART.definir;
  const n = S.db.get('SELECT COUNT(*) AS n FROM contratos').n, u = S.db.get('SELECT COUNT(*) AS n FROM usuarios').n, w = S.db.get('SELECT COUNT(*) AS n FROM carteira').n, imp = S.db.get('SELECT COUNT(*) AS n FROM importacoes').n;
  CART.definir = () => { throw new Error('falha simulada'); };
  try {
    const r = await post('gravar', { csv: csv('UPA;Exemplo Atomico;Cidade X;Nova Pessoa Fictícia'), decisoes: { analistas: { 'Nova Pessoa Fictícia': 'criar' } } });
    assert.equal(r.status, 500);
  } finally { CART.definir = original; }
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM contratos').n, n);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM usuarios').n, u);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM carteira').n, w);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM importacoes').n, imp);
  assert.ok(require('../server/trilha').verificar(S.db).ok);
});
