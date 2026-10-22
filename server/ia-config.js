'use strict';
// Rack de chaves de IA (Administração e Gestão CTAI): chaves ilimitadas, todas valem para todos os usuários; a ordem define a tentativa.
// A chave é cifrada (AES-256-GCM) com um segredo que fica só no .env do servidor (CTAI_SEGREDO). Ela NUNCA volta para a tela,
// nem entra na trilha, nem em log: a tela só recebe "configurada" e os 4 últimos caracteres.
const crypto = require('crypto');
const config = require('./config');
const trilha = require('./trilha');
const { erro } = require('./auth');
const providers = require('../modules/analista/providers');

const AVISO_JURIDICO = 'Dados reais de unidade só podem ir para um provedor aprovado pelo jurídico. Em nuvem, sai somente texto mascarado, e apenas depois da confirmação de aprovação.';

function segredo() { return config.env('CTAI_SEGREDO', ''); }
function chaveDerivada() { return crypto.scryptSync(segredo(), 'ctai-ia-v1', 32); }

function cifrar(texto) {
  if (!segredo() || segredo().length < 16) throw erro(400, 'Para guardar chaves, defina CTAI_SEGREDO no .env do servidor (mínimo de 16 caracteres) e reinicie.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveDerivada(), iv);
  const ct = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
function decifrar(s) {
  if (!s) return '';
  if (!segredo()) return '';
  try {
    const [v, iv, tag, ct] = String(s).split(':');
    if (v !== 'v1') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', chaveDerivada(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}

const mesAtual = () => new Date().toISOString().slice(0, 7);
const agoraIso = () => new Date().toISOString();

function urlValida(u) {
  if (!u) return true;
  return /^https:\/\/[^\s]+$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?(\/[^\s]*)?$/i.test(u);
}

// Liga o módulo do Analista ao rack (chamado quando o app sobe).
function instalar(db) {
  migrar(db);
  providers.usar((nome) => {
    const linhas = db.all('SELECT * FROM ia_chaves WHERE provedor = ? ORDER BY ordem, chave_id', nome);
    return {
      registrado: linhas.length > 0,
      chaves: linhas.filter((r) => r.ativa).map((r) => ({ id: r.chave_id, chave: decifrar(r.chave_cifrada), modelo: r.modelo, url: r.url, juridico: !!r.juridico_em })),
    };
  }, (nome, ok, chaveId) => contar(db, nome, ok, chaveId));
}

// Versão anterior guardava uma chave por provedor (ia_config). Passa para o rack uma única vez.
function migrar(db) {
  if (db.get('SELECT COUNT(*) AS n FROM ia_chaves').n > 0) return;
  for (const r of db.all('SELECT * FROM ia_config WHERE chave_cifrada IS NOT NULL OR (url IS NOT NULL AND provedor = ?)', 'ollama')) {
    if (!providers.DEFS[r.provedor]) continue;
    db.run('INSERT INTO ia_chaves (provedor, rotulo, chave_cifrada, chave_final, modelo, url, ordem, ativa, juridico_por, juridico_em, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      r.provedor, 'Chave anterior', r.chave_cifrada, r.chave_final, r.modelo, r.url, 1, r.ativo ? 1 : 0, r.juridico_por, r.juridico_em, r.atualizado_por || 'migração', r.atualizado_em || agoraIso());
  }
}

function contar(db, nome, ok, chaveId) {
  const agora = agoraIso(), f = ok ? 0 : 1;
  db.run('INSERT INTO ia_uso (provedor, mes, chamadas, falhas, ultimo_uso) VALUES (?,?,?,?,?) ON CONFLICT(provedor, mes) DO UPDATE SET chamadas = chamadas + 1, falhas = falhas + ?, ultimo_uso = excluded.ultimo_uso', nome, mesAtual(), 1, f, agora, f);
  if (chaveId) db.run('INSERT INTO ia_chave_uso (chave_id, mes, chamadas, falhas, ultimo_uso) VALUES (?,?,?,?,?) ON CONFLICT(chave_id, mes) DO UPDATE SET chamadas = chamadas + 1, falhas = falhas + ?, ultimo_uso = excluded.ultimo_uso', chaveId, mesAtual(), 1, f, agora, f);
}

// O que a tela recebe: nunca a chave, só "configurada" e os 4 últimos caracteres.
function listar(db) {
  const mes = mesAtual();
  const servicos = {};
  for (const [nome, d] of Object.entries(providers.DEFS)) servicos[nome] = { nome, nuvem: d.nuvem, tipo: d.tipo, modeloPadrao: d.modeloPadrao, precisaUrl: d.tipo === 'ollama', semChave: d.tipo === 'ollama' };
  const chaves = db.all('SELECT * FROM ia_chaves ORDER BY provedor, ordem, chave_id').map((r) => {
    const uso = db.get('SELECT chamadas, falhas, ultimo_uso FROM ia_chave_uso WHERE chave_id = ? AND mes = ?', r.chave_id, mes) || { chamadas: 0, falhas: 0, ultimo_uso: null };
    const total = db.get('SELECT IFNULL(SUM(chamadas),0) AS c FROM ia_chave_uso WHERE chave_id = ?', r.chave_id).c;
    return { chave_id: r.chave_id, provedor: r.provedor, rotulo: r.rotulo, final: r.chave_final, modelo: r.modelo || '', url: r.url || '', ordem: r.ordem, ativa: !!r.ativa,
      juridico: r.juridico_em ? { por: r.juridico_por, em: r.juridico_em } : null, usoMes: uso.chamadas, falhasMes: uso.falhas, ultimoUso: uso.ultimo_uso, usoTotal: total,
      teste: r.teste_em ? { em: r.teste_em, ok: !!r.teste_ok, ms: r.teste_ms } : null, criado: { por: r.criado_por, em: r.criado_em } };
  });
  const doEnv = Object.entries(providers.DEFS).filter(([nome, d]) => !chaves.some((c) => c.provedor === nome) && providers.efetiva(nome).origem === 'env' && providers.efetiva(nome).ativo)
    .map(([nome, d]) => ({ provedor: nome, final: d.chaveEnv ? providers.efetiva(nome).chave.slice(-4) : null }));
  return { avisoJuridico: AVISO_JURIDICO, segredoConfigurado: segredo().length >= 16, mes, servicos, chaves, doEnv };
}

function validar(d, b, atual, quem) {
  const nome = atual ? atual.provedor : b.provedor;
  const def = providers.DEFS[nome];
  if (!def) throw erro(400, 'Escolha o serviço de IA.');
  const url = b.url === undefined ? (atual ? atual.url : null) : (String(b.url).trim() || null);
  if (url && !urlValida(url)) throw erro(400, 'Endereço inválido. Use https:// (ou http:// só para rede local).');
  const rotulo = b.rotulo === undefined ? (atual ? atual.rotulo : null) : (String(b.rotulo).trim().slice(0, 60) || null);
  const modelo = b.modelo === undefined ? (atual ? atual.modelo : null) : (String(b.modelo).trim().slice(0, 80) || null);
  let ordem = b.ordem === undefined ? (atual ? atual.ordem : null) : Number(b.ordem);
  if (ordem !== null && (!Number.isInteger(ordem) || ordem < 1 || ordem > 99)) throw erro(400, 'A ordem de tentativa vai de 1 a 99.');
  const ativa = b.ativa === undefined ? (atual ? !!atual.ativa : true) : !!b.ativa;
  let jurPor = atual ? atual.juridico_por : null, jurEm = atual ? atual.juridico_em : null;
  if (b.juridico === true && !jurEm) { jurPor = quem; jurEm = agoraIso(); }
  if (b.juridico === false) { jurPor = null; jurEm = null; }
  if (def.tipo === 'ollama' && !url) throw erro(400, 'Informe o endereço do servidor (ex.: http://servidor-local:11434).');
  if (ativa && def.nuvem && !jurEm) throw erro(400, 'Para ligar uma chave de serviço em nuvem, confirme que o uso foi aprovado pelo jurídico. ' + AVISO_JURIDICO);
  return { nome, def, url, rotulo, modelo, ordem, ativa, jurPor, jurEm };
}
function chaveNova(def, b) {
  if (def.tipo === 'ollama') return null;
  const k = String(b.chave || '').trim();
  if (k.length < 8 || /\s/.test(k)) throw erro(400, 'A chave parece inválida (mínimo de 8 caracteres, sem espaços).');
  return k;
}

function criar(db, quem, b) {
  b = b || {};
  const v = validar(null, b, null, quem);
  const k = chaveNova(v.def, b);
  const cifrada = k ? cifrar(k) : null, final = k ? k.slice(-4) : null;
  const ordem = v.ordem || ((db.get('SELECT IFNULL(MAX(ordem),0) AS m FROM ia_chaves WHERE provedor = ?', v.nome).m) + 1);
  const rotulo = v.rotulo || (v.nome + (final ? ' ••••' + final : ''));
  return db.tx(() => {
    const r = db.run('INSERT INTO ia_chaves (provedor, rotulo, chave_cifrada, chave_final, modelo, url, ordem, ativa, juridico_por, juridico_em, criado_por, criado_em, atualizado_por, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      v.nome, rotulo, cifrada, final, v.modelo, v.url, ordem, v.ativa ? 1 : 0, v.jurPor, v.jurEm, quem, agoraIso(), quem, agoraIso());
    const id = Number(r.lastInsertRowid);
    trilha.registrar(db, { usuario: quem, tabela: 'ia_chaves', registro: v.nome + '#' + id, campo: 'chave_criada', valor_novo: (final ? 'final ' + final : 'servidor local') + (v.ativa ? ', ativa' : ', suspensa') });
    return id;
  });
}

// b: { rotulo, chave (nova; vazio = manter), modelo, url, ordem, ativa, juridico }
function atualizar(db, quem, id, b) {
  b = b || {};
  const atual = db.get('SELECT * FROM ia_chaves WHERE chave_id = ?', Number(id));
  if (!atual) throw erro(404, 'Chave não encontrada.');
  const v = validar(null, b, atual, quem);
  let cifrada = atual.chave_cifrada, final = atual.chave_final;
  const mudou = [];
  if (typeof b.chave === 'string' && b.chave.trim()) { const k = chaveNova(v.def, b); cifrada = cifrar(k); final = k.slice(-4); mudou.push('chave trocada (final ' + final + ')'); }
  if (!!atual.ativa !== v.ativa) mudou.push(v.ativa ? 'ativada' : 'suspensa');
  if (v.ordem && atual.ordem !== v.ordem) mudou.push('ordem ' + v.ordem);
  if ((atual.modelo || null) !== v.modelo) mudou.push('modelo: ' + (v.modelo || 'padrão'));
  if ((atual.url || null) !== v.url) mudou.push('endereço alterado');
  if (!atual.juridico_em && v.jurEm) mudou.push('aprovação do jurídico registrada');
  if (atual.juridico_em && !v.jurEm) mudou.push('aprovação do jurídico retirada');
  if ((atual.rotulo || null) !== v.rotulo) mudou.push('nome alterado');
  db.tx(() => {
    db.run('UPDATE ia_chaves SET rotulo = ?, chave_cifrada = ?, chave_final = ?, modelo = ?, url = ?, ordem = ?, ativa = ?, juridico_por = ?, juridico_em = ?, atualizado_por = ?, atualizado_em = ? WHERE chave_id = ?',
      v.rotulo, cifrada, final, v.modelo, v.url, v.ordem || atual.ordem, v.ativa ? 1 : 0, v.jurPor, v.jurEm, quem, agoraIso(), atual.chave_id);
    for (const m of mudou) trilha.registrar(db, { usuario: quem, tabela: 'ia_chaves', registro: atual.provedor + '#' + atual.chave_id, campo: 'config', valor_novo: m });
  });
}

function remover(db, quem, id) {
  const atual = db.get('SELECT * FROM ia_chaves WHERE chave_id = ?', Number(id));
  if (!atual) throw erro(404, 'Chave não encontrada.');
  db.tx(() => {
    db.run('DELETE FROM ia_chave_uso WHERE chave_id = ?', atual.chave_id);
    db.run('DELETE FROM ia_chaves WHERE chave_id = ?', atual.chave_id);
    trilha.registrar(db, { usuario: quem, tabela: 'ia_chaves', registro: atual.provedor + '#' + atual.chave_id, campo: 'chave_removida', valor_anterior: atual.chave_final ? 'final ' + atual.chave_final : 'servidor local' });
  });
}

// Teste de conexão de uma chave: pergunta mínima, sem nenhum dado de unidade. Funciona também com a chave suspensa.
async function testar(db, quem, id) {
  const r = db.get('SELECT * FROM ia_chaves WHERE chave_id = ?', Number(id));
  if (!r) throw erro(404, 'Chave não encontrada.');
  const def = providers.DEFS[r.provedor];
  const chave = decifrar(r.chave_cifrada);
  if (def.tipo !== 'ollama' && !chave) throw erro(400, 'Não foi possível ler a chave guardada. Confira o CTAI_SEGREDO do servidor ou cadastre a chave de novo.');
  const cfg = { chave, modelo: r.modelo || def.modeloPadrao, url: r.url || (def.urlEnv ? config.env(def.urlEnv, def.urlPadrao || '') : '') };
  const t0 = Date.now();
  let ok = false, msg = '';
  try {
    const out = await providers.executar(r.provedor, cfg, { sistema: 'Responda somente com a palavra OK.', usuario: 'Teste de conexão. Responda OK.' }, 20000);
    ok = typeof out === 'string' && out.trim().length > 0; msg = ok ? 'Respondeu normalmente.' : 'Resposta vazia.';
  } catch (e) { msg = String(e.message || e).replace(/(key|bearer|authorization)[^\s]*/ig, '[oculto]').slice(0, 200); if (chave) msg = msg.split(chave).join('[oculto]'); }
  const ms = Date.now() - t0;
  db.run('UPDATE ia_chaves SET teste_em = ?, teste_ok = ?, teste_ms = ? WHERE chave_id = ?', agoraIso(), ok ? 1 : 0, ms, r.chave_id);
  contar(db, r.provedor, ok, r.chave_id);
  trilha.registrar(db, { usuario: quem, tabela: 'ia_chaves', registro: r.provedor + '#' + r.chave_id, campo: 'teste', valor_novo: ok ? 'ok' : 'falhou' });
  return { ok, ms, mensagem: msg };
}

module.exports = { instalar, listar, criar, atualizar, remover, testar, cifrar, decifrar, contar, AVISO_JURIDICO };
