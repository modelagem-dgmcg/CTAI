'use strict';
// Vínculo entre os dois canais: dados no sistema da CTAI + PDF assinado no SEI.
// Sem a API do SEI, o elo é o número do documento registrado à mão pelo gestor da unidade. O sistema só avisa; nunca bloqueia.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, gestor, setor, cleuton, colega1, colega2, nath, admin;
let cid06, env1, env2, env3;
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const canais = async () => (await cleuton.get('/api/ctai/competencias/' + cid06)).json.canais;
const codigos = async () => (await canais()).alertas.map((a) => a.codigo);

test.before(async () => {
  S = await iniciar();
  gestor = cliente(S.base); setor = cliente(S.base); cleuton = cliente(S.base); colega1 = cliente(S.base); colega2 = cliente(S.base); nath = cliente(S.base); admin = cliente(S.base);
  await gestor.entrar('gestor.demo'); await setor.entrar('assistencia.demo'); await cleuton.entrar('cleuton'); await colega1.entrar('colega1'); await colega2.entrar('colega2'); await nath.entrar('nathalia'); await admin.entrar('admin');
  cid06 = S.db.get("SELECT cid FROM competencias WHERE contrato_id='DEMO-UPA' AND competencia_id='2026-06'").cid;
});
test.after(async () => { await S.fechar(); });

test('a unidade envia sem número do SEI: o sistema não bloqueia, só avisa', async () => {
  const r = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  env1 = r.json.envio_id;
  const u = (await gestor.get('/api/unidade/competencias/' + cid06)).json;
  assert.equal(u.sei.versoes[0].situacao, 'Enviado ao sistema');
  assert.deepEqual(u.sei.alertas.map((a) => a.codigo), ['sem_registro_sei']);
  assert.match(u.sei.alertas[0].mensagemUnidade, /registre o número aqui/);
  const lista = (await gestor.get('/api/unidade/competencias')).json.competencias.find((k) => k.cid === cid06);
  assert.equal(lista.seiAlertas, 1);
  // A CTAI vê o alerta no mesmo texto do pedido.
  const c = await canais();
  assert.equal(c.alertas[0].codigo, 'sem_registro_sei');
  assert.match(c.alertas[0].mensagem, /Recebido no sistema sem registro de SEI/);
  const painel = (await cleuton.get('/api/ctai/contratos')).json.contratos.find((x) => x.contrato_id === 'DEMO-UPA').competencias.find((k) => k.cid === cid06);
  assert.equal(painel.seiAlertas, 1);
});

test('registro do número: só dígitos, 6 a 12, não vazio, e só o gestor da unidade registra', async () => {
  const url = '/api/unidade/envios/' + env1 + '/sei';
  for (const ruim of ['', '   ', '12345', '1234567890123', '12.345.678', '123456a', '12 34 56', '-123456']) {
    const r = await gestor.post(url, { numero: ruim });
    assert.equal(r.status, 400, 'deveria recusar "' + ruim + '"');
  }
  assert.equal((await gestor.post(url, {})).status, 400);
  assert.equal((await setor.post(url, { numero: '12345678' })).status, 403, 'responsável de setor não registra');
  assert.equal((await cleuton.post(url, { numero: '12345678' })).status, 403, 'a CTAI não registra pela unidade');
  assert.equal((await cleuton.post('/api/unidade/envios/' + env1 + '/sei', { numero: '12345678' })).status, 403);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM envio_sei').n, 0, 'nada gravado pelas tentativas recusadas');
});

