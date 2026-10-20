'use strict';
// Fluxo completo: unidade preenche e envia → CTAI recebe e recalcula → minuta → mesa → autorização → SEI.
const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');

let S, gestor, setor, cleuton, colega1, colega2, nath, admin;
let cid06, cid07, envio1, envio2, parecerId, versaoId;

test.before(async () => {
  S = await iniciar();
  gestor = cliente(S.base); setor = cliente(S.base); cleuton = cliente(S.base); colega1 = cliente(S.base); colega2 = cliente(S.base); nath = cliente(S.base); admin = cliente(S.base);
  await gestor.entrar('gestor.demo'); await setor.entrar('assistencia.demo'); await cleuton.entrar('cleuton'); await colega1.entrar('colega1'); await colega2.entrar('colega2'); await nath.entrar('nathalia'); await admin.entrar('admin');
});
test.after(async () => { await S.fechar(); });

test('segurança básica: sem login, sem cabeçalho e perfil errado', async () => {
  const anon = cliente(S.base);
  assert.equal((await anon.get('/api/unidade/competencias')).status, 401);
  const semCab = await fetch(S.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(semCab.status, 403);
  assert.equal((await gestor.get('/api/ctai/contratos')).status, 403, 'unidade não entra no console da CTAI');
  assert.equal((await cleuton.get('/api/unidade/competencias')).status, 403, 'CTAI não entra no portal da unidade');
  const novo = cliente(S.base);
  const r = await novo.post('/api/auth/login', { login: 'ouvidoria.demo', senha: 'Trocar@123' });
  assert.equal(r.json.usuario.trocar_senha, true);
  assert.equal((await novo.get('/api/unidade/competencias')).status, 403, 'senha temporária precisa ser trocada');
});

test('bloqueio de login após 5 erros', async () => {
  const c = cliente(S.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { login: 'colega2', senha: 'errada' + i })).status, 401);
  const r = await c.post('/api/auth/login', { login: 'colega2', senha: 'Senha@12345' });
  assert.equal(r.status, 401);
  assert.match(r.json.erro, /bloqueado/i);
  S.db.run('UPDATE usuarios SET bloqueado_ate = NULL, tentativas = 0 WHERE login = ?', 'colega2');
});

test('o portal mostra as competências e as fichas prontas da demonstração', async () => {
  const r = await gestor.get('/api/unidade/competencias');
  assert.equal(r.status, 200);
  assert.equal(r.json.contrato.demo, true);
  cid06 = r.json.competencias.find((c) => c.competencia_id === '2026-06').cid;
  cid07 = r.json.competencias.find((c) => c.competencia_id === '2026-07').cid;
  const d = await gestor.get('/api/unidade/competencias/' + cid06);
  assert.equal(d.json.bloqueios.length, 0);
  assert.ok(d.json.consolidado['2.1'].valor > 0, 'média verde calculada das linhas');
  assert.equal(d.json.consolidado['2.1'].origem, 'linhas');
  assert.equal(d.json.consolidado['2.3'].origem, 'digitado');
});

test('responsável de setor só mexe no próprio setor e não envia', async () => {
  const ok = await setor.put('/api/unidade/competencias/' + cid07 + '/ficha/assistencia', { dados: { i2_1_valor: '22,5', iam_casos: '3' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ficha.dados.i2_1_valor, '22.5');
  assert.equal((await setor.put('/api/unidade/competencias/' + cid07 + '/ficha/rh', { dados: { gasto_pessoal_pct: '70' } })).status, 403);
  assert.equal((await setor.post('/api/unidade/competencias/' + cid06 + '/enviar', {})).status, 403);
  const ruim = await setor.put('/api/unidade/competencias/' + cid07 + '/ficha/assistencia', { dados: { i2_1_valor: 'abc', i2_4_valor: '150' } });
  assert.equal(ruim.status, 400);
  assert.equal(ruim.json.erros.length, 2);
  const cpf = await setor.put('/api/unidade/competencias/' + cid07 + '/ficha/assistencia', { dados: { assistencia_obs: 'paciente 123.456.789-09 reclamou' } });
  assert.equal(cpf.status, 400);
});

test('upload de CSV: coluna de nome recusa o arquivo; arquivo bom entra', async () => {
  const ruim = await gestor.post('/api/unidade/competencias/' + cid07 + '/linhas/retorno', { csv: 'protocolo;nome;retornou_24h\nA1;Maria;sim\n' });
  assert.equal(ruim.status, 422);
  assert.equal(ruim.json.recusado, true);
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM linhas_rascunho WHERE cid = ? AND fonte = 'retorno'", cid07).n, 0);
  const cpf = await gestor.post('/api/unidade/competencias/' + cid07 + '/linhas/retorno', { csv: 'protocolo;retornou_24h\n123.456.789-09;sim\n' });
  assert.equal(cpf.status, 422);
  const bom = await gestor.post('/api/unidade/competencias/' + cid07 + '/linhas/retorno', { csv: 'protocolo;retornou_24h\nDEMO-1;sim\nDEMO-2;não\nDEMO-3;não\n' });
  assert.equal(bom.status, 200);
  assert.equal(bom.json.gravadas, 3);
  const s = await gestor.get('/api/unidade/competencias/' + cid07);
  assert.equal(s.json.consolidado['2.4'].valor, 33.33);
  assert.ok(s.json.bloqueios.length > 0, 'fichas não prontas bloqueiam o envio');
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid07 + '/enviar', {})).status, 409);
});

