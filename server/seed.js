'use strict';
// Carga inicial: contrato real (UPA Olinda, a partir de carga/*.csv), contrato de DEMONSTRAÇÃO com dados FICTÍCIOS, usuários e integrações.
// Não há linha bruta real no repositório. Tudo que é sintético é marcado como demonstração na tela e no PDF.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const trilha = require('./trilha');
const L = require('../core/linhas');
const R = require('../core/regras');
const U = require('../core/util');
const sintetico = require('../core/sintetico');
const F = require('../core/formularios');

const CARGA = path.join(config.RAIZ, 'carga');
const lerCarga = (nome) => L.lerCSV(fs.readFileSync(path.join(CARGA, nome), 'utf8')).registros;
const num = (v) => (v === '' || v === undefined ? null : U.numero(v));
const agora = () => new Date().toISOString();
const DEMO = 'DEMO-UPA';

function semearRegra(db, regraId, contratoId) {
  const regras = R.carregarRegras();
  db.run('INSERT OR IGNORE INTO regras (regra_id, versao, contrato_id, vigente_de, arquivo_json, conteudo, pendencias) VALUES (?,?,?,?,?,?,?)',
    regraId, regras.versao, contratoId, regras.vigencia_inicio || '2026-02-01', 'regras/igq_v1.json', JSON.stringify(regras), JSON.stringify(R.pendencias(regras)));
}

function semearContratoReal(db) {
  for (const c of lerCarga('contratos.csv')) {
    db.run('INSERT OR IGNORE INTO contratos (contrato_id, unidade, oss, numero_cg, vigencia_inicio, vigencia_fim, valor_mensal_global, base_desconto_mensal, observacao, demo) VALUES (?,?,?,?,?,?,?,?,?,0)',
      c.contrato_id, c.unidade, c.oss, c.numero_cg, c.vigencia_inicio || null, c.vigencia_fim || null, num(c.valor_mensal_global), num(c.base_desconto_mensal), c.observacao || null);
  }
  semearRegra(db, 'igq_v1', 'UPA-OLINDA');
  for (const t of lerCarga('termos_aditivos.csv')) {
    db.run('INSERT OR IGNORE INTO termos_aditivos (ta_id, contrato_id, numero, data_assinatura, vigencia_inicio, vigencia_fim, efeito, processo_sei) VALUES (?,?,?,?,?,?,?,?)',
      t.ta_id, t.contrato_id, t.numero, t.data_assinatura || null, t.vigencia_inicio || null, t.vigencia_fim || null, t.efeito, t.processo_sei || null);
  }
  const cidPor = {};
  for (const c of lerCarga('competencias.csv')) {
    const r = db.run('INSERT INTO competencias (competencia_id, contrato_id, regra_id, mes_implantacao, processo_sei, parecer_numero, status, aberta_por, aberta_em) VALUES (?,?,?,?,?,?,?,?,?)',
      c.competencia_id, c.contrato_id, c.regra_id, c.mes_implantacao === 'sim' ? 1 : 0, c.processo_sei || null, c.parecer_numero || null, c.status || 'aberta', 'carga', agora());
    cidPor[c.competencia_id] = Number(r.lastInsertRowid);
  }
  // Competência aberta para a unidade começar a usar o portal.
  const r = db.run("INSERT INTO competencias (competencia_id, contrato_id, regra_id, mes_implantacao, status, aberta_por, aberta_em) VALUES ('2026-07','UPA-OLINDA','igq_v1',0,'aberta','carga',?)", agora());
  cidPor['2026-07'] = Number(r.lastInsertRowid);
  for (const t of lerCarga('totais_igq.csv')) db.run('INSERT INTO totais_igq (cid, igq_oss, igq_parecer, igq_pagina3_faixas, observacao) VALUES (?,?,?,?,?)', cidPor[t.competencia_id], num(t.igq_oss), num(t.igq_parecer), num(t.igq_pagina3_faixas), t.observacao || null);
  for (const o of lerCarga('indicadores_oss.csv')) db.run('INSERT INTO indicadores_oss (cid, indicador_id, valor_declarado, pontos_declarados, texto_analise, documento_id, envio_id) VALUES (?,?,?,?,?,?,NULL)', cidPor[o.competencia_id], o.indicador_id, o.valor_declarado || null, num(o.pontos_declarados), o.texto_analise || null, o.documento_id || null);
  for (const p of lerCarga('pareceres_descontos.csv')) db.run('INSERT INTO pareceres_descontos (cid, cenario, igq_ctai, modo_desconto, desconto_pct, desconto_valor, parecer_numero, fonte) VALUES (?,?,?,?,?,?,?,?)', cidPor[p.competencia_id], p.cenario, num(p.igq_usado), p.modo_desconto, num(p.desconto_pct), num(p.desconto_valor_total_mai_jun), p.cenario.startsWith('parecer') ? '204/2026' : null, p.fonte || null);
  // Divergências lidas dos documentos. Linha com várias competências fica na última; janeiro a março vai para abril.
  for (const d of lerCarga('divergencias.csv')) {
    const comps = d.competencia_id.split(';');
    let alvo = comps[comps.length - 1];
    if (!cidPor[alvo]) alvo = '2026-04';
    const tema = /^\d/.test(d.indicador_id) ? 'Indicador ' + d.indicador_id.replace(';', ' e ') : d.indicador_id;
    db.run("INSERT INTO divergencias (cid, indicador_id, tema, declarado, recalculado, gravidade, status, documento_id, observacao, origem) VALUES (?,?,?,?,?,?,?,?,?,'leitura')",
      cidPor[alvo], /^\d/.test(d.indicador_id) ? d.indicador_id : null, tema + (comps.length > 1 ? ' (' + comps.join(', ') + ')' : ''), d.declarado, d.recalculado, d.gravidade, d.status || 'aberta', d.documento_id || null, d.observacao || null);
  }
  db.run("INSERT INTO integracoes (contrato_id, tipo, nome, config, ativo, estado) VALUES ('UPA-OLINDA','mv-api','API do sistema da unidade (MV)', ?, 0, 'não configurada')", JSON.stringify({ baseUrl: '', auth: { tipo: 'bearer', tokenEnv: 'MV_API_TOKEN' }, mapeamento: 'adapters/mv/mapeamento.json', timeoutMs: 30000 }));
}

