'use strict';
// Importar Arquivos (etapa 1 da página da unidade): estrutura do relatório-modelo, lista de conferência, casamento arquivo → item,
// mensal 1/3..3/3, reserva do catálogo, conclusão da etapa, carteira, trilha. Todos os arquivos aqui são SINTÉTICOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const CART = require('../server/carteira');
const E = require('../server/importar-estrutura');
const I = require('../server/importar');
const F = require('./fixtures-importar');
const { interpretar } = require('../modules/analista/propor-lista');

let S, cle, adm, sup, c2;
const TRI = '2026-T4';
const espera = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('tempo esgotado'); await new Promise((r) => setTimeout(r, 60)); } };

test.before(async () => {
  S = await iniciar(); cle = cliente(S.base); adm = cliente(S.base); sup = cliente(S.base); c2 = cliente(S.base);
  await cle.entrar('cleuton'); await adm.entrar('admin'); await sup.entrar('nathalia'); await c2.entrar('colega2');
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-T','UPAE Teste','OSS Teste','UPAE',0)");
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-NOVA','UPAE Nova','OSS Teste','UPAE',0)");
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('HOSP-T','Hospital Teste','OSS Teste','Hospital',0)");
  const u = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', u.usuario_id, ['UPAE-T', 'UPAE-NOVA', 'HOSP-T', 'UPA-OLINDA'], 'teste');
  const u2 = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'colega2'");
  CART.definir(S.db, 'admin', u2.usuario_id, ['UPA-OLINDA'], 'teste');
});
test.after(async () => { await S.fechar(); });

