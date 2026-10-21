'use strict';
// Caixa de entrada da CTAI: um item por evento, entregue a quem tem a unidade na carteira (co-responsáveis recebem todos).
// - Unidade sem carteira: vai para a superintendente.
// - Substituição/ausência: a caixa de alguém pode ser redirecionada, por período, para outra pessoa (itens novos vão ao substituto).
// - "Tratado" vale para todos os destinatários (o primeiro que trata marca); o histórico guarda tudo. Tudo vai para a trilha.
// - Os textos NÃO carregam dado sensível: só unidade, tipo, competência, versão e setor. O conteúdo fica na tela de destino.
// Ponto de extensão para aviso por e-mail: ver `avisos` no fim do arquivo (fora do escopo; nada é enviado).
const A = require('./auth');
const CART = require('./carteira');
const PZ = require('./prazos');
const trilha = require('./trilha');

const { erro } = A;
const avisos = { aoCriar: null };
const TIPOS = {
  envio: 'Relatório recebido', reenvio: 'Reenvio / correção', resposta: 'Resposta da unidade', prazo_vencer: 'Prazo a vencer', prazo_vencido: 'Prazo vencido',
  minuta: 'Minuta aguardando conferência', sem_gestor: 'Unidade sem gestor', sem_carteira: 'Unidade sem carteira', redirecionado: 'Redirecionado',
};
const URGENCIA = { prazo_vencido: 90, prazo_vencer: 70, resposta: 60, minuta: 55, reenvio: 52, envio: 50, redirecionado: 45, sem_carteira: 42, sem_gestor: 40 };
const PERFIS_CAIXA = ['criador', 'colega', 'superintendente', 'admin'];
const agora = () => new Date().toISOString();
const hoje = () => PZ.dataLocal();

function superintendentes(db) {
  const l = db.all("SELECT usuario_id FROM usuarios WHERE perfil = 'superintendente' AND ativo = 1 ORDER BY usuario_id").map((x) => x.usuario_id);
  return l.length ? l : db.all("SELECT usuario_id FROM usuarios WHERE perfil = 'admin' AND ativo = 1 ORDER BY usuario_id").map((x) => x.usuario_id);
}
const substituicaoAtiva = (db, de, h) => db.get('SELECT * FROM caixa_substituicoes WHERE de_usuario_id = ? AND cancelado_em IS NULL AND desde <= ? AND ate >= ? ORDER BY subst_id DESC', de, h || hoje(), h || hoje());

// Aplica substituições a uma lista de destinatários. Devolve [{usuario_id, subst}] sem repetidos.
function aplicarSubstituicao(db, ids) {
  const h = hoje(), out = new Map();
  for (const id of ids) {
    const s = substituicaoAtiva(db, id, h);
    const alvo = s ? s.para_usuario_id : id;
    if (!out.has(alvo)) out.set(alvo, { usuario_id: alvo, subst: s ? id : null });
    else if (!s) out.set(alvo, { usuario_id: alvo, subst: null });
  }
  return [...out.values()];
}
const ativo = (db, id) => !!db.get('SELECT 1 FROM usuarios WHERE usuario_id = ? AND ativo = 1', id);

// Quem recebe os itens de uma unidade.
function destinatariosDaUnidade(db, contratoId) {
  const resp = CART.responsaveis(db, contratoId).map((r) => r.usuario_id).filter((id) => ativo(db, id));
  return aplicarSubstituicao(db, resp.length ? resp : superintendentes(db));
}

function historico(db, itemId, quem, acao, detalhe) {
  db.run('INSERT INTO caixa_historico (item_id, em, quem, acao, detalhe) VALUES (?,?,?,?,?)', itemId, agora(), quem, acao, detalhe || null);
}

