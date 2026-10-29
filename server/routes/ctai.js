'use strict';
// Console da CTAI: recepção, recálculo, divergências, decisões de regra, minuta, mesa de conferência e trilha.
const express = require('express');
const A = require('../auth');
const D = require('../dominio');
const F = require('../../core/formularios');
const R = require('../../core/regras');
const E = require('../envios');
const SEI = require('../sei');
const M = require('../minuta');
const trilha = require('../trilha');
const achadosDb = require('../achados');
const minutaPdf = require('../pdf/minuta');
const render = require('../pdf/render');

const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  const CART = require('../carteira');
  r.use(CART.guarda(db));
  const CL = require('../checklist');
  const PZ = require('../prazos');
  const soCriadorOuAdmin = (u) => { if (!['criador', 'admin'].includes(u.perfil)) throw erro(403, 'Esta ação é de quem cria o parecer.'); };

  const RC = require('../regras-contrato');
  const CR = require('../contrato-regras');

  // ---------- Painel ----------
  r.get('/contratos', (req, res) => {
    const perguntasAbertas = require('../perguntas-contrato').contagens(db).porUnidade;
    const lista = db.all('SELECT * FROM contratos ORDER BY demo, contrato_id').filter((c) => !req.escopo || req.escopo.has(c.contrato_id)).map((c) => {
      const comps = db.all('SELECT cid, competencia_id, status, mes_implantacao FROM competencias WHERE contrato_id = ? ORDER BY competencia_id', c.contrato_id).map((k) => {
        const ult = D.ultimoEnvio(db, k.cid);
        const div = db.get("SELECT COUNT(*) AS n FROM divergencias WHERE cid = ? AND status = 'aberta'", k.cid).n;
        return Object.assign(k, { mes_implantacao: !!k.mes_implantacao, versaoEnvio: ult ? ult.versao : null, recebido_em: ult ? ult.recebido_em : null, divergenciasAbertas: div, seiAlertas: SEI.resumoAlertas(db, k.cid), prazos: PZ.resumo(PZ.daCompetencia(db, Object.assign({ contrato_id: c.contrato_id }, k))) });
      });
      let abertas = 0, semRegras = false;
      try { const { regras } = D.regrasDoContrato(db, c.contrato_id); abertas = D.pendenciasDeRegra(db, c.contrato_id, regras).abertas.length; } catch (e) { if (e.status !== 409) throw e; semRegras = true; }
      return Object.assign(c, { perguntas_abertas: perguntasAbertas[c.contrato_id] || 0, tipo: RC.tipoDe(c), regra: RC.estado(db, c.contrato_id), demo: !!c.demo, competencias: comps, decisoesAbertas: abertas, semRegras: semRegras && !CR.ler(db, c.contrato_id), semGestor: !db.get("SELECT 1 FROM usuarios WHERE perfil = 'gestor_unidade' AND ativo = 1 AND contrato_id = ?", c.contrato_id) });
    });
    res.json({ contratos: lista, escopo: req.escopo ? 'carteira' : 'todas' });
  });

  r.get('/competencias/:cid', (req, res) => {
    const c = D.competenciaPorCid(db, req.params.cid);
    const { regras } = D.regrasDoContrato(db, c.contrato_id, c.regra_id);
    const envios = db.all('SELECT envio_id, versao, motivo, enviado_por, enviado_em, recebido_em, hash_snapshot, pdf_hash FROM envios WHERE cid = ? ORDER BY versao DESC', c.cid);
    const recalculo = envios.length ? E.recalcularCompetencia(db, c.cid) : null;
    const divergencias = db.all("SELECT * FROM divergencias WHERE cid = ? ORDER BY CASE gravidade WHEN 'alta' THEN 0 WHEN 'média' THEN 1 ELSE 2 END, divergencia_id", c.cid);
    const achados = achadosDb.listar(db, { cid: c.cid });
    const evidencias = db.all('SELECT * FROM evidencias WHERE cid = ?', c.cid);
    const ctai = db.all('SELECT * FROM indicadores_ctai WHERE cid = ?', c.cid);
    const oss = db.all('SELECT * FROM indicadores_oss WHERE cid = ? AND ' + (envios.length ? 'envio_id = ?' : 'envio_id IS NULL'), ...(envios.length ? [c.cid, envios[0].envio_id] : [c.cid]));
    const tot = db.get('SELECT * FROM totais_igq WHERE cid = ?', c.cid) || null;
    res.json({
      competencia: { cid: c.cid, competencia_id: c.competencia_id, status: c.status, mes_implantacao: c.mes_implantacao, unidade: c.unidade, oss: c.oss, demo: c.demo, contrato_id: c.contrato_id, processo_sei: c.processo_sei },
      regras: { versao: regras.versao, indicadores: regras.indicadores.map((i) => Object.assign({}, i, { faixasTexto: R.descricaoFaixas(i) })), faixas_pagamento: regras.faixas_pagamento },
      envios, canais: SEI.canais(db, c.cid), prazos: PZ.daCompetencia(db, c), checklist: CL.listar(db, c.cid), recalculo, divergencias, achados, evidencias, indicadores_ctai: ctai, indicadores_oss: oss, totais: tot,
      decisoes: Object.values(D.decisoes(db, c.contrato_id)),
    });
  });

  // ---------- Configurações da unidade (regras lidas do contrato) ----------
  // Qualquer analista com a unidade na carteira pode ajustar a regra descritiva, sempre com a senha de quem altera e um motivo (fica na trilha).
  r.put('/configuracao/:id/regras', (req, res) => {
    const b = req.body || {};
    if (!['criador', 'colega', 'superintendente', 'admin'].includes(req.usuario.perfil)) throw erro(403, 'Seu perfil não altera regras.');
    const motivo = String(b.motivo || '').trim();
    if (motivo.length < 5) throw erro(400, 'Escreva o motivo da alteração (uma linha basta).');
    if (!b.senha) throw erro(400, 'Confirme com a sua senha.');
    const conf = A.entrar(db, req.usuario.login, String(b.senha));
    if (conf.erro) throw erro(400, conf.erro === 'Usuário ou senha incorretos.' ? 'Senha incorreta.' : conf.erro);
    if (!db.get('SELECT 1 FROM contratos WHERE contrato_id = ?', req.params.id)) throw erro(404, 'Unidade não encontrada.');
    if (req.escopo && !req.escopo.has(req.params.id)) throw erro(403, 'Esta unidade não está na sua carteira. Peça à superintendente para incluí-la.');
    const regra = CR.gravar(db, req.usuario, req.params.id, b.conteudo, 'edição na unidade');
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'contrato_regras', registro: req.params.id, campo: 'configuração', valor_novo: 'regra alterada na unidade, confirmada com senha', motivo });
    res.json({ regra, contratoRegras: CR.ler(db, req.params.id) });
  });

  // ---------- Checklist de recebimento ----------
  r.get('/competencias/:cid/checklist', (req, res) => { const c = D.competenciaPorCid(db, req.params.cid); res.json(CL.listar(db, c.cid)); });
  r.put('/competencias/:cid/checklist/:item', (req, res) => { CL.atualizar(db, req.usuario, req.params.cid, req.params.item, req.body || {}); res.json(CL.listar(db, req.params.cid)); });
  r.post('/competencias/:cid/checklist/:item/restaurar', (req, res) => { CL.restaurarSugestao(db, req.usuario, req.params.cid, req.params.item); res.json(CL.listar(db, req.params.cid)); });

  // ---------- Divergências, evidências, avaliações ----------
  r.patch('/divergencias/:id', (req, res) => {
    const d = db.get('SELECT * FROM divergencias WHERE divergencia_id = ?', Number(req.params.id));
    if (!d) throw erro(404, 'Divergência não encontrada.');
    const { status, observacao } = req.body || {};
    if (!['aberta', 'em apuração', 'resolvida', 'aceita', 'descartada'].includes(status)) throw erro(400, 'Situação inválida.');
    if (status !== 'aberta' && !String(observacao || '').trim()) throw erro(400, 'Explique a decisão sobre a divergência (observação).');
    db.run('UPDATE divergencias SET status = ?, observacao = ? WHERE divergencia_id = ?', status, observacao || d.observacao, d.divergencia_id);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'divergencias', registro: d.divergencia_id, campo: 'status', valor_anterior: d.status, valor_novo: status, motivo: observacao });
    res.json({ ok: true });
  });

  r.put('/competencias/:cid/evidencias/:indicador', (req, res) => {
    const c = D.competenciaPorCid(db, req.params.cid);
    const b = req.body || {};
    const bool = (v) => (v === true || v === 1 || v === '1' ? 1 : (v === false || v === 0 || v === '0' ? 0 : null));
    db.run(`INSERT INTO evidencias (cid, indicador_id, documento_id, tipo, paginas, lido_por, data_leitura, periodo_ok, assinado_ok, tipo_correto_ok, aceita, observacao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cid, indicador_id) DO UPDATE SET documento_id = COALESCE(excluded.documento_id, evidencias.documento_id), tipo = COALESCE(excluded.tipo, evidencias.tipo), paginas = excluded.paginas, lido_por = excluded.lido_por, data_leitura = excluded.data_leitura,
      periodo_ok = excluded.periodo_ok, assinado_ok = excluded.assinado_ok, tipo_correto_ok = excluded.tipo_correto_ok, aceita = excluded.aceita, observacao = excluded.observacao`,
      c.cid, req.params.indicador, b.documento_id || null, b.tipo || null, b.paginas || null, req.usuario.login, new Date().toISOString(), bool(b.periodo_ok), bool(b.assinado_ok), bool(b.tipo_correto_ok), bool(b.aceita), b.observacao || null);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'evidencias', registro: c.cid + '/' + req.params.indicador, campo: 'leitura', valor_novo: { aceita: bool(b.aceita) }, motivo: b.observacao });
    res.json({ ok: true });
  });

  // Avaliação humana de uma linha (ex.: aceite da resposta de uma queixa). Muda o recálculo.
  r.post('/competencias/:cid/avaliacoes', (req, res) => {
    const c = D.competenciaPorCid(db, req.params.cid);
    const { fonte, protocolo, campo, valor } = req.body || {};
    if (!fonte || !protocolo) throw erro(400, 'Informe a fonte e o protocolo.');
    db.run('INSERT INTO avaliacoes_linha (cid, fonte, protocolo, campo, valor, avaliado_por, em) VALUES (?,?,?,?,?,?,?) ON CONFLICT(cid, fonte, protocolo, campo) DO UPDATE SET valor = excluded.valor, avaliado_por = excluded.avaliado_por, em = excluded.em',
      c.cid, fonte, String(protocolo), campo || 'aceite', String(valor), req.usuario.login, new Date().toISOString());
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'avaliacoes_linha', registro: c.cid + '/' + fonte + '/' + protocolo, campo: campo || 'aceite', valor_novo: valor });
    const envio = D.ultimoEnvio(db, c.cid);
    if (envio) E.sincronizarDivergencias(db, c.cid, E.recalcularCompetencia(db, c.cid), envio.envio_id);
    res.json({ ok: true });
  });

  r.post('/envios/:id/reprocessar', async (req, res) => {
    const e = db.get('SELECT * FROM envios WHERE envio_id = ?', Number(req.params.id));
    if (!e) throw erro(404, 'Envio não encontrado.');
    const out = await E.receber(db, e.envio_id, { usuario: req.usuario.login });
    res.json({ ok: true, resultado: out });
  });

  // Comparação opcional com o PDF baixado do SEI (corpo: { arquivo: base64 }). Não grava o arquivo e não bloqueia nada.
  r.post('/envios/:id/comparar-sei', (req, res) => {
    const b64 = String((req.body && req.body.arquivo) || '');
    if (!b64) throw erro(400, 'Envie o arquivo PDF que está no SEI.');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 100 || buf.slice(0, 5).toString('latin1') !== '%PDF-') throw erro(400, 'O arquivo não parece ser um PDF.');
    res.json(SEI.compararArquivo(db, req.usuario, req.params.id, buf));
  });

  r.get('/envios/:id/pdf', (req, res) => {
    const p = E.lerPdf(db, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + p.envio.pdf_arquivo + '"');
    res.setHeader('X-Integridade-PDF', p.integro ? 'ok' : 'ALTERADO');
    res.send(p.buffer);
  });

  // ---------- Regras e decisões ----------
  r.get('/contratos/:id/decisoes', (req, res) => {
    let regras;
    try { regras = D.regrasDoContrato(db, req.params.id).regras; } catch (e) { if (e.status === 409) { const cr = CR.ler(db, req.params.id); return res.json(cr ? { decisoes: [], regraPendencias: [], semRegras: false, descritiva: true, contratoRegras: cr, regra: RC.estado(db, req.params.id) } : { decisoes: [], regraPendencias: [], semRegras: true, regra: { tem: false } }); } throw e; }
    res.json({ decisoes: Object.values(D.decisoes(db, req.params.id)), regraPendencias: R.pendencias(regras), regra: RC.estado(db, req.params.id), contratoRegras: CR.ler(db, req.params.id) });
  });
  r.post('/contratos/:id/regras/modelo', (req, res) => res.json({ regra: RC.aplicarModelo(db, req.usuario, req.params.id, req.body && req.body.modelo) }));
  r.post('/contratos/:id/regras/conferida', (req, res) => res.json({ regra: RC.marcarConferida(db, req.usuario, req.params.id) }));
  r.post('/contratos/:id/regras/importar', (req, res) => res.json({ regra: CR.importar(db, req.usuario, req.params.id, req.body && req.body.regras), estado: RC.estado(db, req.params.id) }));
  r.post('/regras/importar-lote', (req, res) => res.json(CR.importarLote(db, req.usuario, req.body && req.body.lista)));
  r.post('/regras/modelo-lote', (req, res) => res.json(RC.aplicarEmLote(db, req.usuario, req.body && req.body.tipo, req.body && req.body.modelo)));
  r.put('/contratos/:id/decisoes/:chave', (req, res) => {
    if (!['criador', 'superintendente', 'admin'].includes(req.usuario.perfil)) throw erro(403, 'Decisão de regra é de quem cria o parecer ou da superintendência.');
    D.decidir(db, req.params.id, req.params.chave, req.body && req.body.valor, req.body && req.body.justificativa, req.usuario);
    res.json({ ok: true });
  });

  // ---------- Pareceres e mesa ----------
  r.get('/pareceres', (req, res) => res.json({ pareceres: M.listar(db).filter((p) => !req.escopo || req.escopo.has(p.contrato_id)) }));
  r.post('/pareceres', (req, res) => res.json({ parecer_id: M.criar(db, req.usuario, req.body || {}) }));
  r.get('/pareceres/:id', (req, res) => res.json(M.detalhe(db, req.params.id, req.usuario)));
  r.put('/pareceres/:id/texto', (req, res) => { M.salvarTexto(db, req.params.id, req.usuario, req.body && req.body.texto, req.body); res.json({ ok: true }); });
  r.post('/pareceres/:id/rascunho-texto', (req, res) => {
    const p = M.obter(db, req.params.id);
    const sugestao = M.rascunhoDeTexto(M.conteudoAtual(db, p.parecer_id));
    if (req.body && req.body.aplicar) {
      soCriadorOuAdmin(req.usuario);
      const atual = p.blocos.texto || {};
      const novo = {};
      for (const k of Object.keys(sugestao)) if (!String(atual[k] || '').trim() || req.body.sobrescrever) novo[k] = sugestao[k];
      M.salvarTexto(db, p.parecer_id, req.usuario, novo);
    }
    res.json({ sugestao });
  });
  r.post('/pareceres/:id/modelo', (req, res) => res.json({ modelo: require('../parecer-modelo').definir(db, req.params.id, req.usuario, req.body && req.body.modo) }));
  // Perguntas de contrato da unidade (a analista dona da carteira responde; a resposta só registra)
  const PC = require('../perguntas-contrato');
  r.get('/urgencias', (req, res) => res.json(PC.urgencias(db, req.usuario, req.escopo)));
  r.get('/urgencias/contador', (req, res) => res.json({ abertas: PC.urgencias(db, req.usuario, req.escopo).abertas }));
  r.get('/contratos/:id/perguntas', (req, res) => res.json({ perguntas: PC.listar(db, req.params.id), decisoes: PC.decisoes(db, req.params.id) }));
  r.post('/perguntas/:pid/responder', (req, res) => res.json(PC.responder(db, req.usuario, req.params.pid, req.body || {})));
  r.post('/perguntas/:pid/anexo', (req, res) => res.json(PC.marcarAnexo(db, req.usuario, req.params.pid, !(req.body && req.body.desfazer))));
  // Contrato e termos aditivos da unidade (registro importado pela Gestão)
  r.get('/contratos/:id/instrumentos', (req, res) => res.json({ registro: require('../registro-contratos').resumo(db, req.params.id) }));
  r.post('/contratos/:id/instrumentos/confirmar', (req, res) => res.json(require('../registro-contratos').confirmar(db, req.usuario, req.params.id)));
  r.post('/pareceres/:id/modelo/gaocg', async (req, res) => res.json(await require('../parecer-modelo').preencherPeloGaocg(db, req.params.id, req.usuario)));
  const RP = require('../relatorios-parecer');
  r.get('/pareceres/:id/relatorios', (req, res) => res.json({ relatorios: RP.listar(db, req.params.id) }));
  r.post('/pareceres/:id/relatorios', async (req, res) => res.json(await RP.importar(db, req.params.id, req.usuario, req.body || {})));
  r.delete('/pareceres/:id/relatorios/:rel', (req, res) => { RP.remover(db, req.params.id, req.usuario, req.params.rel); res.json({ ok: true }); });
  r.post('/pareceres/:id/relatorios/propor', async (req, res) => res.json(await RP.proporQuadros(db, req.params.id, req.usuario)));
  r.post('/pareceres/:id/relatorios/aplicar', (req, res) => res.json(RP.aplicar(db, req.params.id, req.usuario, req.body && req.body.quadros)));
  r.put('/pareceres/:id/modelo', (req, res) => { require('../parecer-modelo').salvar(db, req.params.id, req.usuario, req.body || {}); res.json({ ok: true }); });
  r.get('/pareceres-modelo', (req, res) => { const m = require('../parecer-modelo').MODELO; res.json({ secoes: m.secoes.map((s) => ({ id: s.id, titulo: s.titulo })), quadros: m.quadros, titulo: m.titulo }); });
  r.post('/pareceres/:id/adotar', (req, res) => {
    const b = req.body || {};
    M.adotar(db, req.params.id, req.usuario, b.cid, b.indicador_id, b);
    res.json({ ok: true });
  });
  r.post('/pareceres/:id/congelar', (req, res) => res.json({ versao_id: M.congelar(db, req.params.id, req.usuario, req.body || {}) }));
  r.post('/pareceres/:id/sei', (req, res) => { M.registrarSEI(db, req.params.id, req.usuario, req.body && req.body.numero); res.json({ ok: true }); });

  r.get('/versoes/:id', (req, res) => {
    const est = M.estadoDaVersao(db, req.params.id);
    const v = db.get('SELECT conteudo FROM versoes_minuta WHERE versao_id = ?', Number(req.params.id));
    const cont = JSON.parse(v.conteudo);
    res.json(Object.assign(est, { conteudo: cont, itensDef: M.itensDe(cont) }));
  });
  r.post('/versoes/:id/conferir', (req, res) => res.json(M.conferir(db, req.params.id, req.usuario, req.body && req.body.item, req.body && req.body.status, req.body && req.body.comentario)));
  r.post('/versoes/:id/autorizar', (req, res) => res.json(M.autorizar(db, req.params.id, req.usuario)));
  // Rascunho do parecer para ler e imprimir (sem congelar nada).
  r.get('/pareceres/:id/pdf', async (req, res) => {
    const p = M.obter(db, req.params.id);
    const buf = await minutaPdf.gerarMinutaPdf(M.conteudoAtual(db, p.parecer_id), { numero: 'rascunho' }, 'rascunho');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="parecer-rascunho-' + p.parecer_id + '.pdf"' }).send(buf);
  });
  r.get('/formularios/pdf', async (req, res) => {
    try { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="formularios-em-branco.pdf"' }).send(await require('../pdf/formularios').gerar(req.query.setor)); } catch (e) { throw e.status ? erro(e.status, e.message) : e; }
  });
  r.get('/versoes/:id/pdf', async (req, res) => {
    const est = M.estadoDaVersao(db, req.params.id);
    const v = db.get('SELECT conteudo FROM versoes_minuta WHERE versao_id = ?', Number(req.params.id));
    const buf = await minutaPdf.gerarMinutaPdf(JSON.parse(v.conteudo), est.versao, est.versao.status);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'versoes_minuta', registro: req.params.id, campo: 'pdf', valor_novo: 'gerado' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="minuta-v' + est.versao.numero + '.pdf"');
    res.send(buf);
  });

  // ---------- Trilha ----------
  r.get('/trilha', (req, res) => {
    const limite = Math.min(Number(req.query.limite) || 100, 500);
    const filtro = req.query.tabela ? ' WHERE tabela = ?' : '';
    const args = req.query.tabela ? [String(req.query.tabela)] : [];
    res.json({ eventos: db.all('SELECT evento_id, data_hora, usuario, tabela, registro, campo, valor_anterior, valor_novo, motivo, substr(hash,1,12) AS hash FROM trilha_auditoria' + filtro + ' ORDER BY evento_id DESC LIMIT ' + limite, ...args) });
  });
  r.get('/trilha/verificar', (req, res) => res.json(trilha.verificar(db)));

  void render; void F;
  return r;
};