test('nova versão antes do registro: o SEI registrado depois aponta versão antiga', async () => {
  const r = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', { motivo: 'Segundo envio, corrigido' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  env2 = r.json.envio_id;
  await espera(10);
  const ok = await gestor.post('/api/unidade/envios/' + env1 + '/sei', { numero: '11111111' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.correcao, false);
  const cs = await canais();
  assert.deepEqual(cs.alertas.map((a) => a.codigo), ['sei_versao_antiga']);
  assert.match(cs.alertas[0].mensagem, /aponta versão antiga/);
  const v1 = cs.versoes.find((v) => v.versao === 1), v2 = cs.versoes.find((v) => v.versao === 2);
  assert.equal(v1.situacao, 'Registrado no SEI'); assert.equal(v1.sei.numero, '11111111'); assert.equal(v1.sei.registrado_por, 'gestor.demo');
  assert.equal(v2.situacao, 'Enviado ao sistema');
  assert.equal(v2.hash_curto.length, 12);
  const trilha = S.db.all("SELECT * FROM trilha_auditoria WHERE tabela = 'envio_sei' ORDER BY evento_id");
  assert.equal(trilha.length, 1);
  assert.equal(trilha[0].valor_novo, '11111111'); assert.equal(trilha[0].usuario, 'gestor.demo'); assert.equal(trilha[0].registro, cid06 + '/v1');
});

test('registrar a versão mais nova limpa o alerta; uma versão ainda mais nova gera "nova versão depois do SEI"', async () => {
  assert.equal((await gestor.post('/api/unidade/envios/' + env2 + '/sei', { numero: '11111111' })).status, 409, 'o mesmo documento não vale para duas versões');
  assert.equal((await gestor.post('/api/unidade/envios/' + env2 + '/sei', { numero: '22222222' })).status, 200);
  assert.deepEqual(await codigos(), []);
  await espera(10);
  const r = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', { motivo: 'Terceiro envio, depois do SEI' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  env3 = r.json.envio_id;
  const cs = await canais();
  assert.deepEqual(cs.alertas.map((a) => a.codigo), ['nova_versao_depois_sei']);
  assert.match(cs.alertas[0].mensagem, /Nova versão no sistema depois do SEI/);
  assert.equal(cs.alertas[0].versao_sei, 2);
  const u = (await gestor.get('/api/unidade/competencias/' + cid06)).json;
  assert.equal(u.sei.alertas.length, 1, 'a unidade também vê o aviso');
});

test('corrigir o número exige motivo, cria nova linha na trilha e guarda o histórico', async () => {
  const url = '/api/unidade/envios/' + env2 + '/sei';
  assert.equal((await gestor.post(url, { numero: '22222299' })).status, 400, 'sem motivo');
  assert.equal((await gestor.post(url, { numero: '22222222', motivo: 'igual' })).status, 409, 'o mesmo número não é correção');
  assert.equal((await gestor.post(url, { numero: '22222299', motivo: 'Digitei o documento errado' })).status, 200);
  const cs = await canais();
  const v2 = cs.versoes.find((v) => v.versao === 2);
  assert.equal(v2.sei.numero, '22222299');
  assert.equal(v2.sei.correcoes, 1);
  assert.deepEqual(v2.sei.historico.map((h) => h.sei_numero), ['22222222', '22222299']);
  const linhas = S.db.all("SELECT valor_anterior, valor_novo, motivo FROM trilha_auditoria WHERE tabela = 'envio_sei' AND registro = ? ORDER BY evento_id", cid06 + '/v2');
  assert.equal(linhas.length, 2);
  assert.equal(linhas[1].valor_anterior, '22222222'); assert.equal(linhas[1].valor_novo, '22222299'); assert.match(linhas[1].motivo, /Digitei o documento errado/);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM envio_sei WHERE envio_id = ?', env2).n, 2, 'a linha antiga continua lá');
});

test('o registro do SEI é só de acréscimo (banco), e a trilha continua íntegra', async () => {
  assert.throws(() => S.db.run("UPDATE envio_sei SET sei_numero = '99999999' WHERE envio_id = ?", env1), /não pode ser alterado/);
  // Contrato real: não apaga. Contrato de demonstração: apaga (para limpar os dados fictícios).
  S.db.run("UPDATE contratos SET demo = 0 WHERE contrato_id = 'DEMO-UPA'");
  assert.throws(() => S.db.run('DELETE FROM envio_sei WHERE envio_id = ?', env1), /não pode ser apagado/);
  S.db.run("UPDATE contratos SET demo = 1 WHERE contrato_id = 'DEMO-UPA'");
  const v = (await cleuton.get('/api/ctai/trilha/verificar')).json;
  assert.equal(v.ok, true, JSON.stringify(v.falhas));
});

test('o rodapé do PDF mostra versão e os 12 primeiros caracteres do código', async () => {
  const relatorio = require('../server/pdf/relatorio');
  const D = require('../server/dominio');
  const e = S.db.get('SELECT * FROM envios WHERE envio_id = ?', env2);
  const m = relatorio.construirRelatorio(Object.assign(JSON.parse(e.snapshot), { hash: e.hash_snapshot }), D.regrasDoContrato(S.db, 'DEMO-UPA').regras);
  assert.ok(m.rodape.includes('Versão v2 · código de integridade ' + e.hash_snapshot.slice(0, 12) + ' · '), m.rodape);
  assert.ok(!m.rodape.includes(e.hash_snapshot.slice(0, 13)));
});

test('comparação opcional com o PDF do SEI: idêntico, diferente (com aviso) e não bloqueia', async () => {
  const pdf = (await gestor.get('/api/unidade/envios/' + env2 + '/pdf')).buffer;
  const url = '/api/ctai/envios/' + env2 + '/comparar-sei';
  const igual = await cleuton.post(url, { arquivo: pdf.toString('base64') });
  assert.equal(igual.status, 200, JSON.stringify(igual.json));
  assert.equal(igual.json.igual, true);
  const alterado = Buffer.concat([pdf, Buffer.from('\n% carimbo do SEI\n')]);
  const dif = await cleuton.post(url, { arquivo: alterado.toString('base64') });
  assert.equal(dif.json.igual, false);
  assert.match(dif.json.aviso, /o SEI pode alterar o arquivo/);
  assert.equal((await cleuton.post(url, { arquivo: Buffer.from('isto não é um pdf, é só texto comprido '.repeat(5)).toString('base64') })).status, 400);
  assert.equal((await cleuton.post(url, {})).status, 400);
  assert.equal((await gestor.post(url, { arquivo: pdf.toString('base64') })).status, 403, 'é uma ferramenta da CTAI');
});

test('mesa: o item do SEI é obrigatório e traz versão, código curto e número do SEI', async () => {
  const c = await cleuton.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', competencias: ['2026-06'], numero_parecer: '1/2026' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const ids = S.db.all("SELECT usuario_id FROM usuarios WHERE login IN ('colega1','colega2') ORDER BY login").map((u) => u.usuario_id);
  const f = await cleuton.post('/api/ctai/pareceres/' + c.json.parecer_id + '/congelar', { convocados: ids });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  const versaoId = f.json.versao_id;
  const v = (await cleuton.get('/api/ctai/versoes/' + versaoId)).json;
  const item = v.itens.find((i) => i.id === 'sei');
  assert.ok(item, 'a mesa tem o item do SEI');
  assert.equal(item.titulo, 'Documento no SEI confere com a versão recebida no sistema');
  assert.equal(v.itens.length, 8);
  // Dados de apoio congelados com a versão.
  const apoio = v.conteudo.indicadores.competencias[0].canais;
  assert.equal(apoio.sistema.versao, 3);
  const e3 = S.db.get('SELECT hash_snapshot FROM envios WHERE envio_id = ?', env3);
  assert.equal(apoio.sistema.hash_curto, e3.hash_snapshot.slice(0, 12));
  assert.equal(apoio.sei.numero, '22222299'); assert.equal(apoio.sei.versao, 2); assert.equal(apoio.sei.de_versao_anterior, true);
  assert.deepEqual(apoio.alertas, ['nova_versao_depois_sei']);
  // Sem o item do SEI, a versão não fica conferida.
  const outros = v.itens.filter((i) => i.id !== 'sei').map((i) => i.id);
  for (const cl of [colega1, colega2]) for (const it of outros) assert.equal((await cl.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: it, status: 'ok' })).status, 200);
  assert.equal((await cleuton.get('/api/ctai/versoes/' + versaoId)).json.versao.status, 'em conferência');
  for (const cl of [colega1, colega2]) await cl.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: 'sei', status: 'ok', comentario: 'Rodapé confere com a v2; há v3 no sistema' });
  assert.equal((await cleuton.get('/api/ctai/versoes/' + versaoId)).json.versao.status, 'conferida');
  // A superintendente também precisa dar OK no item do SEI.
  for (const it of outros) await nath.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: it, status: 'ok' });
  const sem = await nath.post('/api/ctai/versoes/' + versaoId + '/autorizar');
  assert.equal(sem.status, 409); assert.match(sem.json.erro, /Documento no SEI confere/);
  await nath.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: 'sei', status: 'ok' });
  assert.equal((await nath.post('/api/ctai/versoes/' + versaoId + '/autorizar')).status, 200);
  // Mudar o registro depois do congelamento marca a minuta como alterada: pede nova versão.
  assert.equal((await gestor.post('/api/unidade/envios/' + env3 + '/sei', { numero: '33333333' })).status, 200);
  const d = (await cleuton.get('/api/ctai/pareceres/' + c.json.parecer_id)).json;
  assert.equal(d.alteradoDesdeCongelamento, true);
});

test('apagar a demonstração limpa também os registros do SEI', async () => {
  const r = await admin.post('/api/admin/demo/apagar', { confirmar: 'APAGAR' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM envio_sei').n, 0);
});
