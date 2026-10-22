'use strict';
// Lê os relatórios importados e PROPÕE as linhas dos quadros do parecer. Nada entra sozinho: a pessoa confere e aplica.
// A nuvem recebe só texto mascarado. Cada linha volta marcada como "verificada" quando os números dela aparecem no texto-fonte.
const providers = require('./providers');
const { mascarar } = require('./mascara');

const LIMITE = 60000;
const SISTEMA = 'Você extrai tabelas de indicadores de relatórios assistenciais mensais de unidades de saúde. Responda SOMENTE com JSON. Nunca invente número: se não achar, deixe o campo vazio.';
const PEDIDO = (texto, meses) => `Abaixo está o texto de relatório(s) da unidade, período: ${meses}.
Monte três listas de indicadores:
- "q1": produção com valoração (consultas, atendimentos, cirurgias, internações etc. que têm meta e valor);
- "q2": produção sem valoração (indicadores de produção sem desconto financeiro);
- "q3": qualidade (parte variável: classificação de risco, satisfação do usuário, queixas, óbitos, infecção, educação permanente etc.).
Cada linha é uma lista de 6 textos: ["Nº do indicador", "Indicador", "Meta mensal", "Produção/Resultado (valores mensais separados por ' / ', na ordem dos meses)", "% do trimestre", "Status"].
Status: "Meta cumprida", "Meta parcial", "Meta não cumprida" ou "A analisar" (use "A analisar" se não der para concluir).
Responda: {"q1":[[...]],"q2":[[...]],"q3":[[...]]}

TEXTO:
${texto}`;

const numeros = (s) => (String(s).match(/\d[\d.,]*/g) || []).map((n) => n.replace(/[.,]+$/, '')).filter((n) => n.length > 0);
const limpo = (s) => String(s).replace(/\s+/g, '');
function verificada(linha, fonte) {
  const f = limpo(fonte);
  const nums = numeros(linha[3]).concat(numeros(linha[2]));
  if (!nums.length) return false;
  return nums.every((n) => { const v = limpo(n); return f.includes(v) || f.includes(v.replace(/[.,](?=\d{3}(\D|$))/g, '')) || f.includes(v.replace(',', '.')) || f.includes(v.replace('.', ',')); });
}

async function propor({ texto, meses }) {
  const est = providers.estado();
  const tentativas = [];
  for (const nome of est.ordem) {
    const p = providers.PROVEDORES[nome];
    if (!p.ativo()) { tentativas.push({ provedor: nome, ok: false, erro: 'sem chave' }); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { tentativas.push({ provedor: nome, ok: false, erro: 'envio à nuvem desligado' }); continue; }
    const base = (p.nuvem ? mascarar(texto).texto : String(texto)).slice(0, LIMITE);
    try {
      const bruto = await p.chamar({ sistema: SISTEMA, usuario: PEDIDO(base, meses || 'trimestre') });
      const s = String(bruto || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
      let o = {}; try { o = JSON.parse(s.slice(i, j + 1)); } catch (_) { /* vazio */ }
      const quadros = {};
      for (const q of ['q1', 'q2', 'q3']) quadros[q] = (Array.isArray(o[q]) ? o[q] : []).slice(0, 60).filter(Array.isArray).map((l) => { const c = [0, 1, 2, 3, 4, 5].map((k) => String(l[k] === null || l[k] === undefined ? '' : l[k]).slice(0, 300)); return { celulas: c, verificada: verificada(c, base) }; }).filter((x) => x.celulas[1]);
      return { ok: true, provedor: nome, quadros, truncado: texto.length > LIMITE, tentativas };
    } catch (e) { tentativas.push({ provedor: nome, ok: false, erro: String(e.message || e).slice(0, 140) }); }
  }
  return { ok: false, motivo: 'Nenhuma IA disponível agora (' + tentativas.map((t) => t.provedor + ': ' + t.erro).join('; ') + ').', tentativas, quadros: { q1: [], q2: [], q3: [] } };
}

module.exports = { propor, verificada };
