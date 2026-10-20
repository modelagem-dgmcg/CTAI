'use strict';
// Configuração dos provedores de IA feita na Gestão CTAI.
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

function urlValida(u) {
  if (!u) return true;
  return /^https:\/\/[^\s]+$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?(\/[^\s]*)?$/i.test(u);
}

// Liga o módulo do Analista a esta configuração (chamado quando o app sobe).
function instalar(db) {
  providers.usar((nome) => {
    const r = db.get('SELECT * FROM ia_config WHERE provedor = ?', nome);
    if (!r) return null;
    return { ativo: !!r.ativo, chave: decifrar(r.chave_cifrada), modelo: r.modelo, url: r.url, juridico: !!r.juridico_em };
  }, (nome, ok) => contar(db, nome, ok));
}

function contar(db, nome, ok) {
  db.run('INSERT INTO ia_uso (provedor, mes, chamadas, falhas, ultimo_uso) VALUES (?,?,?,?,?) ON CONFLICT(provedor, mes) DO UPDATE SET chamadas = chamadas + 1, falhas = falhas + ?, ultimo_uso = excluded.ultimo_uso',
    nome, mesAtual(), 1, ok ? 0 : 1, new Date().toISOString(), ok ? 0 : 1);
}

function estado(db) {
  const mes = mesAtual();
  return {
    avisoJuridico: AVISO_JURIDICO, segredoConfigurado: segredo().length >= 16, mes,
    provedores: Object.keys(providers.DEFS).map((nome) => {
      const d = providers.DEFS[nome];
      const r = db.get('SELECT * FROM ia_config WHERE provedor = ?', nome);
      const ef = providers.efetiva(nome);
      const uso = db.get('SELECT chamadas, falhas, ultimo_uso FROM ia_uso WHERE provedor = ? AND mes = ?', nome, mes) || { chamadas: 0, falhas: 0, ultimo_uso: null };
      const total = db.get('SELECT IFNULL(SUM(chamadas),0) AS c FROM ia_uso WHERE provedor = ?', nome).c;
      const historico = db.all('SELECT mes, chamadas, falhas FROM ia_uso WHERE provedor = ? ORDER BY mes DESC LIMIT 6', nome);
      const chaveDoPainel = !!(r && r.chave_cifrada);
      return {
        provedor: nome, nuvem: d.nuvem, tipo: d.tipo, ativo: !!(r ? r.ativo : ef.ativo), ativoEfetivo: ef.ativo,
        configurada: chaveDoPainel || !!ef.chave || (d.tipo === 'ollama' && !!ef.url),
        origemChave: chaveDoPainel ? 'painel' : (ef.chave || (d.tipo === 'ollama' && ef.url) ? '.env' : null),
        final: chaveDoPainel ? r.chave_final : (ef.chave ? ef.chave.slice(-4) : null),
        modelo: (r && r.modelo) || '', modeloPadrao: d.modeloPadrao, url: (r && r.url) || '', precisaUrl: d.tipo === 'ollama',
        juridico: r && r.juridico_em ? { por: r.juridico_por, em: r.juridico_em } : null,
        usoMes: uso.chamadas, falhasMes: uso.falhas, ultimoUso: uso.ultimo_uso, usoTotal: total, historico,
        atualizado: r ? { por: r.atualizado_por, em: r.atualizado_em } : null,
      };
    }),
  };
}

