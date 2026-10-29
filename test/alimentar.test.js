'use strict';
// "Alimentar o Analista": trava só de quem tem carteira e nenhum histórico confirmado; fila com leitura, máscara, identificação; revisão em lote; liberação.
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
let S, a, adm, sup;
test.before(async () => {
  S = await iniciar(); a = cliente(S.base); adm = cliente(S.base); sup = cliente(S.base);
  await a.entrar('cleuton'); await adm.entrar('admin'); await sup.entrar('nathalia');
});
test.after(async () => { await S.fechar(); });

const texto = (extra) => 'Parecer da UPA Demonstração, 2026-T2. Nota total do trimestre: 88 pontos. Paciente: Maria da Silva Souza, CPF 123.456.789-09, telefone (81) 99876-5432 reclamou da demora. ' + (extra || '') + ' Texto de enchimento para passar do mínimo de caracteres legíveis do arquivo. '.repeat(2);
const espera = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('tempo esgotado'); await new Promise((r) => setTimeout(r, 80)); } };

test('sem carteira ou com perfil de administração não há trava', async () => {
  assert.equal((await a.get('/api/alimentar/estado')).json.trava, false, 'criador sem carteira ainda vê tudo');
  assert.equal((await adm.get('/api/alimentar/estado')).json.trava, false);
  assert.equal((await sup.get('/api/alimentar/estado')).json.trava, false);
});

test('com carteira e sem histórico confirmado, trava; lê, mascara, identifica e monta o rascunho', async () => {
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', cle.usuario_id, ['DEMO-UPA'], 'teste');
  const e0 = (await a.get('/api/alimentar/estado')).json;
  assert.equal(e0.trava, true); assert.equal(e0.ia.pronta, false);
  const r = await a.upload('/api/alimentar/arquivo', 'parecer-demo-2026-T2.txt', Buffer.from(texto()));
  assert.equal(r.status, 200); assert.equal(r.json.ids.length, 1);
  const e = await espera(async () => { const x = (await a.get('/api/alimentar/estado')).json; return x.resumo.pendentes === 0 ? x : null; });
  const it = e.itens[0];
  assert.equal(it.estado, 'pronto', JSON.stringify(it));
  assert.equal(it.trimestre, '2026-T2'); assert.equal(it.contrato_id, 'DEMO-UPA');
  assert.ok(it.mascarados.CPF >= 1 && it.mascarados.telefone >= 1 && it.mascarados.nome >= 1);
  assert.ok(it.divergencias.some((d) => /IA não leu/.test(d)), 'sem IA, avisa que é para preencher à mão');
  // o texto guardado no rascunho já está mascarado; nada do original no banco
  const guardado = S.db.get('SELECT texto FROM hist_relatorios WHERE hist_id = ?', it.hist_id).texto;
  assert.ok(!/123\.456|99876|Maria da Silva/.test(guardado), guardado);
  assert.ok(!JSON.stringify(S.db.all('SELECT * FROM trilha_auditoria WHERE tabela = ?', 'hist_relatorios')).match(/123\.456|Maria da Silva/), 'trilha só tem contagens');
  assert.equal(S.db.get('SELECT texto FROM alimentar_fila WHERE id = ?', it.id).texto, null);
});

test('mesmo arquivo de novo vira duplicado; ZIP vira vários; tipo não aceito vira problema', async () => {
  await a.upload('/api/alimentar/arquivo', 'parecer-demo-2026-T2.txt', Buffer.from(texto()));
  const z = new JSZip();
  z.file('relatorio-2026-T3.txt', texto('Terceiro trimestre diferente 2026-T3.').replace('2026-T2', '2026-T3'));
  z.file('lixo.exe', 'x'); z.file('__MACOSX/._x.txt', 'x');
  const zr = await a.upload('/api/alimentar/arquivo', 'tudo.zip', await z.generateAsync({ type: 'nodebuffer' }));
  assert.equal(zr.json.ids.length, 2);
  const e = await espera(async () => { const x = (await a.get('/api/alimentar/estado')).json; return x.resumo.pendentes === 0 ? x : null; });
  const por = (n) => e.itens.filter((i) => i.nome === n);
  assert.ok(por('parecer-demo-2026-T2.txt').some((i) => i.estado === 'duplicado'));
  assert.equal(por('relatorio-2026-T3.txt')[0].trimestre, '2026-T3');
  assert.equal(por('lixo.exe')[0].estado, 'problema');
  assert.ok(e.resumo.problemas >= 1);
});

