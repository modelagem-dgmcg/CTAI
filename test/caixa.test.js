'use strict';
// Caixa de entrada da CTAI, substituições, minhas unidades e entregas por carteira (dados fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const CX = require('../server/caixa');

const OLINDA = 'UPA-OLINDA', DEMO = 'DEMO-UPA';
let S, nath, admin, cleuton, colega1, colega2, gestor, ids, cid;
const uid = (login) => S.db.get('SELECT usuario_id FROM usuarios WHERE login = ?', login).usuario_id;
const itens = async (c, q) => (await c.get('/api/caixa' + (q || ''))).json;

test.before(async () => {
  S = await iniciar();
  nath = cliente(S.base); admin = cliente(S.base); cleuton = cliente(S.base); colega1 = cliente(S.base); colega2 = cliente(S.base); gestor = cliente(S.base);
  for (const [c, l] of [[nath, 'nathalia'], [admin, 'admin'], [cleuton, 'cleuton'], [colega1, 'colega1'], [colega2, 'colega2'], [gestor, 'gestor.demo']]) await c.entrar(l);
  ids = { cleuton: uid('cleuton'), colega1: uid('colega1'), colega2: uid('colega2'), nath: uid('nathalia') };
  // carteira: cleuton e colega1 dividem a DEMO; colega2 fica com a UPA Olinda
  await nath.put('/api/gestao/carteira/' + ids.cleuton, { unidades: [DEMO] });
  await nath.put('/api/gestao/carteira/' + ids.colega1, { unidades: [DEMO] });
  await nath.put('/api/gestao/carteira/' + ids.colega2, { unidades: [OLINDA] });
  cid = (await gestor.get('/api/unidade/competencias')).json.competencias.find((c) => c.competencia_id === '2026-06').cid;
});
test.after(async () => { await S.fechar(); });

test('só a CTAI tem caixa; a unidade não', async () => {
  assert.equal((await gestor.get('/api/caixa')).status, 403);
  assert.equal((await cliente(S.base).get('/api/caixa')).status, 401);
});

test('envio recebido cai na caixa de todos os co-responsáveis, não na de quem tem outra carteira; textos sem dado sensível', async () => {
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid + '/enviar', {})).status, 200);
  const a = await itens(cleuton), b = await itens(colega1), c = await itens(colega2);
  const ev = (l) => l.itens.filter((i) => i.tipo === 'envio' && i.contrato_id === DEMO);
  assert.equal(ev(a).length, 1); assert.equal(ev(b).length, 1); assert.equal(ev(c).length, 0, 'colega2 só tem a Olinda');
  const it = ev(a)[0];
  assert.equal(it.link, '#/c/' + cid); assert.equal(it.competencia_id, '2026-06'); assert.equal(it.lido, false); assert.equal(it.tratado, false);
  assert.ok(a.contagem.naoLidos >= 1);
  assert.doesNotMatch(JSON.stringify(it), /R\$|CPF|@/);
});

test('ler é por pessoa; tratar vale para todos, guarda quem e quando; o segundo recebe aviso; reabrir mantém o histórico', async () => {
  const id = (await itens(cleuton)).itens.find((i) => i.tipo === 'envio').item_id;
  assert.equal((await cleuton.post('/api/caixa/' + id + '/lido')).status, 200);
  assert.equal((await itens(cleuton)).itens.find((i) => i.item_id === id).lido, true);
  assert.equal((await itens(colega1)).itens.find((i) => i.item_id === id).lido, false, 'leitura é individual');
  assert.equal((await cleuton.post('/api/caixa/' + id + '/tratar', { obs: 'Conferido' })).status, 200);
  const dep = (await itens(colega1)).itens.find((i) => i.item_id === id);
  assert.equal(dep.tratado, true); assert.ok(dep.tratado_por && dep.tratado_em);
  assert.equal((await colega1.post('/api/caixa/' + id + '/tratar', {})).status, 409, 'já tratado');
  assert.equal((await colega1.post('/api/caixa/' + id + '/reabrir', { motivo: 'Faltou conferir' })).status, 200);
  assert.equal((await itens(cleuton)).itens.find((i) => i.item_id === id).tratado, false);
  const det = (await cleuton.get('/api/caixa/' + id)).json;
  assert.deepEqual(det.historico.map((h) => h.acao).filter((a) => a !== 'lido'), ['criado', 'tratado', 'reaberto']);
  assert.equal((await colega2.get('/api/caixa/' + id)).status, 404, 'fora da carteira não vê nem pelo endereço');
  assert.equal((await colega2.post('/api/caixa/' + id + '/tratar', {})).status, 404);
  const ev = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela = 'caixa' AND registro = ?", String(id)).map((x) => x.campo);
  assert.ok(['item_criado', 'lido', 'tratado', 'reaberto'].every((c) => ev.includes(c)));
});

