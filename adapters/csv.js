'use strict';
// Fonte "CSV": arquivo enviado pela unidade. Valida e recusa dado pessoal antes de guardar qualquer coisa.
const L = require('../core/linhas');

module.exports = {
  tipo: 'csv',
  nome: 'Arquivo CSV',
  // Devolve o resultado de validarLinhas (nada é gravado aqui).
  lerArquivo(texto, fonte, competencia) {
    const { cabecalho, registros } = L.lerCSV(texto);
    if (!cabecalho.length) return { ok: false, recusado: false, erros: [{ linha: 0, coluna: '', mensagem: 'O arquivo está vazio.' }], avisos: [], linhas: [] };
    return L.validarLinhas(fonte, cabecalho, registros, { competencia });
  },
};