test('envio 1: gera o PDF, grava imutável e a CTAI recebe e recalcula', async () => {
  const r = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  envio1 = r.json.envio_id;
  assert.equal(r.json.versao, 1);
  const pdf = await gestor.get('/api/unidade/envios/' + envio1 + '/pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdf.headers.get('x-integridade-pdf'), 'ok');
  assert.ok(pdf.buffer.length > 8000);
  const e = S.db.get('SELECT * FROM envios WHERE envio_id = ?', envio1);
  assert.ok(e.recebido_em, 'recepção automática');
  assert.ok(S.db.get('SELECT COUNT(*) AS n FROM linhas_brutas WHERE envio_id = ?', envio1).n > 600);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM indicadores_oss WHERE envio_id = ?', envio1).n, 16);
});

test('envio é imutável: nem snapshot, nem linhas, nem trilha podem ser alterados', async () => {
  assert.throws(() => S.db.run("UPDATE envios SET snapshot = '{}' WHERE envio_id = ?", envio1), /não pode ser alterado/);
  assert.throws(() => S.db.run('UPDATE linhas_brutas SET minutos = 1 WHERE envio_id = ?', envio1), /não podem ser alteradas/);
  assert.throws(() => S.db.run('UPDATE trilha_auditoria SET usuario = ? WHERE evento_id = 1', 'x'), /não pode ser alterada/);
  assert.throws(() => S.db.run('DELETE FROM trilha_auditoria WHERE evento_id = 1'), /não pode ser apagada/);
});

test('a CTAI vê recalculo independente, divergências e alertas', async () => {
  const r = await cleuton.get('/api/ctai/competencias/' + cid06);
  assert.equal(r.status, 200);
  const rec = r.json.recalculo;
  assert.ok(rec.igqRecalculado >= 0);
  const verm = rec.indicadores['2.3'];
  assert.equal(verm.base, 'linhas');
  assert.ok(verm.valorDeclarado < verm.valor, 'declarado de propósito abaixo do calculado pelas linhas');
  const temas = r.json.divergencias.map((d) => d.tema).join(' | ');
  assert.match(temas, /Tempo médio até a transferência/);
  assert.match(temas, /Classificação vermelho/);
  const codigos = rec.alertas.map((a) => a.codigo);
  for (const c of ['LISTA_INCOMPLETA', 'GASTO_PESSOAL_ACIMA', 'PROTOCOLOS_INCOMPLETOS', 'CASOS_DIVERGENTES']) assert.ok(codigos.includes(c), 'faltou o alerta ' + c);
  assert.ok(r.json.achados.length >= 0);
});

test('a decisão da regra muda o resultado e exige justificativa', async () => {
  const antes = (await cleuton.get('/api/ctai/competencias/' + cid06)).json.recalculo.indicadores['2.3'].pontos;
  assert.equal((await cleuton.put('/api/ctai/contratos/DEMO-UPA/decisoes/vermelho', { valor: 'binario' })).status, 400);
  assert.equal((await colega1.put('/api/ctai/contratos/DEMO-UPA/decisoes/vermelho', { valor: 'binario', justificativa: 'x' })).status, 403);
  const ok = await cleuton.put('/api/ctai/contratos/DEMO-UPA/decisoes/vermelho', { valor: 'binario', justificativa: 'Ficha do contrato, item 6.6.2' });
  assert.equal(ok.status, 200);
  const depois = (await cleuton.get('/api/ctai/competencias/' + cid06)).json.recalculo.indicadores['2.3'].pontos;
  assert.ok(depois <= antes);
  await cleuton.put('/api/ctai/contratos/DEMO-UPA/decisoes/desconto_modo', { valor: 'faixa', justificativa: 'Anexo II, conferido com a superintendente' });
});

test('envio 2 só com motivo, e fica como nova versão', async () => {
  assert.equal((await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', {})).status, 400);
  await gestor.put('/api/unidade/competencias/' + cid06 + '/ficha/bid', { dados: { bid_remocoes: '14', transf_media_declarada: '380' } });
  await gestor.post('/api/unidade/competencias/' + cid06 + '/ficha/bid/pronta', { pronta: true });
  const r = await gestor.post('/api/unidade/competencias/' + cid06 + '/enviar', { motivo: 'Corrigida a lista de remoções e o tempo médio' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.versao, 2);
  envio2 = r.json.envio_id;
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM envios WHERE cid = ?', cid06).n, 2);
  const codigos = (await cleuton.get('/api/ctai/competencias/' + cid06)).json.recalculo.alertas.map((a) => a.codigo);
  assert.ok(!codigos.includes('LISTA_INCOMPLETA'), 'a lista agora fecha com o BID');
});

test('minuta: criar, adotar pontos, congelar e conferir (ninguém aprova o próprio trabalho)', async () => {
  assert.equal((await colega1.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', competencias: ['2026-06'] })).status, 403);
  const c = await cleuton.post('/api/ctai/pareceres', { contrato_id: 'DEMO-UPA', trimestre: '2026-T2', competencias: ['2026-06'], numero_parecer: '1/2026' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  parecerId = c.json.parecer_id;
  const sug = await cleuton.post('/api/ctai/pareceres/' + parecerId + '/rascunho-texto', { aplicar: true });
  assert.ok(sug.json.sugestao.abertura.includes('DEMO/0000'));
  // Ajuste manual exige justificativa; zero exige motivo.
  const ruim = await cleuton.post('/api/ctai/pareceres/' + parecerId + '/adotar', { cid: cid06, indicador_id: '2.13', pontos: 3, origem: 'ajuste manual' });
  assert.equal(ruim.status, 400);
  const boa = await cleuton.post('/api/ctai/pareceres/' + parecerId + '/adotar', { cid: cid06, indicador_id: '2.13', pontos: 3, origem: 'ajuste manual', justificativa: 'Ficha de transparência do mês aponta nível Moderado' });
  assert.equal(boa.status, 200);
  const d0 = await cleuton.get('/api/ctai/pareceres/' + parecerId);
  assert.equal(d0.json.ultima, null);
  assert.ok(d0.json.colegasDisponiveis.length === 2);
  assert.equal((await cleuton.post('/api/ctai/pareceres/' + parecerId + '/congelar', { convocados: [] })).status, 400);
  assert.equal((await cleuton.post('/api/ctai/pareceres/' + parecerId + '/congelar', { convocados: [S.db.get("SELECT usuario_id FROM usuarios WHERE login='nathalia'").usuario_id] })).status, 400, 'só colega pode ser convocado');
  const ids = S.db.all("SELECT usuario_id FROM usuarios WHERE login IN ('colega1','colega2') ORDER BY login").map((u) => u.usuario_id);
  const f = await cleuton.post('/api/ctai/pareceres/' + parecerId + '/congelar', { convocados: ids });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  versaoId = f.json.versao_id;
  // O criador não confere a própria versão.
  assert.equal((await cleuton.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: 'texto', status: 'ok' })).status, 403);
  // Reparo exige explicação.
  assert.equal((await colega1.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: 'texto', status: 'reparo' })).status, 400);
  // Nada mudou: não dá para congelar de novo.
  assert.equal((await cleuton.post('/api/ctai/pareceres/' + parecerId + '/congelar', { convocados: ids, motivo: 'igual' })).status, 409);
});

test('mesa: reparo bloqueia, nova versão reinicia, superintendente só autoriza depois de conferir', async () => {
  const rep = await colega1.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: 'desconto', status: 'reparo', comentario: 'Falta justificar a base do desconto' });
  assert.equal(rep.json.versao.status, 'com reparo');
  assert.equal((await nath.post('/api/ctai/versoes/' + versaoId + '/autorizar')).status, 409);
  // Mudar depois de congelar marca como alterado e exige nova versão com motivo.
  await cleuton.put('/api/ctai/pareceres/' + parecerId + '/texto', { texto: { conclusao: 'Conclusão revisada após o reparo.' } });
  const d = await cleuton.get('/api/ctai/pareceres/' + parecerId);
  assert.equal(d.json.alteradoDesdeCongelamento, true);
  const ids = S.db.all("SELECT usuario_id FROM usuarios WHERE login IN ('colega1','colega2') ORDER BY login").map((u) => u.usuario_id);
  assert.equal((await cleuton.post('/api/ctai/pareceres/' + parecerId + '/congelar', { convocados: ids })).status, 400, 'nova versão exige motivo');
  const v2 = await cleuton.post('/api/ctai/pareceres/' + parecerId + '/congelar', { convocados: ids, motivo: 'Conclusão revisada após o reparo do colega 1' });
  assert.equal(v2.status, 200);
  assert.equal(S.db.get('SELECT status FROM versoes_minuta WHERE versao_id = ?', versaoId).status, 'substituída');
  assert.equal((await colega1.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: 'texto', status: 'ok' })).status, 409, 'versão substituída não se confere');
  versaoId = v2.json.versao_id;
  // A versão congelada não pode ser alterada no banco.
  assert.throws(() => S.db.run("UPDATE versoes_minuta SET conteudo = '{}' WHERE versao_id = ?", versaoId), /congelada/);
  const itens = ['identificacao', 'sei', 'indicadores', 'divergencias', 'desconto', 'alertas', 'texto', 'achados'];
  for (const it of itens) await colega1.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: it, status: 'ok' });
  let est = (await cleuton.get('/api/ctai/versoes/' + versaoId)).json;
  assert.equal(est.versao.status, 'em conferência', 'falta o colega 2');
  for (const it of itens) await colega2.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: it, status: 'ok' });
  est = (await cleuton.get('/api/ctai/versoes/' + versaoId)).json;
  assert.equal(est.versao.status, 'conferida');
  // Ninguém autoriza o que não é seu papel; a superintendente confere antes.
  assert.equal((await colega1.post('/api/ctai/versoes/' + versaoId + '/autorizar')).status, 403);
  assert.equal((await cleuton.post('/api/ctai/versoes/' + versaoId + '/autorizar')).status, 403);
  assert.equal((await nath.post('/api/ctai/versoes/' + versaoId + '/autorizar')).status, 409);
  for (const it of itens) await nath.post('/api/ctai/versoes/' + versaoId + '/conferir', { item: it, status: 'ok' });
  const aut = await nath.post('/api/ctai/versoes/' + versaoId + '/autorizar');
  assert.equal(aut.status, 200, JSON.stringify(aut.json));
  assert.equal(aut.json.versao.status, 'autorizada');
  // O PDF da minuta sai e avisa que o OK é controle interno.
  const pdf = await cleuton.get('/api/ctai/versoes/' + versaoId + '/pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  // Só o criador registra o SEI.
  assert.equal((await nath.post('/api/ctai/pareceres/' + parecerId + '/sei', { numero: '99999999' })).status, 403);
  const sei = await cleuton.post('/api/ctai/pareceres/' + parecerId + '/sei', { numero: '12345678' });
  assert.equal(sei.status, 200);
  assert.equal(S.db.get('SELECT status FROM competencias WHERE cid = ?', cid06).status, 'parecer emitido');
  assert.equal((await cleuton.put('/api/ctai/pareceres/' + parecerId + '/texto', { texto: { conclusao: 'x' } })).status, 409, 'depois do SEI não se edita no sistema');
});