// Cria o item (uma vez por chave). destinos: [{usuario_id, subst}]
function criar(db, d, quem) {
  if (!d.destinos || !d.destinos.length) return null;
  if (db.get('SELECT 1 FROM caixa_itens WHERE chave = ?', d.chave)) return null;
  const idNovo = db.tx(() => {
    const r = db.run('INSERT INTO caixa_itens (chave, tipo, contrato_id, cid, competencia_id, titulo, texto, link, urgencia, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)',
      d.chave, d.tipo, d.contrato_id || null, d.cid || null, d.competencia_id || null, d.titulo, d.texto || null, d.link || null, d.urgencia === undefined ? (URGENCIA[d.tipo] || 0) : d.urgencia, agora());
    const id = Number(r.lastInsertRowid);
    for (const x of d.destinos) db.run('INSERT OR IGNORE INTO caixa_destinos (item_id, usuario_id, em_substituicao_de) VALUES (?,?,?)', id, x.usuario_id, x.subst || null);
    const nomes = d.destinos.map((x) => { const u = db.get('SELECT login FROM usuarios WHERE usuario_id = ?', x.usuario_id); return (u ? u.login : x.usuario_id) + (x.subst ? ' (em substituição)' : ''); });
    historico(db, id, quem || 'sistema', 'criado', nomes.join(', '));
    trilha.registrar(db, { usuario: quem || 'sistema', tabela: 'caixa', registro: String(id), campo: 'item_criado', valor_novo: { tipo: d.tipo, unidade: d.contrato_id || null, destinatarios: nomes } });
    return id;
  });
  if (typeof avisos.aoCriar === 'function') { try { avisos.aoCriar({ item_id: idNovo, tipo: d.tipo, chave: d.chave }); } catch (_) { /* o aviso nunca atrapalha a caixa */ } }
  return idNovo;
}

