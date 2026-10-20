'use strict';
// Máscara de dados pessoais ANTES de qualquer envio a provedor de nuvem.
// O sistema já recusa dado pessoal na entrada; esta é a segunda barreira.
const REGRAS = [
  { nome: 'CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, troca: '[CPF]' },
  { nome: 'CNS', re: /\b\d{15}\b/g, troca: '[CNS]' },
  { nome: 'e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, troca: '[E-MAIL]' },
  { nome: 'telefone', re: /(?:\(\d{2}\)\s?|\b\d{2}\s)?9?\d{4}-\d{4}\b/g, troca: '[TELEFONE]' },
  { nome: 'nascimento', re: /(?:nasc(?:imento|\.)?|dn)\s*:?\s*\d{1,2}\/\d{1,2}\/\d{2,4}/gi, troca: '[NASCIMENTO]' },
  { nome: 'prontuário', re: /(?:prontu[aá]rio|pront\.?)\s*(?:n[ºo°.]*\s*)?:?\s*\d{4,}/gi, troca: '[PRONTUÁRIO]' },
  { nome: 'nome após rótulo', re: /(?:paciente|sr\.?|sra\.?|respons[aá]vel)\s*:?\s+[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][a-zà-ÿ]+){1,4}/g, troca: '[NOME]' },
];

function mascarar(texto) {
  let t = String(texto || '');
  const contagem = {};
  for (const r of REGRAS) {
    t = t.replace(r.re, () => { contagem[r.nome] = (contagem[r.nome] || 0) + 1; return r.troca; });
  }
  return { texto: t, mascarados: contagem, total: Object.values(contagem).reduce((s, n) => s + n, 0) };
}

module.exports = { mascarar, REGRAS };