test('filtros por unidade, tipo e situação; ordenação por urgência', async () => {
  CX.sincronizar(S.db, { forcar: true });
  const todos = await itens(nath);
  const venc = (await itens(cleuton, '?tipo=prazo_vencido')).itens;
  assert.ok(venc.length >= 1 && venc.every((i) => i.contrato_id === DEMO && /Prazo vencido/.test(i.titulo)), 'prazo vencido da DEMO chega aos co-responsáveis');
  assert.ok(venc[0].urgencia > (await itens(cleuton, '?tipo=envio')).itens[0].urgencia);
  const l = await itens(cleuton);
  const pend = l.itens.filter((i) => !i.tratado);
  for (let i = 1; i < pend.length; i++) assert.ok(pend[i - 1].urgencia >= pend[i].urgencia);
  assert.equal((await itens(cleuton, '?tipo=envio')).itens.every((i) => i.tipo === 'envio'), true);
  assert.equal((await itens(cleuton, '?unidade=' + OLINDA)).itens.length, 0);
  assert.ok((await itens(cleuton, '?situacao=pendentes')).itens.every((i) => !i.tratado));
  assert.ok((await itens(cleuton, '?situacao=tratados')).itens.every((i) => i.tratado));
});

test('unidade sem carteira e sem gestor: só a superintendente recebe o aviso de sem carteira', async () => {
  const IMP = '/api/gestao/carteira/importar/gravar';
  assert.equal((await nath.post(IMP, { csv: 'tipo;unidade;municipio;analista\nUPA;Exemplo Solta;Cidade Solta;' })).status, 200);
  CX.sincronizar(S.db, { forcar: true });
  const sn = await itens(nath);
  assert.ok(sn.itens.some((i) => i.tipo === 'sem_carteira' && /Exemplo Solta/.test(i.unidade)));
  assert.ok(sn.itens.some((i) => i.tipo === 'sem_gestor' && /Exemplo Solta/.test(i.unidade)));
  for (const c of [cleuton, colega2]) assert.ok(!(await itens(c)).itens.some((i) => /Exemplo Solta/.test(i.unidade || '')));
  // distribuindo a carteira, o aviso some (tratado pelo sistema)
  await nath.put('/api/gestao/carteira/' + ids.colega2, { unidades: [OLINDA, 'UPA-EXEMPLO-SOLTA-CIDADE-SOLTA'] });
  CX.sincronizar(S.db, { forcar: true });
  assert.equal((await itens(nath)).itens.find((i) => i.tipo === 'sem_carteira' && /Exemplo Solta/.test(i.unidade)).tratado_por, 'sistema');
});