// Sobe arquivos como a tela faz: registra o lote (com destino) e manda cada um pela fila; só devolve depois de tudo lido.
async function subir(cli, contrato, tri, arquivos, modelo) {
  const reg = await cli.post('/api/alimentar/lote', { arquivos: arquivos.map((a) => ({ nome: a.nome, tamanho: a.buf.length })), destino: { contrato_id: contrato, trimestre: tri, modelo: !!modelo } });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  const out = [];
  for (let k = 0; k < arquivos.length; k++) {
    const r = await cli.req('POST', '/api/alimentar/arquivo', undefined, { raw: arquivos[k].buf, headers: { 'content-type': 'application/octet-stream', 'x-fila-id': String(reg.json.itens[k].id), 'x-nome-arquivo': encodeURIComponent(arquivos[k].nome) } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    out.push(reg.json.itens[k].id);
  }
  return (await cli.get('/api/importar/fila?ids=' + out.join(','))).json.itens;
}
const est = async (cli, c, tri) => (await cli.get('/api/importar/unidade/' + c + '/' + (tri || TRI))).json;
const item = (e, cod) => e.itens.find((i) => i.codigo === cod);

// ---------- estrutura e proposta (funções puras) ----------
test('extrai seções, quadros, indicadores e fontes do parecer sintético; "Anexo Técnico" do contrato não é arquivo', () => {
  const e = E.extrairEstrutura(F.textoParecer(), { periodicidadePadrao: 'mensal', tipo: 'UPAE' });
  assert.equal(e.trimestre, '2026-T3');
  assert.match(e.titulo, /PARECER TÉCNICO CTAI/);
  assert.deepEqual(e.secoes.filter((s) => s.nivel === 1).map((s) => s.numero), ['1', '2', '3', '4', '5']);
  assert.ok(e.secoes.some((s) => s.numero === '4.1'));
  assert.deepEqual(e.tabelas.map((t) => t.numero), [1, 2]);
  assert.deepEqual(e.tabelas[0].colunas, ['Nº', 'Indicador', 'Meta', 'Produção', 'Status']);
  assert.deepEqual(e.indicadores.map((i) => i.numero), ['1.1', '1.2', '1.3', '3.1']);
  const cods = e.fontes.map((f) => f.codigo);
  for (const c of ['anexo_I', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_1', 'anexo_1_1', 'anexo_5', 'simas', 'despacho_financeiro', 'financeiro']) assert.ok(cods.includes(c), 'falta ' + c + ' em ' + cods);
  assert.ok(!cods.includes('anexo_T'), 'Anexo Técnico não vira item');
  assert.ok(!cods.includes('bid') && !cods.includes('sia_sus') && !cods.includes('cnes'), 'BID/SIA/CNES já estão cobertos pelos anexos');
  const simas = e.fontes.find((f) => f.codigo === 'simas');
  assert.equal(simas.origem, 'fonte_externa'); assert.match(simas.trecho, /SIMAS/);
  assert.equal(e.fontes.find((f) => f.codigo === 'anexo_5').nome, 'Anexo 5 - Comissão de Óbito');
});

test('proposta de lista: nome, padrões, obrigatório, periodicidade, origem e trecho do modelo', () => {
  const e = E.extrairEstrutura(F.textoParecer(), { periodicidadePadrao: 'mensal', tipo: 'UPAE' });
  const p = E.propostaLista(e, 'UPAE');
  assert.equal(p.vazia, false);
  const bid = p.itens.find((i) => i.codigo === 'anexo_IV');
  assert.equal(bid.obrigatorio, 1); assert.equal(bid.periodicidade, 'mensal'); assert.equal(bid.origem, 'unidade');
  assert.deepEqual(bid.padroes, ['\\banexo iv\\b']); assert.match(bid.trecho, /BID/);
  const fin = p.itens.find((i) => i.codigo === 'financeiro');
  assert.equal(fin.origem, 'fonte_externa'); assert.equal(fin.periodicidade, 'trimestral');
  const cit = p.itens.find((i) => /^planilha_/.test(i.codigo));
  assert.equal(cit.obrigatorio, 0, 'citação solta fica opcional'); assert.equal(cit.confianca, 'baixa');
  // sem nenhuma fonte: parte da lista padrão e avisa
  const vazia = E.propostaLista(E.extrairEstrutura('Texto qualquer sem anexos. '.repeat(30)), 'UPAE');
  assert.equal(vazia.vazia, true); assert.ok(vazia.itens.length > 10); assert.match(vazia.aviso, /lista padrão/);
});

test('casar arquivo com item: por nome, por conteúdo; 1 não confunde com 1.1; I não confunde com II', () => {
  const itens = E.propostaLista(E.extrairEstrutura(F.textoParecer(), { periodicidadePadrao: 'mensal', tipo: 'UPAE' }), 'UPAE').itens.filter((i) => i.origem === 'unidade');
  const c = (nome, texto) => (E.casar(itens, nome, texto || '') || {}).codigo;
  assert.equal(c('[03]-1_Relatorio_ANEXO_I___RM___UPAE_Teste_102026.pdf'), 'anexo_I');
  assert.equal(c('[05]-1_Planilha_ANEXO_II___Planilha_de_Monitoramento.pdf'), 'anexo_II', 'II não é confundido com I');
  assert.equal(c('[05]-1_Planilha_ANEXO_VIII___Outro.pdf'), undefined, 'Anexo VIII não está na lista');
  assert.equal(c('[06]-1_Planilha_ANEXO_IV___BID___UPAE_102026.pdf'), 'anexo_IV');
  assert.equal(c('[10]-1_Anexo_1_Relatorio_das_Atividades_da_Ouvidoria.pdf'), 'anexo_1');
  assert.equal(c('[11]-1_Anexo_1.1_NPS___CSAT_Ouvidoria.pdf'), 'anexo_1_1');
  assert.equal(c('arquivo-sem-pista.pdf', 'ANEXO V - Relatório SIA/SUS. Competência outubro de 2026.'), 'anexo_V', 'pelo começo do conteúdo');
  assert.equal(c('arquivo-sem-pista.pdf', 'Texto qualquer que não diz de que anexo se trata.'), undefined);
});

test('a IA só acrescenta item com trecho conferido no texto e sem repetir', () => {
  const texto = 'O relatório usa a Planilha de Leitos enviada pela unidade e o Mapa de Cirurgias do hospital.';
  const bruto = '```json\n{"itens":[{"nome":"Planilha de Leitos","obrigatorio":true,"periodicidade":"mensal","origem":"unidade","trecho":"Planilha de Leitos enviada pela unidade"},{"nome":"Inventado","trecho":"frase que não existe no texto"},{"nome":"Mapa de Cirurgias","periodicidade":"trimestral","origem":"fonte_externa","trecho":"Mapa de Cirurgias do hospital"},{"nome":"Anexo I","trecho":"Planilha de Leitos"}]}\n```';
  const r = interpretar(bruto, texto, [{ nome: 'Anexo I' }]);
  assert.deepEqual(r.map((x) => x.nome), ['Planilha de Leitos', 'Mapa de Cirurgias']);
  assert.equal(r[1].origem, 'fonte_externa'); assert.equal(r[1].periodicidade, 'trimestral');
  assert.deepEqual(interpretar('isto não é json', texto, []), []);
});

// ---------- lista padrão como reserva ----------
test('sem relatório anterior: lista padrão do tipo, com aviso claro; UPA não cobra o parecer da CTAI; Hospital sem lista avisa', async () => {
  const a = await est(cle, 'UPAE-NOVA');
  assert.equal(a.lista.origem, 'catalogo');
  assert.equal(a.lista.aviso, 'Sem relatório anterior: usando a lista padrão da UPAE.');
  assert.ok(item(a, 'anexo_IV') && item(a, 'anexo_11'));
  assert.equal(item(a, 'anexo_12').esperados, 0 + (item(a, 'anexo_12').esperados), 'a partir de set/2026: em T4 vale nos 3 meses');
  assert.equal(item(a, 'anexo_IV').esperados, 3);
  assert.equal(a.feita, false); assert.match(a.resumo.texto, /^0 de \d+ itens recebidos — falta /);
  const upa = await est(c2, 'UPA-OLINDA');
  assert.match(upa.lista.aviso, /lista padrão da UPA/);
  assert.ok(!upa.itens.some((i) => i.codigo === 'parecer'), 'o parecer é da CTAI, não do que a unidade manda');
  const hosp = await est(cle, 'HOSP-T');
  assert.equal(hosp.lista.vazia, true); assert.match(hosp.lista.aviso, /lista padrão do Hospital ainda não foi definida/);
  // em trimestre que começa antes de set/2026, os anexos 12 a 15 não são exigidos
  const t2 = await est(cle, 'UPAE-NOVA', '2026-T2');
  assert.equal(item(t2, 'anexo_12').estado, 'nao_exigido');
  const t3 = await est(cle, 'UPAE-NOVA', '2026-T3');
  assert.equal(item(t3, 'anexo_12').esperados, 1, 'só setembro');
});

// ---------- relatório-modelo, lista, casamento, mensal, conclusão ----------
test('relatório-modelo em PDF gera lista proposta; ela só vale depois de confirmada; texto fica guardado e mascarado', async () => {
  const pdf = await F.pdfDe(F.textoParecer() + '\nPaciente: Maria da Silva Souza, CPF 123.456.789-09, telefone (81) 99876-5432.');
  // o navegador lê o PDF e manda só o texto; aqui o caminho do arquivo inteiro (servidor lê) cobre o mesmo destino
  const r = (await subir(cle, 'UPAE-T', TRI, [{ nome: '[1]-8000001_GOVPE___Parecer_Tecnico_999.pdf', buf: pdf }], true))[0];
  assert.equal(r.estado, 'lido', JSON.stringify(r));
  assert.match(r.motivo, /Relatório-modelo guardado/);
  let e = await est(cle, 'UPAE-T');
  assert.equal(e.modelo.trimestre, '2026-T3');
  assert.ok(e.proposta && e.proposta.itens >= 25);
  assert.match(e.proposta.nota, /vieram da lista padrão da UPAE/);
  assert.equal(e.lista.origem, 'catalogo', 'enquanto não confirma, vale a lista padrão');
  assert.match(e.lista.aviso, /relatório-modelo, mas a lista dele ainda não foi confirmada/);
  const m = (await cle.get('/api/importar/unidade/UPAE-T/modelo')).json;
  assert.match(m.texto, /DA FUNDAMENTAÇÃO LEGAL/);
  assert.ok(!/123\.456|99876|Maria da Silva/.test(m.texto), 'texto guardado já está mascarado');
  assert.equal(S.db.get('SELECT texto FROM alimentar_fila WHERE id = ?', 1) && S.db.get("SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL").n, 0, 'a fila não guarda texto');
  // mesmo relatório de novo: já guardado
  const igual = (await subir(cle, 'UPAE-T', TRI, [{ nome: 'de-novo.pdf', buf: pdf }], true))[0];
  assert.equal(igual.estado, 'duplicado');
  // confirmar a lista
  const v = (await cle.get('/api/importar/unidade/UPAE-T/lista')).json;
  assert.ok(v.rascunho && v.rascunho.itens.length >= 10);
  assert.ok(v.modelo.secoes.length >= 5 && v.modelo.indicadores.length === 4 && v.modelo.fontes.length >= 8);
  const c = await cle.post('/api/importar/unidade/UPAE-T/lista/confirmar');
  assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.versao, 1);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.lista.origem, 'confirmada'); assert.equal(e.lista.versao, 1); assert.equal(e.proposta, null);
  assert.ok(item(e, 'anexo_IV') && item(e, 'simas'));
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'imp_listas' AND campo = 'lista_confirmada'"));
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'imp_modelos' AND campo = 'modelo_guardado'"));
});

test('editar a lista: renomear, marcar opcional, tirar e acrescentar item; a nova versão só vale ao confirmar', async () => {
  const v = (await cle.get('/api/importar/unidade/UPAE-T/lista')).json;
  assert.equal(v.rascunho, null);
  const MANTER = ['anexo_I', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_1', 'anexo_1_1', 'simas', 'despacho_financeiro', 'financeiro', 'prestacao_contas'];
  assert.ok(v.efetiva.itens.length > 25 && v.efetiva.itens.some((i) => i.codigo === 'anexo_5'), 'a UPAE traz também o que o parecer não cita');
  const itens = v.efetiva.itens.filter((i) => MANTER.includes(i.codigo)).map((i) => (i.codigo === 'anexo_VI' ? Object.assign({}, i, { nome: 'Anexo VI - Cadastro CNES (renomeado)', obrigatorio: false }) : i));
  itens.push({ nome: 'Planilha de leitos', obrigatorio: true, periodicidade: 'trimestral', origem: 'unidade', palavras: ['leitos'] });
  assert.equal((await cle.put('/api/importar/unidade/UPAE-T/lista', { itens })).status, 200);
  let e = await est(cle, 'UPAE-T');
  assert.equal(e.lista.versao, 1, 'a versão 1 segue valendo');
  assert.ok(item(e, 'anexo_5'));
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/lista/confirmar')).json.versao, 2);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.lista.versao, 2);
  assert.equal(item(e, 'anexo_5'), undefined);
  assert.equal(item(e, 'anexo_VI').nome, 'Anexo VI - Cadastro CNES (renomeado)'); assert.equal(item(e, 'anexo_VI').obrigatorio, false);
  const novo = e.itens.find((i) => i.nome === 'Planilha de leitos');
  assert.ok(novo && novo.periodicidade === 'trimestral' && novo.esperados === 1);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM imp_listas WHERE contrato_id = 'UPAE-T' AND estado = 'confirmada'").n, 1, 'só uma versão em vigor');
  assert.equal((await cle.put('/api/importar/unidade/UPAE-T/lista', { itens: [{ nome: '  ' }] })).status, 400);
});

test('casamento por nome e conteúdo; mensal 1/3, 2/3, 3/3; avulso para a analista apontar', async () => {
  // o Anexo 5 (Comissão de Óbito) saiu da lista: o arquivo dele não casa com nada
  let r = await subir(cle, 'UPAE-T', TRI, F.mes('10'));
  assert.ok(r.every((x) => x.estado === 'lido'), JSON.stringify(r.map((x) => x.estado + ':' + x.motivo)));
  let e = await est(cle, 'UPAE-T');
  assert.equal(item(e, 'anexo_IV').recebidos, 1); assert.equal(item(e, 'anexo_IV').esperados, 3); assert.equal(item(e, 'anexo_IV').estado, 'parcial');
  assert.deepEqual(item(e, 'anexo_IV').slots.map((s) => !!s.check), [true, false, false]);
  assert.equal(item(e, 'anexo_VI').recebidos, 1, 'o Anexo VI renomeado continua casando pelo padrão');
  assert.match(e.resumo.texto, /falta .*Anexo IV \(1 de 3 meses\)/);
  assert.equal(e.avulsos.length, 1, 'o Anexo 5 (fora da lista) fica avulso');
  assert.match(e.avulsos[0].nome, /Anexo_5/);
  await subir(cle, 'UPAE-T', TRI, F.mes('11'));
  e = await est(cle, 'UPAE-T');
  assert.equal(item(e, 'anexo_IV').recebidos, 2);
  await subir(cle, 'UPAE-T', TRI, F.mes('12'));
  e = await est(cle, 'UPAE-T');
  assert.equal(item(e, 'anexo_IV').recebidos, 3); assert.equal(item(e, 'anexo_IV').estado, 'completo');
  assert.equal(item(e, 'anexo_I').estado, 'completo');
  assert.equal(e.avulsos.length, 3);
  // mesmo arquivo de novo: já importado, nada muda
  const dup = await subir(cle, 'UPAE-T', TRI, F.mes('12').slice(0, 1));
  assert.equal(dup[0].estado, 'duplicado');
  // apontar à mão: o avulso entra num item da lista (mensal exige o mês)
  const av = e.avulsos.find((a) => /_102026|_10\b|Obito___UPAE_Teste_102026/.test(a.nome)) || e.avulsos[0];
  assert.equal((await cle.post('/api/importar/arquivos/apontar', { arquivo_id: av.id, item: 'anexo_I' })).status, 400, 'item mensal sem mês');
  assert.equal((await cle.post('/api/importar/arquivos/apontar', { arquivo_id: av.id, item: 'item-que-nao-existe', mes: '2026-10' })).status, 400);
  assert.equal((await cle.post('/api/importar/arquivos/apontar', { arquivo_id: av.id, item: 'anexo_I', mes: '2026-10' })).status, 200);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.avulsos.length, 2);
  assert.equal(S.db.get('SELECT casamento FROM imp_arquivos WHERE id = ?', av.id).casamento, 'manual');
  // tirar um avulso apaga o texto guardado
  assert.equal((await cle.del('/api/importar/arquivos/' + e.avulsos[0].id)).status, 200);
  assert.equal((await est(cle, 'UPAE-T')).avulsos.length, 1);
});

test('fonte externa: check manual com observação, por mês; não vem por upload; opcional não bloqueia', async () => {
  let e = await est(cle, 'UPAE-T');
  const simas = item(e, 'simas');
  assert.equal(simas.origem, 'fonte_externa'); assert.equal(simas.estado, 'falta');
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'anexo_I', mes: '2026-10', marcado: true })).status, 400, 'item por arquivo não aceita check manual');
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'simas', mes: '2026-09', marcado: true })).status, 400, 'mês fora do trimestre');
  for (const mes of ['2026-10', '2026-11']) assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'simas', mes, marcado: true, observacao: 'Conferido no SIMAS em ' + mes })).status, 200);
  e = await est(cle, 'UPAE-T');
  assert.equal(item(e, 'simas').recebidos, 2); assert.equal(item(e, 'simas').estado, 'parcial');
  assert.equal(item(e, 'simas').slots[0].observacao, 'Conferido no SIMAS em 2026-10'); assert.equal(item(e, 'simas').slots[0].check, 'manual');
  // um arquivo com nome de despacho NÃO é casado com item de fonte externa (vira avulso)
  const antes = e.avulsos.length;
  await subir(cle, 'UPAE-T', TRI, [{ nome: '[9]-90_GOVPE___Despacho_681.txt', buf: F.corpo('Despacho da Gerência de Prestação de Contas', '10') }]);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.avulsos.length, antes + 1);
  assert.equal(item(e, 'despacho_financeiro').recebidos, 0);
  // desmarcar
  await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'simas', mes: '2026-11', marcado: false });
  assert.equal(item(await est(cle, 'UPAE-T'), 'simas').recebidos, 1);
});

