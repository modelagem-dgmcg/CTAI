'use strict';
// Lista oficial de obrigatórios da UPA: prazos (SEI dia 20, SIMAS dia 25), checklist de recebimento e os dois campos novos (2.10 e 2.13).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../core/prazos');
const O = require('../core/obrigatorios');
const { iniciar, cliente } = require('./helpers');

test('prazos: dia 20 (SEI) e dia 25 (SIMAS) do mês seguinte, inclusive na virada do ano', () => {
  assert.deepEqual(P.prazosDaCompetencia('2026-06'), { sei: '2026-07-20', simas: '2026-07-25' });
  assert.deepEqual(P.prazosDaCompetencia('2026-12'), { sei: '2027-01-20', simas: '2027-01-25' });
  assert.equal(P.prazosDaCompetencia('junho'), null);
});

test('prazos: situações de alerta e de atraso', () => {
  assert.equal(P.avaliar('2026-07-20', null, '2026-07-01').situacao, 'no prazo');
  const aVencer = P.avaliar('2026-07-20', null, '2026-07-18');
  assert.equal(aVencer.situacao, 'a vencer'); assert.equal(aVencer.dias, 2); assert.equal(aVencer.nivel, 'atencao');
  assert.equal(P.avaliar('2026-07-20', null, '2026-07-20').mensagem, 'O prazo termina hoje.');
  const vencido = P.avaliar('2026-07-20', null, '2026-07-25');
  assert.equal(vencido.situacao, 'vencido'); assert.equal(vencido.dias, 5); assert.equal(vencido.nivel, 'alta');
  assert.equal(P.avaliar('2026-07-20', '2026-07-20', '2026-10-01').situacao, 'entregue no prazo');
  const atraso = P.avaliar('2026-07-20', '2026-07-23', '2026-10-01');
  assert.equal(atraso.situacao, 'entregue com atraso'); assert.equal(atraso.dias, 3);
  assert.equal(P.avaliar('2026-03-01', null, '2026-02-27').dias, 2, 'conta dias de calendário também na virada de mês');
});

test('lista de obrigatórios cobre os itens oficiais e mantém transferências e pessoal como complementares', () => {
  const ids = O.ITENS.map((i) => i.id);
  for (const id of ['producao', 'eficiencia', 'retorno', 'seguranca', 'dor_toracica', 'iamcsst', 'ave', 'sepse', 'obitos', 'satisfacao', 'queixas', 'transparencia', 'educ_plano', 'educ_assist', 'educ_adm']) assert.ok(ids.includes(id), id);
  assert.deepEqual(O.ITENS.filter((i) => i.complementar).map((i) => i.id), ['transferencias', 'pessoal']);
  assert.deepEqual(O.STATUS, ['recebido', 'pendente', 'incompleto', 'não aplicável']);
});

let S, gestor, setorQ, cleuton, colega, admin, cid06, envio1;
const agora = new Date().toISOString().slice(0, 10);

test.before(async () => {
  S = await iniciar();
  gestor = cliente(S.base); setorQ = cliente(S.base); cleuton = cliente(S.base); colega = cliente(S.base); admin = cliente(S.base);
  await gestor.entrar('gestor.demo'); await cleuton.entrar('cleuton'); await colega.entrar('colega1'); await admin.entrar('admin');
  cid06 = (await gestor.get('/api/unidade/competencias')).json.competencias.find((c) => c.competencia_id === '2026-06').cid;
});
test.after(async () => { await S.fechar(); });

test('os campos novos existem nas fichas e a unidade é avisada quando faltam', async () => {
  const q = (await gestor.get('/api/unidade/competencias/' + cid06 + '/ficha/qualidade')).json;
  const o = (await gestor.get('/api/unidade/competencias/' + cid06 + '/ficha/ouvidoria')).json;
  const cq = q.campos.find((c) => c.id === 'obitos_relatorio_comissao');
  const co = o.campos.find((c) => c.id === 'transparencia_publicacao');
  assert.ok(cq && /Comissão de Óbitos/.test(cq.rotulo) && cq.indicador === '2.10');
  assert.ok(co && /publicação de transparência/.test(co.rotulo) && co.indicador === '2.13');
  const d = (await gestor.get('/api/unidade/competencias/' + cid06)).json;
  const msgs = d.avisos.map((a) => a.mensagem).join(' | ');
  assert.match(msgs, /Relatório da Comissão de Óbitos/);
  assert.match(msgs, /publicação de transparência/);
  assert.equal(d.bloqueios.length, 0, 'só avisa, não bloqueia o envio');
});

