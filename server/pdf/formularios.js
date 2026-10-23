'use strict';
// PDF dos formulários da unidade em branco (fichas por setor e listas), para leitura e impressão. Sem marca d'água.
const F = require('../../core/formularios');
const render = require('./render');

const TIPO = { numero: 'número', percentual: 'percentual (%)', inteiro: 'número inteiro', sim_nao: 'sim ou não', texto: 'texto', texto_longo: 'texto', data: 'data', hora: 'hora', selecao: 'escolha uma opção' };
const rotuloTipo = (c) => (c.tipo === 'selecao' && c.opcoes ? c.opcoes.join(' / ') : (TIPO[c.tipo] || c.tipo)) + (c.unidade && c.tipo !== 'percentual' ? ' (' + c.unidade + ')' : '');
const vazio = (c) => (c.tipo === 'texto_longo' ? '\n\n\n' : '\n');

function blocosDoSetor(s) {
  const b = [{ tipo: 'titulo', nivel: 1, texto: s.nome }, { tipo: 'paragrafo', texto: s.resumo }];
  const campos = F.camposDoSetor(s.id);
  if (campos.length) b.push({ tipo: 'tabela', titulo: 'Ficha do mês', colunas: [{ rotulo: 'Campo', largura: 4.2 }, { rotulo: 'Como preencher', largura: 1.6 }, { rotulo: 'Resposta', largura: 2.2 }], linhas: campos.map((c) => [c.rotulo, rotuloTipo(c), vazio(c)]) });
  for (const fid of s.fontes) {
    const f = F.FONTES[fid]; if (!f) continue;
    b.push({ tipo: 'titulo', nivel: 2, texto: 'Lista: ' + f.nome });
    if (f.ajuda) b.push({ tipo: 'paragrafo', texto: f.ajuda });
    b.push({ tipo: 'tabela', colunas: f.colunas.map((c) => ({ rotulo: c.rotulo + (c.obrigatorio ? ' *' : ''), largura: 1 })), linhas: Array.from({ length: 5 }, () => f.colunas.map(() => '\n')) });
    b.push({ tipo: 'paragrafo', texto: '* campo obrigatório. Nunca escreva nome, CPF, prontuário ou data de nascimento de paciente.' });
  }
  return b;
}

function gerar(setorId) {
  const lista = setorId ? F.SETORES.filter((s) => s.id === setorId) : F.SETORES;
  if (!lista.length) { const e = new Error('Ficha desconhecida.'); e.status = 404; throw e; }
  const blocos = [];
  if (!setorId) blocos.push({ tipo: 'paragrafo', texto: 'Versão em branco dos formulários mensais da unidade, para leitura e impressão. O preenchimento e o envio são feitos no sistema.' }, { tipo: 'lista', itens: F.SETORES.map((s) => s.nome) });
  for (const s of lista) blocos.push(...blocosDoSetor(s));
  return render.renderizar({ titulo: setorId ? 'Ficha: ' + lista[0].nome : 'Formulários mensais da unidade', subtitulo: 'Versão em branco para consulta e impressão', blocos });
}
module.exports = { gerar };