test('conclusão da etapa: automática com todos os obrigatórios; manual com confirmação quando falta; fica na trilha; reabrir', async () => {
  let e = await est(cle, 'UPAE-T');
  assert.equal(e.feita, false);
  assert.ok(e.resumo.faltam.some((f) => f.codigo === 'simas'));
  // concluir com faltantes exige confirmação
  const sem = await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/concluir', {});
  assert.equal(sem.status, 409); assert.match(sem.json.erro, /Faltam itens obrigatórios/);
  const ok = await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/concluir', { confirmar_faltantes: true, observacao: 'Despachos chegam na próxima semana' });
  assert.equal(ok.status, 200);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.feita, true); assert.equal(e.feitaPorChecks, false);
  assert.ok(e.concluida.faltantes.length >= 2); assert.equal(e.concluida.observacao, 'Despachos chegam na próxima semana'); assert.equal(e.concluida.por, 'cleuton');
  const tr = S.db.get("SELECT * FROM trilha_auditoria WHERE tabela = 'imp_conclusoes' AND campo = 'importacao_concluida'");
  assert.ok(tr && /simas/i.test(tr.valor_novo) && tr.motivo === 'Despachos chegam na próxima semana');
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/reabrir')).status, 200);
  assert.equal((await est(cle, 'UPAE-T')).feita, false);
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE campo = 'importacao_reaberta'"));
  // chega o que falta da unidade (a planilha de leitos, trimestral) e dá o check manual do que é fonte externa: a etapa passa a valer sozinha
  await subir(cle, 'UPAE-T', TRI, [{ nome: 'Planilha_de_leitos_UPAE_Teste_2026T4.txt', buf: F.corpo('Planilha de leitos', '10') }]);
  e = await est(cle, 'UPAE-T');
  const falta = e.resumo.faltam;
  for (const f of falta) {
    const it = item(e, f.codigo);
    assert.equal(it.origem, 'fonte_externa', 'o que sobrou é fonte externa: ' + f.codigo);
    for (const s of it.slots) if (!s.check) await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: it.codigo, mes: s.mes, marcado: true });
  }
  e = await est(cle, 'UPAE-T');
  assert.deepEqual(e.resumo.faltam, [], e.resumo.texto);
  assert.equal(e.feitaPorChecks, true); assert.equal(e.feita, true);
  assert.match(e.resumo.texto, /^(\d+) de \1 itens recebidos$/);
});