test('prazos aparecem no portal da unidade e o SIMAS é informado pelo gestor, com data válida', async () => {
  const lista = (await gestor.get('/api/unidade/competencias')).json.competencias.find((c) => c.cid === cid06);
  assert.equal(lista.prazos.sei.prazo, '2026-07-20');
  assert.equal(lista.prazos.simas.prazo, '2026-07-25');
  assert.equal(lista.prazos.sei.situacao, 'vencido', 'sem envio e depois do prazo');
  const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid06 + '/simas', { data: amanha })).status, 400, 'data futura');
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid06 + '/simas', { data: '31/07/2026' })).status, 400, 'formato');
  const ok = await gestor.post('/api/unidade/competencias/' + cid06 + '/simas', { data: '2026-07-24' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.prazos.simas.situacao, 'entregue no prazo');
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid06 + '/simas', { data: '2026-07-27' })).status, 400, 'corrigir exige motivo');
  const corr = await gestor.post('/api/unidade/competencias/' + cid06 + '/simas', { data: '2026-07-27', motivo: 'Data conferida no protocolo' });
  assert.equal(corr.json.prazos.simas.situacao, 'entregue com atraso');
  assert.equal(corr.json.prazos.simas.dias, 2);
});

test('envio gera o checklist de recebimento; só a equipe da CTAI edita', async () => {
  const env = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', {});
  assert.equal(env.status, 200, JSON.stringify(env.json));
  envio1 = env.json.envio_id;
  const ck = (await cleuton.get('/api/ctai/competencias/' + cid06 + '/checklist')).json;
  assert.equal(ck.iniciado, true);
  assert.equal(ck.itens.length, O.ITENS.length);
  assert.equal(ck.competencia, '2026-06');
  assert.equal(ck.data_recebimento, agora);
  assert.match(ck.responsavel_envio, /Gestor/);
  assert.ok(ck.itens.every((i) => ['recebido', 'pendente', 'incompleto'].includes(i.status)), 'sistema só sugere os três primeiros');
  const ob = ck.itens.find((i) => i.item_id === 'obitos');
  assert.equal(ob.status, 'incompleto', 'valor informado, mas sem o relatório da comissão');
  assert.match(ob.faltas.join(' '), /sem comprovação/);
  assert.equal((await gestor.get('/api/ctai/competencias/' + cid06 + '/checklist')).status, 403);
  assert.equal((await gestor.put('/api/ctai/competencias/' + cid06 + '/checklist/obitos', { status: 'recebido' })).status, 403);
  const detalhe = (await cleuton.get('/api/ctai/competencias/' + cid06)).json;
  assert.equal(detalhe.checklist.itens.length, O.ITENS.length);
  assert.equal(detalhe.prazos.sei.situacao, 'vencido', 'o número do SEI ainda não foi registrado');
  assert.equal(detalhe.prazos.simas.situacao, 'entregue com atraso');
  // Registrando o número do SEI hoje (depois do dia 20 de julho), o SEI passa a "entregue com atraso".
  const sei = await gestor.post('/api/unidade/envios/' + envio1 + '/sei', { numero: '00123456' });
  assert.equal(sei.status, 200, JSON.stringify(sei.json));
  assert.equal((await cleuton.get('/api/ctai/competencias/' + cid06)).json.prazos.sei.situacao, 'entregue com atraso');
});

