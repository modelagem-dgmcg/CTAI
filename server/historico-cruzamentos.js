'use strict';
// Cruzamentos do histórico de uma unidade. Funções puras: recebem os relatórios JÁ CONFIRMADOS e devolvem avisos.
// Nada aqui usa IA nem banco; por isso é fácil de testar e de explicar a quem confere.
// Cada relatório: { hist_id, trimestre:'2026-T2', documento_tipo, igq, indicadores:[{indicador_id,nome,pontos,max}], achados:[{tipo,descricao}], recomendacoes:[{texto,tema,situacao}] }

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Chave de comparação: sem acento, sem pontuação, sem números de mês/ano, palavras pequenas fora, ordenadas. Dois textos parecidos dão a mesma chave.
const PEQUENAS = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'um', 'uma', 'que', 'os', 'as', 'ao', 'se']);
function chave(texto) {
  const p = semAcento(texto).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !PEQUENAS.has(w) && !/^\d+$/.test(w));
  return [...new Set(p)].sort().slice(0, 8).join(' ');
}
// Semelhança entre duas chaves (palavras em comum / menor conjunto). Usada para juntar redações diferentes do mesmo assunto.
function parecidas(a, b) {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return false;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size) >= 0.7 && n >= 2;
}
function agrupar(itens) { // itens: [{ k, trimestre, ... }] -> grupos de itens parecidos
  const grupos = [];
  for (const it of itens) {
    const g = grupos.find((x) => parecidas(x.k, it.k));
    if (g) g.itens.push(it); else grupos.push({ k: it.k, itens: [it] });
  }
  return grupos;
}
const trimestresDistintos = (itens) => [...new Set(itens.map((i) => i.trimestre))].sort();
const rot = (t) => String(t).replace('-T', ' · ').replace(/^(\d{4}) · (\d)/, '$2º tri/$1');

// Prefere o "parecer" quando há mais de um relatório no mesmo trimestre; senão, o mais recente.
function porTrimestre(relatorios) {
  const m = new Map();
  for (const r of relatorios) {
    const a = m.get(r.trimestre);
    const melhor = !a || (r.documento_tipo === 'parecer' && a.documento_tipo !== 'parecer') || (r.documento_tipo === a.documento_tipo && r.hist_id > a.hist_id);
    if (melhor) m.set(r.trimestre, r);
  }
  return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, r]) => r);
}

// Quedas seguidas terminando no trimestre mais recente.
function quedasSeguidas(serie) { // serie: [{trimestre, valor}] em ordem
  let n = 0;
  for (let i = serie.length - 1; i > 0; i--) { if (serie[i].valor < serie[i - 1].valor) n++; else break; }
  return n;
}

function achadoRepetido(relatorios) {
  const itens = [];
  for (const r of relatorios) for (const a of r.achados || []) { const k = chave((a.tipo || '') + ' ' + (a.descricao || '')); if (k) itens.push({ k, trimestre: r.trimestre, rotulo: a.tipo || String(a.descricao || '').slice(0, 80), hist_id: r.hist_id }); }
  return agrupar(itens).map((g) => ({ g, tr: trimestresDistintos(g.itens) })).filter((x) => x.tr.length >= 2).map((x) => ({
    codigo: 'achado_repetido', gravidade: x.tr.length >= 3 ? 'ALTA' : 'MÉDIA', trimestres: x.tr, assunto: x.g.itens[0].rotulo,
    texto: 'O achado "' + x.g.itens[0].rotulo + '" já apareceu em ' + x.tr.length + ' trimestres (' + x.tr.map(rot).join(', ') + ').',
  }));
}

function indicadorEmQueda(relatorios) {
  const base = porTrimestre(relatorios);
  const out = [];
  const ids = new Map();
  for (const r of base) for (const i of r.indicadores || []) if (i.pontos !== null && i.pontos !== undefined && Number.isFinite(Number(i.pontos))) {
    if (!ids.has(i.indicador_id)) ids.set(i.indicador_id, { nome: i.nome, serie: [] });
    ids.get(i.indicador_id).serie.push({ trimestre: r.trimestre, valor: Number(i.pontos) });
  }
  for (const [id, o] of ids) {
    const n = quedasSeguidas(o.serie);
    if (n >= 2) out.push({ codigo: 'indicador_em_queda', gravidade: 'MÉDIA', indicador_id: id, assunto: o.nome || id, quedas: n, trimestres: o.serie.slice(-(n + 1)).map((s) => s.trimestre),
      texto: 'O indicador ' + id + (o.nome ? ' (' + o.nome + ')' : '') + ' caiu em ' + n + ' trimestres seguidos: ' + o.serie.slice(-(n + 1)).map((s) => rot(s.trimestre) + ' = ' + String(s.valor).replace('.', ',')).join(' → ') + '.' });
  }
  const igqs = base.filter((r) => r.igq !== null && r.igq !== undefined && Number.isFinite(Number(r.igq))).map((r) => ({ trimestre: r.trimestre, valor: Number(r.igq) }));
  const n = quedasSeguidas(igqs);
  if (n >= 2) out.unshift({ codigo: 'indicador_em_queda', gravidade: 'ALTA', indicador_id: 'IGQ', assunto: 'Nota total (IGQ)', quedas: n, trimestres: igqs.slice(-(n + 1)).map((s) => s.trimestre),
    texto: 'A nota total (IGQ) caiu em ' + n + ' trimestres seguidos: ' + igqs.slice(-(n + 1)).map((s) => rot(s.trimestre) + ' = ' + String(s.valor).replace('.', ',')).join(' → ') + '.' });
  return out;
}