test('trocar a lista casa de novo o que não foi apontado à mão e respeita o que foi', async () => {
  const v = (await cle.get('/api/importar/unidade/UPAE-T/lista')).json;
  const itens = v.efetiva.itens.filter((i) => i.codigo !== 'anexo_IV');
  await cle.put('/api/importar/unidade/UPAE-T/lista', { itens });
  const c = await cle.post('/api/importar/unidade/UPAE-T/lista/confirmar');
  assert.equal(c.json.versao, 3); assert.ok(c.json.recasados >= 3, 'os 3 BID viram avulsos');
  let e = await est(cle, 'UPAE-T');
  assert.ok(e.avulsos.filter((a) => /BID/.test(a.nome)).length === 3);
  assert.equal(item(e, 'anexo_I').recebidos, 3, 'o que foi apontado à mão ficou');
  // volta o item: os BID voltam a ser casados
  await cle.put('/api/importar/unidade/UPAE-T/lista', { itens: v.efetiva.itens });
  await cle.post('/api/importar/unidade/UPAE-T/lista/confirmar');
  e = await est(cle, 'UPAE-T');
  assert.equal(item(e, 'anexo_IV').recebidos, 3);
});

test('Word e texto vindo do navegador: o servidor lê o Word e mascara de novo o texto que chega pronto', async () => {
  const docx = await F.docxDe('Anexo VII - Planilha de profissionais UPAE Teste ' + F.ENCHIMENTO.repeat(2));
  const r = (await subir(cle, 'UPAE-NOVA', TRI, [{ nome: 'Anexo_VII_profissionais_112026.docx', buf: docx }]))[0];
  assert.equal(r.estado, 'lido', JSON.stringify(r));
  // texto já lido no navegador (PDF): CPF que escapou da máscara do navegador é mascarado de novo
  const reg = await cle.post('/api/alimentar/lote', { arquivos: [{ nome: 'Anexo_IV_BID_UPAE_Nova_112026.pdf', tamanho: 100 }], destino: { contrato_id: 'UPAE-NOVA', trimestre: TRI } });
  const id = reg.json.itens[0].id;
  const corpo = JSON.stringify({ texto: 'Anexo IV BID novembro/2026. Paciente CPF 123.456.789-09 atendido.' + F.ENCHIMENTO.repeat(2), hash: null, paginas: 1, paginasSemTexto: [], mascarados: {} });
  const t = await cle.req('POST', '/api/alimentar/texto', undefined, { raw: Buffer.from(corpo), headers: { 'content-type': 'text/plain; charset=utf-8', 'x-fila-id': String(id) } });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const e = await est(cle, 'UPAE-NOVA');
  assert.equal(item(e, 'anexo_VII').recebidos, 1); assert.equal(item(e, 'anexo_IV').recebidos, 1);
  const g = S.db.all("SELECT texto FROM gaveta_documentos WHERE contrato_id = 'UPAE-NOVA'");
  assert.ok(g.length >= 1 && g.every((x) => !/123\.456/.test(x.texto)), 'unidade com gaveta (UPAE) também guarda lá, mascarado');
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM imp_arquivos WHERE texto LIKE '%123.456%'").n, 0);
});

