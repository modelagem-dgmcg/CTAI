'use strict';
// Fonte "manual": o que a unidade digitou no portal (fichas e linhas de rascunho).
const D = require('../server/dominio');

module.exports = {
  tipo: 'manual',
  nome: 'Digitação no portal',
  listarCompetencias(db, contratoId) { return db.all('SELECT competencia_id, status FROM competencias WHERE contrato_id = ? ORDER BY competencia_id', contratoId); },
  obterIndicador(db, cid, campo) { return D.achatarFichas(D.fichasDaCompetencia(db, cid))[campo] ?? null; },
  obterLinhas(db, cid, fonte) { return (D.linhasRascunho(db, cid, false)[fonte] || []); },
};
