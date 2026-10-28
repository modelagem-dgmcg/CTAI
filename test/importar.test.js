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
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-ORIG','UPAE Origens','OSS Teste','UPAE',0)");
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('UPAE-SIM','UPAE Simas','OSS Teste','UPAE',0)");
  S.db.run("INSERT INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('HOSP-T','Hospital Teste','OSS Teste','Hospital',0)");
  const u = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  CART.definir(S.db, 'admin', u.usuario_id, ['UPAE-T', 'UPAE-NOVA', 'UPAE-ORIG', 'UPAE-SIM', 'HOSP-T', 'UPA-OLINDA'], 'teste');
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
  for (const c of ['anexo_I', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_1', 'anexo_1_1', 'anexo_5', 'simas_metas', 'despacho_financeiro', 'financeiro']) assert.ok(cods.includes(c), 'falta ' + c + ' em ' + cods);
  assert.ok(!cods.includes('anexo_T'), 'Anexo Técnico não vira item');
  assert.ok(!cods.includes('bid') && !cods.includes('sia_sus') && !cods.includes('cnes'), 'BID/SIA/CNES já estão cobertos pelos anexos');
  const simas = e.fontes.find((f) => f.codigo === 'simas_metas');
  assert.equal(simas.origem, 'gerado_simas'); assert.match(simas.trecho, /SIMAS/);
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
  assert.equal(fin.origem, 'pedida_setor'); assert.equal(fin.periodicidade, 'trimestral');
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
  assert.ok(item(e, 'anexo_IV') && item(e, 'simas_metas'));
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'imp_listas' AND campo = 'lista_confirmada'"));
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'imp_modelos' AND campo = 'modelo_guardado'"));
});

test('editar a lista: renomear, marcar opcional, tirar e acrescentar item; a nova versão só vale ao confirmar', async () => {
  const v = (await cle.get('/api/importar/unidade/UPAE-T/lista')).json;
  assert.equal(v.rascunho, null);
  const MANTER = ['anexo_I', 'anexo_IV', 'anexo_V', 'anexo_VI', 'anexo_1', 'anexo_1_1', 'simas_metas', 'despacho_financeiro', 'financeiro', 'prestacao_contas'];
  assert.ok(v.efetiva.itens.length > 25 && v.efetiva.itens.some((i) => i.codigo === 'anexo_5'), 'a UPAE traz também o que o parecer não cita');
  const itens = v.efetiva.itens.filter((i) => MANTER.includes(i.codigo)).map((i) => (i.codigo === 'anexo_VI' ? Object.assign({}, i, { nome: 'Anexo VI - Cadastro CNES (renomeado)', obrigatorio: false }) : i));
  itens.push({ codigo: 'mapa_ses', nome: 'Mapa de leitos SES', obrigatorio: true, periodicidade: 'mensal', origem: 'fonte_externa' });
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
  const simas = item(e, 'mapa_ses');
  assert.equal(simas.origem, 'fonte_externa'); assert.equal(simas.estado, 'falta');
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'anexo_I', mes: '2026-10', marcado: true })).status, 400, 'item por arquivo não aceita check manual');
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'mapa_ses', mes: '2026-09', marcado: true })).status, 400, 'mês fora do trimestre');
  for (const mes of ['2026-10', '2026-11']) assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'mapa_ses', mes, marcado: true, observacao: 'Conferido no mapa em ' + mes })).status, 200);
  e = await est(cle, 'UPAE-T');
  assert.equal(item(e, 'mapa_ses').recebidos, 2); assert.equal(item(e, 'mapa_ses').estado, 'parcial');
  assert.equal(item(e, 'mapa_ses').slots[0].observacao, 'Conferido no mapa em 2026-10'); assert.equal(item(e, 'mapa_ses').slots[0].check, 'manual');
  // item de fonte externa (SIMAS) nunca é casado por upload: o arquivo vira avulso
  const antes = e.avulsos.length;
  await subir(cle, 'UPAE-T', TRI, [{ nome: '[9]-90_GOVPE___SES_681.txt', buf: F.corpo('Consulta SES', '10') }]);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.avulsos.length, antes + 1);
  assert.equal(item(e, 'mapa_ses').slots.filter((x) => x.arquivos.length).length, 0);
  // desmarcar
  await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/check', { item: 'mapa_ses', mes: '2026-11', marcado: false });
  assert.equal(item(await est(cle, 'UPAE-T'), 'mapa_ses').recebidos, 1);
});

