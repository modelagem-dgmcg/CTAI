'use strict';
// Mascaramento de dado pessoal. Roda ANTES de guardar qualquer texto extraído de arquivo e ANTES de qualquer envio a provedor de IA.
// Regras fixas (alta certeza) + heurística de nomes de paciente + segunda passada opcional pela IA (reforço, nunca a única barreira).
// Mantém: CNPJ, nome de unidade/OSS, valores, números de processo SEI (têm pontos e barra), datas de competência.
// Nunca devolve nem registra o valor original: só o texto mascarado e a contagem por tipo.

const NOME = '[A-ZÀ-Ý][a-zà-ÿ]+|[A-ZÀ-Ý]{2,}';
const LIGA = '(?:d[aeo]s?|e)';
// 2 a 5 palavras de nome próprio (maiúscula inicial ou tudo maiúsculo), com "da/de/do/dos/das/e" no meio.
const NOME_COMPLETO = `(?:${NOME})(?:\\s+(?:${LIGA}\\s+)?(?:${NOME})){1,4}`;
// Cargos e termos que seguem "Sr./Sra./usuário" sem ser nome de pessoa atendida.
const NAO_NOME = /^(?:Secret[aá]ri[oa]|Diretor[a]?|Gestor[a]?|Presidente|Superintendente|Coordenador[a]?|Governador[a]?|Prefeit[oa]|Relator[a]?|Conselheir[oa]|Doutor[a]?|Dr[a]?|Ger[eê]nte|Respons[aá]vel|Representante|Administrador[a]?|Sistema|SUS|Final|Interno|Externo|Contratada|Contratante|Unidade|Hospital|Fundação|Instituto|Estado|Governo|Secretaria|Ministério|Tribunal|Conselho)\b/i;

// Palavra-rótulo sem diferenciar maiúscula/minúscula, mas deixando o NOME exigir inicial maiúscula.
const ci = (w) => String(w).split('').map((c) => (c.toLowerCase() !== c.toUpperCase() ? '[' + c.toLowerCase() + c.toUpperCase() + ']' : (c === ' ' ? '\\s+' : c))).join('');
const ANOS = /^(?:19|20)\d{2}$/;
const LOC = 'rua|r\\.|av\\.|avenida|travessa|tv\\.|alameda|estrada|rodovia|pra[cç]a|largo|beco|vila|conjunto|conj\\.|quadra|lote';

