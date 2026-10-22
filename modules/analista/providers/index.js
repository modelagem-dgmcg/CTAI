'use strict';
// Provedores de IA. Todos ficam DESLIGADOS enquanto não houver chave (no .env ou cadastrada na Gestão CTAI).
// Nuvem só recebe texto mascarado e só se ANALISTA_ENVIAR_NUVEM=sim ou se a Gestão CTAI registrou a aprovação do jurídico para aquele provedor.
// O módulo não conhece o banco: o servidor instala um "resolvedor" (usar) que devolve a configuração cadastrada e um "contador" de uso.
const config = require('../../../server/config');
const { postarJson } = require('./http');

const env = config.env;

let resolvedor = null; // (nome) => { registrado, chaves: [{ id, chave, modelo, url, juridico }] } | null  (só as ativas, já na ordem de tentativa)
let contador = null;   // (nome, ok, chaveId) => void
function usar(res, cont) { resolvedor = res || null; contador = cont || null; }
function contar(nome, ok, chaveId) { if (contador) { try { contador(nome, ok, chaveId); } catch (_) { /* contagem nunca derruba a análise */ } } }

const DEFS = {
  gemini: { nuvem: true, tipo: 'gemini', chaveEnv: 'GEMINI_API_KEY', modeloEnv: 'GEMINI_MODEL', modeloPadrao: 'gemini-2.0-flash', urlEnv: 'GEMINI_URL', urlPadrao: null },
  groq: { nuvem: true, tipo: 'openai', chaveEnv: 'GROQ_API_KEY', modeloEnv: 'GROQ_MODEL', modeloPadrao: 'llama-3.3-70b-versatile', urlEnv: 'GROQ_URL', urlPadrao: 'https://api.groq.com/openai/v1/chat/completions' },
  kimi: { nuvem: true, tipo: 'openai', chaveEnv: 'KIMI_API_KEY', modeloEnv: 'KIMI_MODEL', modeloPadrao: 'moonshot-v1-32k', urlEnv: 'KIMI_URL', urlPadrao: 'https://api.moonshot.ai/v1/chat/completions' },
  deepseek: { nuvem: true, tipo: 'openai', chaveEnv: 'DEEPSEEK_API_KEY', modeloEnv: 'DEEPSEEK_MODEL', modeloPadrao: 'deepseek-chat', urlEnv: 'DEEPSEEK_URL', urlPadrao: 'https://api.deepseek.com/chat/completions' },
  openrouter: { nuvem: true, tipo: 'openai', chaveEnv: 'OPENROUTER_API_KEY', modeloEnv: 'OPENROUTER_MODEL', modeloPadrao: 'openrouter/auto', urlEnv: 'OPENROUTER_URL', urlPadrao: 'https://openrouter.ai/api/v1/chat/completions' },
  ollama: { nuvem: false, tipo: 'ollama', chaveEnv: null, modeloEnv: 'OLLAMA_MODEL', modeloPadrao: 'llama3.1', urlEnv: 'OLLAMA_URL', urlPadrao: '' },
};

// Configurações disponíveis de um provedor, na ordem de tentativa: as chaves ativas do rack (Administração) e, por último, a do .env.
// Se o provedor tem chaves no rack mas todas estão suspensas, ele fica desligado (o rack manda, inclusive para desligar).
function disponiveis(nome) {
  const d = DEFS[nome];
  const env0 = { id: null, chave: d.chaveEnv ? env(d.chaveEnv, '') : '', modelo: env(d.modeloEnv, d.modeloPadrao), url: env(d.urlEnv, d.urlPadrao || ''), juridico: false, origem: 'env' };
  env0.ativo = d.tipo === 'ollama' ? !!env0.url : !!env0.chave;
  const r = resolvedor ? resolvedor(nome) : null;
  if (!r || !r.registrado) return env0.ativo ? [env0] : [];
  return r.chaves.map((k) => {
    const url = k.url || env0.url;
    const e = { id: k.id, chave: k.chave, modelo: k.modelo || env0.modelo, url, juridico: !!k.juridico, origem: 'rack' };
    e.ativo = d.tipo === 'ollama' ? !!url : !!e.chave;
    return e;
  }).filter((e) => e.ativo);
}
// Primeira configuração disponível (a que seria usada agora). Sem nenhuma, devolve uma configuração desligada.
function efetiva(nome) {
  const l = disponiveis(nome);
  if (l.length) return l[0];
  const d = DEFS[nome];
  return { id: null, chave: '', modelo: env(d.modeloEnv, d.modeloPadrao), url: env(d.urlEnv, d.urlPadrao || ''), juridico: false, origem: 'env', ativo: false };
}

