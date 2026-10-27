'use strict';
// Zerar dados de demonstração e de teste, para começar a alimentar com dados reais.
// Mantém: usuários reais da equipe CTAI, configurações (IA, GAOCG, gestão), regras, decisões, normas, ensinos, modelos de documento,
// a definição dos contratos reais (sem nenhum dado operacional) e a trilha de auditoria (que nunca é apagada).
// Apaga: contrato e usuários de demonstração e todos os dados operacionais (competências, fichas, linhas, envios, pareceres, achados,
// histórico, caixa de entrada, mensagens, carteiras, documentos).
// Os gatilhos que protegem envios, linhas brutas, versões e conferências só deixam apagar de contrato marcado como demonstração.
// Por isso, dentro de UMA transação, todos os contratos são marcados como demonstração só pelo tempo da limpeza e os reais voltam ao normal no fim.
// Se qualquer passo falhar, a transação desfaz tudo.
const fs = require('fs');
const path = require('path');
const A = require('./auth');
const trilha = require('./trilha');
const config = require('./config');
const seed = require('./seed');

const { erro } = A;

// Tabelas com dado operacional: apagadas por inteiro (ordem: filhas antes das mães).
const OPERACIONAIS = [
  ['conferencias', 'Conferências de minutas'], ['versoes_minuta', 'Versões de minutas'], ['parecer_relatorios', 'Relatórios anexados a pareceres'], ['pareceres', 'Pareceres'],
  ['documentos_conferencia', 'Conferências de documentos'], ['documentos', 'Ofícios, despachos e outros documentos'],
  ['achados', 'Achados e esclarecimentos'], ['linhas_brutas', 'Linhas de envios'], ['envio_sei', 'Registros do SEI'], ['envios', 'Envios das unidades'],
  ['indicadores_oss', 'Indicadores declarados'], ['indicadores_ctai', 'Indicadores adotados'], ['evidencias', 'Evidências'], ['linhas_rascunho', 'Linhas em rascunho'],
  ['divergencias', 'Divergências'], ['pareceres_descontos', 'Cenários de desconto'], ['totais_igq', 'Totais do IGQ'], ['fichas', 'Fichas por setor'], ['lotes_api', 'Lotes da integração'],
  ['avaliacoes_linha', 'Avaliações de linhas'], ['checklist_itens', 'Checklist de recebimento'], ['competencias', 'Competências (meses)'],
  ['caixa_historico', 'Histórico da Caixa de entrada'], ['caixa_destinos', 'Destinatários da Caixa de entrada'], ['caixa_itens', 'Itens da Caixa de entrada'], ['caixa_substituicoes', 'Ausências na Caixa de entrada'],
  ['msg', 'Mensagens da equipe'], ['msg_anexos', 'Anexos das mensagens'], ['carteira', 'Carteiras (unidades por analista)'], ['importacoes', 'Importações em lote'],
  ['hist_indicadores', 'Histórico: indicadores'], ['hist_achados', 'Histórico: achados'], ['hist_recomendacoes', 'Histórico: recomendações'], ['hist_relatorios', 'Histórico: relatórios'],
  ['gaocg_cache', 'Cópia temporária de consultas ao GAOCG'], ['integracao_log', 'Registro das integrações'],
];
const MANTIDOS = [
  'Usuários reais da equipe CTAI (administração, superintendência, analistas, conferentes)', 'Configurações: IA (provedores e chaves), GAOCG, Gestão CTAI',
  'Regras do IGQ, regras por contrato e decisões da CTAI', 'Normas, ensinos ("Ensinar ao Sistema") e modelos de documento',
  'A definição dos contratos reais (nome, número, vigência), sem nenhum dado de mês, ficha ou envio',
  'Trilha de auditoria e registro de acessos (nunca são apagados)',
];

const ehUsuarioDemo = (u) => u.contrato_id === seed.DEMO || /\.demo$/i.test(u.login) || /demonstra|\(demo\)|conferente\s*\d/i.test(u.nome || '');

function usuariosDaLimpeza(db, eu) {
  const todos = db.all('SELECT usuario_id, login, nome, perfil, contrato_id FROM usuarios ORDER BY usuario_id');
  const apagar = todos.filter((u) => u.usuario_id !== (eu && eu.usuario_id) && u.perfil !== 'admin' && ehUsuarioDemo(u));
  const ids = new Set(apagar.map((u) => u.usuario_id));
  return { apagar, manter: todos.filter((u) => !ids.has(u.usuario_id)) };
}