// Cada regra devolve o texto trocado e conta quantas trocas fez.
const REGRAS = [
  { nome: 'CPF', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, troca: '[CPF]' },
  { nome: 'CPF', re: /\b(CPF\b[^\d\n]{0,8})\d{11}\b/gi, troca: '$1[CPF]' },
  { nome: 'CNS', re: /\b(?:CNS|cart[aã]o\s+(?:nacional\s+de\s+sa[uú]de|SUS))\b[^\d\n]{0,12}\d[\d ]{13,18}\d/gi, troca: '[CNS]' },
  { nome: 'CNS', re: /\b[12789]\d{14}\b/g, troca: '[CNS]' },
  { nome: 'e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, troca: '[E-MAIL]' },
  { nome: 'RG', re: /\b(?:RG|identidade)\b\s*(?:n[ºo°.]{0,2}\s*)?:?\s*[\d][\d.\-xX]{4,13}(?:\s*(?:SSP|SDS|DGPC|PC)[\s/\-]*[A-Z]{0,2})?/gi, troca: '[RG]' },
  { nome: 'telefone', re: /(?:\+?55\s?)?\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b/g, troca: '[TELEFONE]' },
  { nome: 'telefone', re: /\b(?:\+?55\s?)?\d{2}\s?9\d{4}[-\s]?\d{4}\b/g, troca: '[TELEFONE]' },
  { nome: 'telefone', re: /\b((?:tel(?:efone)?|fone|cel(?:ular)?|whats(?:app)?|contato)\b[^\d\n]{0,10})9?\d{4}[-\s]?\d{4}\b/gi, troca: '$1[TELEFONE]' },
  { nome: 'nascimento', re: /\b(?:data\s+de\s+nasc(?:imento|\.)?|nasc(?:imento|\.)?|d\.?n\.?)\s*:?\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/gi, troca: '[NASCIMENTO]' },
  { nome: 'nascimento', re: /\bnascid[oa]\s+em\s+\d{1,2}(?:[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\s+de\s+[a-zç]+\s+de\s+\d{4})/gi, troca: '[NASCIMENTO]' },
  { nome: 'prontuário', re: /\b(?:prontu[aá]rio|pront\.|registro\s+hospitalar|SAME|BAM|boletim\s+de\s+atendimento|ficha\s+de\s+atendimento|n[ºo°]?\s*do\s+atendimento|matr[ií]cula\s+do\s+paciente)\s*(?:n[ºo°.]{0,2}\s*)?:?\s*\d[\d.\-\/]{3,}/gi, troca: '[PRONTUÁRIO]' },
  // Endereço residencial: só quando a frase fala de paciente/morador (endereço de hospital e de OSS fica).
  { nome: 'endereço', re: new RegExp(`\\b(?:residente|reside|domiciliad[oa]|moradora?|endere[cç]o\\s+(?:residencial|do\\s+(?:paciente|usu[aá]rio))|resid[eê]ncia)\\b[^\\n.;]{0,25}?\\b(?:${LOC})\\b(?:(?!\\.\\s+[A-ZÀ-Ý])[^\\n;]){2,80}`, 'gi'), troca: '[ENDEREÇO]' },
  { nome: 'endereço', re: /\bCEP\s*:?\s*\d{5}-?\d{3}\b/gi, troca: '[CEP]', soSe: (t, i) => /\b(?:paciente|residente|reside|moradora?|domic[ií]li)/i.test(t.slice(Math.max(0, i - 160), i)) },
  // Nome depois de rótulo de pessoa atendida. A palavra-rótulo fica; só o nome é trocado.
  { nome: 'nome', re: new RegExp(`\\b((?:${ci('nome')}\\s+d[oa]\\s+)?(?:${['paciente','pacientes','usuário','usuária','usuario','acompanhante','responsável legal','Sr','Sra','Srta'].map(ci).join('|')})\\.?\\s*:?\\s+)(${NOME_COMPLETO})`, 'g'), troca: '$1[PACIENTE]', soSeNome: true },
  { nome: 'nome', re: /\b(nome\s*(?:completo)?\s*:\s*)([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ]+(?:\s+(?:d[aeo]s?\s+|e\s+)?[A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ]+){1,4})/g, troca: '$1[PACIENTE]', soSeNome: true },
];

const ehTelefoneFalso = (trecho) => {
  // "2025-2026" e afins não são telefone.
  const m = /(\d{4})[-\s](\d{4})/.exec(trecho);
  return !!(m && ANOS.test(m[1]) && ANOS.test(m[2]));
};

function mascarar(texto) {
  let t = String(texto || '');
  const contagem = {};
  const soma = (nome) => { contagem[nome] = (contagem[nome] || 0) + 1; };
  for (const r of REGRAS) {
    r.re.lastIndex = 0;
    t = t.replace(r.re, (...a) => {
      const casado = a[0];
      const pos = a[a.length - 2];
      if (r.nome === 'telefone' && ehTelefoneFalso(casado)) return casado;
      if (r.soSe && !r.soSe(a[a.length - 1], pos)) return casado;
      if (r.soSeNome) {
        // O último grupo de captura é o nome; se começa por cargo/termo institucional, não é paciente.
        const grupos = a.slice(1, -2).filter((x) => typeof x === 'string');
        const nome = grupos[grupos.length - 1] || '';
        if (NAO_NOME.test(nome)) return casado;
      }
      soma(r.nome);
      return r.troca.replace(/\$(\d)/g, (_, n) => (a[Number(n)] === undefined ? '' : a[Number(n)]));
    });
  }
  return { texto: t, mascarados: contagem, total: Object.values(contagem).reduce((s, n) => s + n, 0) };
}

// Junta contagens de vários trechos.
function somar(a, b) { const o = Object.assign({}, a); for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + v; return o; }

// Segunda passada (opcional): pede à IA os nomes de pessoas atendidas que ainda restaram no texto JÁ MASCARADO e troca todas as ocorrências.
// Só roda se houver provedor disponível (nuvem só com envio liberado) e nunca derruba a importação.
async function reforcarComIA(texto, opcoes = {}) {
  const o = { texto: String(texto || ''), nomes: 0, usada: false };
  if (opcoes.desligada) return o;
  try {
    const providers = require('../modules/analista/providers');
    const est = providers.estado();
    for (const nome of est.ordem) {
      const p = providers.PROVEDORES[nome];
      if (!p || !p.ativo()) continue;
      if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) continue;
      const amostra = o.texto.slice(0, 30000);
      const bruto = await p.chamar({
        sistema: 'Você revisa textos de saúde para proteger pessoas. Responda SOMENTE com JSON: {"nomes":["Nome Completo", ...]}. Liste apenas nomes completos de PESSOAS ATENDIDAS (pacientes, usuários, acompanhantes) que ainda aparecem no texto. Não liste médicos, gestores, servidores, empresas nem unidades. Se não houver, responda {"nomes":[]}.',
        usuario: 'TEXTO:\n' + amostra,
      });
      const s = String(bruto || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
      let r = {}; try { r = JSON.parse(s.slice(i, j + 1)); } catch (_) { /* sem lista */ }
      const nomes = (Array.isArray(r.nomes) ? r.nomes : []).map((n) => String(n || '').trim()).filter((n) => n.split(/\s+/).length >= 2 && n.length <= 80 && !NAO_NOME.test(n));
      let t = o.texto;
      for (const n of nomes) {
        const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
        t = t.replace(re, () => { o.nomes++; return '[PACIENTE]'; });
      }
      o.texto = t; o.usada = true;
      return o;
    }
  } catch (_) { /* a IA é só reforço */ }
  return o;
}

module.exports = { mascarar, reforcarComIA, somar, REGRAS };
