'use strict';
// Gera docs/FORMULARIOS.md a partir das definições reais (core/formularios.js). Rode: node scripts/gerar-doc-formularios.js
const fs = require('fs');
const path = require('path');
const F = require('../core/formularios');
const R = require('../core/regras');
const regras = R.carregarRegras();

let o = '# Formulários da unidade\n\n';
o += 'Este arquivo é gerado do código (`core/formularios.js`). Não edite à mão: rode `node scripts/gerar-doc-formularios.js`.\n\n';
o += 'Regra de ouro: **nenhum dado de paciente**. Os campos aceitam só número de protocolo, datas, horas, minutos e categorias. CPF, cartão SUS, e-mail e telefone digitados em texto livre são recusados.\n\n';
o += '## Fichas por setor\n\nCada setor da unidade preenche a sua ficha. O gestor da unidade vê todas e envia. A ficha só conta no envio quando está marcada como "pronta".\n\n';
for (const s of F.SETORES) {
  o += '### ' + s.nome + ' (`' + s.id + '`)\n\n' + s.resumo + '\n\n';
  o += 'Indicadores: ' + (s.indicadores.length ? s.indicadores.join(', ') : '—') + '. Listas (linhas): ' + (s.fontes.length ? s.fontes.map((f) => F.FONTES[f].nome).join('; ') : '—') + '.\n\n';
  o += '| Campo | Tipo | Faixa | Indicador | Ajuda |\n|---|---|---|---|---|\n';
  for (const c of F.camposDoSetor(s.id)) {
    const faixa = c.min !== undefined || c.max !== undefined ? (c.min ?? '') + ' a ' + (c.max ?? '') + (c.unidade ? ' ' + c.unidade : '') : (c.opcoes ? c.opcoes.join(' / ') : (c.unidade || ''));
    o += '| ' + c.rotulo + ' (`' + c.id + '`) | ' + c.tipo + ' | ' + faixa + ' | ' + (c.indicador || '') + ' | ' + String(c.ajuda || '').replace(/\|/g, '/') + ' |\n';
  }
  o += '\n';
}
o += '## Listas de linhas (CSV ou digitação)\n\nCada lista aceita CSV com separador `;` ou `,`, com a primeira linha de cabeçalho. O modelo de cada lista está no botão "Baixar o modelo" da própria tela. Colunas com cara de dado pessoal (nome, CPF, prontuário, data de nascimento, telefone, e-mail, endereço) fazem o arquivo inteiro ser **recusado**.\n\n';
for (const [id, f] of Object.entries(F.FONTES)) {
  o += '### ' + f.nome + ' (`' + id + '`)\n\n' + f.ajuda + '\n\n| Coluna | Tipo | Obrigatória | Observação |\n|---|---|---|---|\n';
  for (const c of f.colunas) o += '| `' + c.nome + '` — ' + c.rotulo + ' | ' + c.tipo + ' | ' + (c.obrigatorio ? 'sim' : 'não') + ' | ' + (c.opcoes ? c.opcoes.join(' / ') + '. ' : '') + String(c.ajuda || '').replace(/\|/g, '/') + ' |\n';
  o += '\n';
}
o += '## Pontuação (regra `' + regras.regra_id + '`)\n\n| Item | Indicador | Máx. | Faixas |\n|---|---|---|---|\n';
for (const i of regras.indicadores) o += '| ' + i.id + ' | ' + i.nome + ' | ' + i.max + ' | ' + R.descricaoFaixas(i) + (i.pendente ? ' **(pendente: ' + i.pendente + ')**' : '') + ' |\n';
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'FORMULARIOS.md'), o);
console.log('docs/FORMULARIOS.md gerado (' + o.length + ' caracteres)');