test('resposta da unidade a achado chega à caixa; minuta aguardando conferência chega aos convocados', async () => {
  await cleuton.post('/api/analista/analisar', { cid, salvar: true, texto: 'O valor foi R$ 1.000,00 (dois mil reais). Foram 63 de 100 (70%) casos.' });
  const achadoId = (await cleuton.get('/api/analista/achados?cid=' + cid)).json.achados[0].achado_id;
  await cleuton.post('/api/analista/achados/' + achadoId + '/encaminhar', { mensagem: 'Explique.', setor: 'assistencia' });
  const ass = cliente(S.base); await ass.entrar('assistencia.demo');
  const r = await ass.post('/api/unidade/achados/' + achadoId + '/responder', { resposta: 'Texto interno da resposta' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const it = (await itens(colega1)).itens.find((i) => i.tipo === 'resposta');
  assert.ok(it); assert.doesNotMatch(JSON.stringify(it), /Texto interno/, 'o conteúdo da resposta não vai para a caixa');
  assert.equal(it.link, '#/c/' + cid + '/achados');
  // minuta congelada: aviso só para os convocados
  CX.eventoMinuta(S.db, { contrato_id: DEMO, trimestre: '2026-T2' }, 777, 1, [ids.colega1]);
  const mn = (await itens(colega1)).itens.find((i) => i.tipo === 'minuta');
  assert.ok(mn); assert.equal(mn.link, '#/v/777'); assert.ok(!(await itens(cleuton)).itens.some((i) => i.tipo === 'minuta'));
});

test('substituição: itens novos vão ao substituto marcados "em substituição de"; validações; trilha; fim do período', async () => {
  const hoje = require('../server/prazos').dataLocal();
  const amanha = new Date(Date.now() + 864e5).toISOString().slice(0, 10), ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  // colega2 sai de licença: caixa vai para cleuton (que não tem a Olinda)
  assert.equal((await colega1.post('/api/caixa/substituicoes', { de_usuario_id: ids.colega2, para_usuario_id: ids.cleuton, desde: hoje, ate: amanha })).status, 403, 'colega não redireciona a caixa de outra pessoa');
  assert.equal((await nath.post('/api/caixa/substituicoes', { de_usuario_id: ids.colega2, para_usuario_id: ids.colega2, desde: hoje, ate: amanha })).status, 400);
  assert.equal((await nath.post('/api/caixa/substituicoes', { de_usuario_id: ids.colega2, para_usuario_id: ids.cleuton, desde: amanha, ate: hoje })).status, 400);
  assert.equal((await nath.post('/api/caixa/substituicoes', { de_usuario_id: ids.colega2, para_usuario_id: ids.cleuton, desde: ontem, ate: ontem })).status, 400, 'período já terminou');
  const ok = await nath.post('/api/caixa/substituicoes', { de_usuario_id: ids.colega2, para_usuario_id: ids.cleuton, desde: hoje, ate: amanha, motivo: 'Licença' });
  assert.equal(ok.status, 200);
  assert.equal((await nath.post('/api/caixa/substituicoes', { de_usuario_id: ids.colega2, para_usuario_id: ids.colega1, desde: hoje, ate: amanha })).status, 409, 'sobreposição');
  assert.ok((await itens(cleuton)).itens.some((i) => i.tipo === 'redirecionado' && /redirecionada para você/.test(i.titulo)));
  // evento novo na unidade da colega2 (Olinda)
  S.db.run("INSERT OR IGNORE INTO competencias (contrato_id, competencia_id, status) VALUES ('UPA-OLINDA','2026-06','aberta')");
  const cOl = S.db.get("SELECT cid FROM competencias WHERE contrato_id = 'UPA-OLINDA' AND competencia_id = '2026-06'").cid;
  const antes = S.db.get('SELECT COUNT(*) AS n FROM caixa_itens').n;
  CX.eventoResposta(S.db, { achado_id: 9001, cid: cOl, respondido_em: new Date().toISOString() });
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM caixa_itens').n, antes + 1);
  const com = (await itens(cleuton)).itens.find((i) => i.tipo === 'resposta' && i.contrato_id === OLINDA);
  assert.ok(com, 'substituto recebe'); assert.equal(com.em_substituicao_de, 'Colega conferente 2');
  assert.ok(!(await itens(colega2)).itens.some((i) => i.contrato_id === OLINDA && i.tipo === 'resposta' && i.item_id === com.item_id), 'o ausente não recebe durante o período');
  // o substituto abre a unidade (acesso temporário), mas só durante o período
  assert.equal((await cleuton.get('/api/ctai/contratos/' + OLINDA + '/decisoes')).status, 200);
  const sub = (await nath.get('/api/caixa/substituicoes')).json.substituicoes.find((s) => s.de_login === 'colega2');
  assert.equal(sub.situacao, 'em vigor');
  assert.equal((await cleuton.del('/api/caixa/substituicoes/' + sub.subst_id)).status, 403, 'só o dono da caixa ou a superintendência cancela');
  assert.equal((await nath.del('/api/caixa/substituicoes/' + sub.subst_id)).status, 200);
  assert.equal((await cleuton.get('/api/ctai/contratos/' + OLINDA + '/decisoes')).status, 403, 'acabou o período: sem acesso');
  CX.eventoResposta(S.db, { achado_id: 9002, cid: cOl, respondido_em: new Date().toISOString() });
  assert.ok((await itens(colega2)).itens.some((i) => i.contrato_id === OLINDA && i.tipo === 'resposta'), 'volta para quem é dono');
  const tr = S.db.all("SELECT campo FROM trilha_auditoria WHERE tabela = 'caixa_substituicoes'").map((x) => x.campo);
  assert.deepEqual(tr, ['criada', 'cancelada']);
  // o próprio analista redireciona a própria caixa
  assert.equal((await colega1.post('/api/caixa/substituicoes', { para_usuario_id: ids.cleuton, desde: hoje, ate: amanha })).status, 200);
});

test('redirecionar um item a outra pessoa exige a unidade na carteira dela', async () => {
  const it = (await itens(colega2)).itens.find((i) => i.tipo === 'resposta' && i.contrato_id === OLINDA);
  assert.equal((await colega2.post('/api/caixa/' + it.item_id + '/redirecionar', { para_usuario_id: ids.colega1 })).status, 400, 'colega1 não tem a Olinda');
  await nath.put('/api/gestao/carteira/' + ids.colega1, { unidades: [DEMO, OLINDA] });
  assert.equal((await colega2.post('/api/caixa/' + it.item_id + '/redirecionar', { para_usuario_id: ids.colega1, motivo: 'Apoio' })).status, 200);
  assert.ok((await itens(colega1)).itens.some((i) => i.tipo === 'redirecionado' && i.contrato_id === OLINDA));
  assert.ok((await itens(colega1)).itens.some((i) => i.item_id === it.item_id));
});

test('minhas unidades respeita a carteira', async () => {
  const m = (await colega2.get('/api/caixa/minhas-unidades')).json;
  assert.ok(m.unidades.every((u) => [OLINDA, 'UPA-EXEMPLO-SOLTA-CIDADE-SOLTA'].includes(u.contrato_id)));
  assert.ok(m.unidades.find((u) => u.contrato_id === OLINDA).fase);
  const t = (await nath.get('/api/caixa/minhas-unidades')).json; assert.equal(t.todas, true);
});

test('Gestão CTAI: entregas por carteira (lido, tratado, pendente), destaque de não lidos, sem responsável, PDF, config e produção', async () => {
  const e = (await nath.get('/api/gestao/entregas')).json;
  assert.equal(e.dias_nao_lido, 3);
  const c1 = e.analistas.find((a) => a.login === 'colega1');
  const ent = c1.unidades.find((u) => u.contrato_id === DEMO).entregas[0];
  assert.equal(ent.competencia_id, '2026-06'); assert.ok(ent.recebido_em); assert.equal(ent.caixa.length, 2);
  // envelhece o envio para destacar "não lido há mais de N dias"
  const velho = new Date(Date.now() - 5 * 864e5).toISOString();
  S.db.run('UPDATE envios SET recebido_em = ? WHERE envio_id = ?', velho, ent.envio_id);
  S.db.run("UPDATE caixa_destinos SET lido_em = NULL WHERE item_id = (SELECT item_id FROM caixa_itens WHERE chave = ?)", 'envio:' + ent.envio_id);
  S.db.run("UPDATE caixa_itens SET tratado_por = NULL, tratado_em = NULL WHERE chave = ?", 'envio:' + ent.envio_id);
  const e2 = (await nath.get('/api/gestao/entregas')).json;
  const x = e2.analistas.find((a) => a.login === 'colega1').unidades.find((u) => u.contrato_id === DEMO).entregas.find((y) => y.envio_id === ent.envio_id);
  assert.equal(x.destaque, true); assert.ok(x.pendente_dias >= 5); assert.ok(e2.total.destacadas >= 1);
  assert.equal((await nath.put('/api/gestao/caixa-config', { dias_nao_lido: 10 })).status, 200);
  assert.equal((await nath.get('/api/gestao/entregas')).json.analistas.find((a) => a.login === 'colega1').unidades.find((u) => u.contrato_id === DEMO).entregas.find((y) => y.envio_id === ent.envio_id).destaque, false);
  assert.equal((await nath.put('/api/gestao/caixa-config', { dias_nao_lido: 0 })).status, 400);
  assert.equal((await cleuton.get('/api/gestao/entregas')).status, 403);
  assert.ok(Array.isArray(e2.sem_responsavel));
  const pdf = await nath.get('/api/gestao/entregas.pdf'); assert.equal(pdf.status, 200); assert.equal(pdf.buffer.slice(0, 4).toString(), '%PDF');
  // leitura e tratamento medidos na Produção
  const it = S.db.get("SELECT item_id FROM caixa_itens WHERE chave = ?", 'envio:' + ent.envio_id).item_id;
  await colega1.post('/api/caixa/' + it + '/lido'); await colega1.post('/api/caixa/' + it + '/tratar', {});
  const p = (await nath.get('/api/gestao/producao')).json.funcionarios.find((f) => f.login === 'colega1');
  assert.ok(p.caixa.lidos >= 1 && p.caixa.horas_ate_leitura !== null && p.caixa.tratados_por_mim >= 1 && p.caixa.horas_ate_tratamento !== null);
});

test('ponto de extensão do aviso por e-mail existe e não envia nada', () => {
  assert.equal(CX.avisos.aoCriar, null);
  let chamado = 0; CX.avisos.aoCriar = () => { chamado++; };
  CX.eventoResposta(S.db, { achado_id: 9100, cid: S.db.get("SELECT cid FROM competencias WHERE contrato_id = 'UPA-OLINDA' LIMIT 1").cid, respondido_em: new Date().toISOString() });
  CX.avisos.aoCriar = null; assert.equal(chamado, 1);
});
