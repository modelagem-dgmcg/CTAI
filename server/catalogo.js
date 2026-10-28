'use strict';
// Catálogo de documentos esperados por TIPO de unidade (regras/catalogo-documentos.json) e as contas de calendário
// (mês, trimestre, lacunas). Tudo aqui é puro: não lê banco e não altera nada.
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', 'regras', 'catalogo-documentos.json');
let cache = null;
function carregar(recarregar) {
  if (!cache || recarregar) cache = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  return cache;
}

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_RE = '(jan(?:eiro)?|fev(?:ereiro)?|mar(?:co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)';
const numMes = (tok) => ABREV.indexOf(String(tok).slice(0, 3)) + 1;
const ano4 = (a) => (String(a).length === 2 ? 2000 + Number(a) : Number(a));
const mm = (ano, mes) => ano + '-' + String(mes).padStart(2, '0');

// ---------- tipo da unidade ----------
function tipoDaUnidade(c) {
  if (!c) return null;
  const t = String(c.tipo || '').toUpperCase();
  if (t === 'UPAE') return 'UPAE';
  if (t === 'UPA') return 'UPA';
  if (t === 'HOSPITAL') return 'Hospital';
  const n = sem(c.unidade);
  if (/\bupae\b/.test(n)) return 'UPAE';
  if (/\bupa\b/.test(n)) return 'UPA';
  if (/\bhospital\b|\bhosp\b|\bmaternidade\b/.test(n)) return 'Hospital';
  return null;
}
const catalogoDoTipo = (tipo) => (tipo ? carregar().tipos[tipo] || null : null);

// ---------- calendário ----------
const MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/;
const TRI_OK = /^\d{4}-T[1-4]$/;
function trimestreDoMes(mes) { const m = MES_OK.exec(String(mes || '')); return m ? mes.slice(0, 4) + '-T' + (Math.floor((Number(mes.slice(5)) - 1) / 3) + 1) : null; }
function mesesDoTrimestre(tri) {
  if (!TRI_OK.test(String(tri || ''))) return [];
  const q = Number(tri.slice(6));
  return [0, 1, 2].map((i) => mm(tri.slice(0, 4), (q - 1) * 3 + 1 + i));
}
const rotuloMes = (mes) => (MES_OK.test(String(mes || '')) ? MESES[Number(mes.slice(5)) - 1][0].toUpperCase() + MESES[Number(mes.slice(5)) - 1].slice(1) + '/' + mes.slice(0, 4) : String(mes || ''));
const rotuloMesCurto = (mes) => (MES_OK.test(String(mes || '')) ? ABREV[Number(mes.slice(5)) - 1] + '/' + mes.slice(2, 4) : String(mes || ''));
const nomeMes = (mes) => (MES_OK.test(String(mes || '')) ? MESES[Number(mes.slice(5)) - 1][0].toUpperCase() + MESES[Number(mes.slice(5)) - 1].slice(1) : String(mes || ''));

// ---------- identificar o mês ----------
// Tira o prefixo que o SEI põe nos arquivos baixados: "[03]-92339724_".
const limpaNome = (nome) => String(nome || '').replace(/^\s*\[\d+\]-\d+_/, '');

function mesDoNome(nome) {
  const n = limpaNome(nome).replace(/\.[A-Za-z0-9]{2,5}$/, '');
  // 072026, 07.2026, 07_2026, 07-2026
  let m = /(?<!\d)(0[1-9]|1[0-2])[\W_]{0,3}(20\d{2})(?!\d)/.exec(n);
  if (m) return mm(m[2], Number(m[1]));
  // jul/26, julho 2026, SET_26
  const s = sem(n);
  m = new RegExp('\\b' + MES_RE + '\\s+(20\\d{2}|[23]\\d)\\b').exec(s);
  if (m) return mm(ano4(m[2]), numMes(m[1]));
  return null;
}

