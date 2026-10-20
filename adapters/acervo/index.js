'use strict';
// Fonte OPCIONAL de conferência: o acervo (SIMAS ou outro banco que a SES já mantém). Só leitura.
// Hoje lê um arquivo JSON exportado, no formato:
//   { "fonte": "SIMAS (exportação)", "competencias": { "2026-06": { "2.8": 1234, "2.11": 56 } } }
// Quando houver acesso à base ou à API do SIMAS, só este arquivo muda: o contrato de saída continua o mesmo ({ fonte, valores }).
// Modo demonstração: valores FICTÍCIOS derivados do recálculo, com pequenas diferenças propositais, só para ver a conferência funcionando.
const fs = require('fs');
const path = require('path');

function lerArquivo(caminho, competencia) {
  if (!caminho || !fs.existsSync(caminho)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch (_) { throw new Error('O arquivo do acervo não é um JSON válido.'); }
  const v = j.competencias && j.competencias[competencia];
  if (!v || typeof v !== 'object') return null;
  const valores = {};
  for (const [k, x] of Object.entries(v)) { const n = Number(x); if (Number.isFinite(n)) valores[k] = n; }
  return { fonte: j.fonte || 'acervo (arquivo)', valores };
}

// Valores de demonstração: 2 indicadores contados ficam ~6% e ~2% diferentes do recálculo; os demais, iguais.
function demo(recalculados) {
  const valores = {};
  let i = 0;
  for (const [id, v] of Object.entries(recalculados)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    valores[id] = v;
  }
  const ids = Object.keys(valores);
  if (ids[1]) valores[ids[1]] = Math.round(valores[ids[1]] * 1.06 * 100) / 100;
  if (ids[3]) valores[ids[3]] = Math.round(valores[ids[3]] * 0.98 * 100) / 100;
  void i;
  return { fonte: 'Acervo fictício (demonstração)', valores };
}

function ler({ config, competencia, recalculados, dataDir }) {
  const cfg = config || {};
  if (cfg.demo) return demo(recalculados);
  const arq = cfg.arquivo ? path.resolve(dataDir || '.', cfg.arquivo) : null;
  if (arq && !arq.startsWith(path.resolve(dataDir || '.') + path.sep)) throw new Error('O arquivo do acervo deve ficar dentro da pasta de dados.');
  return lerArquivo(arq, competencia);
}

module.exports = { ler, lerArquivo, demo, tipo: 'acervo', nome: 'Acervo / SIMAS (conferência)' };