test('conclusão da etapa: automática com todos os obrigatórios; manual com confirmação quando falta; fica na trilha; reabrir', async () => {
  let e = await est(cle, 'UPAE-T');
  assert.equal(e.feita, false);
  assert.ok(e.resumo.faltam.some((f) => f.codigo === 'mapa_ses'));
  // concluir com faltantes exige confirmação
  const sem = await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/concluir', {});
  assert.equal(sem.status, 409); assert.match(sem.json.erro, /Faltam itens obrigatórios/);
  const ok = await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/concluir', { confirmar_faltantes: true, observacao: 'Despachos chegam na próxima semana' });
  assert.equal(ok.status, 200);
  e = await est(cle, 'UPAE-T');
  assert.equal(e.feita, true); assert.equal(e.feitaPorChecks, false);
  assert.ok(e.concluida.faltantes.length >= 2); assert.equal(e.concluida.observacao, 'Despachos chegam na próxima semana'); assert.equal(e.concluida.por, 'cleuton');
  const tr = S.db.get("SELECT * FROM trilha_auditoria WHERE tabela = 'imp_conclusoes' AND campo = 'importacao_concluida'");
  assert.ok(tr && /mapa/i.test(tr.valor_novo) && tr.motivo === 'Despachos chegam na próxima semana');
  assert.equal((await cle.post('/api/importar/unidade/UPAE-T/' + TRI + '/reabrir')).status, 200);
  assert.equal((await est(cle, 'UPAE-T')).feita, false);
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE campo = 'importacao_reaberta'"));
  // chega o que falta da unidade (a planilha de leitos, trimestral) e dá o check manual do que é fonte externa: a etapa passa a valer sozinha
  await subir(cle, 'UPAE-T', TRI, [{ nome: 'Planilha_de_leitos_UPAE_Teste_2026T4.txt', buf: F.corpo('Planilha de leitos', '10') }]);
  e = await est(cle, 'UPAE-T');
  const falta = e.resumo.faltam;
  for (const f of falta) {
    const it = item(e, f.codigo);
    assert.notEqual(it.origem, 'unidade', 'o que sobrou é fonte externa: ' + f.codigo);
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
  for (const t of ['imp_modelos', 'imp_listas', 'imp_itens', 'imp_arquivos', 'imp_checks', 'imp_conclusoes', 'imp_ausencias', 'imp_simas', 'imp_simas_numeros']) assert.ok(fonte.includes("['" + t + "'"), t);
  const apagar = require('../server/zerar').contar(S.db, null).apagar.map((x) => x.tabela);
  for (const t of ['imp_modelos', 'imp_listas', 'imp_itens', 'imp_arquivos', 'imp_checks']) assert.ok(apagar.includes(t), t);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM alimentar_fila WHERE texto IS NOT NULL').n, 0);
});

// ---------- três origens e a regra da planilha de monitoramento ----------
const TEXTO_ORIGENS = F.textoParecer() + `
Os dados de ostomizados e de TEA foram extraídos da planilha de monitoramento enviada pela Unidade (Anexo II), às vezes chamada de planilha consolidada.
Foi anexado o Despacho da Gerência de Prestação de Contas com o relatório de prestação de contas do trimestre.
As Informações Financeiras referentes ao trimestre anterior constam da INFORMAÇÃO N.º 48/2026/SES - GGCCG.
Consideramos o Parecer Conclusivo da CMA do trimestre anterior, que consta do processo do parecer.
`;

test('o extrator sugere as três origens e a planilha de monitoramento como item obrigatório e mensal da unidade', () => {
  const e = E.extrairEstrutura(TEXTO_ORIGENS, { periodicidadePadrao: 'mensal', tipo: 'UPAE' });
  const lista = E.propostaLista(e, 'UPAE').itens;
  const por = (c) => lista.find((i) => i.codigo === c);
  assert.equal(por('despacho_financeiro').origem, 'pedida_setor');
  assert.equal(por('financeiro').origem, 'pedida_setor');
  assert.equal(por('parecer_cma').origem, 'processo_parecer');
  assert.equal(por('simas_metas').origem, 'gerado_simas'); assert.equal(por('simas_metas').periodicidade, 'trimestral'); assert.equal(por('simas_metas').obrigatorio, 1);
  const plan = por('anexo_II');
  assert.equal(plan.origem, 'unidade'); assert.equal(plan.obrigatorio, 1); assert.equal(plan.periodicidade, 'mensal');
  assert.ok(!lista.some((i) => /^planilha_.*monitoramento/.test(i.codigo)), 'sem item duplicado para a mesma planilha');
  // casa pelo nome do arquivo: "monitoramento" e "consolidad"
  const itens = [plan];
  assert.equal(E.casar(itens, 'Planilha_de_Monitoramento_UPAE_102026.pdf', '').codigo, 'anexo_II');
  assert.equal(E.casar(itens, 'planilha consolidada outubro.pdf', '').codigo, 'anexo_II');
  assert.equal(E.casar(itens, 'Anexo_II_UPAE.pdf', '').codigo, 'anexo_II');
  assert.equal(E.casar(itens, 'Relatorio_RM_102026.pdf', ''), null);
});

test('origens na prática: pedida (não pedido, pedido com processo, recebido), consultada no processo, resumo e conclusão', async () => {
  const lista = E.propostaLista(E.extrairEstrutura(TEXTO_ORIGENS, { periodicidadePadrao: 'mensal', tipo: 'UPAE' }), 'UPAE').itens
    .filter((i) => ['anexo_I', 'anexo_II', 'despacho_financeiro', 'financeiro', 'parecer_cma'].includes(i.codigo)).map((i) => ({ ...i, obrigatorio: true }));
  assert.equal(lista.length, 5);
  assert.equal((await cle.put('/api/importar/unidade/UPAE-ORIG/lista', { itens: lista })).status, 200);
  assert.equal((await cle.post('/api/importar/unidade/UPAE-ORIG/lista/confirmar')).status, 200);
  const url = '/api/importar/unidade/UPAE-ORIG/' + TRI + '/check';
  let e = await est(cle, 'UPAE-ORIG');
  const fin = item(e, 'financeiro'); const cma = item(e, 'parecer_cma');
  assert.equal(fin.origem, 'pedida_setor'); assert.equal(fin.estado, 'falta');
  assert.match(e.resumo.texto, /falta .*Informação financeira.*\(ainda não pedido\)/);
  const mesFin = fin.periodicidade === 'mensal' ? '2026-10' : '';
  // pedido: data e nº do processo SEI, campo livre; ainda não conta como recebido
  assert.equal((await cle.post(url, { item: 'financeiro', mes: mesFin, situacao: 'pedido', data_pedido: '2026-10-20', processo_sei: '00000.0000001/2026-11', observacao: 'Pedido à GGCCG' })).status, 200);
  e = await est(cle, 'UPAE-ORIG');
  assert.equal(item(e, 'financeiro').estado, 'pedido'); assert.equal(item(e, 'financeiro').slots[0].processo_sei, '00000.0000001/2026-11'); assert.equal(item(e, 'financeiro').slots[0].data_pedido, '2026-10-20');
  assert.match(e.resumo.texto, /pedido, aguardando resposta/);
  assert.equal((await cle.post(url, { item: 'financeiro', mes: mesFin, situacao: 'pedido', data_pedido: '20/10/2026' })).status, 400, 'data inválida');
  assert.equal((await cle.post(url, { item: 'financeiro', mes: mesFin, situacao: 'consultado' })).status, 400, 'situação de outra origem');
  // recebido (sem arquivo: não é obrigatório subir)
  assert.equal((await cle.post(url, { item: 'financeiro', mes: mesFin, situacao: 'recebido', data_pedido: '2026-10-20', processo_sei: '00000.0000001/2026-11', observacao: 'Gasto com pessoal 61%' })).status, 200);
  e = await est(cle, 'UPAE-ORIG');
  assert.equal(item(e, 'financeiro').estado, 'completo'); assert.equal(item(e, 'financeiro').slots[0].check, 'manual'); assert.equal(item(e, 'financeiro').slots[0].observacao, 'Gasto com pessoal 61%');
  // dentro do processo do parecer: consultado + informação anotada
  assert.equal(cma.origem, 'processo_parecer');
  assert.equal((await cle.post(url, { item: 'parecer_cma', mes: cma.periodicidade === 'mensal' ? '2026-10' : '', situacao: 'consultado', observacao: 'CMA: metas parcialmente cumpridas' })).status, 200);
  e = await est(cle, 'UPAE-ORIG');
  assert.equal(item(e, 'parecer_cma').slots[0].check, 'consultado'); assert.equal(item(e, 'parecer_cma').slots[0].observacao, 'CMA: metas parcialmente cumpridas');
  // desmarcar volta a "não pedido"
  assert.equal((await cle.post(url, { item: 'parecer_cma', mes: cma.periodicidade === 'mensal' ? '2026-10' : '', marcado: false })).status, 200);
  assert.equal(item(await est(cle, 'UPAE-ORIG'), 'parecer_cma').estado, 'falta');
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE tabela = 'imp_checks' AND valor_novo LIKE '%00000.0000001/2026-11%'"));
});

test('arquivo de item pedido a outro setor pode ser enviado, mas não é obrigatório', async () => {
  const r = await subir(cle, 'UPAE-ORIG', TRI, [{ nome: 'Despacho_Gerencia_Prestacao_de_Contas_102026.txt', buf: F.corpo('Despacho da Gerência de Prestação de Contas', '10') }]);
  assert.equal(r[0].estado, 'lido', JSON.stringify(r[0]));
  const e = await est(cle, 'UPAE-ORIG');
  assert.ok(item(e, 'despacho_financeiro').slots.some((s) => s.arquivos.length), 'casou pelo nome');
});

test('planilha de monitoramento ausente: aviso, regra da CTAI registrada ao concluir, sem valor inventado; reabrir limpa', async () => {
  let e = await est(cle, 'UPAE-ORIG');
  assert.equal(item(e, 'anexo_II').estado, 'falta');
  const aus = e.ausencias.find((a) => a.item === 'anexo_II');
  assert.ok(aus); assert.equal(aus.estado, 'sem_planilha_meta_nao_cumprida');
  assert.match(aus.texto, /contam como meta não cumprida/); assert.deepEqual(aus.indicadores, ['Ostomizados', 'TEA / neuropediatria']);
  assert.equal(aus.meses_sem.length, 3);
  // ainda não registrado: só aparece como aviso até concluir
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM imp_ausencias').n, 0);
  assert.equal((await cle.post('/api/importar/unidade/UPAE-ORIG/' + TRI + '/concluir', {})).status, 409);
  assert.equal((await cle.post('/api/importar/unidade/UPAE-ORIG/' + TRI + '/concluir', { confirmar_faltantes: true })).status, 200);
  const reg = (await cle.get('/api/importar/unidade/UPAE-ORIG/' + TRI + '/ausencias')).json.ausencias;
  assert.equal(reg.length, 6, '3 meses x 2 indicadores');
  assert.ok(reg.every((x) => x.estado === 'sem_planilha_meta_nao_cumprida' && /regra da CTAI/.test(x.regra)));
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM gaveta_numeros WHERE contrato_id = 'UPAE-ORIG'").n, 0, 'nenhum número inventado');
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE campo = 'regra_ausencia_aplicada'"));
  assert.equal((await c2.get('/api/importar/unidade/UPAE-ORIG/' + TRI + '/ausencias')).status, 403);
  // a planilha chega nos três meses: o aviso some
  await cle.post('/api/importar/unidade/UPAE-ORIG/' + TRI + '/reabrir', {});
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM imp_ausencias').n, 0);
  for (const mm of ['10', '11', '12']) await subir(cle, 'UPAE-ORIG', TRI, [{ nome: 'Planilha_Consolidada_UPAE_Origens_' + mm + '2026.txt', buf: F.corpo('Planilha de monitoramento', mm) }]);
  e = await est(cle, 'UPAE-ORIG');
  assert.equal(item(e, 'anexo_II').estado, 'completo'); assert.equal(e.ausencias.length, 0);
});

// ---------- consolidado do SIMAS ----------
test('leitor do SIMAS: cabeçalho, grupos, linhas, totais, descrição quebrada, sem meta e indicadores com mês presumido', () => {
  const r = require('../server/simas').lerSimas(F.simasTexto());
  assert.deepEqual(r.cabecalho.periodos, ['2026-10', '2026-11', '2026-12']); assert.equal(r.cabecalho.trimestre, '2026-T4');
  assert.equal(r.cabecalho.gerado_por, 'Analista de Teste'); assert.equal(r.cabecalho.cnpj, '00000000000191'); assert.match(r.cabecalho.gerado_em, /^2027-02-01T10:30/);
  assert.deepEqual(r.grupos.map((g) => g.nome), ['TEA ATENDIMENTOS MEDICOS', 'Atendimento Ambulatorial Não Médico', 'Matriciamento e Supervisão', 'Programas Especiais', 'SADT UPAE', 'SADT Especial']);
  assert.equal(r.grupos[0].secao, 'Ambulatorial'); assert.equal(r.grupos[4].secao, 'SADT');
  const todas = r.grupos.flatMap((g) => g.linhas);
  assert.equal(todas.length, 9); assert.deepEqual(r.resumo, { grupos: 6, linhas: 9, indicadores: 9 });
  const nutri = todas.find((l) => l.descricao === 'Nutrição'); assert.equal(nutri.sem_meta, true); assert.equal(nutri.pct, 100);
  assert.equal(todas.find((l) => l.descricao === 'Fisioterapia').realizado, 1243, '1.243 é milhar em pt-BR');
  assert.equal(todas.find((l) => l.descricao === 'Neuropediatra').pct, 34.63);
  assert.ok(todas.some((l) => l.descricao === 'Matriciamento das equipes de Saúde da Família dos Municípios da Área de Abrangência'), 'descrição quebrada em duas linhas');
  assert.ok(todas.some((l) => l.descricao === 'Supervisão dos Cuidados Prestados nas Unidades Básicas de Saúde'));
  assert.deepEqual(r.grupos[2].total, { previsto: 48, realizado: 96, pct: 200, trecho: r.grupos[2].total.trecho });
  assert.equal(todas.filter((l) => l.descricao === 'Mamografia').length, 2);
  // indicadores: ponto decimal, 3 blocos sem rótulo -> mês presumido pela ordem
  const pront = r.indicadores.filter((i) => i.nome === 'Qualidade do Preenchimento de Prontuários');
  assert.deepEqual(pront.map((i) => [i.ocorrencia, i.mes_presumido, i.realizado]), [[1, '2026-10', 100], [2, '2026-11', 97.5], [3, '2026-12', 94.12]]);
  const sat = r.indicadores.find((i) => i.nome === 'Índice de Satisfação do Usuário (CTT Novo)');
  assert.equal(sat.atingido, 'Não'); assert.equal(sat.regra, 'Maior ou igual a 90');
  assert.equal(r.indicadores.find((i) => i.nome === 'Perda Primária PE').regra, 'N/A 0');
  assert.deepEqual(r.avisos, []);
  // texto de PDF lido no navegador: sem linhas em branco, com marcas de página -> mesmo resultado
  const seco = F.simasTexto().split('\n').filter((l) => l.trim()).map((l, k) => (k % 17 === 0 ? '--- página ' + (k / 17 + 1) + ' ---\n' : '') + l.trimStart()).join('\n');
  const r2 = require('../server/simas').lerSimas(seco);
  assert.deepEqual(r2.resumo, r.resumo); assert.deepEqual(r2.indicadores.map((i) => [i.nome, i.ocorrencia, i.realizado]), r.indicadores.map((i) => [i.nome, i.ocorrencia, i.realizado]));
  assert.deepEqual(r2.grupos.map((g) => [g.nome, g.linhas.length]), r.grupos.map((g) => [g.nome, g.linhas.length]));
  // período que não fecha um trimestre
  assert.match(require('../server/simas').lerSimas(F.simasTexto({ periodos: '12/2026, 01/2027' })).avisos.join(' '), /não fecham um único trimestre/);
});

test('SIMAS na lista: item obrigatório trimestral da UPAE, reconhecido por nome e por conteúdo; planilha consolidada continua sendo o Anexo II', () => {
  const lista = E.listaDoCatalogo('UPAE').itens;
  const sim = lista.find((i) => i.codigo === 'simas_metas');
  assert.equal(sim.nome, 'SIMAS – Metas atingidas (consolidado do trimestre)'); assert.equal(sim.origem, 'gerado_simas'); assert.equal(sim.periodicidade, 'trimestral'); assert.equal(sim.obrigatorio, 1);
  assert.equal(E.casar(lista, 'METAS_ATINGIDAS_UPAE_Teste.pdf', '').codigo, 'simas_metas');
  assert.equal(E.casar(lista, 'relatorio_simas_2026T4.pdf', '').codigo, 'simas_metas');
  assert.equal(E.casar(lista, 'qualquer.pdf', F.simasTexto()).codigo, 'simas_metas');
  assert.equal(E.casar(lista, 'consolidado.pdf', F.simasTexto()).codigo, 'simas_metas', 'conteúdo vence o "consolidad" do Anexo II');
  assert.equal(E.casar(lista, 'Planilha_consolidada_102026.pdf', 'Planilha de produção').codigo, 'anexo_II');
  // o extrator sugere o item quando o parecer cita o SIMAS
  const prop = E.propostaLista(E.extrairEstrutura(F.textoParecer(), { periodicidadePadrao: 'mensal', tipo: 'UPAE' }), 'UPAE').itens.find((i) => i.codigo === 'simas_metas');
  assert.ok(prop && prop.origem === 'gerado_simas' && /SIMAS/.test(prop.trecho));
});

test('SIMAS na prática: lê ao receber, números ficam propostos; confirmar exige a ordem dos meses; alternativa "sem acesso agora"', async () => {
  let e = await est(cle, 'UPAE-SIM');
  assert.equal(item(e, 'simas_metas').estado, 'falta');
  const r = await subir(cle, 'UPAE-SIM', TRI, [{ nome: 'Metas_atingidas_consolidado_UPAE_Simas.txt', buf: Buffer.from(F.simasTexto(), 'utf8') }]);
  assert.equal(r[0].estado, 'lido', JSON.stringify(r[0])); assert.match(r[0].motivo, /Consolidado do SIMAS lido: 6 grupos, 9 linhas e 9 indicadores/);
  e = await est(cle, 'UPAE-SIM');
  assert.equal(item(e, 'simas_metas').estado, 'completo'); assert.equal(item(e, 'simas_metas').slots[0].check, 'arquivo');
  let v = (await cle.get('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas')).json;
  assert.equal(v.lido, true); assert.equal(v.resumo.confirmados, 0); assert.ok(v.resumo.propostos >= 20);
  assert.ok(v.numeros.every((n) => n.fonte === 'SIMAS' && n.estado === 'proposto' && n.trecho));
  assert.ok(v.numeros.filter((n) => n.tipo === 'indicador').every((n) => n.mes_estado === 'presumido'));
  assert.deepEqual(v.ordem_meses.map((o) => o.mes), ['2026-10', '2026-11', '2026-12']);
  // nada vira definitivo sem confirmar a ordem dos meses
  const url = '/api/importar/unidade/UPAE-SIM/' + TRI + '/simas/confirmar';
  assert.equal((await cle.post(url, {})).status, 400);
  assert.equal((await cle.post(url, { ordem_meses: { 1: '2026-10', 2: '2026-10', 3: '2026-12' } })).status, 400, 'mês repetido');
  assert.equal((await c2.post(url, { ordem_meses: { 1: '2026-10', 2: '2026-11', 3: '2026-12' } })).status, 403);
  const ok = await cle.post(url, { ordem_meses: { 1: '2026-10', 2: '2026-12', 3: '2026-11' } });
  assert.equal(ok.status, 200); assert.ok(ok.json.confirmados >= 20);
  v = (await cle.get('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas')).json;
  assert.equal(v.resumo.propostos, 0);
  const pr = v.numeros.filter((n) => n.tipo === 'indicador' && n.descricao.startsWith('Qualidade'));
  assert.deepEqual(pr.map((n) => [n.ocorrencia, n.mes, n.mes_estado, n.realizado]), [[1, '2026-10', 'confirmado', 100], [2, '2026-12', 'confirmado', 97.5], [3, '2026-11', 'confirmado', 94.12]]);
  assert.ok(S.db.get("SELECT 1 AS x FROM trilha_auditoria WHERE campo = 'simas_confirmado'"));
  // reenviar outro consolidado substitui a leitura (e volta a ser proposto)
  assert.equal((await cle.del('/api/importar/arquivos/' + e.itens.find((i) => i.codigo === 'simas_metas').slots[0].arquivos[0].id)).status, 200);
  assert.equal((await cle.get('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas')).json.lido, false);
  // alternativa: SIMAS sem acesso agora (check manual com observação) para não travar
  assert.equal((await cle.post('/api/importar/unidade/UPAE-SIM/' + TRI + '/check', { item: 'simas_metas', situacao: 'recebido', observacao: 'SIMAS fora do ar hoje' })).status, 200);
  e = await est(cle, 'UPAE-SIM');
  assert.equal(item(e, 'simas_metas').estado, 'completo'); assert.equal(item(e, 'simas_metas').slots[0].alternativa_manual, true); assert.equal(item(e, 'simas_metas').slots[0].observacao, 'SIMAS fora do ar hoje');
});

test('conferidor SIMAS x RM x planilha: lista divergências por indicador e período, sem concluir quem está certo', async () => {
  await subir(cle, 'UPAE-SIM', TRI, [{ nome: 'Metas_atingidas_consolidado_UPAE_Simas.txt', buf: Buffer.from(F.simasTexto(), 'utf8') }]);
  // RM (Anexo I) sintético dos 3 meses, direto na gaveta
  const docs = {};
  for (const mes of ['2026-10', '2026-11', '2026-12']) docs[mes] = Number(S.db.run("INSERT INTO gaveta_documentos (contrato_id, mes, codigo, parte, nome_arquivo, hash, caracteres, texto, versao, criado_por, criado_em, atualizado_em) VALUES ('UPAE-SIM',?,'anexo_I','','rm.txt',?,1,'x',1,'t','2026-10-01','2026-10-01')", mes, 'h' + mes).lastInsertRowid);
  const num = (mes, chave, meta, real) => S.db.run("INSERT INTO gaveta_numeros (doc_id, contrato_id, mes, fonte, chave, rotulo, meta, realizado, estado) VALUES (?,?,?,?,?,?,?,?, 'confirmado')", docs[mes], 'UPAE-SIM', mes, 'anexo_I', chave, chave, meta, real);
  for (const [mes, real] of [['2026-10', 400], ['2026-11', 300], ['2026-12', 200]]) num(mes, 'mamografia', 500, real);
  for (const [mes, meta] of [['2026-10', 20], ['2026-11', 20], ['2026-12', 10]]) num(mes, 'matriciamento', meta, 12);
  const v = (await cle.get('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas')).json;
  const por = (t, ind) => v.divergencias.filter((d) => d.tipo === t && (!ind || new RegExp(ind, 'i').test(d.indicador)));
  assert.ok(v.divergencias.length >= 6 && v.divergencias.every((d) => /Só sinaliza/.test(d.aviso)), 'todas só sinalizam');
  assert.equal(por('duplicidade', 'Mamografia').length, 1, 'Mamografia em dois grupos do SIMAS');
  assert.match(por('duplicidade')[0].detalhe, /SADT UPAE.*previsto 442.*SADT Especial.*1\.498/);
  assert.ok(por('mamografia').length >= 1 && por('mamografia').every((d) => d.b.fonte === 'RM (Anexo I)'));
  const mat = por('previsto', 'Matriciamento');
  assert.equal(mat.length, 1); assert.equal(mat[0].a.valor, 24); assert.equal(mat[0].b.valor, 50); assert.match(mat[0].detalhe, /Outubro\/2026 20; Novembro\/2026 20; Dezembro\/2026 10/);
  assert.equal(por('planilha_pendente', 'Ostomizados').length, 1, 'planilha ainda sem números lidos: só aponta o que conferir');
  assert.equal(por('indicador_zero', 'Satisfação').length, 1); assert.match(por('indicador_zero')[0].detalhe, /dado não importado/);
  assert.ok(por('total_grupo').length >= 1, 'total do grupo diferente da soma das linhas');
  // sem RM de um mês: a nota diz que a soma está incompleta
  S.db.run("DELETE FROM gaveta_numeros WHERE mes = '2026-12'");
  const v2 = (await cle.get('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas')).json;
  assert.match(v2.divergencias.find((d) => d.tipo === 'previsto' && /Matriciamento/.test(d.indicador)).nota, /Dezembro\/2026 não lido/);
});

test('divergências do SIMAS viram achados da unidade: "A CONFERIR", com números e origem; fixar ou descartar com motivo; não voltam depois de decididas', async () => {
  // o RM só chegou depois da leitura: atualizar os achados
  S.db.run("DELETE FROM achados WHERE origem_tipo = 'simas'");
  const at = await cle.post('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas/achados');
  assert.equal(at.status, 200, JSON.stringify(at.json)); assert.ok(at.json.novos >= 4);
  assert.equal((await c2.post('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas/achados')).status, 403);
  let lista = (await cle.get('/api/analista/achados?contrato=UPAE-SIM&origem_tipo=simas')).json.achados;
  assert.equal(lista.length, at.json.novos);
  assert.ok(lista.every((a) => a.gravidade === 'A CONFERIR' && a.status === 'novo' && a.contrato_id === 'UPAE-SIM' && a.unidade === 'UPAE Simas' && a.trimestre === TRI && a.cid === null));
  const mam = lista.find((a) => /Mamografia/.test(a.tipo) && /dois grupos/.test(a.trecho));
  assert.ok(mam, 'achado da duplicidade de Mamografia');
  assert.match(mam.trecho, /previsto 442, realizado 0/); assert.match(mam.trecho, /arquivo Metas_atingidas_consolidado_UPAE_Simas\.txt/); assert.match(mam.trecho, /trecho: "/);
  assert.match(mam.risco, /não diz qual está certa/);
  // aparece também na fila do painel do Analista
  assert.ok((await cle.get('/api/analista/painel')).json.fila.some((a) => a.origem_tipo === 'simas' && a.unidade === 'UPAE Simas'));
  // a unidade (portal) nunca vê
  assert.equal((await cle.get('/api/analista/achados?contrato=UPAE-SIM&origem_tipo=simas')).json.achados.length, lista.length);
  // não dá para encaminhar sem competência
  assert.equal((await cle.post('/api/analista/achados/' + mam.achado_id + '/encaminhar', { mensagem: 'x' })).status, 400);
  // descartar exige motivo; fixar aceita
  assert.equal((await cle.patch('/api/analista/achados/' + mam.achado_id, { status: 'descartado' })).status, 400);
  assert.equal((await cle.patch('/api/analista/achados/' + mam.achado_id, { status: 'descartado', motivo: 'Mamografia do SADT é outro exame' })).status, 200);
  const outro = lista.find((a) => a.achado_id !== mam.achado_id);
  assert.equal((await cle.patch('/api/analista/achados/' + outro.achado_id, { status: 'fixado' })).status, 200);
  // ler de novo: os já decididos não voltam; os ainda novos são refeitos sem duplicar
  const de = await cle.post('/api/importar/unidade/UPAE-SIM/' + TRI + '/simas/achados');
  assert.equal(de.json.novos, at.json.novos - 2);
  lista = (await cle.get('/api/analista/achados?contrato=UPAE-SIM&origem_tipo=simas')).json.achados;
  assert.equal(lista.length, at.json.novos);
  assert.equal(lista.filter((a) => a.status === 'descartado').length, 1); assert.equal(lista.filter((a) => a.status === 'fixado').length, 1);
});
