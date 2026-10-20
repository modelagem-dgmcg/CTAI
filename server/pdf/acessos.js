'use strict';
// PDF do registro de acessos (Gestão CTAI). Somente leitura: reflete o que está gravado, ligado à trilha encadeada.
const render = require('./render');
const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Recife' });

function construir(dados, filtros, trilhaOk, por) {
  const c = dados.contagens;
  const blocos = [];
  blocos.push({ tipo: 'chaveValor', itens: [
    ['Período', (filtros.de || 'início') + ' a ' + (filtros.ate || 'hoje')], ['Unidade', filtros.contrato || 'todas'], ['Usuário', filtros.usuario || 'todos'], ['Evento', filtros.evento || 'todos'], ['Gerado por', por],
    ['Trilha encadeada', trilhaOk ? 'íntegra' : 'COM FALHAS'],
  ] });
  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Resumo' });
  blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Evento', largura: 3 }, { rotulo: 'Quantidade', largura: 1, alinhar: 'right' }], linhas: [['Entradas', c.entrada], ['Tentativas falhas', c.falha], ['Bloqueios', c.bloqueio], ['Saídas', c.saida], ['Cadastros feitos por gestores de unidade', c.cadastro], ['Registros de origem externa', c.externas]] });
  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Registros (mais recentes primeiro)' });
  blocos.push(dados.linhas.length ? { tipo: 'tabela', colunas: [{ rotulo: 'Quando', largura: 1.5 }, { rotulo: 'Evento', largura: 0.9 }, { rotulo: 'Usuário', largura: 1.1 }, { rotulo: 'Unidade', largura: 1.3 }, { rotulo: 'Origem', largura: 1.2 }, { rotulo: 'Detalhe', largura: 2.2 }],
    linhas: dados.linhas.slice(0, 400).map((l) => [hora(l.data_hora), l.evento, l.login || '—', l.unidade || '—', (l.origem || '—') + (l.ip ? ' · ' + l.ip : ''), l.detalhe || '—']) } : { tipo: 'paragrafo', texto: 'Nenhum registro para o filtro.' });
  if (dados.linhas.length > 400) blocos.push({ tipo: 'aviso', nivel: 'info', texto: 'O PDF mostra os 400 registros mais recentes; use o CSV para a lista completa.' });
  return { titulo: 'Registro de acessos – Gestão CTAI', subtitulo: 'Entradas, falhas, bloqueios, saídas e cadastros da equipe das unidades', cabecalhoCurto: 'Gestão CTAI · acessos', demo: false,
    rodape: 'Gestão CTAI · gerado em ' + hora(new Date().toISOString()) + ' · o registro não pode ser alterado', blocos };
}
async function gerar(dados, filtros, trilhaOk, por) { return render.renderizar(construir(dados, filtros, trilhaOk, por)); }
module.exports = { construir, gerar };