// Do texto: devolve { mes, forte } ou null. "Forte" = padrões que dizem claramente a competência ("RM 07/2026", "Relatório Mensal – Julho/2026").
function mesDoTexto(texto) {
  let s = sem(String(texto || '').slice(0, 8000));
  // datas completas ("20 de agosto de 2026", "20/08/2026") são a data do documento, não a competência
  s = s.replace(new RegExp('\\b\\d{1,2} de ' + MES_RE + '[a-z]* de 20\\d{2}\\b', 'g'), ' ').replace(/\b\d{1,2} (?:0[1-9]|1[0-2]) 20\d{2}\b/g, ' ');
  const voto = new Map();
  const soma = (mes, peso, forte) => { const v = voto.get(mes) || { peso: 0, forte: false }; v.peso += peso; v.forte = v.forte || forte; voto.set(mes, v); };
  let m;
  const reForte = [
    [/\brm (0[1-9]|1[0-2]) (20\d{2})\b/g, (x) => mm(x[2], Number(x[1]))],
    [new RegExp('\\brelatorio mensal(?: de| referente a| competencia)? ' + MES_RE + '[a-z]* (?:de )?(20\\d{2}|[23]\\d)\\b', 'g'), (x) => mm(ano4(x[2]), numMes(x[1]))],
    [new RegExp('\\b(?:competencia|mes de referencia|mes de) ' + MES_RE + '[a-z]* (?:de )?(20\\d{2}|[23]\\d)\\b', 'g'), (x) => mm(ano4(x[2]), numMes(x[1]))],
    [/\b(?:competencia|mes de referencia) (0[1-9]|1[0-2]) (20\d{2})\b/g, (x) => mm(x[2], Number(x[1]))],
  ];
  for (const [re, f] of reForte) while ((m = re.exec(s))) soma(f(m), 10, true);
  const reNum = /(?<![\d])(0[1-9]|1[0-2]) (20\d{2})\b/g;
  while ((m = reNum.exec(s))) {
    const antes = s.slice(Math.max(0, m.index - 14), m.index);
    if (/\b(?:n|no|numero|oficio|despacho|parecer|decreto|lei|portaria|cg|contrato|processo|sei)\s+$/.test(antes)) continue;
    soma(mm(m[2], Number(m[1])), 1, false);
  }
  const reNome = new RegExp('\\b' + MES_RE + '[a-z]* (?:de )?(20\\d{2}|[23]\\d)\\b', 'g');
  while ((m = reNome.exec(s))) soma(mm(ano4(m[2]), numMes(m[1])), 1, false);
  if (!voto.size) return null;
  const ord = [...voto.entries()].sort((a, b) => b[1].peso - a[1].peso);
  if (ord.length > 1 && ord[0][1].peso === ord[1][1].peso) return null;
  return { mes: ord[0][0], forte: ord[0][1].forte };
}

// ---------- identificar o documento do catálogo ----------
function identificar(catalogo, nome, texto) {
  if (!catalogo) return null;
  const n = sem(limpaNome(nome));
  const docs = catalogo.documentos || [];
  const parteDe = (d) => {
    if (!d.parte_regex) return '';
    const m = new RegExp(d.parte_regex).exec(n);
    return m ? m[1].toUpperCase() : '';
  };
  for (const d of docs) for (const p of d.padroes_nome || []) if (new RegExp(p).test(n)) return { codigo: d.codigo, parte: parteDe(d), por: 'nome' };
  const t = sem(String(texto || '').slice(0, 3000));
  if (t) for (const d of docs) for (const p of d.padroes_texto || []) if (new RegExp(p).test(t)) return { codigo: d.codigo, parte: parteDe(d), por: 'texto' };
  return null;
}
const documento = (catalogo, codigo) => ((catalogo && catalogo.documentos) || []).find((d) => d.codigo === codigo) || null;

// ---------- o que se espera num mês e o que falta ----------
function esperados(catalogo, mes) {
  return ((catalogo && catalogo.documentos) || []).filter((d) => !d.a_partir_de || !MES_OK.test(mes || '') || mes >= d.a_partir_de);
}
// presentes: [{codigo, parte}]. Devolve o que chegou, o que falta (obrigatório) e os opcionais ausentes.
function lacunas(catalogo, mes, presentes) {
  const tem = new Set((presentes || []).map((p) => p.codigo));
  const esp = esperados(catalogo, mes);
  const chegaram = esp.filter((d) => tem.has(d.codigo));
  const faltam = esp.filter((d) => d.obrigatorio && !tem.has(d.codigo));
  const opcionais = esp.filter((d) => !d.obrigatorio && !tem.has(d.codigo));
  const fora = (presentes || []).filter((p) => !esp.some((d) => d.codigo === p.codigo));
  return { esperados: esp, chegaram, faltam, opcionais, fora, obrigatorios: esp.filter((d) => d.obrigatorio).length };
}
// "Anexo 5 - Comissão de Óbito" -> "Anexo 5"
const nomeCurto = (d) => String((d && d.nome) || '').split(' - ')[0];
function frase(lista) {
  const n = lista.map(nomeCurto);
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
}

module.exports = { carregar, tipoDaUnidade, catalogoDoTipo, trimestreDoMes, mesesDoTrimestre, rotuloMes, rotuloMesCurto, nomeMes, mesDoNome, mesDoTexto, identificar, documento, esperados, lacunas, nomeCurto, frase, sem, limpaNome, MES_OK, TRI_OK };