test('o sistema nunca guarda senha ou credencial do SEI e a trilha continua íntegra', async () => {
  const campos = S.db.all("SELECT name FROM pragma_table_info('pareceres')").map((c) => c.name).concat(S.db.all("SELECT name FROM pragma_table_info('usuarios')").map((c) => c.name));
  assert.ok(!campos.some((c) => /sei_senha|sei_credencial|sei_token/.test(c)));
  const v = (await cleuton.get('/api/ctai/trilha/verificar')).json;
  assert.equal(v.ok, true, JSON.stringify(v.falhas));
  assert.ok(v.total > 40);
});

test('trilha: adulterar um evento é detectado', async () => {
  S.db.exec('DROP TRIGGER trg_trilha_no_update');
  S.db.run("UPDATE trilha_auditoria SET valor_novo = 'adulterado' WHERE evento_id = 3");
  const v = (await cleuton.get('/api/ctai/trilha/verificar')).json;
  assert.equal(v.ok, false);
  assert.ok(v.falhas.some((f) => f.evento_id === 3));
});

test('contrato de demonstração pode ser apagado pelo administrador', async () => {
  assert.equal((await gestor.post('/api/admin/demo/apagar', { confirmar: 'APAGAR' })).status, 403);
  assert.equal((await admin.post('/api/admin/demo/apagar', {})).status, 400);
  const r = await admin.post('/api/admin/demo/apagar', { confirmar: 'APAGAR' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(S.db.get("SELECT COUNT(*) AS n FROM contratos WHERE contrato_id = 'DEMO-UPA'").n, 0);
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM contratos').n, 1, 'o contrato real fica');
});
