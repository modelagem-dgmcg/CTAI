'use strict';
// Busca externa (Gemini com Google Search): confere se as normas citadas no parecer seguem vigentes e se há
// jurisprudência (TCE-PE, TCU) sobre o tema. Só sai da máquina a LISTA de citações legais e os nomes dos indicadores,
// nunca o texto do parecer nem dados da unidade.
const providers = require('./providers');
const { postarJson } = require('./providers/http');

const RE_NORMA = /\b(Lei(?: Complementar)?|Decreto|Portaria|Resolução|Instrução Normativa)(?: Estadual| Federal| Municipal)?\s+(?:n\.?[ºo°]?\s*)?(\d{1,3}(?:\.\d{3})?\/\d{2,4})/gi;

function citacoes(texto) {
  const set = new Map();
  let m;
  while ((m = RE_NORMA.exec(String(texto)))) set.set((m[1] + ' ' + m[2]).toLowerCase(), { citacao: m[1] + ' n.º ' + m[2], trecho: m[0] });
  return [...set.values()].slice(0, 12);
}

async function buscar({ texto, indicadores }) {
  const cits = citacoes(texto);
  const est = providers.estado();
  const gem = providers.PROVEDORES.gemini;
  if (!gem.ativo()) return { ok: false, motivo: 'Sem chave do Gemini no rack (Administração → Chaves de IA).', citacoes: cits, resultados: [], fontes: [] };
  if (!est.enviarNuvem && !(gem.nuvemLiberada && gem.nuvemLiberada())) return { ok: false, motivo: 'Envio à nuvem desligado.', citacoes: cits, resultados: [], fontes: [] };
  if (!cits.length) return { ok: true, citacoes: [], resultados: [], fontes: [], aviso: 'O texto não cita lei ou decreto; nada a verificar na busca externa.' };
  const pergunta = 'Para cada norma abaixo, diga se está em vigor, se foi alterada ou revogada (indique a norma que alterou), e se houver entendimento relevante do TCE-PE ou do TCU sobre contratos de gestão com organizações sociais de saúde ligado ao tema, resuma em uma linha. Seja objetivo e diga "não encontrei" quando não houver fonte confiável.\nNormas: ' + cits.map((c) => c.citacao).join('; ') + '.\nTemas dos indicadores: ' + (indicadores || []).slice(0, 15).join('; ') + '.';
  let ultimo = null;
  for (const e of providers.disponiveis('gemini')) {
    try {
      const url = e.url || ('https://generativelanguage.googleapis.com/v1beta/models/' + e.modelo + ':generateContent');
      const r = await postarJson(url, { contents: [{ role: 'user', parts: [{ text: pergunta }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } }, { 'x-goog-api-key': e.chave }, 60000);
      providers.contar('gemini', true, e.id);
      const c = r.candidates && r.candidates[0];
      const resposta = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('') : '';
      const fontes = ((c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []).map((g) => g.web).filter(Boolean).map((w) => ({ titulo: w.title || w.uri, url: w.uri })).slice(0, 10);
      return { ok: true, citacoes: cits, resposta, fontes };
    } catch (err) { ultimo = err; providers.contar('gemini', false, e.id); }
  }
  return { ok: false, motivo: 'A busca falhou: ' + String((ultimo && ultimo.message) || 'erro').slice(0, 160), citacoes: cits, resultados: [], fontes: [] };
}

module.exports = { buscar, citacoes };