test('checklist: validações e decisão manual que o recálculo não sobrescreve', async () => {
  const url = '/api/ctai/competencias/' + cid06 + '/checklist/';
  assert.equal((await cleuton.put(url + 'inexistente', { status: 'recebido' })).status, 404);
  assert.equal((await cleuton.put(url + 'sepse', { status: 'quase' })).status, 400);
  assert.equal((await cleuton.put(url + 'sepse', { status: 'não aplicável' })).status, 400, 'não aplicável exige o motivo');
  assert.equal((await cleuton.put(url + 'sepse', { validacao: 'talvez' })).status, 400);
  assert.equal((await cleuton.put(url + 'sepse', { data_recebimento: '20/10/2026' })).status, 400);
  const ok = await colega.put(url + 'sepse', { status: 'não aplicável', observacao: 'Sem casos de sepse no mês, conforme a unidade.', validacao: 'validado', responsavel: 'Setor de Qualidade', data_recebimento: '2026-10-19' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const it = ok.json.itens.find((i) => i.item_id === 'sepse');
  assert.equal(it.status, 'não aplicável'); assert.equal(it.status_manual, true); assert.equal(it.validacao, 'validado');
  assert.equal(it.responsavel, 'Setor de Qualidade'); assert.equal(it.data_recebimento, '2026-10-19'); assert.equal(it.atualizado_por, 'colega1');
  // Nova versão do envio: o item decidido à mão continua como está; o calculado se atualiza.
  const qd = (await gestor.get('/api/unidade/competencias/' + cid06 + '/ficha/qualidade')).json.ficha.dados;
  await gestor.put('/api/unidade/competencias/' + cid06 + '/ficha/qualidade', { dados: Object.assign({}, qd, { obitos_relatorio_comissao: 'SEI 0044556', i2_10_anexo: 'SEI 0044557' }) });
  await gestor.post('/api/unidade/competencias/' + cid06 + '/ficha/qualidade/pronta', {});
  const v2 = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', { motivo: 'Incluído o relatório da Comissão de Óbitos' });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  const ck = (await cleuton.get('/api/ctai/competencias/' + cid06 + '/checklist')).json;
  assert.equal(ck.itens.find((i) => i.item_id === 'obitos').status, 'recebido', 'agora tem valor, anexo e relatório da comissão');
  assert.equal(ck.itens.find((i) => i.item_id === 'sepse').status, 'não aplicável', 'decisão manual preservada');
  assert.equal(ck.versao, 2);
  // Voltar ao cálculo do sistema.
  const volta = (await cleuton.post(url + 'sepse/restaurar', {})).json.itens.find((i) => i.item_id === 'sepse');
  assert.equal(volta.status_manual, false);
  assert.notEqual(volta.status, 'não aplicável');
});

test('trilha registra cada alteração do checklist e do SIMAS', async () => {
  const t = (await admin.get('/api/ctai/trilha?tabela=checklist_itens&limite=200')).json.eventos;
  assert.ok(t.some((e) => e.campo === 'status' && e.usuario === 'colega1' && /sepse/.test(e.registro)));
  const s = (await admin.get('/api/ctai/trilha?tabela=competencias&limite=200')).json.eventos;
  assert.ok(s.some((e) => e.campo === 'simas_enviado_em'));
  const v = (await admin.get('/api/ctai/trilha/verificar')).json;
  assert.ok(v.ok === true || v.integra === true || v.integro === true, JSON.stringify(v));
});

test('painel da CTAI mostra os prazos e a minuta congelada leva o checklist e os prazos', async () => {
  const painel = (await cleuton.get('/api/ctai/contratos')).json.contratos.find((c) => c.contrato_id === 'DEMO-UPA');
  const k = painel.competencias.find((x) => x.cid === cid06);
  assert.ok(k.prazos && k.prazos.texto && ['alta', 'atencao', 'info', 'ok'].includes(k.prazos.nivel));
  const r = await cleuton.post('/api/analista/relatorio-trimestral', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const col = S.db.get("SELECT usuario_id FROM usuarios WHERE login='colega1'").usuario_id;
  const f = await cleuton.post('/api/ctai/pareceres/' + r.json.parecer_id + '/congelar', { convocados: [col] });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  const v = (await cleuton.get('/api/ctai/versoes/' + f.json.versao_id)).json;
  const comp = v.conteudo.indicadores.competencias.find((x) => x.competencia === '2026-06');
  assert.equal(comp.checklist.itens.length, O.ITENS.length);
  assert.equal(comp.checklist.responsavel_envio.length > 0, true);
  assert.equal(comp.prazos.simas.situacao, 'entregue com atraso');
  const pdf = await cleuton.get('/api/ctai/versoes/' + f.json.versao_id + '/pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.slice(0, 5).toString(), '%PDF-');
});

test('o relatório da unidade traz os prazos, os documentos obrigatórios e os dois campos novos', async () => {
  const E = require('../server/envios');
  const envio = S.db.get('SELECT * FROM envios WHERE cid = ? ORDER BY versao DESC', cid06);
  const t = E.textoDoEnvio(S.db, envio);
  assert.match(t.texto, /Prazo de entrega no SEI/);
  assert.match(t.texto, /20\/07\/2026/);
  assert.match(t.texto, /Prazo de entrega no SIMAS/);
  assert.match(t.texto, /25\/07\/2026/);
  assert.match(t.texto, /Documentos obrigatórios do mês/);
  assert.match(t.texto, /Vigilância de óbito: relatório da Comissão de Óbitos/);
  assert.match(t.texto, /Relatório da Comissão de Óbitos: SEI 0044556/);
  assert.equal(t.modelo.blocos.some((b) => b.tipo === 'titulo' && /^3\. Documentos obrigatórios/.test(b.texto)), true);
  assert.equal(t.modelo.blocos.some((b) => b.tipo === 'titulo' && /^11\. Declaração/.test(b.texto)), true, 'numeração seguinte ajustada');
});

test('apagar a demonstração limpa o checklist', async () => {
  assert.ok(S.db.get('SELECT COUNT(*) AS n FROM checklist_itens').n > 0);
  assert.equal((await admin.post('/api/admin/demo/apagar', { confirmar: 'APAGAR' })).status, 200);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM checklist_itens').n, 0);
});