test('a IA, quando está ligada, só acrescenta itens à proposta (marcados como sugestão da IA)', async () => {
  const antes = I.ia.propor;
  I.ia.propor = async () => ({ ok: true, itens: [{ nome: 'Mapa de leitos', obrigatorio: false, periodicidade: 'trimestral', origem: 'fonte_externa', trecho: 'Mapa de leitos do hospital' }] });
  try {
    const texto = F.textoParecer().replace('1. DA INTRODUÇÃO', 'O Mapa de leitos do hospital foi citado.\n1. DA INTRODUÇÃO');
    const r = (await subir(cle, 'HOSP-T', TRI, [{ nome: 'parecer-hosp.txt', buf: Buffer.from(texto) }], true))[0];
    assert.equal(r.estado, 'lido', JSON.stringify(r));
    const v = (await cle.get('/api/importar/unidade/HOSP-T/lista')).json;
    const ia = v.rascunho.itens.find((i) => i.nome === 'Mapa de leitos');
    assert.ok(ia && ia.fonte_ia === true && ia.origem === 'fonte_externa' && ia.obrigatorio === false);
    assert.ok(v.rascunho.itens.some((i) => i.codigo === 'anexo_IV'), 'o que a regra achou continua lá');
    assert.equal(v.modelo.fontes.length > 5, true);
    assert.equal(v.padrao_disponivel, false, 'Hospital não tem lista padrão para acrescentar');
    assert.equal((await cle.post('/api/importar/unidade/HOSP-T/lista/completar-padrao')).status, 409);
  } finally { I.ia.propor = antes; }
});

