'use strict';
// Converte um registro da API para as colunas do sistema, conforme o mapeamento.json.
// SÓ os campos mapeados são lidos: qualquer outro campo do registro (nome, CPF etc.) é descartado sem ser examinado.
const U = require('../../core/util');

function partesLocais(valor, fuso) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: fuso || 'America/Recife', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { data: p.year + '-' + p.month + '-' + p.day, hora: p.hour + ':' + p.minute };
}

function converter(valor, regra, fuso) {
  if (valor === undefined || valor === null || valor === '') return '';
  switch (regra.como || 'texto') {
    case 'data': { const p = /^\d{4}-\d{2}-\d{2}$/.test(String(valor)) ? { data: String(valor) } : partesLocais(valor, fuso); return p ? p.data : String(valor); }
    case 'hora': { const p = partesLocais(valor, fuso); return p ? p.hora : String(valor); }
    case 'numero': { const n = U.numero(valor); return n === null ? String(valor) : String(n); }
    case 'segundos_para_minutos': { const n = U.numero(valor); return n === null ? String(valor) : String(Math.round((n / 60) * 100) / 100); }
    case 'sim_nao': { const s = String(valor).trim().toLowerCase(); return ['s', 'sim', '1', 'true', 'y'].includes(s) ? 'sim' : 'não'; }
    case 'mapa': { const m = regra.mapa || {}; const chave = Object.keys(m).find((k) => k.toLowerCase() === String(valor).trim().toLowerCase()); return chave ? m[chave] : String(valor); }
    default: return String(valor);
  }
}

function transformarRegistro(registro, campos, fuso) {
  const out = {};
  for (const [coluna, regra] of Object.entries(campos)) out[coluna] = converter(registro[regra.de], regra, fuso);
  return out;
}

// Inverso, usado só pelo servidor de teste para fabricar respostas com os nomes fictícios da API.
function inverterRegistro(linha, campos) {
  const out = {};
  for (const [coluna, regra] of Object.entries(campos)) {
    const v = linha[coluna];
    if (v === undefined || v === '') continue;
    if (regra.como === 'data' || regra.como === 'hora') {
      const dataCol = Object.keys(campos).find((c) => campos[c].de === regra.de && campos[c].como === 'data');
      const horaCol = Object.keys(campos).find((c) => campos[c].de === regra.de && campos[c].como === 'hora');
      if (regra.como === 'data' && !horaCol) out[regra.de] = linha[dataCol];
      else if (regra.como === 'data' && linha[dataCol]) out[regra.de] = linha[dataCol] + 'T' + (linha[horaCol] || '00:00') + ':00-03:00';
    } else if (regra.como === 'segundos_para_minutos') out[regra.de] = Math.round(Number(v) * 60);
    else if (regra.como === 'sim_nao') out[regra.de] = v === 'sim' ? 'S' : 'N';
    else if (regra.como === 'mapa') out[regra.de] = String(v).toUpperCase();
    else out[regra.de] = v;
  }
  return out;
}

module.exports = { transformarRegistro, inverterRegistro, partesLocais, converter };