// Preenche as fichas e as linhas de uma competência de demonstração. Valores escolhidos para gerar divergências a ver.
function preencherDemo(db, cid, competencia, usuarioLogin) {
  const g = sintetico.gerar(competencia);
  const mediaMin = (ls) => ls.reduce((s, l) => s + Number(l.minutos || 0), 0) / Math.max(ls.length, 1);
  const verm = g.classificacao.filter((l) => l.cor === 'vermelho');
  const fichas = {
    assistencia: { i2_3_valor: String(Math.round(mediaMin(verm) * 0.55 * 100) / 100), i2_3_anexo: 'SEI 00000001', i2_1_anexo: 'SEI 00000001', i2_2_anexo: 'SEI 00000001', i2_4_anexo: 'SEI 00000002', iam_casos: '5', i2_6_anexo: 'SEI 00000003', i2_7_anexo: 'SEI 00000003', i2_8_anexo: 'SEI 00000003', i2_9_anexo: 'SEI 00000003', assistencia_obs: 'Sistema de prontuário ficou fora do ar por 3 horas no dia 12; registros feitos em papel e digitados depois.' },
    qualidade: { i2_5_valor: 'sim', pnsp_protocolos_abrangidos: '4', i2_5_anexo: 'SEI 00000004', obitos_24h: '3', obitos_24h_revisados: '3', i2_10_anexo: 'SEI 00000005', prontuarios_amostra: '140', prontuarios_total: '3869', prontuarios_amostra_pct_declarada: '2', qualidade_obs: 'Revisão de prontuários realizada pela comissão no dia 25.' },
    ouvidoria: { satisfacao_respondentes: '1330', satisfacao_satisfeitos: '1310', satisfacao_denominador: '13000', i2_11_anexo: 'SEI 00000006', queixas_recebidas: '8', queixas_identificadas: '6', queixas_aceitas: '6', i2_12_anexo: 'SEI 00000007', i2_13_valor: 'Moderado', i2_13_anexo: 'SEI 00000008', ouvidoria_obs: 'No mês de maio houve duas queixas sobre tempo de espera; as respostas seguiram o fluxo da ouvidoria e foram encaminhadas à coordenação assistencial.' },
    educacao: { educ_previstas: '6', educ_realizadas: '6', i2_14_anexo: 'SEI 00000009', educ_capacitados_assist: '31', educ_ativos_assist: '40', i2_15_anexo: 'SEI 00000009', educ_capacitados_adm: '6', educ_ativos_adm: '10', i2_16_anexo: 'SEI 00000009', educacao_obs: 'Atividades conforme cronograma do plano de educação permanente.' },
    bid: { bid_atendimentos_medicos: '9500', bid_atendimentos_odonto: '420', bid_vermelhos: '14', bid_amarelos: '62', bid_verdes: '125', bid_azuis: '20', turno_vermelhos: '12', turno_amarelos: '60', turno_verdes: '118', bid_obitos: '9', bid_remocoes: '16', transf_media_declarada: '120', i_bid_anexo: 'SEI 00000010', bid_obs: '' },
    rh: { gasto_pessoal_pct: '81.5', quadro_assist_ativos: '40', quadro_adm_ativos: '10', i_rh_anexo: 'SEI 00000011', rh_obs: '' },
  };
  for (const s of F.SETORES) db.run("INSERT OR REPLACE INTO fichas (cid, setor, dados, status, atualizado_por, atualizado_em) VALUES (?,?,?,'pronta',?,?)", cid, s.id, JSON.stringify(fichas[s.id]), usuarioLogin, agora());
  for (const [fonte, registros] of Object.entries(g)) {
    const v = L.validarLinhas(fonte, Object.keys(registros[0]), registros, { competencia });
    for (const l of v.linhas) db.run("INSERT INTO linhas_rascunho (cid, fonte, protocolo, data_inicio, hora_inicio, data_fim, hora_fim, minutos, categoria, dados, origem, confirmada, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,'demo',1,?,?)",
      cid, fonte, l.protocolo, l.data_inicio, l.hora_inicio, l.data_fim, l.hora_fim, l.minutos, l.categoria, JSON.stringify(l.dados || {}), usuarioLogin, agora());
  }
}

