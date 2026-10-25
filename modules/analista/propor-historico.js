'use strict';
// Lê um relatório ou parecer ANTERIOR e PROPÕE o histórico dele: nota total, desconto, nota por indicador, achados e recomendações.
// Nada entra sozinho: o resultado vira rascunho e a pessoa confere campo a campo. A nuvem recebe só texto mascarado.
// Cada item volta com o trecho de origem e a marca "verificada" (o trecho e os números existem no texto lido).
const providers = require('./providers');
const { mascarar } = require('./mascara');

const LIMITE = 60000;
const SISTEMA = 'Você lê pareceres e relatórios de acompanhamento de contratos de gestão de unidades de saúde e extrai dados para um histórico. Responda SOMENTE com JSON. Nunca invente: se não achar, deixe vazio ou null. Cada item deve trazer "trecho": uma frase copiada literalmente do texto que o comprova.';
const PEDIDO = (texto, ctx) => `Documento da unidade ${ctx.unidade || '—'}, trimestre ${ctx.trimestre || '—'}.
Extraia:
- "igq": nota total do trimestre (número, ou null);
- "desconto_pct": percentual de desconto aplicado (número, ou null);
- "desconto_valor": valor do desconto em reais (número, ou null);
- "igq_trecho": frase copiada do texto que mostra a nota total;
- "indicadores": lista de {"indicador_id":"1.1","nome":"...","pontos":número,"max":número,"trecho":"frase copiada"} (nota de cada indicador);
- "achados": lista de {"tipo":"tema curto","descricao":"o que foi constatado","gravidade":"ALTA|MÉDIA|BAIXA","trecho":"frase copiada"};
- "recomendacoes": lista de {"texto":"o que foi recomendado à unidade","tema":"tema curto","trecho":"frase copiada"}.
Responda: {"igq":..,"igq_trecho":"..","desconto_pct":..,"desconto_valor":..,"indicadores":[..],"achados":[..],"recomendacoes":[..]}

TEXTO:
${texto}`;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/\./g, '').replace(',', '.')); const d = Number(String(v).replace(',', '.')); const x = Number.isFinite(d) ? d : n; return Number.isFinite(x) ? x : null; };
const limpo = (s) => String(s).replace(/\s+/g, '');
function numeroNoTexto(n, fonte) {
  if (n === null || n === undefined) return false;
  const f = limpo(fonte), a = String(n), b = a.replace('.', ',');
  return f.includes(a) || f.includes(b);
}
// Página do trecho: usa os marcadores "--- página N ---" que a extração deixa no texto.
function paginaDe(texto, trecho) {
  const t = norm(trecho); if (!t) return null;
  const T = String(texto);
  const marcas = [...T.matchAll(/--- página (\d+) ---/g)].map((m) => ({ pos: m.index, n: Number(m[1]) }));
  if (!marcas.length) return null;
  // procura no texto normalizado, mapeando de volta por página
  for (let i = 0; i < marcas.length; i++) {
    const ini = marcas[i].pos, fim = i + 1 < marcas.length ? marcas[i + 1].pos : T.length;
    if (norm(T.slice(ini, fim)).includes(t)) return marcas[i].n;
  }
  return null;
}
const trechoExiste = (trecho, texto) => !!norm(trecho) && norm(texto).includes(norm(trecho));
const origem = (texto, trecho) => { const p = paginaDe(texto, trecho); return (p ? 'página ' + p + ': ' : '') + String(trecho || '').slice(0, 300); };

const GRAV = (g) => { const s = String(g || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return s.startsWith('ALT') ? 'ALTA' : (s.startsWith('MED') ? 'MÉDIA' : 'BAIXA'); };

// Limpa e marca o que a IA devolveu. Função pura (testada sem IA).
function normalizar(o, texto) {
  o = o && typeof o === 'object' ? o : {};
  const lista = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const igq = num(o.igq);
  return {
    igq, igq_verificada: igq !== null && numeroNoTexto(igq, texto), igq_origem: origem(texto, o.igq_trecho),
    desconto_pct: num(o.desconto_pct), desconto_valor: num(o.desconto_valor),
    indicadores: lista(o.indicadores).slice(0, 60).map((i) => {
      const pontos = num(i.pontos), max = num(i.max);
      return { indicador_id: String(i.indicador_id || '').slice(0, 20), nome: String(i.nome || '').slice(0, 200), pontos, max, valor: i.valor === undefined || i.valor === null ? '' : String(i.valor).slice(0, 80),
        trecho: origem(texto, i.trecho), verificada: (pontos !== null && numeroNoTexto(pontos, texto)) && (!String(i.trecho || '').trim() || trechoExiste(i.trecho, texto)) };
    }).filter((i) => i.indicador_id),
    achados: lista(o.achados).slice(0, 60).map((a) => ({ tipo: String(a.tipo || '').slice(0, 120), descricao: String(a.descricao || '').slice(0, 600), gravidade: GRAV(a.gravidade), trecho: origem(texto, a.trecho), verificada: trechoExiste(a.trecho, texto) })).filter((a) => a.descricao),
    recomendacoes: lista(o.recomendacoes).slice(0, 60).map((r) => ({ texto: String(r.texto || '').slice(0, 600), tema: String(r.tema || '').slice(0, 120), trecho: origem(texto, r.trecho), verificada: trechoExiste(r.trecho, texto) })).filter((r) => r.texto),
  };
}

async function propor({ texto, unidade, trimestre }) {
  const est = providers.estado();
  const tentativas = [];
  for (const nome of est.ordem) {
    const p = providers.PROVEDORES[nome];
    if (!p.ativo()) { tentativas.push({ provedor: nome, ok: false, erro: 'sem chave' }); continue; }
    if (p.nuvem && !est.enviarNuvem && !(p.nuvemLiberada && p.nuvemLiberada())) { tentativas.push({ provedor: nome, ok: false, erro: 'envio à nuvem desligado' }); continue; }
    const base = (p.nuvem ? mascarar(texto).texto : String(texto)).slice(0, LIMITE);
    try {
      const bruto = await p.chamar({ sistema: SISTEMA, usuario: PEDIDO(base, { unidade: p.nuvem ? '(unidade)' : unidade, trimestre }) });
      const s = String(bruto || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
      let o = {}; try { o = JSON.parse(s.slice(i, j + 1)); } catch (_) { /* vazio */ }
      return Object.assign({ ok: true, provedor: nome, truncado: texto.length > LIMITE, tentativas }, normalizar(o, base));
    } catch (e) { tentativas.push({ provedor: nome, ok: false, erro: String(e.message || e).slice(0, 140) }); }
  }
  return Object.assign({ ok: false, motivo: 'Nenhuma IA disponível agora (' + tentativas.map((t) => t.provedor + ': ' + t.erro).join('; ') + '). Você pode lançar os dados à mão.', tentativas }, normalizar({}, texto));
}

module.exports = { propor, normalizar, paginaDe };
