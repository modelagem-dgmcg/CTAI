'use strict';
// Módulo Analista (encaixe). Contrato:
//   entrada : { texto, tabelas?, tipo?, contexto? }
//             contexto: { competencia:'2026-06', unidade, mesImplantacao, valores:{verde,amarelo,vermelho}, transparencia, outrosTextos:[{id,texto}], observacoes }
//   saída   : { achados:[{gravidade:'ALTA|MÉDIA|BAIXA', tipo, trecho, risco, sugestao, setor_sugerido}], provedor, tentativas:[{provedor, ok, erro?}], mascarados }
// O sistema grava os achados; este módulo não toca o banco.
// Para juntar o Analista que já existe, veja docs/DNA-ANALISTA.md: basta implementar um provedor que cumpra este contrato
// (ou substituir `analisarComIA`) e apontar para ele em ANALISTA_ORDEM.
const fs = require('fs');
const path = require('path');
const regrasLocais = require('./regras-locais');
const { mascarar } = require('./mascara');
const providers = require('./providers');

const PROMPT_SISTEMA = fs.readFileSync(path.join(__dirname, 'prompts', 'sistema.md'), 'utf8');
const PROMPT_USUARIO = fs.readFileSync(path.join(__dirname, 'prompts', 'usuario.md'), 'utf8');
const LIMITE_CHARS = 24000;
const GRAVIDADES = ['ALTA', 'MÉDIA', 'BAIXA'];

function normalizarGravidade(g) {
  const s = String(g || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.startsWith('ALT')) return 'ALTA';
  if (s.startsWith('MED')) return 'MÉDIA';
  return 'BAIXA';
}

// Aceita o array JSON mesmo com cerca de código ou texto em volta.
function extrairJson(txt) {
  const s = String(txt || '').trim();
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i < 0 || j <= i) return [];
  try { const v = JSON.parse(s.slice(i, j + 1)); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}

function limparAchado(a, textoOriginal) {
  if (!a || typeof a !== 'object') return null;
  const trecho = String(a.trecho || '').trim().slice(0, 300);
  // Anti-alucinação: o trecho precisa existir no documento.
  const achou = trecho && textoOriginal.replace(/\s+/g, ' ').includes(trecho.replace(/\s+/g, ' '));
  if (!achou) return null;
  return {
    gravidade: normalizarGravidade(a.gravidade), tipo: String(a.tipo || 'Ponto a conferir').slice(0, 120), trecho,
    risco: String(a.risco || '').slice(0, 400), sugestao: String(a.sugestao || '').slice(0, 400),
    setor_sugerido: ['assistencia', 'qualidade', 'ouvidoria', 'educacao', 'bid', 'rh'].includes(a.setor_sugerido) ? a.setor_sugerido : null,
  };
}

async function analisarComIA({ texto, tipo, contexto }, tentativas) {
  const est = providers.estado();
  const ctx = contexto || {};
  for (const nome of est.ordem) {
    const p = providers.PROVEDORES[nome];
    if (!p.ativo()) { tentativas.push({ provedor: nome, ok: false, erro: 'sem chave' }); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { tentativas.push({ provedor: nome, ok: false, erro: 'envio à nuvem desligado (sem aprovação do jurídico)' }); continue; }
    // Nuvem recebe só texto mascarado e cortado.
    const base = (p.nuvem ? mascarar(texto).texto : String(texto)).slice(0, LIMITE_CHARS);
    const usuario = PROMPT_USUARIO.replace('{{tipo}}', tipo || 'documento').replace('{{unidade}}', ctx.unidade || '—').replace('{{competencia}}', ctx.competencia || '—')
      .replace('{{observacoes}}', ctx.observacoes || (ctx.mesImplantacao ? 'mês de implantação' : '—')).replace('{{texto}}', base);
    try {
      let bruto;
      try { bruto = await p.chamar({ sistema: PROMPT_SISTEMA, usuario }); providers.contar(nome, true); } catch (e) { providers.contar(nome, false); throw e; }
      const achados = extrairJson(bruto).map((a) => limparAchado(a, base)).filter(Boolean);
      tentativas.push({ provedor: nome, ok: true, achados: achados.length });
      return { provedor: nome, achados };
    } catch (e) {
      tentativas.push({ provedor: nome, ok: false, erro: String(e.message || e).slice(0, 160) });
    }
  }
  return null;
}

async function analisar(entrada) {
  const texto = String((entrada && entrada.texto) || '');
  const tentativas = [];
  const locais = regrasLocais.analisar({ texto, tabelas: entrada.tabelas, contexto: entrada.contexto }).map((a) => Object.assign({ origem: 'regras locais' }, a));
  let ia = null;
  if (texto.trim()) ia = await analisarComIA({ texto, tipo: entrada.tipo, contexto: entrada.contexto }, tentativas);
  const todos = locais.slice();
  if (ia) {
    const vistos = new Set(locais.map((a) => a.trecho.slice(0, 60)));
    for (const a of ia.achados) if (!vistos.has(a.trecho.slice(0, 60))) todos.push(Object.assign({ origem: ia.provedor }, a));
  }
  todos.sort((a, b) => GRAVIDADES.indexOf(a.gravidade) - GRAVIDADES.indexOf(b.gravidade));
  return { achados: todos, provedor: ia ? 'local-regras + ' + ia.provedor : 'local-regras', tentativas, mascarados: mascarar(texto).mascarados };
}

module.exports = { analisar, estado: providers.estado, mascarar, extrairJson, limparAchado, GRAVIDADES };