test('mensal sem mês, ou com mês de outro trimestre, fica avulso com aviso; trimestral não pede mês; discordância de trimestre avisa', async () => {
  const r = await subir(cle, 'UPAE-NOVA', TRI, [
    { nome: 'Anexo_VI_Cadastro_CNES_sem_mes.txt', buf: F.corpo('Cadastro CNES', 'sem data') },
    { nome: 'Anexo_VII_Planilha_profissionais_072026.txt', buf: F.corpo('Planilha de profissionais', '07') },
  ]);
  assert.match(r[0].motivo, /Falta indicar o mês/);
  assert.match(r[1].motivo, /outro trimestre/);
  const e = await est(cle, 'UPAE-NOVA');
  const nomes = e.avulsos.map((a) => a.nome);
  assert.ok(nomes.includes('Anexo_VI_Cadastro_CNES_sem_mes.txt') && nomes.includes('Anexo_VII_Planilha_profissionais_072026.txt'));
  assert.equal(e.avulsos.find((a) => /sem_mes/.test(a.nome)).sugestao.codigo, 'anexo_VI');
  assert.equal(item(e, 'anexo_VI').recebidos, 0);
  assert.equal((await cle.post('/api/importar/arquivos/apontar', { arquivo_id: e.avulsos.find((a) => /sem_mes/.test(a.nome)).id, item: 'anexo_VI', mes: '2026-12' })).status, 200);
  assert.equal(item(await est(cle, 'UPAE-NOVA'), 'anexo_VI').recebidos, 1);
});

