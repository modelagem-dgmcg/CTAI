'use strict';
// Lê o relatório/parecer do trimestre anterior e PROPÕE itens a mais para a lista de conferência da unidade (documentos e dados que compõem o relatório).
// A regra fixa (server/importar-estrutura.js) vem primeiro; a IA só acrescenta. Cada item volta com o trecho copiado do texto e só vale se o trecho existir de fato.
// Nada entra sozinho: a analista confere e confirma a lista. A nuvem recebe só texto mascarado.
const providers = require('./providers');
const { mascarar } = require('./mascara');

const LIMITE = 60000;
const SISTEMA = 'Você lê relatórios e pareceres de acompanhamento de contratos de gestão de unidades de saúde. Seu trabalho é listar os DOCUMENTOS e FONTES DE DADOS que o relatório usa ou cita (anexos, planilhas, relatórios, sistemas, despachos), para virar uma lista de conferência do trimestre seguinte. Responda SOMENTE com JSON. Nunca invente: cada item precisa de "trecho" copiado exatamente do texto.';
const PEDIDO = (texto, existentes) => `Itens que já encontrei (não repita): ${existentes.map((i) => i.nome).join('; ') || 'nenhum'}.
Liste só o que FALTOU: documentos ou fontes citados no texto que a unidade ou outro órgão precisa fornecer a cada mês ou trimestre.
Para cada um: {"nome":"nome curto","obrigatorio":true|false,"periodicidade":"mensal"|"trimestral","origem":"unidade"|"pedida_setor"|"processo_parecer"|"fonte_externa","trecho":"frase copiada do texto"}.
"unidade" = enviado pela unidade/OSS pelo SEI; "pedida_setor" = a CTAI pede a outro setor (despacho da Gerência de Prestação de Contas, informação financeira da GGCCG); "processo_parecer" = fica no próprio processo do parecer (parecer conclusivo da CMA); "fonte_externa" = consulta da analista (SIMAS).
Responda: {"itens":[...]}

TEXTO:
${texto}`;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Limpa o que a IA devolveu. Função pura (testada sem IA): descarta item sem nome, sem trecho no texto ou repetido.
function interpretar(bruto, texto, existentes) {
  const s = String(bruto || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
  let o = {}; try { o = JSON.parse(s.slice(i, j + 1)); } catch (_) { /* sem lista */ }
  const base = norm(texto);
  const jaTem = new Set((existentes || []).map((x) => norm(x.nome)));
  const out = [];
  for (const x of Array.isArray(o.itens) ? o.itens : []) {
    if (!x || typeof x !== 'object') continue;
    const nome = String(x.nome || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const trecho = String(x.trecho || '').replace(/\s+/g, ' ').trim();
    if (nome.length < 3 || jaTem.has(norm(nome))) continue;
    if (trecho.length < 8 || !base.includes(norm(trecho))) continue; // sem trecho conferido, não entra
    jaTem.add(norm(nome));
    out.push({ nome, obrigatorio: x.obrigatorio === true, periodicidade: x.periodicidade === 'trimestral' ? 'trimestral' : 'mensal', origem: ['fonte_externa', 'pedida_setor', 'processo_parecer'].includes(x.origem) ? x.origem : 'unidade', trecho: trecho.slice(0, 280) });
    if (out.length >= 30) break;
  }
  return out;
}

async function propor({ texto, itens, unidade }) {
  const est = providers.estado();
  const tentativas = [];
  for (const nome of est.ordem) {
    const p = providers.PROVEDORES[nome];
    if (!p.ativo()) { tentativas.push({ provedor: nome, ok: false, erro: 'sem chave' }); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { tentativas.push({ provedor: nome, ok: false, erro: 'envio à nuvem desligado' }); continue; }
    const base = (p.nuvem ? mascarar(texto).texto : String(texto)).slice(0, LIMITE);
    try {
      const bruto = await p.chamar({ sistema: SISTEMA, usuario: PEDIDO(base, itens || []) });
      return { ok: true, provedor: nome, itens: interpretar(bruto, base, itens), unidade: p.nuvem ? null : unidade };
    } catch (e) { tentativas.push({ provedor: nome, ok: false, erro: String(e.message || e).slice(0, 140) }); }
  }
  return { ok: false, motivo: 'Nenhuma IA disponível agora (' + tentativas.map((t) => t.provedor + ': ' + t.erro).join('; ') + ').', itens: [] };
}

module.exports = { propor, interpretar };
