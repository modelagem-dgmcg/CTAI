'use strict';
// Provedores de IA. Todos ficam DESLIGADOS enquanto não houver chave (no .env ou cadastrada na Gestão CTAI).
// Nuvem só recebe texto mascarado e só se ANALISTA_ENVIAR_NUVEM=sim ou se a Gestão CTAI registrou a aprovação do jurídico para aquele provedor.
// O módulo não conhece o banco: o servidor instala um "resolvedor" (usar) que devolve a configuração cadastrada e um "contador" de uso.
const config = require('../../../server/config');
const { postarJson } = require('./http');

const env = config.env;

let resolvedor = null; // (nome) => { ativo, chave, modelo, url, juridico } | null
let contador = null;   // (nome, ok) => void
function usar(res, cont) { resolvedor = res || null; contador = cont || null; }
function contar(nome, ok) { if (contador) { try { contador(nome, ok); } catch (_) { /* contagem nunca derruba a análise */ } } }

const DEFS = {
  gemini: { nuvem: true, tipo: 'gemini', chaveEnv: 'GEMINI_API_KEY', modeloEnv: 'GEMINI_MODEL', modeloPadrao: 'gemini-2.0-flash', urlEnv: 'GEMINI_URL', urlPadrao: null },
  groq: { nuvem: true, tipo: 'openai', chaveEnv: 'GROQ_API_KEY', modeloEnv: 'GROQ_MODEL', modeloPadrao: 'llama-3.3-70b-versatile', urlEnv: 'GROQ_URL', urlPadrao: 'https://api.groq.com/openai/v1/chat/completions' },
  kimi: { nuvem: true, tipo: 'openai', chaveEnv: 'KIMI_API_KEY', modeloEnv: 'KIMI_MODEL', modeloPadrao: 'moonshot-v1-32k', urlEnv: 'KIMI_URL', urlPadrao: 'https://api.moonshot.ai/v1/chat/completions' },
  deepseek: { nuvem: true, tipo: 'openai', chaveEnv: 'DEEPSEEK_API_KEY', modeloEnv: 'DEEPSEEK_MODEL', modeloPadrao: 'deepseek-chat', urlEnv: 'DEEPSEEK_URL', urlPadrao: 'https://api.deepseek.com/chat/completions' },
  openrouter: { nuvem: true, tipo: 'openai', chaveEnv: 'OPENROUTER_API_KEY', modeloEnv: 'OPENROUTER_MODEL', modeloPadrao: 'openrouter/auto', urlEnv: 'OPENROUTER_URL', urlPadrao: 'https://openrouter.ai/api/v1/chat/completions' },
  ollama: { nuvem: false, tipo: 'ollama', chaveEnv: null, modeloEnv: 'OLLAMA_MODEL', modeloPadrao: 'llama3.1', urlEnv: 'OLLAMA_URL', urlPadrao: '' },
};

// Configuração efetiva: .env como base; o que foi cadastrado na Gestão CTAI manda por cima (inclusive para desligar).
function efetiva(nome) {
  const d = DEFS[nome];
  const base = { chave: d.chaveEnv ? env(d.chaveEnv, '') : '', modelo: env(d.modeloEnv, d.modeloPadrao), url: env(d.urlEnv, d.urlPadrao || ''), juridico: false, origem: 'env' };
  base.ativo = d.tipo === 'ollama' ? !!base.url : !!base.chave;
  const r = resolvedor ? resolvedor(nome) : null;
  if (!r) return base;
  const chave = r.chave || base.chave;
  const url = r.url || base.url;
  return { chave, modelo: r.modelo || base.modelo, url, juridico: !!r.juridico, origem: 'painel', ativo: !!r.ativo && (d.tipo === 'ollama' ? !!url : !!chave) };
}

function montar(nome) {
  const d = DEFS[nome];
  return {
    nome, nuvem: d.nuvem,
    ativo: () => efetiva(nome).ativo,
    nuvemLiberada: () => d.nuvem && efetiva(nome).juridico,
    async chamar({ sistema, usuario }, opcoes) {
      const e = efetiva(nome);
      const ms = opcoes && opcoes.ms;
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
  for (const nome of Object.keys(PROVEDORES)) if (!o.includes(nome) && efetiva(nome).origem === 'painel' && efetiva(nome).ativo) o.push(nome);
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

module.exports = { PROVEDORES, DEFS, ordem, estado, efetiva, usar, contar };