function contar(db, eu) {
  const itens = OPERACIONAIS.map(([t, nome]) => ({ tabela: t, nome, n: db.get('SELECT COUNT(*) AS n FROM ' + t).n })).filter((x) => x.n > 0);
  const contratos = db.all('SELECT contrato_id, unidade, demo FROM contratos ORDER BY contrato_id');
  const u = usuariosDaLimpeza(db, eu);
  return {
    apagar: itens,
    contratosApagados: contratos.filter((c) => c.demo).map((c) => c.unidade + ' (' + c.contrato_id + ')'),
    contratosMantidos: contratos.filter((c) => !c.demo).map((c) => c.unidade + ' (' + c.contrato_id + ')'),
    usuariosApagados: u.apagar.map((x) => x.nome + ' (' + x.login + ')'),
    usuariosMantidos: u.manter.map((x) => x.nome + ' (' + x.login + ')'),
    mantidos: MANTIDOS,
    pdfs: arquivosPdf().length,
  };
}

function arquivosPdf() {
  const out = [];
  for (const sub of ['envios', 'pareceres']) {
    const d = path.join(config.dataDir, sub);
    try { for (const f of fs.readdirSync(d)) if (fs.statSync(path.join(d, f)).isFile()) out.push(path.join(sub, f)); } catch (_) { /* pasta ausente */ }
  }
  return out;
}

const NOME_BACKUP = /^backup-antes-de-zerar-[0-9T\-]+\.sqlite$/;
const caminhoBackup = (nome) => { if (!NOME_BACKUP.test(nome || '')) throw erro(400, 'Nome de backup inválido.'); const f = path.join(config.dataDir, nome); if (!fs.existsSync(f)) throw erro(404, 'Backup não encontrado.'); return f; };

function zerar(db, eu, corpo) {
  const b = corpo || {};
  if (b.confirmar !== 'ZERAR') throw erro(400, 'Confirme digitando ZERAR.');
  const adm = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', eu.usuario_id);
  if (!adm || !b.senha || !A.conferirSenha(String(b.senha), adm.senha_hash)) {
    trilha.registrar(db, { usuario: eu.login, tabela: 'sistema', registro: 'dados', campo: 'zerar_demo', valor_novo: 'recusado: senha incorreta' });
    throw erro(403, 'Senha incorreta. Nada foi apagado.');
  }
  const antes = contar(db, eu);
  // 1) cópia do banco ANTES de qualquer apagamento (fora de transação)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const nomeBackup = 'backup-antes-de-zerar-' + stamp + '.sqlite';
  db.exec("VACUUM INTO '" + path.join(config.dataDir, nomeBackup).replace(/'/g, "''") + "'");
  // 2) limpeza em uma transação só
  const u = usuariosDaLimpeza(db, eu);
  const reais = db.all('SELECT contrato_id FROM contratos WHERE IFNULL(demo,0) = 0').map((c) => c.contrato_id);
  db.tx(() => {
    db.run('UPDATE contratos SET demo = 1');
    for (const [t] of OPERACIONAIS) db.run('DELETE FROM ' + t);
    for (const c of db.all('SELECT contrato_id FROM contratos WHERE contrato_id = ?', seed.DEMO)) {
      for (const t of ['normas', 'decisoes_regra', 'regras', 'termos_aditivos', 'contrato_regras']) db.run('DELETE FROM ' + t + ' WHERE contrato_id = ?', c.contrato_id);
      db.run('DELETE FROM integracoes WHERE contrato_id = ?', c.contrato_id);
      db.run('DELETE FROM contratos WHERE contrato_id = ?', c.contrato_id);
    }
    for (const x of u.apagar) { db.run('DELETE FROM sessoes WHERE usuario_id = ?', x.usuario_id); db.run('DELETE FROM usuarios WHERE usuario_id = ?', x.usuario_id); }
    if (reais.length) db.run('UPDATE contratos SET demo = 0 WHERE contrato_id IN (' + reais.map(() => '?').join(',') + ')', ...reais);
    trilha.registrar(db, { usuario: eu.login, tabela: 'sistema', registro: 'dados', campo: 'zerar_demo', valor_novo: {
      apagado: Object.fromEntries(antes.apagar.map((x) => [x.tabela, x.n])), usuarios_removidos: u.apagar.map((x) => x.login), contratos_removidos: antes.contratosApagados, backup: nomeBackup },
      motivo: 'Dados de demonstração e de teste zerados para iniciar com dados reais' });
  });
  // 3) PDFs gerados deixam de ter referência: ficam guardados, fora do caminho, numa pasta datada (nada é perdido)
  let arquivados = 0;
  const pasta = path.join(config.dataDir, 'arquivados-antes-de-zerar-' + stamp);
  for (const rel of arquivosPdf()) {
    try { const dest = path.join(pasta, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(path.join(config.dataDir, rel), dest); arquivados++; } catch (_) { /* segue */ }
  }
  return { ok: true, backup: nomeBackup, pdfsArquivados: arquivados, apagado: antes.apagar, usuariosRemovidos: u.apagar.length };
}

module.exports = { contar, zerar, caminhoBackup, ehUsuarioDemo };
