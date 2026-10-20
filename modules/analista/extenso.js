'use strict';
// Converte número por extenso em português (até bilhões) para conferir "R$ 1.234,56 (um mil, duzentos...)".
const UN = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const DZ = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const CT = { cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900 };

function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// Devolve o inteiro representado, ou null se houver palavra desconhecida.
function inteiroPorExtenso(tokens) {
  let total = 0, atual = 0, viu = false;
  for (const t of tokens) {
    if (t === 'e' || t === 'de') continue;
    if (t in UN) { atual += UN[t]; viu = true; }
    else if (t in DZ) { atual += DZ[t]; viu = true; }
    else if (t in CT) { atual += CT[t]; viu = true; }
    else if (t === 'mil') { total += (atual || 1) * 1000; atual = 0; viu = true; }
    else if (t === 'milhao' || t === 'milhoes') { total += (atual || 1) * 1e6; atual = 0; viu = true; }
    else if (t === 'bilhao' || t === 'bilhoes') { total += (atual || 1) * 1e9; atual = 0; viu = true; }
    else return null;
  }
  return viu ? total + atual : null;
}

// "um milhão, seiscentos e quarenta e sete mil ... reais e dezessete centavos" -> 1647464.17
// "sessenta e três por cento" -> 63
function extensoParaNumero(texto) {
  const s = semAcento(texto).replace(/[(),;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/por cento/.test(s)) {
    const t = s.split('por cento')[0].trim().split(' ').filter(Boolean);
    return inteiroPorExtenso(t);
  }
  const reais = /\breais?\b/.test(s);
  const cent = /\bcentavos?\b/.test(s);
  if (reais || cent) {
    const [parteReais, resto] = s.split(/\breais?\b/);
    let valor = 0;
    if (reais && parteReais.trim()) {
      const v = inteiroPorExtenso(parteReais.trim().split(' ').filter(Boolean));
      if (v === null) return null;
      valor = v;
    }
    const centTxt = reais ? (resto || '') : parteReais;
    const m = centTxt.replace(/\bcentavos?\b/, '').trim();
    if (m) {
      const c = inteiroPorExtenso(m.split(' ').filter(Boolean));
      if (c === null) return null;
      valor += c / 100;
    }
    return Math.round(valor * 100) / 100;
  }
  return inteiroPorExtenso(s.split(' ').filter(Boolean));
}

module.exports = { extensoParaNumero };
