'use strict';
// Gestão CTAI: usuários, carteira (escopo), IA (chave cifrada), produção e painel da superintendente.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { iniciar, cliente } = require('./helpers');

process.env.CTAI_SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres';
process.env.CTAI_EXIGIR_JURIDICO = 'sim';
const OLINDA = 'UPA-OLINDA', DEMO = 'DEMO-UPA';
let S, nath, admin, cleuton, colega1, colega2, gestor, falso, urlFalso;

test.before(async () => {
  S = await iniciar();
  nath = cliente(S.base); admin = cliente(S.base); cleuton = cliente(S.base); colega1 = cliente(S.base); colega2 = cliente(S.base); gestor = cliente(S.base);
  await nath.entrar('nathalia'); await admin.entrar('admin'); await cleuton.entrar('cleuton'); await colega1.entrar('colega1'); await colega2.entrar('colega2'); await gestor.entrar('gestor.demo');
  // Provedor falso (compatível com OpenAI) para testar a conexão sem internet.
  falso = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { res.setHeader('content-type', 'application/json'); if (String(req.headers.authorization || '').includes('RUIM')) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'chave invalida' })); } res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); }); });
  await new Promise((ok) => falso.listen(0, '127.0.0.1', ok));
  urlFalso = 'http://127.0.0.1:' + falso.address().port + '/v1/chat/completions';
});
test.after(async () => { falso.close(); await S.fechar(); });

test('só superintendente e administrador entram na Gestão CTAI', async () => {
  assert.equal((await nath.get('/api/gestao/painel')).status, 200);
  assert.equal((await admin.get('/api/gestao/painel')).status, 200);
  for (const c of [cleuton, colega1, gestor]) {
    assert.equal((await c.get('/api/gestao/painel')).status, 403);
    assert.equal((await c.get('/api/gestao/usuarios')).status, 403);
    assert.equal((await c.get('/api/gestao/ia')).status, 403);
    assert.equal((await c.put('/api/gestao/carteira/4', { unidades: [] })).status, 403);
  }
  assert.equal((await cliente(S.base).get('/api/gestao/painel')).status, 401);
});

test('usuários: criar, mudar perfil, trocar senha, desativar; tudo na trilha; admin só pelo administrador', async () => {
  assert.equal((await nath.post('/api/gestao/usuarios', { login: 'novo.colega', nome: 'Novo Colega', perfil: 'colega' })).status, 200);
  assert.equal((await nath.post('/api/gestao/usuarios', { login: 'novo.colega', nome: 'Outro', perfil: 'colega' })).status, 409, 'login repetido');
  assert.equal((await nath.post('/api/gestao/usuarios', { login: 'adm2', nome: 'Admin 2', perfil: 'admin' })).status, 403, 'superintendente não cria administrador');
  assert.equal((await admin.post('/api/gestao/usuarios', { login: 'adm2', nome: 'Admin 2', perfil: 'admin' })).status, 200);
  assert.equal((await nath.post('/api/gestao/usuarios', { login: 'u.unid', nome: 'Sem contrato', perfil: 'gestor_unidade' })).status, 400, 'usuário de unidade precisa de contrato');
  const lista = (await nath.get('/api/gestao/usuarios')).json.usuarios;
  const novo = lista.find((u) => u.login === 'novo.colega');
  assert.deepEqual(novo.unidades, []);
  assert.equal((await nath.patch('/api/gestao/usuarios/' + novo.usuario_id, { perfil: 'criador' })).status, 200);
  assert.equal((await nath.patch('/api/gestao/usuarios/' + novo.usuario_id, { perfil: 'admin' })).status, 403);
  const adm2 = lista.find((u) => u.login === 'adm2');
  assert.equal((await nath.post('/api/gestao/usuarios/' + adm2.usuario_id + '/senha', {})).status, 403, 'não mexe em administrador');
  const t = cliente(S.base);
  assert.equal((await t.post('/api/auth/login', { login: 'novo.colega', senha: 'Trocar@123' })).status, 200);
  assert.equal((await nath.post('/api/gestao/usuarios/' + novo.usuario_id + '/senha', { senha: 'abc' })).status, 400, 'senha fraca');
  assert.equal((await nath.post('/api/gestao/usuarios/' + novo.usuario_id + '/senha', { senha: 'Outra@12345' })).status, 200);
  assert.ok((await cliente(S.base).post('/api/auth/login', { login: 'novo.colega', senha: 'Outra@12345' })).json.usuario.trocar_senha, 'troca obrigatória');
  assert.equal((await nath.post('/api/gestao/usuarios/' + novo.usuario_id + '/ativo', { ativo: false })).status, 200);
  assert.equal((await cliente(S.base).post('/api/auth/login', { login: 'novo.colega', senha: 'Outra@12345' })).status, 401, 'desativado não entra');
  const eu = lista.find((u) => u.login === 'nathalia');
  assert.equal((await nath.post('/api/gestao/usuarios/' + eu.usuario_id + '/ativo', { ativo: false })).status, 400, 'não desativa a si');
  const tr = (await nath.get('/api/ctai/trilha?tabela=usuarios&limite=50')).json;
  const campos = JSON.stringify(tr);
  assert.match(campos, /novo\.colega/);
  assert.doesNotMatch(campos, /Outra@12345/, 'senha nunca vai para a trilha');
});

