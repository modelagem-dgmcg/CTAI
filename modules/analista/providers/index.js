'use strict';
// Provedores de IA. Todos ficam DESLIGADOS enquanto não houver chave no .env.
// Nuvem só recebe texto mascarado e só se ANALISTA_ENVIAR_NUVEM=sim. O Ollama roda na rede local e não passa pela nuvem.
const config = require('../../../server/config');
const { postarJson } = require('./http');

const env = config.env;

function compativelOpenAI(nome, { urlPadrao, urlEnv, chaveEnv, modeloEnv, modeloPadrao, extra }) {
  return {
    nome, nuvem: true,
    ativo: () => !!env(chaveEnv, ''),
    async chamar({ sistema, usuario }) {
      const url = env(urlEnv, urlPadrao);
      const r = await postarJson(url, {
        model: env(modeloEnv, modeloPadrao), temperature: 0,
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
      }, Object.assign({ authorization: 'Bearer ' + env(chaveEnv, '') }, extra || {}));
      return r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : '';
    },
  };
}

const PROVEDORES = {
  gemini: {
    nome: 'gemini', nuvem: true,
    ativo: () => !!env('GEMINI_API_KEY', ''),
    async chamar({ sistema, usuario }) {
      const modelo = env('GEMINI_MODEL', 'gemini-2.0-flash');
      const url = env('GEMINI_URL', 'https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent');
      const r = await postarJson(url, {
        systemInstruction: { parts: [{ text: sistema }] }, contents: [{ role: 'user', parts: [{ text: usuario }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }, { 'x-goog-api-key': env('GEMINI_API_KEY', '') });
      const c = r.candidates && r.candidates[0];
      return c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('') : '';
    },
  },
  groq: compativelOpenAI('groq', { urlPadrao: 'https://api.groq.com/openai/v1/chat/completions', urlEnv: 'GROQ_URL', chaveEnv: 'GROQ_API_KEY', modeloEnv: 'GROQ_MODEL', modeloPadrao: 'llama-3.3-70b-versatile' }),
  kimi: compativelOpenAI('kimi', { urlPadrao: 'https://api.moonshot.ai/v1/chat/completions', urlEnv: 'KIMI_URL', chaveEnv: 'KIMI_API_KEY', modeloEnv: 'KIMI_MODEL', modeloPadrao: 'moonshot-v1-32k' }),
  deepseek: compativelOpenAI('deepseek', { urlPadrao: 'https://api.deepseek.com/chat/completions', urlEnv: 'DEEPSEEK_URL', chaveEnv: 'DEEPSEEK_API_KEY', modeloEnv: 'DEEPSEEK_MODEL', modeloPadrao: 'deepseek-chat' }),
  openrouter: compativelOpenAI('openrouter', { urlPadrao: 'https://openrouter.ai/api/v1/chat/completions', urlEnv: 'OPENROUTER_URL', chaveEnv: 'OPENROUTER_API_KEY', modeloEnv: 'OPENROUTER_MODEL', modeloPadrao: 'openrouter/auto' }),
  ollama: {
    nome: 'ollama', nuvem: false,
    ativo: () => !!env('OLLAMA_URL', ''),
    async chamar({ sistema, usuario }) {
      const r = await postarJson(env('OLLAMA_URL', '').replace(/\/$/, '') + '/api/chat', {
        model: env('OLLAMA_MODEL', 'llama3.1'), stream: false, options: { temperature: 0 }, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
      }, {}, 120000);
      return r.message ? r.message.content : '';
    },
  },
};

function ordem() {
  return String(env('ANALISTA_ORDEM', 'gemini,groq,ollama')).split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && s !== 'local-regras' && PROVEDORES[s]);
}

function estado() {
  const enviarNuvem = env('ANALISTA_ENVIAR_NUVEM', 'nao') === 'sim';
  return {
    enviarNuvem,
    ordem: ordem(),
    provedores: Object.values(PROVEDORES).map((p) => ({ nome: p.nome, nuvem: p.nuvem, comChave: p.ativo(), disponivel: p.ativo() && (!p.nuvem || enviarNuvem) })),
  };
}

module.exports = { PROVEDORES, ordem, estado };