// dados: { ativo, modelo, url, chave (texto novo; vazio = manter), removerChave, juridico (true confirma aprovação) }
function salvar(db, quem, nome, dados) {
  const d = providers.DEFS[nome];
  if (!d) throw erro(404, 'Provedor desconhecido.');
  const b = dados || {};
  const atual = db.get('SELECT * FROM ia_config WHERE provedor = ?', nome) || {};
  if (b.url !== undefined && !urlValida(String(b.url).trim())) throw erro(400, 'Endereço inválido. Use https:// (ou http:// só para rede local).');
  let cifrada = atual.chave_cifrada || null, final = atual.chave_final || null;
  const mudou = [];
  if (b.removerChave) { cifrada = null; final = null; mudou.push('chave removida'); }
  else if (typeof b.chave === 'string' && b.chave.trim()) {
    const k = b.chave.trim();
    if (k.length < 8 || /\s/.test(k)) throw erro(400, 'A chave parece inválida (mínimo de 8 caracteres, sem espaços).');
    cifrada = cifrar(k); final = k.slice(-4); mudou.push('chave atualizada (final ' + final + ')');
  }
  const ativo = b.ativo === undefined ? !!atual.ativo : !!b.ativo;
  const modelo = b.modelo === undefined ? (atual.modelo || null) : (String(b.modelo).trim() || null);
  const url = b.url === undefined ? (atual.url || null) : (String(b.url).trim() || null);
  let jurPor = atual.juridico_por || null, jurEm = atual.juridico_em || null;
  if (b.juridico === true && !jurEm) { jurPor = quem; jurEm = new Date().toISOString(); mudou.push('aprovação do jurídico registrada'); }
  if (b.juridico === false && jurEm) { jurPor = null; jurEm = null; mudou.push('aprovação do jurídico retirada'); }
  if (ativo) {
    const tem = d.tipo === 'ollama' ? !!(url || providers.efetiva(nome).url) : !!(cifrada || providers.efetiva(nome).chave);
    if (!tem) throw erro(400, d.tipo === 'ollama' ? 'Informe o endereço do servidor para ligar este provedor.' : 'Cadastre a chave antes de ligar este provedor.');
    if (d.nuvem && !jurEm) throw erro(400, 'Para ligar um provedor em nuvem, confirme que o uso foi aprovado pelo jurídico. ' + AVISO_JURIDICO);
  }
  const agora = new Date().toISOString();
  db.tx(() => {
    db.run(`INSERT INTO ia_config (provedor, ativo, modelo, url, chave_cifrada, chave_final, juridico_por, juridico_em, atualizado_por, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provedor) DO UPDATE SET ativo = excluded.ativo, modelo = excluded.modelo, url = excluded.url, chave_cifrada = excluded.chave_cifrada, chave_final = excluded.chave_final,
      juridico_por = excluded.juridico_por, juridico_em = excluded.juridico_em, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`,
    nome, ativo ? 1 : 0, modelo, url, cifrada, final, jurPor, jurEm, quem, agora);
    if (!!atual.ativo !== ativo) mudou.push(ativo ? 'ligado' : 'desligado');
    if ((atual.modelo || null) !== modelo) mudou.push('modelo: ' + (modelo || 'padrão'));
    if ((atual.url || null) !== url) mudou.push('endereço alterado');
    for (const m of mudou) trilha.registrar(db, { usuario: quem, tabela: 'ia_config', registro: nome, campo: 'config', valor_novo: m });
  });
}

// Faz uma chamada mínima, sem dado de unidade, para saber se a chave e o modelo respondem.
async function testar(db, quem, nome) {
  const p = providers.PROVEDORES[nome];
  if (!p) throw erro(404, 'Provedor desconhecido.');
  if (!p.ativo()) throw erro(400, 'Provedor desligado ou sem chave. Cadastre a chave e ligue antes de testar.');
  const t0 = Date.now();
  let ok = false, msg = '';
  try {
    const r = await p.chamar({ sistema: 'Responda somente com a palavra OK.', usuario: 'Teste de conexão. Responda OK.' }, { ms: 20000 });
    ok = typeof r === 'string' && r.trim().length > 0; msg = ok ? 'Respondeu normalmente.' : 'Resposta vazia.';
  } catch (e) { msg = String(e.message || e).replace(/(key|bearer|authorization)[^\s]*/ig, '[oculto]').slice(0, 200); }
  contar(db, nome, ok);
  trilha.registrar(db, { usuario: quem, tabela: 'ia_config', registro: nome, campo: 'teste', valor_novo: ok ? 'ok' : 'falhou' });
  return { ok, ms: Date.now() - t0, mensagem: msg };
}

module.exports = { instalar, estado, salvar, testar, cifrar, decifrar, contar, AVISO_JURIDICO };
