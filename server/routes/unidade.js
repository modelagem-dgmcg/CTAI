'use strict';
// Portal da Unidade: fichas por setor, listas (linhas brutas), conferência antes do envio, envio e PDF.
const express = require('express');
const A = require('../auth');
const D = require('../dominio');
const F = require('../../core/formularios');
const L = require('../../core/linhas');
const U = require('../../core/util');
const E = require('../envios');
const SEI = require('../sei');
const achadosDb = require('../achados');
const PZ = require('../prazos');
const trilha = require('../trilha');
const sync = require('../../adapters/mv/sync');

const { erro } = A;
const PERFIS = ['gestor_unidade', 'setor_unidade'];

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, PERFIS));

  // Contrato do usuário (admin escolhe com ?contrato=).
  const contratoDe = (req) => req.usuario.perfil === 'admin' ? (req.query.contrato || 'DEMO-UPA') : req.usuario.contrato_id;
  const comp = (req) => { const c = D.competenciaPorCid(db, req.params.cid); D.exigirContrato(req.usuario, c.contrato_id); return c; };

  // ---------- Equipe da unidade (só o gestor da unidade; nunca outra unidade nem a CTAI) ----------
  const EQ = require('../equipe');
  const gestor = (req) => { if (req.usuario.perfil !== 'gestor_unidade') throw erro(403, 'Só o gestor da unidade cuida da equipe.'); return req.usuario; };
  r.get('/equipe', (req, res) => res.json(EQ.listar(db, gestor(req))));
  r.post('/equipe', (req, res) => res.json(EQ.criar(db, req, gestor(req), req.body || {})));
  r.put('/equipe/fichas/:setor', (req, res) => { EQ.trocarResponsavel(db, req, gestor(req), req.params.setor, req.body && req.body.usuario_id); res.json(EQ.listar(db, req.usuario)); });
  r.patch('/equipe/:id', (req, res) => { EQ.atualizar(db, req, gestor(req), req.params.id, req.body || {}); res.json({ ok: true }); });
  r.post('/equipe/:id/ativo', (req, res) => { EQ.ativar(db, req, gestor(req), req.params.id, !!(req.body && req.body.ativo)); res.json({ ok: true }); });
  r.post('/equipe/:id/senha', (req, res) => res.json(Object.assign({ ok: true }, EQ.senhaTemporaria(db, req, gestor(req), req.params.id, req.body && req.body.senha))));

  r.get('/competencias', (req, res) => {
    const contrato = contratoDe(req);
    const c = db.get('SELECT contrato_id, unidade, oss, numero_cg, demo FROM contratos WHERE contrato_id = ?', contrato);
    if (!c) throw erro(404, 'Contrato não encontrado.');
    const lista = db.all('SELECT cid, competencia_id, status, mes_implantacao, processo_sei FROM competencias WHERE contrato_id = ? ORDER BY competencia_id DESC', contrato).map((k) => {
      const f = D.fichasDaCompetencia(db, k.cid);
      const ult = D.ultimoEnvio(db, k.cid);
      return Object.assign(k, { mes_implantacao: !!k.mes_implantacao, fichasProntas: Object.values(f).filter((x) => x.status === 'pronta').length, fichasTotal: F.SETORES.length, versaoEnvio: ult ? ult.versao : null, seiAlertas: SEI.resumoAlertas(db, k.cid), prazos: PZ.daCompetencia(db, k) });
    });
    res.json({ contrato: Object.assign(c, { demo: !!c.demo }), competencias: lista });
  });

  r.get('/competencias/:cid', (req, res) => {
    const c = comp(req);
    const s = E.situacaoAntesDoEnvio(db, c.cid);
    const contagem = {};
    for (const f of Object.keys(F.FONTES)) contagem[f] = { confirmadas: 0, pendentes: 0 };
    for (const x of db.all('SELECT fonte, confirmada, COUNT(*) AS n FROM linhas_rascunho WHERE cid = ? GROUP BY fonte, confirmada', c.cid)) contagem[x.fonte][x.confirmada ? 'confirmadas' : 'pendentes'] = x.n;
    const envios = db.all('SELECT envio_id, versao, motivo, enviado_por, enviado_em, hash_snapshot, pdf_hash FROM envios WHERE cid = ? ORDER BY versao DESC', c.cid);
    const sei = SEI.canais(db, c.cid);
    const lotes = db.all("SELECT * FROM lotes_api WHERE cid = ? AND status = 'pendente'", c.cid);
    res.json({
      competencia: { cid: c.cid, competencia_id: c.competencia_id, status: c.status, mes_implantacao: c.mes_implantacao, unidade: c.unidade, oss: c.oss, demo: c.demo },
      setores: F.SETORES.map((st) => ({ id: st.id, nome: st.nome, resumo: st.resumo, indicadores: st.indicadores, fontes: st.fontes, status: s.fichas[st.id].status, atualizado_por: s.fichas[st.id].atualizado_por, atualizado_em: s.fichas[st.id].atualizado_em })),
      prazos: PZ.daCompetencia(db, c), contagem, consolidado: s.consolidado, pontos: s.pontos, avisos: s.avisos, bloqueios: s.bloqueios, envios, sei, lotes,
      voce: { perfil: req.usuario.perfil, setor: req.usuario.setor, setores: A.setoresDe(req.usuario), podeEnviar: req.usuario.perfil === 'gestor_unidade' || req.usuario.perfil === 'admin' },
    });
  });

  r.get('/competencias/:cid/ficha/:setor', (req, res) => {
    const c = comp(req);
    const st = F.setor(req.params.setor);
    if (!st) throw erro(404, 'Setor desconhecido.');
    const f = D.fichasDaCompetencia(db, c.cid)[st.id];
    res.json({ setor: st, campos: F.camposDoSetor(st.id), ficha: f, podeEditar: req.usuario.perfil === 'gestor_unidade' || req.usuario.perfil === 'admin' || req.usuario.setor === st.id });
  });

  // Lê PDF/DOCX/XLSX/CSV/TXT e propõe valores para a ficha. Não salva nada; o arquivo não fica guardado.
  r.post('/competencias/:cid/ficha/:setor/ler', async (req, res) => {
    const c = comp(req);
    const st = F.setor(req.params.setor);
    if (!st) throw erro(404, 'Setor desconhecido.');
    D.exigirSetor(req.usuario, st.id);
    const nome = String((req.body && req.body.nome) || 'arquivo').replace(/[\\/\r\n"]/g, '_').slice(0, 120);
    const ex = await require('../extrair-texto').extrair(nome, Buffer.from(String((req.body && req.body.base64) || ''), 'base64'));
    const o = await require('../../modules/analista/propor-ficha').propor({ texto: ex.texto, campos: F.camposDoSetor(st.id), mes: c.mes || c.competencia || c.cid });
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'fichas', registro: c.cid + '/' + st.id, campo: 'leitura_arquivo', valor_novo: { nome, tipo: ex.tipo, caracteres: ex.texto.length, propostos: Object.keys(o.campos).length } });
    res.json(Object.assign({ arquivo: nome, caracteres: ex.texto.length }, o));
  });

  r.put('/competencias/:cid/ficha/:setor', (req, res) => {
    const c = comp(req);
    const st = F.setor(req.params.setor);
    if (!st) throw erro(404, 'Setor desconhecido.');
    D.exigirSetor(req.usuario, st.id);
    const campos = F.camposDoSetor(st.id);
    const entrada = (req.body && req.body.dados) || {};
    const atual = D.fichasDaCompetencia(db, c.cid)[st.id];
    const dados = Object.assign({}, atual.dados);
    const erros = [];
    for (const cp of campos) {
      if (!(cp.id in entrada)) continue;
      let v = entrada[cp.id];
      if (v === null || v === undefined) v = '';
      v = String(v).trim();
      if (v === '') { delete dados[cp.id]; continue; }
      if (['inteiro', 'numero', 'percentual'].includes(cp.tipo)) {
        const n = U.numero(v);
        if (n === null) { erros.push({ campo: cp.id, mensagem: 'Número inválido: "' + v + '".' }); continue; }
        if (cp.tipo === 'inteiro' && !Number.isInteger(n)) { erros.push({ campo: cp.id, mensagem: 'Use um número inteiro.' }); continue; }
        if (cp.min !== undefined && n < cp.min) { erros.push({ campo: cp.id, mensagem: 'O mínimo é ' + cp.min + '.' }); continue; }
        if (cp.max !== undefined && n > cp.max) { erros.push({ campo: cp.id, mensagem: 'O máximo é ' + cp.max + '.' }); continue; }
        if (cp.tipo === 'percentual' && (n < 0 || n > 100)) { erros.push({ campo: cp.id, mensagem: 'Percentual entre 0 e 100.' }); continue; }
        dados[cp.id] = String(n);
      } else if (cp.tipo === 'sim_nao') {
        const b = U.simNao(v);
        if (b === null) { erros.push({ campo: cp.id, mensagem: 'Responda sim ou não.' }); continue; }
        dados[cp.id] = b ? 'sim' : 'não';
      } else if (cp.tipo === 'selecao') {
        if (!(cp.opcoes || []).includes(v)) { erros.push({ campo: cp.id, mensagem: 'Escolha uma das opções.' }); continue; }
        dados[cp.id] = v;
      } else {
        const p = L.pareceDadoPessoal(v, 'protocolo');
        const p2 = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(v) ? 'parece um CPF' : null;
        if (p || p2) { erros.push({ campo: cp.id, mensagem: 'O texto ' + (p || p2) + '. Não escreva dados de paciente.' }); continue; }
        dados[cp.id] = v.slice(0, 2000);
      }
    }
    if (erros.length) return res.status(400).json({ erro: 'Há campos com problema.', erros });
    db.run("INSERT INTO fichas (cid, setor, dados, status, atualizado_por, atualizado_em) VALUES (?,?,?, 'rascunho', ?, ?) ON CONFLICT(cid, setor) DO UPDATE SET dados = excluded.dados, status = 'rascunho', atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em",
      c.cid, st.id, JSON.stringify(dados), req.usuario.login, new Date().toISOString());
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'fichas', registro: c.cid + '/' + st.id, campo: 'dados', valor_novo: Object.keys(entrada).length + ' campo(s) salvos' });
    res.json({ ok: true, ficha: D.fichasDaCompetencia(db, c.cid)[st.id] });
  });

  r.post('/competencias/:cid/ficha/:setor/pronta', (req, res) => {
    const c = comp(req);
    const st = F.setor(req.params.setor);
    if (!st) throw erro(404, 'Setor desconhecido.');
    D.exigirSetor(req.usuario, st.id);
    const pronta = !(req.body && req.body.pronta === false);
    db.run("INSERT INTO fichas (cid, setor, dados, status, atualizado_por, atualizado_em) VALUES (?,?,'{}',?,?,?) ON CONFLICT(cid, setor) DO UPDATE SET status = excluded.status, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em",
      c.cid, st.id, pronta ? 'pronta' : 'rascunho', req.usuario.login, new Date().toISOString());
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'fichas', registro: c.cid + '/' + st.id, campo: 'status', valor_novo: pronta ? 'pronta' : 'rascunho' });
    res.json({ ok: true });
  });

  // ---------- Linhas (listas) ----------
  // Esclarecimentos que a CTAI pediu à unidade (achados encaminhados). A unidade vê só o que foi encaminhado a ela.
  r.get('/achados', (req, res) => res.json({ achados: achadosDb.daUnidade(db, Object.assign({}, req.usuario, { contrato_id: contratoDe(req) })) }));
  // PDF da resposta, para a unidade levar ao SEI. A transmissão dos dados à CTAI segue igual.
  r.get('/achados/:id/pdf', async (req, res) => {
    const a = achadosDb.daUnidade(db, Object.assign({}, req.usuario, { contrato_id: contratoDe(req) })).find((x) => x.achado_id === Number(req.params.id));
    if (!a) throw erro(404, 'Esclarecimento não encontrado.');
    if (!a.resposta) throw erro(400, 'Responda primeiro; depois o PDF fica disponível.');
    const un = (db.get('SELECT unidade, numero_cg FROM contratos WHERE contrato_id = ?', contratoDe(req)) || {});
    const data = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
    const blocos = [{ tipo: 'chaveValor', itens: [['Unidade', un.unidade || '—'], ['Contrato de Gestão', un.numero_cg || '—'], ['Competência', a.competencia_id || '—'], ['Assunto', a.tipo || 'Ponto a esclarecer'], ['Pedido enviado em', data(a.encaminhado_em)], ['Prazo', data(a.prazo)]] }];
    if (a.trecho) blocos.push({ tipo: 'titulo', nivel: 2, texto: 'Trecho em questão' }, { tipo: 'paragrafo', texto: a.trecho });
    blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Pedido de esclarecimento' }, { tipo: 'paragrafo', texto: a.mensagem || '—' });
    blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Resposta da unidade' }, { tipo: 'paragrafo', texto: a.resposta });
    blocos.push({ tipo: 'paragrafo', texto: 'Respondido por ' + (a.respondido_por || '—') + ' em ' + data(a.respondido_em) + '.' });
    const buf = await require('../pdf/render').renderizar({ titulo: 'Resposta a pedido de esclarecimento', subtitulo: un.unidade || '', blocos });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="esclarecimento-' + a.achado_id + '.pdf"' }).send(buf);
  });
  r.post('/achados/:id/responder', (req, res) => { achadosDb.responder(db, req.params.id, req.usuario, req.body && req.body.resposta); res.json({ ok: true }); });

  r.get('/fontes', (req, res) => res.json({ fontes: Object.entries(F.FONTES).map(([id, f]) => ({ id, nome: f.nome, setor: f.setor, indicadores: f.indicadores, ajuda: f.ajuda, colunas: f.colunas })), colunasProibidas: L.COLUNAS_PROIBIDAS }));

  r.get('/fontes/:fonte/modelo.csv', (req, res) => {
    if (!F.FONTES[req.params.fonte]) throw erro(404, 'Fonte desconhecida.');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-' + req.params.fonte + '.csv"');
    res.send(L.modeloCSV(req.params.fonte));
  });

  const fonteDe = (req) => {
    const f = F.FONTES[req.params.fonte];
    if (!f) throw erro(404, 'Fonte desconhecida.');
    D.exigirSetor(req.usuario, f.setor);
    return f;
  };

  r.get('/competencias/:cid/linhas/:fonte', (req, res) => {
    const c = comp(req);
    const f = F.FONTES[req.params.fonte];
    if (!f) throw erro(404, 'Fonte desconhecida.');
    const total = db.get('SELECT COUNT(*) AS n FROM linhas_rascunho WHERE cid = ? AND fonte = ?', c.cid, req.params.fonte).n;
    const linhas = db.all('SELECT id, protocolo, data_inicio, hora_inicio, data_fim, hora_fim, minutos, categoria, dados, origem, confirmada FROM linhas_rascunho WHERE cid = ? AND fonte = ? ORDER BY id LIMIT 300', c.cid, req.params.fonte).map((l) => Object.assign(l, { dados: D.json(l.dados, {}) }));
    res.json({ fonte: Object.assign({ id: req.params.fonte }, f), total, linhas });
  });

  // Entrada por arquivo CSV (texto) ou por registros digitados. Dado pessoal recusa tudo.
  r.post('/competencias/:cid/linhas/:fonte', (req, res) => {
    const c = comp(req);
    const f = fonteDe(req);
    const corpo = req.body || {};
    let cab, registros;
    if (typeof corpo.csv === 'string') { const p = L.lerCSV(corpo.csv); cab = p.cabecalho; registros = p.registros; }
    else if (Array.isArray(corpo.registros) && corpo.registros.length) { registros = corpo.registros; cab = Object.keys(registros[0]); }
    else throw erro(400, 'Envie o arquivo CSV ou ao menos uma linha.');
    if (registros.length > 20000) throw erro(413, 'Arquivo grande demais (máximo de 20.000 linhas por envio).');
    const v = L.validarLinhas(req.params.fonte, cab, registros, { competencia: c.competencia_id });
    if (v.recusado) {
      trilha.registrar(db, { usuario: req.usuario.login, tabela: 'linhas_rascunho', registro: c.cid + '/' + req.params.fonte, campo: 'upload', valor_novo: 'RECUSADO: coluna de dado pessoal' });
      return res.status(422).json({ erro: v.motivoRecusa, recusado: true });
    }
    if (!v.ok) return res.status(422).json({ erro: 'O arquivo tem problemas. Nenhuma linha foi gravada.', erros: v.erros.slice(0, 50), totalErros: v.erros.length, avisos: v.avisos });
    const modo = corpo.modo === 'somar' ? 'somar' : 'substituir';
    db.tx(() => {
      if (modo === 'substituir') db.run("DELETE FROM linhas_rascunho WHERE cid = ? AND fonte = ? AND origem <> 'api_mv'", c.cid, req.params.fonte);
      const origem = typeof corpo.csv === 'string' ? 'csv' : 'portal';
      for (const l of v.linhas) db.run('INSERT INTO linhas_rascunho (cid, fonte, protocolo, data_inicio, hora_inicio, data_fim, hora_fim, minutos, categoria, dados, origem, confirmada, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
        c.cid, req.params.fonte, l.protocolo, l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim, l.minutos, l.categoria, JSON.stringify(l.dados || {}), origem, req.usuario.login, new Date().toISOString());
      db.run("UPDATE fichas SET status = 'rascunho' WHERE cid = ? AND setor = ? AND status = 'pronta'", c.cid, f.setor);
      trilha.registrar(db, { usuario: req.usuario.login, tabela: 'linhas_rascunho', registro: c.cid + '/' + req.params.fonte, campo: 'upload', valor_novo: { linhas: v.linhas.length, modo, origem } });
    });
    res.json({ ok: true, gravadas: v.linhas.length, avisos: v.avisos });
  });

  r.delete('/competencias/:cid/linhas/:fonte', (req, res) => {
    const c = comp(req);
    const f = fonteDe(req);
    const n = db.run("DELETE FROM linhas_rascunho WHERE cid = ? AND fonte = ? AND origem <> 'api_mv'", c.cid, req.params.fonte).changes;
    db.run("UPDATE fichas SET status = 'rascunho' WHERE cid = ? AND setor = ? AND status = 'pronta'", c.cid, f.setor);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'linhas_rascunho', registro: c.cid + '/' + req.params.fonte, campo: 'limpeza', valor_novo: n + ' linha(s) removidas do rascunho' });
    res.json({ ok: true, removidas: Number(n) });
  });

  // ---------- Conferir e enviar ----------
  r.get('/competencias/:cid/conferir', (req, res) => {
    const c = comp(req);
    const s = E.situacaoAntesDoEnvio(db, c.cid);
    res.json({ avisos: s.avisos, bloqueios: s.bloqueios, consolidado: s.consolidado, pontos: s.pontos, regras: s.regras.indicadores.map((i) => ({ id: i.id, nome: i.nome, max: i.max })) });
  });

  r.post('/competencias/:cid/enviar', async (req, res) => {
    const c = comp(req);
    if (!['gestor_unidade', 'admin'].includes(req.usuario.perfil)) throw erro(403, 'Só o gestor da unidade envia o relatório.');
    const out = await E.enviar(db, c.cid, req.usuario, (req.body && req.body.motivo) || '');
    res.json({ ok: true, envio_id: out.envio_id, versao: out.versao, hash: out.hash, avisos: [] });
  });

  // Depois de anexar e assinar no SEI, o gestor registra o número do documento. Para corrigir, o motivo é obrigatório e o registro anterior fica no histórico.
  // Data em que a unidade enviou o relatório ao SIMAS (prazo: dia 25 do mês seguinte). Só o gestor informa.
  r.post('/competencias/:cid/simas', (req, res) => { const c = comp(req); PZ.registrarSimas(db, req.usuario, c.cid, req.body && req.body.data, req.body && req.body.motivo); res.json({ prazos: PZ.daCompetencia(db, c) }); });

  r.post('/envios/:id/sei', (req, res) => {
    const out = SEI.registrar(db, req.usuario, req.params.id, req.body && req.body.numero, req.body && req.body.motivo);
    res.json(Object.assign({ ok: true }, out));
  });

  r.get('/envios/:id/pdf', (req, res) => {
    const e = db.get('SELECT * FROM envios WHERE envio_id = ?', Number(req.params.id));
    if (!e) throw erro(404, 'Envio não encontrado.');
    D.exigirContrato(req.usuario, D.competenciaPorCid(db, e.cid).contrato_id);
    const p = E.lerPdf(db, e.envio_id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + p.envio.pdf_arquivo + '"');
    res.setHeader('X-Integridade-PDF', p.integro ? 'ok' : 'ALTERADO');
    res.send(p.buffer);
  });

  // ---------- Lotes da API ----------
  r.post('/lotes/:id/confirmar', (req, res) => {
    if (!['gestor_unidade', 'admin'].includes(req.usuario.perfil)) throw erro(403, 'Só o gestor confirma lotes da integração.');
    const l = db.get('SELECT * FROM lotes_api WHERE lote_id = ?', Number(req.params.id));
    if (!l) throw erro(404, 'Lote não encontrado.');
    comp({ params: { cid: l.cid }, usuario: req.usuario });
    sync.confirmarLote(db, l.lote_id, req.usuario, !!(req.body && req.body.substituir));
    res.json({ ok: true });
  });
  r.post('/lotes/:id/descartar', (req, res) => {
    if (!['gestor_unidade', 'admin'].includes(req.usuario.perfil)) throw erro(403, 'Só o gestor descarta lotes da integração.');
    const l = db.get('SELECT * FROM lotes_api WHERE lote_id = ?', Number(req.params.id));
    if (!l) throw erro(404, 'Lote não encontrado.');
    comp({ params: { cid: l.cid }, usuario: req.usuario });
    sync.descartarLote(db, l.lote_id, req.usuario);
    res.json({ ok: true });
  });

  return r;
};
