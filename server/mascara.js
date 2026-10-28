'use strict';
// Mascaramento de dado pessoal. Roda ANTES de guardar qualquer texto extraído de arquivo e ANTES de qualquer envio a provedor de IA.
// As regras fixas ficam em public/js/mascara-comum.js (a MESMA lista roda no navegador antes de o texto sair da máquina da analista).
// Aqui o servidor mascara de novo ao receber (defesa em profundidade) e faz a segunda passada opcional pela IA (reforço, nunca a única barreira).

const { mascarar, somar, REGRAS, NAO_NOME } = require('../public/js/mascara-comum');

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