test('carteira: quem tem unidades vê só elas; superintendente e admin veem tudo; sem carteira aparece para distribuir', async () => {
  const antes = (await colega1.get('/api/ctai/contratos')).json;
  assert.equal(antes.contratos.length, 2, 'sem carteira, vê tudo (modo compatível)');
  assert.equal((await nath.get('/api/gestao/carteira')).json.semCarteira.length, 2);

  const c1 = (await nath.get('/api/gestao/carteira')).json.funcionarios.find((f) => f.login === 'colega1');
  assert.equal((await nath.put('/api/gestao/carteira/' + c1.usuario_id, { unidades: ['NAO-EXISTE'] })).status, 400);
  const ok = await nath.put('/api/gestao/carteira/' + c1.usuario_id, { unidades: [DEMO], motivo: 'Distribuição inicial' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.entraram, [DEMO]);

  const lista = (await colega1.get('/api/ctai/contratos')).json;
  assert.deepEqual(lista.contratos.map((c) => c.contrato_id), [DEMO]);
  assert.equal(lista.escopo, 'carteira');
  const cidOlinda = (await nath.get('/api/ctai/contratos')).json.contratos.find((c) => c.contrato_id === OLINDA).competencias[0].cid;
  assert.equal((await colega1.get('/api/ctai/competencias/' + cidOlinda)).status, 403, 'fora da carteira');
  assert.equal((await colega1.get('/api/ctai/contratos/' + OLINDA + '/decisoes')).status, 403);
  assert.equal((await colega1.get('/api/ctai/competencias/' + cidOlinda + '/checklist')).status, 403);
  assert.equal((await colega1.get('/api/analista/achados?contrato=' + OLINDA)).status, 403);
  const painel = (await colega1.get('/api/analista/painel')).json;
  assert.deepEqual(painel.contratos.map((c) => c.contrato_id), [DEMO]);
  const cidDemo = lista.contratos[0].competencias[0].cid;
  assert.equal((await colega1.get('/api/ctai/competencias/' + cidDemo)).status, 200);
  // outros perfis continuam vendo tudo
  assert.equal((await nath.get('/api/ctai/contratos')).json.contratos.length, 2);
  assert.equal((await admin.get('/api/ctai/contratos')).json.contratos.length, 2);
  assert.equal((await cleuton.get('/api/ctai/contratos')).json.contratos.length, 2, 'criador sem carteira segue vendo tudo');
  // pareceres: criador com carteira não abre minuta de outra unidade
  const c0 = (await nath.get('/api/gestao/carteira')).json.funcionarios.find((f) => f.login === 'cleuton');
  await nath.put('/api/gestao/carteira/' + c0.usuario_id, { unidades: [OLINDA] });
  assert.equal((await cleuton.post('/api/ctai/pareceres', { contrato_id: DEMO, trimestre: '2026-T2', competencias: ['2026-04'] })).status, 403);
  assert.equal((await cleuton.post('/api/analista/relatorio-trimestral', { contrato_id: DEMO, trimestre: '2026-T2' })).status, 403);

  // sem carteira agora é só o que ninguém acompanha
  const sem = (await nath.get('/api/gestao/carteira')).json;
  assert.equal(sem.semCarteira.length, 0);
  assert.equal((await nath.get('/api/gestao/painel')).json.cartoes.sem_carteira, 0);

  // troca de carteira guarda histórico
  await nath.put('/api/gestao/carteira/' + c1.usuario_id, { unidades: [OLINDA], motivo: 'Troca' });
  const hist = (await nath.get('/api/gestao/carteira/historico?usuario_id=' + c1.usuario_id)).json.historico;
  assert.ok(hist.some((x) => x.contrato_id === DEMO && x.ate && x.removido_por === 'nathalia'), 'saída registrada');
  assert.ok(hist.some((x) => x.contrato_id === OLINDA && !x.ate), 'entrada vigente');
  const tr = JSON.stringify((await nath.get('/api/ctai/trilha?tabela=carteira&limite=50')).json);
  assert.match(tr, /unidade_atribuida/); assert.match(tr, /unidade_removida/);
  assert.equal((await nath.post('/api/gestao/carteira/atribuir', { usuario_id: c1.usuario_id, contrato_id: DEMO })).status, 200);
  assert.equal((await nath.put('/api/gestao/carteira/' + 1, { unidades: [DEMO] })).status, 400, 'admin/superintendente não têm carteira');

  // modo estrito: quem não tem carteira não vê nada
  const c2 = (await nath.get('/api/gestao/carteira')).json.funcionarios.find((f) => f.login === 'colega2');
  assert.equal((await colega2.get('/api/ctai/contratos')).json.contratos.length, 2);
  assert.equal((await nath.put('/api/gestao/carteira-modo', { estrita: true })).json.estrita, true);
  assert.equal((await colega2.get('/api/ctai/contratos')).json.contratos.length, 0);
  await nath.put('/api/gestao/carteira-modo', { estrita: false });
  assert.ok(c2);
});

test('IA: rack de chaves — cifrada e nunca devolvida; nuvem exige o jurídico; várias chaves em ordem; teste de conexão por chave', async () => {
  const e0 = (await nath.get('/api/gestao/ia')).json;
  assert.equal(e0.segredoConfigurado, true);
  assert.deepEqual(e0.chaves, [], 'rack vazio por padrão');
  assert.ok(e0.servicos.kimi && e0.servicos.ollama.semChave === true);
  assert.match(e0.avisoJuridico, /jurídico/);
  const CHAVE = 'sk-teste-ABCDEFGH-12345678';
  const nova = (c) => nath.post('/api/gestao/ia/chaves', c);
  assert.equal((await nova({ provedor: 'kimi', chave: 'curta', juridico: true })).status, 400, 'chave curta');
  assert.equal((await nova({ provedor: 'inexistente', chave: CHAVE })).status, 400, 'serviço desconhecido');
  assert.equal((await nova({ provedor: 'kimi', chave: CHAVE, url: urlFalso })).status, 400, 'nuvem ligada sem aprovação do jurídico');
  assert.equal((await nova({ provedor: 'kimi', chave: CHAVE, url: 'ftp://errado', juridico: true })).status, 400, 'endereço inválido');
  assert.equal((await nova({ provedor: 'ollama', ativa: true })).status, 400, 'servidor local precisa de endereço');

  const r = await nova({ provedor: 'kimi', rotulo: 'Kimi da GGPCG', chave: CHAVE, modelo: 'modelo-x', url: urlFalso, juridico: true });
  assert.equal(r.status, 200);
  const k = r.json.chaves.find((c) => c.chave_id === r.json.chave_id);
  assert.equal(k.final, '5678'); assert.equal(k.ativa, true); assert.equal(k.juridico.por, 'nathalia'); assert.equal(k.rotulo, 'Kimi da GGPCG');
  assert.doesNotMatch(JSON.stringify(r.json), /sk-teste|ABCDEFGH/, 'a chave nunca volta');
  assert.doesNotMatch(JSON.stringify((await nath.get('/api/gestao/ia')).json), /sk-teste|ABCDEFGH/);
  const linha = S.db.get('SELECT chave_cifrada FROM ia_chaves WHERE chave_id = ?', k.chave_id);
  assert.doesNotMatch(linha.chave_cifrada, /sk-teste|ABCDEFGH/, 'cifrada no banco'); assert.match(linha.chave_cifrada, /^v1:/);
  const tr = JSON.stringify((await nath.get('/api/ctai/trilha?tabela=ia_chaves&limite=50')).json);
  assert.match(tr, /kimi/); assert.doesNotMatch(tr, /sk-teste|ABCDEFGH|chave_cifrada/);
  assert.equal(require('../server/ia-config').decifrar(linha.chave_cifrada), CHAVE);

  // teste de conexão: por chave, conta o uso e guarda o resultado
  const t = await nath.post('/api/gestao/ia/chaves/' + k.chave_id + '/testar', {});
  assert.equal(t.status, 200); assert.equal(t.json.ok, true, JSON.stringify(t.json));
  const dep = t.json.estado.chaves.find((c) => c.chave_id === k.chave_id);
  assert.equal(dep.usoMes, 1); assert.equal(dep.falhasMes, 0); assert.equal(dep.teste.ok, true);
  const providers = require('../modules/analista/providers');
  assert.equal(providers.estado().provedores.find((p) => p.nome === 'kimi').disponivel, true);

  // várias chaves: a de menor ordem é tentada primeiro; se falhar, passa para a próxima
  const ruim = (await nova({ provedor: 'kimi', rotulo: 'Chave vencida', chave: 'sk-RUIM-00000000', url: urlFalso, juridico: true, ordem: 1 })).json.chave_id;
  assert.equal((await nath.put('/api/gestao/ia/chaves/' + k.chave_id, { ordem: 2 })).status, 200);
  const tRuim = await nath.post('/api/gestao/ia/chaves/' + ruim + '/testar', {});
  assert.equal(tRuim.json.ok, false); assert.doesNotMatch(JSON.stringify(tRuim.json), /sk-RUIM/);
  const resp = await providers.PROVEDORES.kimi.chamar({ sistema: 's', usuario: 'u' });
  assert.equal(resp, 'OK', 'a segunda chave respondeu quando a primeira falhou');
  const lst = (await nath.get('/api/gestao/ia')).json.chaves;
  assert.equal(lst.find((c) => c.chave_id === ruim).falhasMes >= 2, true);
  // suspender e apagar
  assert.equal((await nath.put('/api/gestao/ia/chaves/' + ruim, { ativa: false })).status, 200);
  assert.equal((await nath.put('/api/gestao/ia/chaves/' + k.chave_id, { ativa: false })).status, 200);
  assert.equal(providers.estado().provedores.find((p) => p.nome === 'kimi').disponivel, false, 'todas suspensas, desligado');
  assert.equal((await nath.post('/api/gestao/ia/chaves/' + k.chave_id + '/testar', {})).status, 200, 'chave suspensa ainda pode ser testada');
  assert.equal((await nath.del('/api/gestao/ia/chaves/' + ruim)).status, 200);
  assert.equal((await nath.del('/api/gestao/ia/chaves/' + k.chave_id)).status, 200);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM ia_chaves').n, 0);
  assert.equal((await nath.del('/api/gestao/ia/chaves/9999')).status, 404);
  assert.equal((await cleuton.get('/api/gestao/ia')).status, 403);
  assert.equal((await admin.get('/api/gestao/ia')).status, 200, 'o administrador também gerencia o rack');
});

test('IA em fase de teste: sem CTAI_EXIGIR_JURIDICO a chave de nuvem liga sem a aprovação do jurídico', async () => {
  const antes = process.env.CTAI_EXIGIR_JURIDICO; delete process.env.CTAI_EXIGIR_JURIDICO;
  try {
    assert.equal((await nath.get('/api/gestao/ia')).json.exigirJuridico, false);
    const r = await nath.post('/api/gestao/ia/chaves', { provedor: 'deepseek', chave: 'sk-teste-sem-juridico-1111', url: urlFalso });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const providers = require('../modules/analista/providers');
    assert.equal(providers.estado().provedores.find((p) => p.nome === 'deepseek').disponivel, true, 'liberado para o Analista sem a trava');
    assert.equal((await nath.del('/api/gestao/ia/chaves/' + r.json.chave_id)).status, 200);
  } finally { process.env.CTAI_EXIGIR_JURIDICO = antes; }
});

test('IA: sem CTAI_SEGREDO não guarda chave', async () => {
  const antes = process.env.CTAI_SEGREDO; delete process.env.CTAI_SEGREDO;
  try {
    const r = await nath.post('/api/gestao/ia/chaves', { provedor: 'groq', chave: 'chave-qualquer-1234', juridico: true });
    assert.equal(r.status, 400); assert.match(r.json.erro, /CTAI_SEGREDO/);
  } finally { process.env.CTAI_SEGREDO = antes; }
});

test('produção e painel: números vêm das ações registradas; filtros e PDF', async () => {
  // Atividade: gestor envia, cleuton lê o texto (achado), encaminha à unidade.
  const comps = (await gestor.get('/api/unidade/competencias')).json.competencias;
  const cid06 = comps.find((c) => c.competencia_id === '2026-06').cid;
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', {})).status, 200);
  await nath.put('/api/gestao/carteira/' + (await nath.get('/api/gestao/carteira')).json.funcionarios.find((f) => f.login === 'cleuton').usuario_id, { unidades: [DEMO, OLINDA] });
  const a = await cleuton.post('/api/analista/analisar', { cid: cid06, salvar: true, texto: 'O valor foi R$ 1.000,00 (dois mil reais). Foram 63 de 100 (70%) casos.' });
  assert.equal(a.status, 200);
  const achadoId = (await cleuton.get('/api/analista/achados?cid=' + cid06)).json.achados[0].achado_id;
  assert.equal((await cleuton.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: 'Explique, por favor.', setor: 'assistencia' })).status, 200);

  const p = (await nath.get('/api/gestao/producao')).json;
  const eu = p.funcionarios.find((f) => f.login === 'cleuton');
  assert.equal(eu.achados.encaminhados, 1);
  assert.ok(eu.acoes_registradas >= 1);
  assert.ok(eu.carga.unidades === 2 && eu.carga.achados_abertos >= 1);
  assert.match(p.nota, /Não há monitoramento/);
  assert.equal(p.totais.achados_encaminhados, 1);
  // filtros: outro período e outra unidade não contam
  assert.equal((await nath.get('/api/gestao/producao?trimestre=2020-T1')).json.totais.achados_encaminhados, 0);
  assert.equal((await nath.get('/api/gestao/producao?contrato=' + OLINDA)).json.totais.achados_encaminhados, 0);
  assert.equal((await nath.get('/api/gestao/producao?contrato=' + DEMO)).json.totais.achados_encaminhados, 1);
  assert.equal((await nath.get('/api/gestao/producao?trimestre=xx')).status, 400);
  assert.equal((await nath.get('/api/gestao/producao?usuario_id=' + eu.usuario_id)).json.funcionarios.length, 1);

  const pn = (await nath.get('/api/gestao/painel?trimestre=2026-T2')).json;
  assert.equal(pn.trimestre, '2026-T2'); assert.equal(pn.trimestre_anterior, '2026-T1');
  const un = pn.unidades.find((u) => u.contrato_id === DEMO);
  assert.ok(un.competencias.length >= 1);
  const k = un.competencias.find((x) => x.competencia_id === '2026-06');
  assert.ok(k.prazos.sei.prazo === '2026-07-20' && k.prazos.simas.prazo === '2026-07-25');
  assert.ok(['recebido', 'incompleto', 'pendente'].includes(k.envio.estado));
  assert.ok(un.achados.abertos >= 1);
  assert.ok(pn.cartoes.prazos.vencido >= 1, 'prazos vencidos aparecem (hoje é depois de julho)');
  assert.ok(pn.alertas.some((x) => x.tipo === 'prazo vencido'));
  assert.ok(Array.isArray(pn.recorrentes));
  assert.equal((await nath.get('/api/gestao/painel?trimestre=abc')).status, 400);
  const so = (await nath.get('/api/gestao/painel?trimestre=2026-T2&contrato=' + OLINDA)).json;
  assert.deepEqual(so.unidades.map((u) => u.contrato_id), [OLINDA]);
  const porFunc = (await nath.get('/api/gestao/painel?trimestre=2026-T2&usuario_id=' + eu.usuario_id)).json;
  assert.equal(porFunc.unidades.length, 2);
  const pdf = await nath.get('/api/gestao/painel/pdf?trimestre=2026-T2');
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/); assert.equal(pdf.buffer.slice(0, 4).toString(), '%PDF');
  assert.equal((await colega1.get('/api/gestao/painel/pdf')).status, 403);
  assert.equal((await nath.get('/api/ctai/trilha/verificar')).json.ok, true, 'trilha íntegra depois de tudo');
});

