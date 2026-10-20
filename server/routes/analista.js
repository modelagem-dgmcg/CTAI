'use strict';
// Rotas do Analista (encaixe). A análise é do módulo modules/analista; aqui só ligamos ao envio, à minuta e aos achados fixados.
const express = require('express');
const A = require('../auth');
const D = require('../dominio');
const E = require('../envios');
const M = require('../minuta');
const achadosDb = require('../achados');
const analista = require('../../modules/analista');

const { erro } = A;

module.exports = (db) => {
  const r = express.Router();
  r.use(A.exigir(db, A.PERFIS_CTAI));

  r.get('/estado', (req, res) => res.json(analista.estado()));

  // Análise de texto colado (relatório da OSS em PDF/Word, copiado como texto).
  r.post('/analisar', async (req, res) => {
    const b = req.body || {};
    const texto = String(b.texto || '');
    if (!texto.trim()) throw erro(400, 'Cole o texto do documento.');
    if (texto.length > 200000) throw erro(413, 'Texto grande demais (máximo de 200.000 caracteres).');
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
      salvos = achadosDb.salvar(db, { origem_tipo: 'texto', origem_id: proximo, cid, achados: res1.achados, provedor: res1.provedor, usuario: req.usuario.login });
    }
    res.json(Object.assign(res1, { salvos }));
  });

  r.post('/envios/:id/analisar', async (req, res) => res.json(await E.analisarEnvio(db, req.params.id, req.usuario.login)));

  // Lê a própria minuta (texto + números) antes de congelar.
  r.post('/pareceres/:id/analisar', async (req, res) => {
    const p = M.obter(db, req.params.id);
    const c = M.conteudoAtual(db, p.parecer_id);
    const texto = [c.texto.abertura, c.texto.analise, c.texto.conclusao].join('\n\n');
    const comp = c.indicadores.competencias[c.indicadores.competencias.length - 1];
    const out = await analista.analisar({ texto, tipo: 'minuta de parecer', contexto: { competencia: comp ? comp.competencia : null, unidade: c.identificacao.unidade } });
    const salvos = achadosDb.salvar(db, { origem_tipo: 'minuta', origem_id: p.parecer_id, cid: comp ? comp.cid : null, achados: out.achados, provedor: out.provedor, usuario: req.usuario.login });
    res.json(Object.assign(out, { salvos }));
  });

  r.get('/achados', (req, res) => res.json({ achados: achadosDb.listar(db, { cid: req.query.cid, origem_tipo: req.query.origem_tipo, origem_id: req.query.origem_id, status: req.query.status }) }));
  r.patch('/achados/:id', (req, res) => { achadosDb.mudarStatus(db, req.params.id, req.body && req.body.status, req.usuario, req.body && req.body.motivo); res.json({ ok: true }); });

  return r;
};
