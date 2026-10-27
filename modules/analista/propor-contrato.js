'use strict';
// Lê o TEXTO de um contrato de gestão ou de um termo aditivo e PROPÕE o quadro dele: tipo, número do aditivo, data, objeto, vigência, valores e repasses,
// metas e indicadores, regras de desconto (art. 15-A) e o que o aditivo muda. Nada entra sozinho: vira rascunho e a pessoa confere.
// Cada ponto volta com o trecho de origem e a marca "verificada" (o trecho e os números existem no texto lido). A nuvem recebe só texto mascarado.
const providers = require('./providers');
const { mascarar } = require('./mascara');

const LIMITE = 70000;
const CATEGORIAS = ['valor', 'repasse', 'meta', 'indicador', 'desconto', 'art15a', 'vigencia', 'outro'];
const EFEITOS = ['novo', 'altera', 'revoga', 'mantem'];
const SISTEMA = 'Você lê contratos de gestão e termos aditivos entre a Secretaria de Saúde e organizações sociais e extrai um quadro estruturado. Responda SOMENTE com JSON. Nunca invente: se não achar, deixe vazio ou null. Todo ponto precisa de "trecho" copiado literalmente do texto.';
const PEDIDO = (texto, ctx) => `Documento "${ctx.nome || '—'}", da unidade ${ctx.unidade || '—'}.
Extraia:
- "tipo": "contrato" ou "aditivo";
- "numero_aditivo": número do termo aditivo (inteiro) ou null;
- "data_doc": data de assinatura em AAAA-MM-DD ou null;
- "objeto": o objeto do documento em uma ou duas frases;
- "vigencia_inicio" e "vigencia_fim": AAAA-MM-DD ou null (de uma vigência nova, se houver);
- "valor_total": valor global do contrato ou do aditivo (texto, como no documento) ou null;
- "muda": se for aditivo, em uma frase, o que ele altera no contrato; se for contrato, vazio;
- "pontos": lista de {"categoria":"valor|repasse|meta|indicador|desconto|art15a|vigencia|outro","titulo":"nome curto","valor":"valor ou meta como escrito","descricao":"explicação curta","efeito":"novo|altera|revoga|mantem","trecho":"frase copiada do texto"}.
  Use "valor" e "repasse" para valores e parcelas, "meta" e "indicador" para metas e indicadores, "desconto" e "art15a" para regras de desconto/glosa (art. 15-A), "vigencia" para prazos.
  Num aditivo, "efeito" diz se o ponto é novo, altera ou revoga algo do contrato.
Responda: {"tipo":..,"numero_aditivo":..,"data_doc":..,"objeto":"..","vigencia_inicio":..,"vigencia_fim":..,"valor_total":..,"muda":"..","pontos":[..]}

TEXTO:
${texto}`;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const limpo = (s) => String(s || '').replace(/\s+/g, '');
const trechoExiste = (trecho, texto) => !!norm(trecho) && norm(texto).includes(norm(trecho));
const data = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? m[0] : null; };
const inteiro = (v) => { const n = parseInt(String(v === null || v === undefined ? '' : v).replace(/\D/g, ''), 10); return Number.isFinite(n) && n > 0 && n < 1000 ? n : null; };
// Os números do "valor" (sem pontuação) precisam aparecer no texto, para o ponto ser marcado como conferido.
function valorNoTexto(valor, texto) {
  const nums = String(valor || '').match(/\d[\d.,]*/g);
  if (!nums) return true;
  const f = limpo(texto);
  return nums.every((n) => f.includes(limpo(n)) || f.includes(limpo(n).replace(/[.,]/g, '')));
}

// Limpa e marca o que a IA devolveu. Função pura (testada sem IA).
function normalizar(o, texto) {
  o = o && typeof o === 'object' ? o : {};
  const pontos = (Array.isArray(o.pontos) ? o.pontos : []).filter((p) => p && typeof p === 'object').slice(0, 120).map((p) => {
    const trecho = String(p.trecho || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    return {
      categoria: CATEGORIAS.includes(p.categoria) ? p.categoria : 'outro', titulo: String(p.titulo || '').trim().slice(0, 160), valor: String(p.valor === undefined || p.valor === null ? '' : p.valor).trim().slice(0, 200),
      descricao: String(p.descricao || '').trim().slice(0, 600), efeito: EFEITOS.includes(p.efeito) ? p.efeito : 'novo', trecho,
      verificada: !!trecho && trechoExiste(trecho, texto) && valorNoTexto(p.valor, texto),
    };
  }).filter((p) => p.titulo);
  return {
    tipo: o.tipo === 'aditivo' ? 'aditivo' : (o.tipo === 'contrato' ? 'contrato' : null), numero_aditivo: inteiro(o.numero_aditivo), data_doc: data(o.data_doc), objeto: String(o.objeto || '').trim().slice(0, 800),
    vigencia_inicio: data(o.vigencia_inicio), vigencia_fim: data(o.vigencia_fim), valor_total: String(o.valor_total || '').trim().slice(0, 120), muda: String(o.muda || '').trim().slice(0, 800), pontos,
  };
}

// deps.providers só existe para teste.
async function propor({ texto, nome, unidade }, deps) {
  const P = (deps && deps.providers) || providers;
  const est = P.estado();
  const tentativas = [];
  for (const prov of est.ordem) {
    const p = P.PROVEDORES[prov];
    if (!p.ativo()) { tentativas.push({ provedor: prov, ok: false, erro: 'sem chave' }); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { tentativas.push({ provedor: prov, ok: false, erro: 'envio à nuvem desligado' }); continue; }
    const base = (p.nuvem ? mascarar(texto).texto : String(texto)).slice(0, LIMITE);
    try {
      const bruto = await p.chamar({ sistema: SISTEMA, usuario: PEDIDO(base, { nome: p.nuvem ? '(documento)' : nome, unidade: p.nuvem ? '(unidade)' : unidade }) });
      const s = String(bruto || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
      let o = {}; try { o = JSON.parse(s.slice(i, j + 1)); } catch (_) { /* vazio */ }
      return Object.assign({ ok: true, provedor: prov, truncado: String(texto).length > LIMITE, tentativas }, normalizar(o, base));
    } catch (e) { tentativas.push({ provedor: prov, ok: false, erro: String(e.message || e).slice(0, 140) }); }
  }
  return Object.assign({ ok: false, motivo: 'Nenhuma IA disponível agora (' + tentativas.map((t) => t.provedor + ': ' + t.erro).join('; ') + '). O quadro abre em branco para você preencher à mão.', tentativas }, normalizar({}, texto));
}

module.exports = { propor, normalizar, CATEGORIAS, EFEITOS };
