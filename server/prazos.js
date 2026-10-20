'use strict';
// Prazos de entrega por competência: SEI até o dia 20 e SIMAS até o dia 25 do mês seguinte.
// Entrega no SEI = data do primeiro registro do número do documento no sistema (é o que a CTAI consegue saber sem a API do SEI).
// Entrega no SIMAS = data que o gestor da unidade informa. Tudo só avisa: nada bloqueia o envio.
const P = require('../core/prazos');
const D = require('./dominio');
const trilha = require('./trilha');
const { erro } = require('./auth');

// Datas "de calendário" no fuso de Recife, para que 23h de um dia não vire o dia seguinte.
function dataLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function daCompetencia(db, comp, hoje) {
  const h = hoje || dataLocal();
  const prazos = P.prazosDaCompetencia(comp.competencia_id);
  if (!prazos) return null;
  const sei = db.get('SELECT MIN(registrado_em) AS em FROM envio_sei WHERE cid = ?', comp.cid);
  const k = db.get('SELECT simas_enviado_em, simas_registrado_por, simas_registrado_em FROM competencias WHERE cid = ?', comp.cid) || {};
  const temEnvio = !!D.ultimoEnvio(db, comp.cid);
  const entregueSei = sei && sei.em ? dataLocal(sei.em) : null;
  const montar = (prazo, entregue, extra) => Object.assign({ prazo, entregue_em: entregue }, P.avaliar(prazo, entregue, h), extra || {});
  return {
    hoje: h, mes_implantacao: !!comp.mes_implantacao, tem_envio: temEnvio,
    sei: montar(prazos.sei, entregueSei, { origem: 'primeiro registro do número do documento no sistema' }),
    simas: montar(prazos.simas, k.simas_enviado_em || null, { origem: 'data informada pelo gestor da unidade', registrado_por: k.simas_registrado_por || null }),
  };
}

// Pior situação entre os dois prazos, para selos curtos em listas.
function resumo(pz) {
  if (!pz) return null;
  const ordem = { alta: 3, atencao: 2, info: 1, ok: 0 };
  const pior = ordem[pz.sei.nivel] >= ordem[pz.simas.nivel] ? { canal: 'SEI', ...pz.sei } : { canal: 'SIMAS', ...pz.simas };
  return { nivel: pior.nivel, texto: pior.canal + ': ' + pior.situacao + (pior.dias && ['vencido', 'entregue com atraso', 'a vencer'].includes(pior.situacao) ? ' (' + pior.dias + ' d)' : '') };
}

function registrarSimas(db, usuario, cid, data, motivo) {
  if (!['gestor_unidade', 'admin'].includes(usuario.perfil)) throw erro(403, 'Só o gestor da unidade informa a data de envio ao SIMAS.');
  const comp = D.competenciaPorCid(db, cid);
  D.exigirContrato(usuario, comp.contrato_id);
  const d = String(data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) throw erro(400, 'Informe a data de envio ao SIMAS (dia/mês/ano).');
  if (d > dataLocal()) throw erro(400, 'A data de envio ao SIMAS não pode ser futura.');
  const ant = db.get('SELECT simas_enviado_em FROM competencias WHERE cid = ?', comp.cid).simas_enviado_em;
  if (ant === d) throw erro(409, 'Esta já é a data registrada.');
  if (ant && !String(motivo || '').trim()) throw erro(400, 'Para corrigir a data, explique o motivo.');
  db.tx(() => {
    db.run('UPDATE competencias SET simas_enviado_em = ?, simas_registrado_por = ?, simas_registrado_em = ? WHERE cid = ?', d, usuario.login, new Date().toISOString(), comp.cid);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'competencias', registro: comp.cid, campo: 'simas_enviado_em', valor_anterior: ant, valor_novo: d, motivo: ant ? 'Correção da data de envio ao SIMAS: ' + motivo : 'Data de envio ao SIMAS informada pela unidade' });
  });
}

module.exports = { dataLocal, daCompetencia, resumo, registrarSimas };