function semearDemo(db) {
  db.run("INSERT INTO contratos (contrato_id, unidade, oss, numero_cg, vigencia_inicio, vigencia_fim, valor_mensal_global, base_desconto_mensal, observacao, demo) VALUES (?,?,?,?,?,?,?,?,?,1)",
    DEMO, 'UPA Demonstração (dados fictícios)', 'OSS Fictícia', 'DEMO/0000', '2026-02-01', '2028-01-31', 1000000, 1000000, 'DEMONSTRAÇÃO – dados fictícios. O administrador pode apagar este contrato.');
  semearRegra(db, 'igq_v1-demo', DEMO);
  const c6 = db.run("INSERT INTO competencias (competencia_id, contrato_id, regra_id, mes_implantacao, processo_sei, status, aberta_por, aberta_em) VALUES ('2026-06',?, 'igq_v1-demo',0,'SEI DEMO','aberta','carga',?)", DEMO, agora());
  db.run("INSERT INTO competencias (competencia_id, contrato_id, regra_id, mes_implantacao, processo_sei, status, aberta_por, aberta_em) VALUES ('2026-07',?, 'igq_v1-demo',0,'SEI DEMO','aberta','carga',?)", DEMO, agora());
  preencherDemo(db, Number(c6.lastInsertRowid), '2026-06', 'carga');
  db.run("INSERT INTO integracoes (contrato_id, tipo, nome, config, ativo, estado) VALUES (?,?,?,?,0,'não configurada')", DEMO, 'mv-api', 'API de teste (dados fictícios)', JSON.stringify({ baseUrl: 'http://127.0.0.1:4010', auth: { tipo: 'bearer', tokenEnv: 'MV_API_TOKEN' }, mapeamento: 'adapters/mv/mapeamento.json', timeoutMs: 15000 }));
}