test('produção: conferências, minutas e tempo entre recebimento e conferência concluída', async () => {
  const ids = [colega1, colega2].map((_, i) => S.db.get('SELECT usuario_id FROM usuarios WHERE login = ?', 'colega' + (i + 1)).usuario_id);
  const c = await cleuton.post('/api/ctai/pareceres', { contrato_id: DEMO, trimestre: '2026-T2', competencias: ['2026-06'], numero_parecer: '9/2026' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const pid = c.json.parecer_id;
  const f = await cleuton.post('/api/ctai/pareceres/' + pid + '/congelar', { convocados: ids });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  const vid = f.json.versao_id;
  const itens = (await nath.get('/api/meta')).json.itensMesa.map((i) => i.id || i.item_id || i);
  for (const it of itens) { await colega1.post('/api/ctai/versoes/' + vid + '/conferir', { item: it, status: 'ok' }); await colega2.post('/api/ctai/versoes/' + vid + '/conferir', { item: it, status: 'ok' }); }
  for (const it of itens) await nath.post('/api/ctai/versoes/' + vid + '/conferir', { item: it, status: 'ok' });
  const aut = await nath.post('/api/ctai/versoes/' + vid + '/autorizar');
  assert.equal(aut.status, 200, JSON.stringify(aut.json));
  const tudo = (await nath.get('/api/gestao/producao')).json;
  const cl = tudo.funcionarios.find((x) => x.login === 'cleuton');
  assert.equal(cl.minutas.criadas, 1); assert.equal(cl.minutas.congeladas, 1);
  assert.ok(cl.tempo_medio && cl.tempo_medio.amostra === 1, 'tempo entre recebimento e autorização');
  const c1 = tudo.funcionarios.find((x) => x.login === 'colega1');
  assert.equal(c1.itens_conferidos, itens.length);
  assert.equal(tudo.funcionarios.find((x) => x.login === 'colega2').itens_conferidos, itens.length);
  assert.equal(tudo.funcionarios.find((x) => x.login === 'nathalia').itens_conferidos, itens.length, 'a superintendente também confere antes de autorizar');
  assert.equal(c1.carga.minutas_abertas, 0);
  const pn = (await nath.get('/api/gestao/painel?trimestre=2026-T2&contrato=' + DEMO)).json.unidades[0];
  assert.ok(pn.parecer.congelado); assert.equal(pn.fase, 'Autorizado (aguarda o SEI)');
  assert.ok((await nath.get('/api/gestao/painel?trimestre=2026-T2')).json.cartoes.pareceres_congelados >= 1);
});