const unidadeDe = (db, id) => (db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', id) || {}).unidade || id;
const compTxt = (c) => { if (!c) return ''; const [a, m] = String(c).split('-'); return m + '/' + a; };

// ---------- Eventos (chamados pelos módulos) ----------
function eventoEnvio(db, envio) {
  const k = db.get('SELECT cid, contrato_id, competencia_id FROM competencias WHERE cid = ?', envio.cid);
  if (!k) return null;
  const re = envio.versao > 1;
  return criar(db, { chave: 'envio:' + envio.envio_id, tipo: re ? 'reenvio' : 'envio', contrato_id: k.contrato_id, cid: k.cid, competencia_id: k.competencia_id,
    titulo: (re ? 'Reenvio (versão ' + envio.versao + ') de ' : 'Relatório recebido de ') + unidadeDe(db, k.contrato_id), texto: 'Competência ' + compTxt(k.competencia_id) + ', versão ' + envio.versao + '.',
    link: '#/c/' + k.cid, destinos: destinatariosDaUnidade(db, k.contrato_id) });
}
function eventoResposta(db, achado) {
  const k = achado.cid ? db.get('SELECT cid, contrato_id, competencia_id FROM competencias WHERE cid = ?', achado.cid) : null;
  const contrato = achado.contrato_id || (k && k.contrato_id);
  if (!contrato) return null;
  return criar(db, { chave: 'resposta:' + achado.achado_id + ':' + (achado.respondido_em || agora()), tipo: 'resposta', contrato_id: contrato, cid: k ? k.cid : null, competencia_id: k ? k.competencia_id : null,
    titulo: 'Resposta da unidade ' + unidadeDe(db, contrato), texto: 'A unidade respondeu a um esclarecimento' + (k ? ' (competência ' + compTxt(k.competencia_id) + ')' : '') + '.',
    link: k ? '#/c/' + k.cid + '/achados' : '#/analista', destinos: destinatariosDaUnidade(db, contrato) });
}
function eventoMinuta(db, parecer, versaoId, numero, convocados) {
  return criar(db, { chave: 'minuta:' + versaoId, tipo: 'minuta', contrato_id: parecer.contrato_id, titulo: 'Minuta aguardando conferência: ' + unidadeDe(db, parecer.contrato_id),
    texto: 'Versão ' + numero + ' do parecer (' + (parecer.trimestre || '') + ') espera a sua conferência.', link: '#/v/' + versaoId, destinos: aplicarSubstituicao(db, convocados.map(Number)) });
}

// ---------- Situações calculadas (prazos, sem gestor, sem carteira) ----------
// garantir: abre o item se a condição existe; fecha (pelo sistema) quando deixa de existir; reabre se voltar.
function garantir(db, spec, vale) {
  const it = db.get('SELECT * FROM caixa_itens WHERE chave = ?', spec.chave);
  if (vale) {
    if (!it) return criar(db, spec, 'sistema');
    if (it.tratado_por === 'sistema') db.tx(() => {
      db.run('UPDATE caixa_itens SET tratado_por = NULL, tratado_em = NULL, tratado_obs = NULL WHERE item_id = ?', it.item_id);
      db.run('UPDATE caixa_destinos SET lido_em = NULL WHERE item_id = ?', it.item_id);
      historico(db, it.item_id, 'sistema', 'reaberto', 'A situação voltou a existir');
      trilha.registrar(db, { usuario: 'sistema', tabela: 'caixa', registro: String(it.item_id), campo: 'reaberto', valor_novo: 'situação voltou' });
    });
  } else if (it && !it.tratado_por) {
    db.tx(() => {
      db.run('UPDATE caixa_itens SET tratado_por = ?, tratado_em = ?, tratado_obs = ? WHERE item_id = ?', 'sistema', agora(), 'Situação resolvida', it.item_id);
      historico(db, it.item_id, 'sistema', 'tratado', 'Situação resolvida');
      trilha.registrar(db, { usuario: 'sistema', tabela: 'caixa', registro: String(it.item_id), campo: 'tratado', valor_novo: 'resolvido automaticamente' });
    });
  }
  return null;
}

const ultimaSync = new WeakMap();
function sincronizar(db, opc) {
  const t = Date.now();
  if (!(opc && opc.forcar) && ultimaSync.has(db) && t - ultimaSync.get(db) < 20000) return;
  ultimaSync.set(db, t);
  const h = hoje();
  const G = require('./gestao');
  for (const k of db.all('SELECT cid, contrato_id, competencia_id, mes_implantacao FROM competencias')) {
    const pz = PZ.daCompetencia(db, k, h);
    if (!pz) continue;
    for (const canal of ['sei', 'simas']) {
      const s = pz[canal], nome = canal === 'sei' ? 'SEI (dia 20)' : 'SIMAS (dia 25)';
      const base = { contrato_id: k.contrato_id, cid: k.cid, competencia_id: k.competencia_id, link: '#/c/' + k.cid + '/envios' };
      const dest = () => destinatariosDaUnidade(db, k.contrato_id);
      const vencido = s.situacao === 'vencido', avencer = s.situacao === 'a vencer';
      if (!vencido && !avencer && !db.get('SELECT 1 FROM caixa_itens WHERE chave IN (?,?)', 'prazo:' + k.cid + ':' + canal + ':vencido', 'prazo:' + k.cid + ':' + canal + ':vencer')) continue;
      garantir(db, Object.assign({ chave: 'prazo:' + k.cid + ':' + canal + ':vencer', tipo: 'prazo_vencer', titulo: 'Prazo a vencer: ' + nome + ' de ' + unidadeDe(db, k.contrato_id), texto: 'Competência ' + compTxt(k.competencia_id) + ': vence em ' + s.dias + ' dia(s).', destinos: dest() }, base), avencer);
      garantir(db, Object.assign({ chave: 'prazo:' + k.cid + ':' + canal + ':vencido', tipo: 'prazo_vencido', titulo: 'Prazo vencido: ' + nome + ' de ' + unidadeDe(db, k.contrato_id), texto: 'Competência ' + compTxt(k.competencia_id) + ': venceu há ' + s.dias + ' dia(s).', destinos: dest() }, base), vencido);
    }
  }
  const supers = () => aplicarSubstituicao(db, superintendentes(db));
  for (const c of db.all('SELECT contrato_id, unidade FROM contratos')) {
    const semG = G.semGestor(db, c.contrato_id);
    const semC = CART.responsaveis(db, c.contrato_id).length === 0;
    garantir(db, { chave: 'semgestor:' + c.contrato_id, tipo: 'sem_gestor', contrato_id: c.contrato_id, titulo: 'Unidade sem gestor: ' + c.unidade, texto: 'Ninguém da unidade está cadastrado para usar o Portal da Unidade.', link: '#/gestao/usuarios',
      destinos: (() => { const m = new Map(); for (const d of destinatariosDaUnidade(db, c.contrato_id).concat(supers())) m.set(d.usuario_id, d); return [...m.values()]; })() }, semG);
    garantir(db, { chave: 'semcarteira:' + c.contrato_id, tipo: 'sem_carteira', contrato_id: c.contrato_id, titulo: 'Unidade sem carteira: ' + c.unidade, texto: 'Nenhum funcionário acompanha esta unidade. Distribua em Gestão CTAI > Carteira.', link: '#/gestao/carteira', destinos: supers() }, semC);
  }
}

// ---------- Leitura ----------
const ehSuper = (u) => ['superintendente', 'admin'].includes(u.perfil);
function permitido(db, u) { return ehSuper(u) ? null : CART.permitidos(db, u); }

function listar(db, u, f) {
  f = f || {};
  const perm = permitido(db, u);
  let linhas = db.all('SELECT i.*, d.lido_em, d.em_substituicao_de FROM caixa_itens i JOIN caixa_destinos d ON d.item_id = i.item_id WHERE d.usuario_id = ?', u.usuario_id);
  linhas = linhas.filter((i) => !perm || !i.contrato_id || perm.has(i.contrato_id));
  const contagem = { naoLidos: linhas.filter((i) => !i.lido_em && !i.tratado_por).length, pendentes: linhas.filter((i) => !i.tratado_por).length, total: linhas.length };
  if (f.unidade) linhas = linhas.filter((i) => i.contrato_id === f.unidade);
  if (f.tipo) linhas = linhas.filter((i) => i.tipo === f.tipo);
  if (f.situacao === 'pendentes') linhas = linhas.filter((i) => !i.tratado_por);
  else if (f.situacao === 'tratados') linhas = linhas.filter((i) => !!i.tratado_por);
  else if (f.situacao === 'nao_lidos') linhas = linhas.filter((i) => !i.lido_em && !i.tratado_por);
  linhas.sort((a, b) => (!!a.tratado_por - !!b.tratado_por) || (b.urgencia - a.urgencia) || (b.criado_em < a.criado_em ? -1 : b.criado_em > a.criado_em ? 1 : 0));
  const nome = (id) => { const x = db.get('SELECT nome FROM usuarios WHERE usuario_id = ?', id); return x ? x.nome : null; };
  const unidades = {};
  const itens = linhas.slice(0, 300).map((i) => {
    const un = i.contrato_id ? unidadeDe(db, i.contrato_id) : null;
    return { item_id: i.item_id, tipo: i.tipo, tipo_rotulo: TIPOS[i.tipo] || i.tipo, contrato_id: i.contrato_id, unidade: un, competencia_id: i.competencia_id, titulo: i.titulo, texto: i.texto, link: i.link, urgencia: i.urgencia,
      criado_em: i.criado_em, lido: !!i.lido_em, lido_em: i.lido_em, tratado: !!i.tratado_por, tratado_por: i.tratado_por ? (i.tratado_por === 'sistema' ? 'sistema' : (nome2(db, i.tratado_por))) : null, tratado_em: i.tratado_em, tratado_obs: i.tratado_obs,
      em_substituicao_de: i.em_substituicao_de ? nome(i.em_substituicao_de) : null };
  });
  for (const i of linhas) if (i.contrato_id) unidades[i.contrato_id] = unidadeDe(db, i.contrato_id);
  return { itens, contagem, unidades: Object.entries(unidades).map(([id, un]) => ({ contrato_id: id, unidade: un })).sort((a, b) => a.unidade.localeCompare(b.unidade)), tipos: TIPOS };
}
function nome2(db, login) { const x = db.get('SELECT nome FROM usuarios WHERE login = ?', login); return x ? x.nome : login; }

// Faixa de resumo do topo da Caixa de entrada (só o que está pendente e dentro da carteira da pessoa).
function resumo(db, u) {
  const p = listar(db, u, { situacao: 'pendentes' });
  const n = (...t) => p.itens.filter((i) => t.includes(i.tipo)).length;
  return { naoLidos: p.contagem.naoLidos, prazos_vencidos: n('prazo_vencido'), prazos_a_vencer: n('prazo_vencer'), respostas: n('resposta'), sem_gestor: n('sem_gestor') };
}
function contador(db, u) { const l = listar(db, u, {}); return l.contagem; }

function meuItem(db, u, id) {
  const i = db.get('SELECT i.*, d.lido_em FROM caixa_itens i JOIN caixa_destinos d ON d.item_id = i.item_id AND d.usuario_id = ? WHERE i.item_id = ?', u.usuario_id, Number(id));
  if (!i) throw erro(404, 'Item não encontrado.');
  const perm = permitido(db, u);
  if (perm && i.contrato_id && !perm.has(i.contrato_id)) throw erro(404, 'Item não encontrado.');
  return i;
}

function detalhe(db, u, id) {
  const i = meuItem(db, u, id);
  const hist = db.all('SELECT em, quem, acao, detalhe FROM caixa_historico WHERE item_id = ? ORDER BY hist_id', i.item_id);
  const dest = db.all('SELECT u.nome, u.login, d.lido_em, d.em_substituicao_de FROM caixa_destinos d JOIN usuarios u ON u.usuario_id = d.usuario_id WHERE d.item_id = ? ORDER BY u.nome', i.item_id);
  return { item_id: i.item_id, historico: hist, destinatarios: dest };
}

function marcarLido(db, u, id) {
  const i = meuItem(db, u, id);
  if (i.lido_em) return { ok: true };
  db.tx(() => {
    db.run('UPDATE caixa_destinos SET lido_em = ? WHERE item_id = ? AND usuario_id = ?', agora(), i.item_id, u.usuario_id);
    historico(db, i.item_id, u.login, 'lido', null);
    trilha.registrar(db, { usuario: u.login, tabela: 'caixa', registro: String(i.item_id), campo: 'lido', valor_novo: 'sim' });
  });
  return { ok: true };
}
function marcarTodosLidos(db, u) {
  let n = 0;
  for (const i of listar(db, u, { situacao: 'nao_lidos' }).itens) { marcarLido(db, u, i.item_id); n++; }
  return { lidos: n };
}

function tratar(db, u, id, obs) {
  const i = meuItem(db, u, id);
  if (i.tratado_por) throw erro(409, 'Este item já foi tratado por ' + (i.tratado_por === 'sistema' ? 'o sistema' : nome2(db, i.tratado_por)) + '.');
  const o = String(obs || '').trim().slice(0, 500) || null;
  db.tx(() => {
    db.run('UPDATE caixa_itens SET tratado_por = ?, tratado_em = ?, tratado_obs = ? WHERE item_id = ?', u.login, agora(), o, i.item_id);
    if (!i.lido_em) db.run('UPDATE caixa_destinos SET lido_em = ? WHERE item_id = ? AND usuario_id = ?', agora(), i.item_id, u.usuario_id);
    historico(db, i.item_id, u.login, 'tratado', o);
    trilha.registrar(db, { usuario: u.login, tabela: 'caixa', registro: String(i.item_id), campo: 'tratado', valor_novo: 'sim', motivo: o });
  });
  return { ok: true };
}
function reabrir(db, u, id, motivo) {
  const i = meuItem(db, u, id);
  if (!i.tratado_por) throw erro(409, 'Este item não está tratado.');
  db.tx(() => {
    db.run('UPDATE caixa_itens SET tratado_por = NULL, tratado_em = NULL, tratado_obs = NULL WHERE item_id = ?', i.item_id);
    historico(db, i.item_id, u.login, 'reaberto', motivo || null);
    trilha.registrar(db, { usuario: u.login, tabela: 'caixa', registro: String(i.item_id), campo: 'reaberto', valor_novo: 'sim', motivo: motivo || null });
  });
  return { ok: true };
}

function redirecionarItem(db, u, id, paraId, motivo) {
  const i = meuItem(db, u, id);
  const para = db.get('SELECT * FROM usuarios WHERE usuario_id = ? AND ativo = 1', Number(paraId));
  if (!para || !PERFIS_CAIXA.includes(para.perfil)) throw erro(400, 'Escolha uma pessoa da CTAI.');
  if (para.usuario_id === u.usuario_id) throw erro(400, 'Escolha outra pessoa.');
  const perm = permitido(db, para);
  if (perm && i.contrato_id && !perm.has(i.contrato_id)) throw erro(400, para.nome + ' não tem esta unidade na carteira. Inclua a unidade na carteira antes de redirecionar.');
  db.tx(() => {
    db.run('INSERT OR IGNORE INTO caixa_destinos (item_id, usuario_id) VALUES (?,?)', i.item_id, para.usuario_id);
    historico(db, i.item_id, u.login, 'redirecionado', 'para ' + para.login + (motivo ? ' — ' + motivo : ''));
    trilha.registrar(db, { usuario: u.login, tabela: 'caixa', registro: String(i.item_id), campo: 'redirecionado', valor_novo: para.login, motivo: motivo || null });
    criar(db, { chave: 'redir:' + i.item_id + ':' + para.usuario_id + ':' + Date.now(), tipo: 'redirecionado', contrato_id: i.contrato_id, cid: i.cid, competencia_id: i.competencia_id, titulo: 'Redirecionado a você: ' + i.titulo,
      texto: u.nome + ' redirecionou este item' + (motivo ? ': ' + String(motivo).slice(0, 200) : '.'), link: i.link, destinos: [{ usuario_id: para.usuario_id }] }, u.login);
  });
  return { ok: true };
}

// ---------- Substituição / ausência ----------
const DATA = /^\d{4}-\d{2}-\d{2}$/;
function criarSubstituicao(db, u, b) {
  const deId = Number(b.de_usuario_id || u.usuario_id);
  if (!ehSuper(u) && deId !== u.usuario_id) throw erro(403, 'Você só pode redirecionar a sua própria caixa.');
  const de = db.get('SELECT * FROM usuarios WHERE usuario_id = ?', deId), para = db.get('SELECT * FROM usuarios WHERE usuario_id = ? AND ativo = 1', Number(b.para_usuario_id));
  if (!de || !PERFIS_CAIXA.includes(de.perfil)) throw erro(400, 'Escolha uma pessoa da CTAI para ter a caixa redirecionada.');
  if (!para || !PERFIS_CAIXA.includes(para.perfil)) throw erro(400, 'Escolha o substituto entre as pessoas ativas da CTAI.');
  if (para.usuario_id === de.usuario_id) throw erro(400, 'O substituto deve ser outra pessoa.');
  if (!DATA.test(b.desde || '') || !DATA.test(b.ate || '')) throw erro(400, 'Informe o período (AAAA-MM-DD).');
  if (b.ate < b.desde) throw erro(400, 'O fim do período não pode ser antes do início.');
  if (b.ate < hoje()) throw erro(400, 'O período já terminou.');
  if (db.get('SELECT 1 FROM caixa_substituicoes WHERE de_usuario_id = ? AND cancelado_em IS NULL AND desde <= ? AND ate >= ?', de.usuario_id, b.ate, b.desde)) throw erro(409, 'Já existe redirecionamento para essa pessoa neste período.');
  if (substituicaoAtiva(db, para.usuario_id, null) && b.desde <= hoje()) throw erro(400, para.nome + ' está com a caixa redirecionada para outra pessoa agora.');
  return db.tx(() => {
    const r = db.run('INSERT INTO caixa_substituicoes (de_usuario_id, para_usuario_id, desde, ate, motivo, criado_por, criado_em) VALUES (?,?,?,?,?,?,?)', de.usuario_id, para.usuario_id, b.desde, b.ate, String(b.motivo || '').slice(0, 300) || null, u.login, agora());
    const id = Number(r.lastInsertRowid);
    trilha.registrar(db, { usuario: u.login, tabela: 'caixa_substituicoes', registro: String(id), campo: 'criada', valor_novo: { de: de.login, para: para.login, desde: b.desde, ate: b.ate }, motivo: b.motivo || null });
    criar(db, { chave: 'subst:' + id, tipo: 'redirecionado', titulo: 'Caixa de ' + de.nome + ' redirecionada para você', texto: 'De ' + b.desde.split('-').reverse().join('/') + ' a ' + b.ate.split('-').reverse().join('/') + '. Os itens novos das unidades dela(e) chegam aqui, marcados "em substituição".', link: '#/caixa', destinos: [{ usuario_id: para.usuario_id }] }, u.login);
    return id;
  });
}
function cancelarSubstituicao(db, u, id) {
  const s = db.get('SELECT * FROM caixa_substituicoes WHERE subst_id = ?', Number(id));
  if (!s || s.cancelado_em) throw erro(404, 'Redirecionamento não encontrado.');
  if (!ehSuper(u) && s.de_usuario_id !== u.usuario_id) throw erro(403, 'Você só pode cancelar o seu próprio redirecionamento.');
  db.run('UPDATE caixa_substituicoes SET cancelado_por = ?, cancelado_em = ? WHERE subst_id = ?', u.login, agora(), s.subst_id);
  trilha.registrar(db, { usuario: u.login, tabela: 'caixa_substituicoes', registro: String(s.subst_id), campo: 'cancelada', valor_novo: 'sim' });
  return { ok: true };
}
function listarSubstituicoes(db, u) {
  const h = hoje();
  return db.all('SELECT s.*, a.nome AS de_nome, a.login AS de_login, b.nome AS para_nome, b.login AS para_login FROM caixa_substituicoes s JOIN usuarios a ON a.usuario_id = s.de_usuario_id JOIN usuarios b ON b.usuario_id = s.para_usuario_id ORDER BY s.subst_id DESC LIMIT 60')
    .filter((s) => ehSuper(u) || s.de_usuario_id === u.usuario_id || s.para_usuario_id === u.usuario_id)
    .map((s) => Object.assign(s, { situacao: s.cancelado_em ? 'cancelada' : (s.ate < h ? 'encerrada' : (s.desde > h ? 'agendada' : 'em vigor')) }));
}

// ---------- Minhas unidades ----------
function minhasUnidades(db, u) {
  const G = require('./gestao');
  const perm = permitido(db, u);
  const p = G.painel(db, {});
  const pend = {};
  for (const i of listar(db, u, { situacao: 'pendentes' }).itens) if (i.contrato_id) pend[i.contrato_id] = (pend[i.contrato_id] || 0) + 1;
  const unidades = p.unidades.filter((x) => !perm || perm.has(x.contrato_id)).map((x) => {
    const ult = db.get('SELECT MAX(e.recebido_em) AS t FROM envios e JOIN competencias k ON k.cid = e.cid WHERE k.contrato_id = ? AND e.recebido_em IS NOT NULL', x.contrato_id).t;
    const ab = db.get("SELECT COUNT(*) AS n FROM divergencias d JOIN competencias k ON k.cid = d.cid WHERE k.contrato_id = ? AND d.status = 'aberta'", x.contrato_id).n;
    return { contrato_id: x.contrato_id, unidade: x.unidade, tipo: x.tipo, municipio: x.municipio, fase: x.fase, pior_prazo: x.pior_prazo, achados: x.achados, divergencias_abertas: ab, ultima_entrega: ult, pendencias_caixa: pend[x.contrato_id] || 0,
      competencias: x.competencias.map((k) => ({ cid: k.cid, competencia_id: k.competencia_id, envio: k.envio.estado, prazos: k.prazos })), sem_gestor: x.sem_gestor, link: x.competencias.length ? '#/c/' + x.competencias[x.competencias.length - 1].cid : '#/analista' };
  });
  return { unidades, trimestre: p.trimestre, todas: !perm };
}

// ---------- Entregas por carteira (Gestão CTAI) ----------
const diasNaoLido = (db) => Math.max(1, Number(CART.cfg(db, 'caixa_dias_nao_lido', '3')) || 3);
function entregas(db, filtro) {
  filtro = filtro || {};
  const N = diasNaoLido(db), t = Date.now();
  let envios = db.all('SELECT e.envio_id, e.cid, e.versao, e.recebido_em, k.competencia_id, k.contrato_id, c.unidade FROM envios e JOIN competencias k ON k.cid = e.cid JOIN contratos c ON c.contrato_id = k.contrato_id WHERE e.recebido_em IS NOT NULL ORDER BY e.recebido_em DESC LIMIT 400');
  if (filtro.contrato) envios = envios.filter((e) => e.contrato_id === filtro.contrato);
  const porAnalista = new Map(), semResp = new Map();
  const dias = (iso) => Math.floor((t - Date.parse(iso)) / 864e5);
  const resumo = () => ({ entregas: 0, nao_lidas: 0, pendentes: 0, destacadas: 0 });
  for (const e of envios) {
    const it = db.get('SELECT * FROM caixa_itens WHERE chave = ?', 'envio:' + e.envio_id);
    const dest = it ? db.all('SELECT d.usuario_id, d.lido_em, d.em_substituicao_de, u.nome, u.login, u.perfil FROM caixa_destinos d JOIN usuarios u ON u.usuario_id = d.usuario_id WHERE d.item_id = ?', it.item_id) : [];
    const lidoEm = dest.map((d) => d.lido_em).filter(Boolean).sort()[0] || null;
    const pend = it && !it.tratado_por ? dias(e.recebido_em) : null;
    const base = { envio_id: e.envio_id, cid: e.cid, contrato_id: e.contrato_id, unidade: e.unidade, competencia_id: e.competencia_id, versao: e.versao, recebido_em: e.recebido_em, registrado_na_caixa: !!it,
      caixa: dest.map((d) => ({ usuario_id: d.usuario_id, nome: d.nome, login: d.login, perfil: d.perfil, em_substituicao_de: d.em_substituicao_de ? (db.get('SELECT nome FROM usuarios WHERE usuario_id = ?', d.em_substituicao_de) || {}).nome : null, lido_em: d.lido_em })),
      lido: !!lidoEm, lido_em: lidoEm, tratado: !!(it && it.tratado_por), tratado_por: it && it.tratado_por ? (it.tratado_por === 'sistema' ? 'sistema' : nome2(db, it.tratado_por)) : null, tratado_em: it ? it.tratado_em : null,
      pendente_dias: pend, destaque: !!(it && !lidoEm && !it.tratado_por && dias(e.recebido_em) >= N),
      horas_ate_leitura: lidoEm ? Math.round(((Date.parse(lidoEm) - Date.parse(e.recebido_em)) / 36e5) * 10) / 10 : null,
      horas_ate_tratamento: it && it.tratado_em && it.tratado_por !== 'sistema' ? Math.round(((Date.parse(it.tratado_em) - Date.parse(e.recebido_em)) / 36e5) * 10) / 10 : null };
    const donos = dest.filter((d) => d.perfil !== 'superintendente' && d.perfil !== 'admin');
    if (!donos.length) { const m = semResp.get(e.contrato_id) || { contrato_id: e.contrato_id, unidade: e.unidade, entregas: [] }; m.entregas.push(base); semResp.set(e.contrato_id, m); continue; }
    for (const d of donos) {
      if (filtro.usuario_id && Number(filtro.usuario_id) !== d.usuario_id) continue;
      let a = porAnalista.get(d.usuario_id); if (!a) { a = { usuario_id: d.usuario_id, nome: d.nome, login: d.login, resumo: resumo(), unidades: new Map() }; porAnalista.set(d.usuario_id, a); }
      let un = a.unidades.get(e.contrato_id); if (!un) { un = { contrato_id: e.contrato_id, unidade: e.unidade, entregas: [] }; a.unidades.set(e.contrato_id, un); }
      un.entregas.push(base);
      const meu = d.lido_em;
      a.resumo.entregas++; if (!meu && !base.tratado) a.resumo.nao_lidas++; if (!base.tratado) a.resumo.pendentes++; if (base.destaque) a.resumo.destacadas++;
    }
  }
  const analistas = [...porAnalista.values()].map((a) => Object.assign(a, { unidades: [...a.unidades.values()] })).sort((x, y) => x.nome.localeCompare(y.nome));
  // Unidades sem responsável: sem carteira (mesmo sem envio) ou com entregas caídas na caixa da superintendente.
  for (const c of CART.semCarteira(db)) if ((!filtro.contrato || filtro.contrato === c.contrato_id) && !semResp.has(c.contrato_id)) semResp.set(c.contrato_id, { contrato_id: c.contrato_id, unidade: c.unidade, entregas: [] });
  const total = { entregas: 0, nao_lidas: 0, pendentes: 0, destacadas: 0 };
  for (const a of analistas) for (const k of Object.keys(total)) total[k] += a.resumo[k];
  return { dias_nao_lido: N, analistas, sem_responsavel: [...semResp.values()], total, gerado_em: new Date().toISOString() };
}

// ---------- Produção: tempo até a primeira leitura e até o tratamento ----------
function tempos(db, usuarioId, de, ate, contrato) {
  let sql = "SELECT i.criado_em, i.tratado_em, i.tratado_por, d.lido_em, u.login FROM caixa_destinos d JOIN caixa_itens i ON i.item_id = d.item_id JOIN usuarios u ON u.usuario_id = d.usuario_id WHERE d.usuario_id = ? AND i.tipo IN ('envio','reenvio','resposta','minuta')";
  const a = [usuarioId];
  if (de) { sql += ' AND i.criado_em >= ?'; a.push(de); }
  if (ate) { sql += ' AND i.criado_em < ?'; a.push(ate); }
  if (contrato) { sql += ' AND i.contrato_id = ?'; a.push(contrato); }
  const l = db.all(sql, ...a);
  const media = (v) => (v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null);
  const hr = (x, y) => (Date.parse(y) - Date.parse(x)) / 36e5;
  const leit = l.filter((x) => x.lido_em).map((x) => hr(x.criado_em, x.lido_em)).filter((x) => x >= 0);
  const trat = l.filter((x) => x.tratado_em && x.tratado_por === x.login).map((x) => hr(x.criado_em, x.tratado_em)).filter((x) => x >= 0);
  return { itens: l.length, lidos: l.filter((x) => x.lido_em).length, tratados_por_mim: trat.length, pendentes: l.filter((x) => !x.tratado_por).length, horas_ate_leitura: media(leit), horas_ate_tratamento: media(trat) };
}

// Ponto de extensão (aviso por e-mail): nada é enviado hoje. Para ligar no futuro, registre aqui uma função que receba
// { item_id, tipo, unidade, titulo, destinatarios:[{login,nome}] } — ela é chamada depois que o item é criado.

module.exports = { TIPOS, PERFIS_CAIXA, criar, eventoEnvio, eventoResposta, eventoMinuta, sincronizar, listar, resumo, contador, detalhe, marcarLido, marcarTodosLidos, tratar, reabrir, redirecionarItem,
  criarSubstituicao, cancelarSubstituicao, listarSubstituicoes, minhasUnidades, entregas, tempos, diasNaoLido, destinatariosDaUnidade, avisos };
