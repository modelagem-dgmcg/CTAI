'use strict';
// Lê um arquivo (texto extraído) e PROPÕE os valores da ficha do setor. Nada é salvo: a pessoa confere na tela e salva.
// A nuvem recebe só texto mascarado. Cada valor volta marcado como "verificado" quando o número aparece no texto-fonte.
const providers = require('./providers');
const { mascarar } = require('./mascara');

const LIMITE = 60000;
const SISTEMA = 'Você preenche fichas mensais de indicadores de unidades de saúde a partir de relatórios. Responda SOMENTE com JSON. Nunca invente: se o dado não estiver no texto, omita o campo. Nunca copie nome, CPF, prontuário ou data de nascimento de paciente.';
const descreve = (c) => `- "${c.id}": ${c.rotulo}${c.unidade ? ' (' + c.unidade + ')' : ''} [${c.tipo}${c.opcoes ? ': ' + c.opcoes.join('|') : ''}]`;
const PEDIDO = (texto, campos, mes) => `Período da ficha: ${mes || 'mês informado'}.\nCampos da ficha:\n${campos.map(descreve).join('\n')}\n\nResponda {"campo_id": "valor"} só com os campos encontrados. Números com vírgula decimal, sem unidade. sim_nao: "sim" ou "não".\n\nTEXTO:\n${texto}`;

const limpo = (s) => String(s).replace(/\s+/g, '');
function verificado(valor, fonte) {
  const f = limpo(fonte), v = limpo(valor);
  if (!/\d/.test(v)) return false;
  return f.includes(v) || f.includes(v.replace(',', '.')) || f.includes(v.replace('.', ',')) || f.includes(v.replace(/[.,]/g, ''));
}

function interpretar(bruto, campos, fonte) {
  const s = String(bruto || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
  let o = {}; try { o = JSON.parse(s.slice(i, j + 1)); } catch (_) { /* vazio */ }
  const out = {};
  for (const c of campos) {
    let v = o[c.id];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    v = String(v).trim().slice(0, c.tipo === 'texto_longo' ? 2000 : 200);
    if (c.tipo === 'selecao' && !c.opcoes.includes(v)) continue;
    if (c.tipo === 'sim_nao') { v = /^s/i.test(v) ? 'sim' : /^n/i.test(v) ? 'não' : ''; if (!v) continue; }
    const num = ['inteiro', 'numero', 'percentual'].includes(c.tipo);
    if (num && !/^-?\d[\d.,]*$/.test(v)) continue;
    out[c.id] = { valor: v, verificado: num ? verificado(v, fonte) : false };
  }
  return out;
}

async function propor({ texto, campos, mes }) {
  const est = providers.estado();
  const tentativas = [];
  for (const nome of est.ordem) {
    const p = providers.PROVEDORES[nome];
    if (!p.ativo()) { tentativas.push({ provedor: nome, ok: false, erro: 'sem chave' }); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { tentativas.push({ provedor: nome, ok: false, erro: 'envio à nuvem desligado' }); continue; }
    const base = (p.nuvem ? mascarar(texto).texto : String(texto)).slice(0, LIMITE);
    try {
      const bruto = await p.chamar({ sistema: SISTEMA, usuario: PEDIDO(base, campos, mes) });
      return { ok: true, provedor: nome, campos: interpretar(bruto, campos, texto), truncado: texto.length > LIMITE };
    } catch (e) { tentativas.push({ provedor: nome, ok: false, erro: String(e.message || e).slice(0, 140) }); }
  }
  return { ok: false, motivo: 'Nenhuma IA disponível agora (' + tentativas.map((t) => t.provedor + ': ' + t.erro).join('; ') + ').', campos: {} };
}

module.exports = { propor, interpretar, verificado };