// Recomendação que continua aberta (ou foi marcada como repetida) e aparece de novo em outro trimestre.
function recomendacaoReaparece(relatorios) {
  const itens = [];
  for (const r of relatorios) for (const c of r.recomendacoes || []) { const k = chave(c.texto); if (k) itens.push({ k, trimestre: r.trimestre, situacao: c.situacao || 'aberta', texto: c.texto, hist_id: r.hist_id }); }
  return agrupar(itens).map((g) => ({ g, tr: trimestresDistintos(g.itens) })).filter((x) => x.tr.length >= 2).filter((x) => {
    const ult = x.g.itens.filter((i) => i.trimestre === x.tr[x.tr.length - 1]);
    return !(ult.every((i) => i.situacao === 'atendida')); // se a mais recente já consta como atendida, não é aviso
  }).map((x) => ({
    codigo: 'recomendacao_reaparece', gravidade: 'ALTA', trimestres: x.tr, assunto: x.g.itens[0].texto.slice(0, 120),
    texto: 'A recomendação "' + x.g.itens[0].texto.slice(0, 120) + '" foi feita em ' + x.tr.length + ' trimestres (' + x.tr.map(rot).join(', ') + ') e não consta como atendida.',
  }));
}

// Dois relatórios do mesmo trimestre que dizem números diferentes (nota total ou pontos do mesmo indicador).
function numeroDiverge(relatorios) {
  const out = [];
  const m = new Map();
  for (const r of relatorios) { if (!m.has(r.trimestre)) m.set(r.trimestre, []); m.get(r.trimestre).push(r); }
  const tol = 0.005;
  for (const [tri, lista] of m) {
    if (lista.length < 2) continue;
    for (let a = 0; a < lista.length; a++) for (let b = a + 1; b < lista.length; b++) {
      const x = lista[a], y = lista[b], nx = x.documento_tipo + ' #' + x.hist_id, ny = y.documento_tipo + ' #' + y.hist_id;
      if (x.igq !== null && x.igq !== undefined && y.igq !== null && y.igq !== undefined && Math.abs(Number(x.igq) - Number(y.igq)) > tol) {
        out.push({ codigo: 'numero_diverge', gravidade: 'ALTA', trimestres: [tri], assunto: 'Nota total (IGQ)', texto: 'Em ' + rot(tri) + ', a nota total é ' + String(x.igq).replace('.', ',') + ' no ' + nx + ' e ' + String(y.igq).replace('.', ',') + ' no ' + ny + '.' });
      }
      const mapa = new Map((y.indicadores || []).map((i) => [i.indicador_id, i]));
      for (const i of x.indicadores || []) {
        const j = mapa.get(i.indicador_id); if (!j) continue;
        if (i.pontos === null || i.pontos === undefined || j.pontos === null || j.pontos === undefined) continue;
        if (Math.abs(Number(i.pontos) - Number(j.pontos)) > tol) out.push({ codigo: 'numero_diverge', gravidade: 'MÉDIA', trimestres: [tri], assunto: 'Indicador ' + i.indicador_id, texto: 'Em ' + rot(tri) + ', o indicador ' + i.indicador_id + ' tem ' + String(i.pontos).replace('.', ',') + ' ponto(s) no ' + nx + ' e ' + String(j.pontos).replace('.', ',') + ' no ' + ny + '.' });
      }
    }
  }
  return out;
}

const ORDEM = { ALTA: 0, MÉDIA: 1, BAIXA: 2 };
function cruzar(relatorios) {
  const confirmados = (relatorios || []);
  const avisos = [].concat(recomendacaoReaparece(confirmados), numeroDiverge(confirmados), indicadorEmQueda(confirmados), achadoRepetido(confirmados));
  avisos.sort((a, b) => (ORDEM[a.gravidade] - ORDEM[b.gravidade]));
  return avisos;
}

// Série para a mini-linha da carteira: uma nota por trimestre.
function tendencia(relatorios) {
  return porTrimestre(relatorios || []).filter((r) => r.igq !== null && r.igq !== undefined && Number.isFinite(Number(r.igq))).map((r) => ({ trimestre: r.trimestre, igq: Number(r.igq) }));
}

module.exports = { cruzar, tendencia, achadoRepetido, indicadorEmQueda, recomendacaoReaparece, numeroDiverge, chave, parecidas, porTrimestre };
