'use strict';
// Ponte com o Analista da diretoria: o CTAI entra no servidor dele (Apps Script) com UMA conta de serviço e usa o mensageiro de lá.
// Configuração (só no painel da hospedagem, nunca no repositório): CTAI_ANALISTA_URL, CTAI_ANALISTA_EMAIL, CTAI_ANALISTA_SENHA.
// A conta de serviço aparece no Analista como remetente; por isso cada mensagem sai com o nome de quem escreveu no CTAI.
// Só texto: o mensageiro do Analista não recebe anexos por esta ponte.
const crypto = require('crypto');
const config = require('./config');
const { erro } = require('./auth');

let sessao = null; // { token, ate }
const env = (k) => String(config.env(k, '') || '').trim();
const configurada = () => !!(env('CTAI_ANALISTA_URL') && env('CTAI_ANALISTA_EMAIL') && env('CTAI_ANALISTA_SENHA'));

async function post(action, corpo, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 30000);
  try {
    const r = await fetch(env('CTAI_ANALISTA_URL') + (env('CTAI_ANALISTA_URL').includes('?') ? '&' : '?') + 'action=' + encodeURIComponent(action), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(corpo || {}), signal: ctl.signal, redirect: 'follow' });
    const txt = await r.text();
    try { const j = JSON.parse(txt); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch (_) { /* cai abaixo */ }
    throw new Error('resposta inesperada do Analista');
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'o Analista não respondeu a tempo' : e.message); } finally { clearTimeout(t); }
}

async function entrar() {
  const hash = crypto.createHash('sha256').update(env('CTAI_ANALISTA_SENHA')).digest('hex');
  const r = await post('auth/login', { email: env('CTAI_ANALISTA_EMAIL'), senha_hash: hash, app: 'analista' });
  if (!r.ok || !r.token) throw new Error('login da conta de serviço recusado' + (r.erro ? ': ' + String(r.erro).slice(0, 80) : ''));
  sessao = { token: r.token, ate: Date.now() + 20 * 60 * 1000 };
  return sessao.token;
}

async function chamar(action, corpo) {
  if (!configurada()) throw erro(503, 'Ponte com o Analista não configurada.');
  try {
    for (let i = 0; i < 2; i++) {
      const token = sessao && sessao.ate > Date.now() ? sessao.token : await entrar();
      const r = await post(action, Object.assign({}, corpo, { token }));
      if (r.sessao_expirada) { sessao = null; continue; }
      if (!r.ok) throw new Error(String(r.erro || 'erro no Analista').slice(0, 160));
      return r;
    }
    throw new Error('sessão do Analista expirou');
  } catch (e) { if (e.status) throw e; throw erro(502, 'Analista: ' + e.message); }
}

async function contatos() {
  const r = await chamar('mensagens/contatos', {});
  const f = (c, grupo) => ({ id: String(c.conversa_id), nome: String(c.nome || c.conversa_id), grupo });
  return (r.individuais || []).map((c) => f(c, false)).concat((r.grupos || []).map((c) => f(c, true)));
}
async function conversa(id) {
  const r = await chamar('mensagens/listar', { conversa_id: String(id) });
  const eu = env('CTAI_ANALISTA_EMAIL').toLowerCase();
  return (r.mensagens || []).map((m) => ({ meu: String(m.de_usuario || '').toLowerCase() === eu, de: m.de_nome || '', texto: String(m.texto || ''), criado_em: m.enviado_em || null }));
}
async function enviar(id, texto, remetente) {
  const t = String(texto || '').trim().slice(0, 3000);
  if (!t) throw erro(400, 'Escreva a mensagem.');
  return chamar('mensagens/enviar', { conversa_id: String(id), texto: '[CTAI · ' + String(remetente || '').slice(0, 60) + '] ' + t });
}

module.exports = { configurada, contatos, conversa, enviar, _zerar: () => { sessao = null; } };
