'use strict';
// Rotas do Analista (encaixe). A análise é do módulo modules/analista; aqui só ligamos ao envio, à minuta e aos achados fixados.
const express = require('express');
const A = require('../auth');
const D = require('../dominio');
const E = require('../envios');
const M = require('../minuta');
const achadosDb = require('../achados');
const normasDb = require('../normas');
const acervoSrv = require('../acervo');
const trilha = require('../trilha');
const analista = require('../../modules/analista');

const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));
  r.use(require('../carteira').guarda(db));

  r.get('/estado', (req, res) => res.json(analista.estado()));

  // Análise de texto colado (relatório da OSS em PDF/Word, copiado como texto).
  r.post('/analisar', async (req, res) => {
    const b = req.body || {};
    const texto = String(b.texto || '').slice(0, 200000); // documentos longos: analisa os primeiros 200.000 caracteres
    if (!texto.trim()) throw erro(400, 'Cole o texto do documento.');
    let contexto = { observacoes: b.observacoes || '' };
    let cid = null;
    if (b.cid) {
      const c = D.competenciaPorCid(db, b.cid);
      cid = c.cid;
      contexto = Object.assign(contexto, { competencia: c.competencia_id, unidade: c.unidade, mesImplantacao: c.mes_implantacao });
      const envio = D.ultimoEnvio(db, c.cid);
      if (envio) { const t = E.textoDoEnvio(db, envio); Object.assign(contexto, E.contextoDoEnvio(db, envio, t)); }
    }
    const res1 = await analista.analisar({ texto, tipo: b.tipo || 'relatorio da OSS', contexto });
    let salvos = 0;
    if (b.salvar) {
      const proximo = db.get("SELECT IFNULL(MAX(origem_id),0)+1 AS n FROM achados WHERE origem_tipo = 'texto'").n;
      salvos = achadosDb.salvar(db, { origem_tipo: 'texto', origem_id: proximo, cid, achados: res1.achados, provedor: res1.provedor, usuario: req.usuario.login,
        origem: { fonte: 'Texto colado e lido pela IA', documento: 'Texto colado em "Analisar outro texto" (' + (b.tipo || 'relatório da OSS') + (contexto.unidade ? ', ' + contexto.unidade : '') + '); o texto não fica guardado', data: new Date().toISOString().slice(0, 10) } });
    }
    res.json(Object.assign(res1, { salvos }));
  });

  // Lê um arquivo (PDF com texto, Word, Excel, CSV, TXT) e devolve o texto, sem guardar nada.
  r.post('/extrair', async (req, res) => {
    const b = req.body || {};
    const ex = await require('../extrair-texto').extrair(String(b.nome || 'arquivo'), Buffer.from(String(b.base64 || ''), 'base64'));
    res.json({ texto: ex.texto, paginas: ex.paginas, tipo: ex.tipo });
  });

  r.post('/envios/:id/analisar', async (req, res) => res.json(await E.analisarEnvio(db, req.params.id, req.usuario.login)));

  // Lê a própria minuta (texto + números) antes de congelar.
  r.post('/pareceres/:id/analisar', async (req, res) => {
    const p = M.obter(db, req.params.id);
    const c = M.conteudoAtual(db, p.parecer_id);
    const texto = [c.texto.abertura, c.texto.analise, c.texto.conclusao].join('\n\n');
    const comp = c.indicadores.competencias[c.indicadores.competencias.length - 1];
    const out = await analista.analisar({ texto, tipo: 'minuta de parecer', contexto: { competencia: comp ? comp.competencia : null, unidade: c.identificacao.unidade } });
    const salvos = achadosDb.salvar(db, { origem_tipo: 'minuta', origem_id: p.parecer_id, cid: comp ? comp.cid : null, achados: out.achados, provedor: out.provedor, origem: { fonte: 'Minuta lida pela IA', documento: 'Minuta do parecer · ' + (c.identificacao.unidade || ''), data: new Date().toISOString().slice(0, 10) }, usuario: req.usuario.login });
    res.json(Object.assign(out, { salvos }));
  });

  r.post('/pareceres/:id/revisao-completa', async (req, res) => res.json(await require('../parecer-revisao').revisar(db, req.params.id, req.usuario)));

  const soEquipe = (u) => { if (!['criador', 'admin', 'superintendente'].includes(u.perfil)) throw erro(403, 'Só a equipe que monta o parecer (criador, superintendente) faz esta alteração.'); };

  // ---------- Achados: lista, fixar/descartar, encaminhar à unidade ----------
  r.get('/achados', (req, res) => {
    const lista = achadosDb.listar(db, { cid: req.query.cid, origem_tipo: req.query.origem_tipo, origem_id: req.query.origem_id, status: req.query.status, contrato_id: req.query.contrato })
      .filter((a) => !req.escopo || !a.contrato_id || req.escopo.has(a.contrato_id));
    if (req.query.normas) for (const a of lista) a.normas = normasDb.paraAchado(db, a, a.contrato_id);
    res.json({ achados: lista });
  });
  r.patch('/achados/:id', (req, res) => { achadosDb.mudarStatus(db, req.params.id, req.body && req.body.status, req.usuario, req.body && req.body.motivo); res.json({ ok: true }); });
  r.post('/achados/:id/encaminhar', (req, res) => { soEquipe(req.usuario); achadosDb.encaminhar(db, req.params.id, req.usuario, req.body || {}); res.json({ ok: true }); });

  // Painel do Analista da CTAI: o que pede ação agora, em todas as unidades.
  r.get('/painel', (req, res) => {
    const contagens = achadosDb.contagens(db);
    const hoje = new Date().toISOString().slice(0, 10);
    const fila = achadosDb.listar(db, {}).filter((a) => !req.escopo || !a.contrato_id || req.escopo.has(a.contrato_id)).filter((a) => ['novo', 'encaminhado', 'respondido'].includes(a.status)).slice(0, 60)
      .map((a) => Object.assign(a, { vencido: a.status === 'encaminhado' && !!a.prazo && a.prazo < hoje }));
    const contratos = db.all('SELECT contrato_id, unidade, demo FROM contratos ORDER BY demo, unidade').filter((c) => !req.escopo || req.escopo.has(c.contrato_id)).map((c) => {
      const integ = acervoSrv.integracaoDoContrato(db, c.contrato_id);
      return { contrato_id: c.contrato_id, unidade: c.unidade, demo: !!c.demo, acervo: integ ? { ativo: !!integ.ativo, estado: integ.estado, ultima_sync: integ.ultima_sync } : null,
        competencias: db.all('SELECT cid, competencia_id, status FROM competencias WHERE contrato_id = ? ORDER BY competencia_id DESC', c.contrato_id).map((k) => Object.assign(k, { temEnvio: !!D.ultimoEnvio(db, k.cid) })) };
    });
    res.json({ contagens, fila, contratos, normas: db.get('SELECT COUNT(*) AS n FROM normas WHERE vigente = 1').n });
  });

  // ---------- Normas por unidade ----------
  r.get('/normas', (req, res) => res.json({ normas: normasDb.listar(db, { contrato_id: req.query.contrato, q: req.query.q, somenteVigentes: req.query.vigentes === '1' }) }));
  r.post('/normas', (req, res) => { soEquipe(req.usuario); res.json({ norma_id: normasDb.criar(db, req.usuario, req.body || {}) }); });
  r.patch('/normas/:id', (req, res) => { soEquipe(req.usuario); normasDb.atualizar(db, req.usuario, req.params.id, req.body || {}); res.json({ ok: true }); });

  // ---------- Conferência com o acervo (fonte opcional) ----------
  r.post('/competencias/:cid/acervo/conferir', (req, res) => {
    if (req.usuario.perfil === 'colega') throw erro(403, 'A conferência com o acervo é feita pelo criador do parecer ou pelo administrador.');
    res.json(acervoSrv.conferir(db, req.params.cid, req.usuario));
  });

  // ---------- Relatório trimestral da unidade: abre a minuta com as competências do trimestre e a sugestão de texto ----------
  // A pessoa edita o texto antes de congelar. Depois de congelado, a versão é imutável (nova versão exige novo congelamento).
  r.post('/relatorio-trimestral', (req, res) => {
    const b = req.body || {};
    if (!['criador', 'admin'].includes(req.usuario.perfil)) throw erro(403, 'Só quem cria o parecer (perfil criador) monta o relatório trimestral.');
    const m = /^(\d{4})-T([1-4])$/.exec(String(b.trimestre || '').trim());
    if (!m) throw erro(400, 'Informe o trimestre no formato 2026-T2.');
    const meses = [0, 1, 2].map((i) => m[1] + '-' + String((Number(m[2]) - 1) * 3 + 1 + i).padStart(2, '0'));
    const comps = db.all('SELECT competencia_id FROM competencias WHERE contrato_id = ? ORDER BY competencia_id', String(b.contrato_id || '')).map((x) => x.competencia_id).filter((c) => meses.includes(c));
    if (!comps.length) throw erro(404, 'Não há competências deste contrato em ' + b.trimestre + '.');
    let p = db.get('SELECT parecer_id FROM pareceres WHERE contrato_id = ? AND trimestre = ?', String(b.contrato_id), m[0]);
    const jaExistia = !!p;
    const id = p ? p.parecer_id : M.criar(db, req.usuario, { contrato_id: b.contrato_id, trimestre: m[0], competencias: comps, numero_parecer: b.numero_parecer || null });
    const parecer = M.obter(db, id);
    const sugestao = M.rascunhoDeTexto(M.conteudoAtual(db, id));
    const atual = parecer.blocos.texto || {};
    const novo = {};
    for (const k of Object.keys(sugestao)) if (!String(atual[k] || '').trim()) novo[k] = sugestao[k];
    if (Object.keys(novo).length) M.salvarTexto(db, id, req.usuario, novo);
    trilha.registrar(db, { usuario: req.usuario.login, tabela: 'pareceres', registro: id, campo: 'relatorio_trimestral', valor_novo: { competencias: comps, jaExistia } });
    res.json({ parecer_id: id, competencias: comps, jaExistia, faltam: meses.filter((x) => !comps.includes(x)) });
  });

  return r;
};