// ---------- carteira e perfis ----------
test('respeita a carteira: colega de outra carteira não vê nem mexe; superintendente e admin veem todas', async () => {
  assert.equal((await c2.get('/api/importar/unidade/UPAE-T/' + TRI)).status, 403);
  assert.equal((await c2.get('/api/importar/unidade/UPAE-T/lista')).status, 403);
  assert.equal((await c2.put('/api/importar/unidade/UPAE-T/lista', { itens: [] })).status, 403);
  assert.equal((await c2.post('/api/importar/unidade/UPAE-T/' + TRI + '/concluir', { confirmar_faltantes: true })).status, 403);
  assert.equal((await c2.get('/api/importar/unidade/UPAE-T/modelo')).status, 403);
  const reg = await c2.post('/api/alimentar/lote', { arquivos: [{ nome: 'x.pdf', tamanho: 10 }], destino: { contrato_id: 'UPAE-T', trimestre: TRI } });
  assert.equal(reg.status, 403, 'nem registrar arquivo em unidade de outra carteira');
  const av = S.db.get('SELECT id FROM imp_arquivos WHERE contrato_id = ? LIMIT 1', 'UPAE-T');
  assert.equal((await c2.post('/api/importar/arquivos/apontar', { arquivo_id: av.id, item: 'anexo_I', mes: '2026-10' })).status, 403);
  assert.equal((await c2.del('/api/importar/arquivos/' + av.id)).status, 403);
  assert.equal((await sup.get('/api/importar/unidade/UPAE-T/' + TRI)).status, 200);
  assert.equal((await adm.get('/api/importar/unidade/UPAE-T/lista')).status, 200);
  assert.equal((await c2.get('/api/importar/unidade/UPAE-T/2026-X9')).status, 403);
  assert.equal((await cle.get('/api/importar/unidade/UPAE-T/2026-X9')).status, 400);
  // gestor de unidade (portal) não entra
  const g = cliente(S.base); await g.entrar('gestor.olinda');
  assert.equal((await g.get('/api/importar/unidade/UPA-OLINDA/' + TRI)).status, 403);
  // o painel do Alimentar não mostra o que veio de Importar Arquivos
  const al = (await cle.get('/api/alimentar/estado')).json;
  assert.equal(al.itens.length, 0);
});

test('zerar apaga as tabelas novas e o original nunca fica no banco', () => {
  const fonte = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'zerar.js'), 'utf8');
  for (const t of ['imp_modelos', 'imp_listas', 'imp_itens', 'imp_arquivos', 'imp_checks', 'imp_conclusoes']) assert.ok(fonte.includes("['" + t + "'"), t);
  const apagar = require('../server/zerar').contar(S.db, null).apagar.map((x) => x.tabela);
  for (const t of ['imp_modelos', 'imp_listas', 'imp_itens', 'imp_arquivos', 'imp_checks']) assert.ok(apagar.includes(t), t);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL').n, 0);
});