test('arquivo sem nenhuma pista de período assume o trimestre em fechamento, avisa para conferir e vira rascunho', async () => {
  await a.upload('/api/alimentar/arquivo', 'sem-data.txt', Buffer.from('Relatório sem indicação de período algum, apenas texto de enchimento para passar do mínimo de caracteres legíveis do arquivo da unidade. '.repeat(2)));
  const e = await espera(async () => { const x = (await a.get('/api/alimentar/estado')).json; return x.resumo.pendentes === 0 ? x : null; });
  const it = e.itens.find((i) => i.nome === 'sem-data.txt');
  assert.equal(it.estado, 'pronto');
  assert.match(it.trimestre, /^20\d\d-T[1-4]$/);
});

test('aprovar em bloco confirma; só o confirmado destrava; pular problemas e liberar', async () => {
  const e = (await a.get('/api/alimentar/estado')).json;
  const prontos = e.itens.filter((i) => i.estado === 'pronto').map((i) => i.id);
  assert.ok(prontos.length >= 2);
  const vazio = await a.post('/api/alimentar/aprovar', { ids: prontos });
  assert.equal(vazio.json.aprovados, 0, 'rascunho em branco não é aprovado');
  for (const i of e.itens.filter((x) => x.estado === 'pronto')) {
    const r = await a.put('/api/historico/relatorios/' + i.hist_id, { igq: 88, indicadores: [], achados: [], recomendacoes: [] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const ap = await a.post('/api/alimentar/aprovar', { ids: prontos });
  assert.equal(ap.json.aprovados, prontos.length, JSON.stringify(ap.json));
  const e2 = (await a.get('/api/alimentar/estado')).json;
  assert.equal(e2.trava, false, 'com histórico confirmado, não trava mais');
  assert.equal((await a.post('/api/alimentar/pular-problemas')).status, 200);
  const alheio = cliente(S.base); await alheio.entrar('colega1');
  assert.equal((await alheio.post('/api/alimentar/' + prontos[0] + '/identificar', { contrato_id: 'DEMO-UPA', trimestre: '2026-T1' })).status, 404, 'um não mexe na fila do outro');
});

test('administração libera uma pessoa sem esperar; quem não é admin não consegue', async () => {
  const col = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega2'");
  CART.definir(S.db, 'admin', col.usuario_id, ['UPA-OLINDA'], 'teste');
  const c2 = cliente(S.base); await c2.entrar('colega2');
  assert.equal((await c2.get('/api/alimentar/estado')).json.trava, true);
  assert.equal((await c2.post('/api/alimentar/liberar-usuario', { login: 'colega2' })).status, 403);
  assert.equal((await adm.post('/api/alimentar/liberar-usuario', { login: 'colega2', motivo: 'teste' })).status, 200);
  assert.equal((await c2.get('/api/alimentar/estado')).json.trava, false);
});

test('trimestre deduzido do mês dito no texto, sem pedir ao usuário', () => {
  const AL = require('../server/alimentar');
  assert.equal(typeof AL.resolverTrimestre, 'function');
  const r = AL.resolverTrimestre(null, { nome: '[13]-95748824_Anexo.pdf' }, 'HOSPITAL REGIONAL EMILIA CAMARA julho/2026 SADT Procedimento', { zip: null, tri: null });
  assert.equal(r.tri, '2026-T3'); assert.match(r.aviso, /Julho\/2026|julho/i);
  assert.equal(AL.resolverTrimestre(null, { nome: 'x_2026-T2.pdf' }, '', {}).aviso, null);
  assert.equal(AL.resolverTrimestre(null, { nome: 'Anexo.pdf' }, 'sem pistas', { tri: '2026-T3' }).tri, '2026-T3');
});

test('reavaliar: arquivo que esperava a pessoa é refeito com o texto guardado, sem novo envio', async () => {
  const uid = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'").usuario_id;
  const texto = 'Relatório de produção referente a julho/2026 da unidade, com texto de enchimento suficiente para passar do mínimo de caracteres legíveis do arquivo. '.repeat(3);
  const id = Number(S.db.run("INSERT INTO alimentar_fila (usuario_id, lote, nome, tamanho, estado, texto, caracteres, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)", uid, null, 'preso.txt', texto.length, 'precisa_dados', texto, texto.length, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
  const r = await a.post('/api/alimentar/reavaliar', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.reavaliados >= 1);
  const depois = S.db.get('SELECT estado, trimestre FROM alimentar_fila WHERE id = ?', id);
  assert.notEqual(depois.estado, 'precisa_dados', JSON.stringify(depois));
  assert.equal(depois.trimestre, '2026-T3');
});
