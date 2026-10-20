'use strict';
// Funções pequenas, puras, usadas por vários módulos. Nada aqui acessa banco ou rede.
const crypto = require('crypto');

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

// JSON com chaves ordenadas: o mesmo conteúdo sempre gera o mesmo hash.
function jsonCanonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return '[' + valor.map(jsonCanonico).join(',') + ']';
  const chaves = Object.keys(valor).sort();
  return '{' + chaves.map((k) => JSON.stringify(k) + ':' + jsonCanonico(valor[k])).join(',') + '}';
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, '').replace('%', '');
  if (!s) return null;
  // 1.234,56 -> 1234.56 ; 12,5 -> 12.5
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Aceita AAAA-MM-DD ou DD/MM/AAAA. Devolve AAAA-MM-DD ou null.
function normalizarData(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(s);
  let a, mes, d;
  if (m) { a = +m[1]; mes = +m[2]; d = +m[3]; } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    d = +m[1]; mes = +m[2]; a = +m[3];
  }
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return null;
  return String(a).padStart(4, '0') + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Aceita HH:MM ou HH:MM:SS. Devolve HH:MM ou null.
function normalizarHora(v) {
  if (v === null || v === undefined) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(v).trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

function paraMs(data, hora) {
  const d = normalizarData(data);
  if (!d) return null;
  const h = normalizarHora(hora) || '00:00';
  return Date.parse(d + 'T' + h + ':00Z');
}

// Minutos entre dois pontos no tempo; null se faltar dado ou se o fim vier antes do início.
function minutosEntre(d1, h1, d2, h2) {
  const a = paraMs(d1, h1), b = paraMs(d2, h2);
  if (a === null || b === null) return null;
  if (b < a) return null;
  return (b - a) / 60000;
}

function diasUteisEntre(d1, d2) {
  const a = normalizarData(d1), b = normalizarData(d2);
  if (!a || !b) return null;
  let cur = Date.parse(a + 'T00:00:00Z');
  const fim = Date.parse(b + 'T00:00:00Z');
  if (fim < cur) return null;
  let n = 0;
  while (cur < fim) {
    cur += 86400000;
    const dia = new Date(cur).getUTCDay();
    if (dia !== 0 && dia !== 6) n++;
  }
  return n;
}

function media(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; }
function mediana(xs) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}
function maximo(xs) { return xs.length ? Math.max(...xs) : null; }
function minimo(xs) { return xs.length ? Math.min(...xs) : null; }
function arred(x, casas) {
  if (x === null || x === undefined) return x;
  const f = Math.pow(10, casas === undefined ? 2 : casas);
  return Math.round((x + Number.EPSILON) * f) / f;
}

function simNao(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (['sim', 's', '1', 'true', 'yes'].includes(s)) return true;
  if (['nao', 'não', 'n', '0', 'false', 'no'].includes(s)) return false;
  return null;
}

function formatarNumero(n, casas) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas === undefined ? 2 : casas, maximumFractionDigits: casas === undefined ? 2 : casas });
}
function formatarMoeda(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Código estável e irreversível (HMAC) para identificadores que possam identificar pessoas.
function pseudonimo(valor, chave) {
  const h = crypto.createHmac('sha256', String(chave || 'ctai-chave-local')).update(String(valor)).digest('base64url');
  return 'P' + h.slice(0, 10).toUpperCase();
}

module.exports = {
  sha256, jsonCanonico, numero, normalizarData, normalizarHora, paraMs, minutosEntre, diasUteisEntre,
  media, mediana, maximo, minimo, arred, simNao, formatarNumero, formatarMoeda, pseudonimo,
};