function semearUsuarios(db) {
  const u = (login, nome, perfil, contrato, setor) => auth.criarUsuario(db, { login, nome, perfil, contrato_id: contrato || null, setor: setor || null }, 'carga');
  u('admin', 'Administrador', 'admin');
  u('nathalia', 'Nathália', 'superintendente');
  u('cleuton', 'Cleuton', 'criador');
  u('colega1', 'Colega conferente 1', 'colega');
  u('colega2', 'Colega conferente 2', 'colega');
  u('gestor.olinda', 'Gestor da UPA Olinda', 'gestor_unidade', 'UPA-OLINDA');
  u('gestor.demo', 'Gestor da UPA Demonstração', 'gestor_unidade', DEMO);
  u('assistencia.demo', 'Responsável da assistência (demo)', 'setor_unidade', DEMO, 'assistencia');
  u('ouvidoria.demo', 'Responsável da ouvidoria (demo)', 'setor_unidade', DEMO, 'ouvidoria');
}

function semear(db) {
  if (db.get('SELECT COUNT(*) AS n FROM usuarios').n > 0) return false;
  db.tx(() => {
    semearUsuarios(db);
    semearContratoReal(db);
    semearDemo(db);
    trilha.registrar(db, { usuario: 'sistema', tabela: 'sistema', registro: 'carga', campo: 'semente', valor_novo: 'Carga inicial: UPA Olinda (carga/*.csv) e contrato de demonstração' });
  });
  return true;
}

// Apaga tudo do contrato de demonstração (é o que o gatilho permite) e recria os dados fictícios.
function limparDemo(db) {
  const c = db.get('SELECT * FROM contratos WHERE contrato_id = ?', DEMO);
  if (!c) return;
  const cids = db.all('SELECT cid FROM competencias WHERE contrato_id = ?', DEMO).map((x) => x.cid);
  const em = (n) => '(' + new Array(n).fill('?').join(',') + ')';
  db.tx(() => {
    const pids = db.all('SELECT parecer_id FROM pareceres WHERE contrato_id = ?', DEMO).map((x) => x.parecer_id);
    if (pids.length) {
      db.run('DELETE FROM conferencias WHERE versao_id IN (SELECT versao_id FROM versoes_minuta WHERE parecer_id IN ' + em(pids.length) + ')', ...pids);
      db.run('DELETE FROM versoes_minuta WHERE parecer_id IN ' + em(pids.length), ...pids);
      db.run('DELETE FROM pareceres WHERE parecer_id IN ' + em(pids.length), ...pids);
    }
    if (cids.length) {
      for (const t of ['linhas_brutas', 'envio_sei', 'envios', 'indicadores_oss', 'indicadores_ctai', 'evidencias', 'linhas_rascunho', 'divergencias', 'pareceres_descontos', 'totais_igq', 'fichas', 'lotes_api', 'achados', 'avaliacoes_linha']) db.run('DELETE FROM ' + t + ' WHERE cid IN ' + em(cids.length), ...cids);
    }
    db.run('DELETE FROM integracao_log WHERE integracao_id IN (SELECT integracao_id FROM integracoes WHERE contrato_id = ?)', DEMO);
    db.run('DELETE FROM integracoes WHERE contrato_id = ?', DEMO);
    db.run('DELETE FROM decisoes_regra WHERE contrato_id = ?', DEMO);
    db.run('DELETE FROM competencias WHERE contrato_id = ?', DEMO);
    db.run('DELETE FROM regras WHERE contrato_id = ?', DEMO);
    db.run('DELETE FROM contratos WHERE contrato_id = ?', DEMO);
  });
}

function recarregarDemo(db, usuario) {
  limparDemo(db);
  db.tx(() => {
    semearDemo(db);
    trilha.registrar(db, { usuario: usuario || 'sistema', tabela: 'contratos', registro: DEMO, campo: 'demo', valor_novo: 'recarregado', motivo: 'Dados fictícios recriados' });
  });
}

function apagarDemo(db, usuario) {
  limparDemo(db);
  db.run("UPDATE usuarios SET ativo = 0 WHERE contrato_id = ?", DEMO);
  trilha.registrar(db, { usuario: usuario || 'sistema', tabela: 'contratos', registro: DEMO, campo: 'demo', valor_novo: 'apagado', motivo: 'Contrato de demonstração removido' });
}

module.exports = { semear, recarregarDemo, apagarDemo, preencherDemo, DEMO };