// Uma chamada com uma configuração específica (usada também no teste de conexão de cada chave).
async function executar(nome, e, { sistema, usuario }, ms) {
  const d = DEFS[nome];
  if (d.tipo === 'gemini') {
    const url = e.url || ('https://generativelanguage.googleapis.com/v1beta/models/' + e.modelo + ':generateContent');
    const r = await postarJson(url, { systemInstruction: { parts: [{ text: sistema }] }, contents: [{ role: 'user', parts: [{ text: usuario }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }, { 'x-goog-api-key': e.chave }, ms);
    const c = r.candidates && r.candidates[0];
    return c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('') : '';
  }
  if (d.tipo === 'ollama') {
    const r = await postarJson(e.url.replace(/\/$/, '') + '/api/chat', { model: e.modelo, stream: false, options: { temperature: 0 }, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }] }, {}, ms || 120000);
    return r.message ? r.message.content : '';
  }
  const r = await postarJson(e.url || d.urlPadrao, { model: e.modelo, temperature: 0, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }] }, { authorization: 'Bearer ' + e.chave }, ms);
  return r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : '';
}

function montar(nome) {
  const d = DEFS[nome];
  return {
    nome, nuvem: d.nuvem,
    ativo: () => disponiveis(nome).length > 0,
    nuvemLiberada: () => d.nuvem && disponiveis(nome).some((e) => e.juridico),
    // Tenta as chaves na ordem; se uma falhar (limite, chave vencida), passa para a próxima.
    async chamar(pedido, opcoes) {
      const ms = opcoes && opcoes.ms;
      let ultimo = null;
      for (const e of disponiveis(nome)) {
        try { const r = await executar(nome, e, pedido, ms); contar(nome, true, e.id); return r; } catch (err) { ultimo = err; contar(nome, false, e.id); }
      }
      throw ultimo || new Error('sem chave disponível');
    },
  };
}

const PROVEDORES = {};
for (const nome of Object.keys(DEFS)) PROVEDORES[nome] = montar(nome);

function ordem() {
  return String(env('ANALISTA_ORDEM', 'gemini,groq,ollama')).split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && s !== 'local-regras' && PROVEDORES[s]);
}

// Ordem efetiva: a da configuração, mais (no fim) os provedores ligados na Gestão CTAI que não estão na lista.
function ordemEfetiva() {
  const o = ordem();
  for (const nome of Object.keys(PROVEDORES)) if (!o.includes(nome) && efetiva(nome).origem === 'rack' && efetiva(nome).ativo) o.push(nome);
  return o;
}

function estado() {
  const enviarNuvem = env('ANALISTA_ENVIAR_NUVEM', 'nao') === 'sim';
  return {
    enviarNuvem,
    ordem: ordemEfetiva(),
    provedores: Object.values(PROVEDORES).map((p) => {
      const lib = !p.nuvem || enviarNuvem || (p.nuvemLiberada && p.nuvemLiberada());
      return { nome: p.nome, nuvem: p.nuvem, comChave: p.ativo(), disponivel: p.ativo() && lib };
    }),
  };
}

module.exports = { PROVEDORES, DEFS, ordem, estado, efetiva, disponiveis, executar, usar, contar };
