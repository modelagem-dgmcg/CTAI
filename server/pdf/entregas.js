'use strict';
// PDF "Entregas por carteira": quando cada relatório chegou, em qual caixa caiu, se foi lido e tratado, e há quanto tempo está pendente.
const render = require('./render');
const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '—');
const compTxt = (c) => { const [a, m] = String(c).split('-'); return m + '/' + a; };

function construir(d, por) {
  const blocos = [];
  blocos.push({ tipo: 'chaveValor', itens: [['Gerado por', por], ['Entregas', d.total.entregas], ['Não lidas', d.total.nao_lidas], ['Pendentes', d.total.pendentes], ['Não lidas há ' + d.dias_nao_lido + ' dia(s) ou mais', d.total.destacadas]] });
  const linha = (e) => [e.unidade, compTxt(e.competencia_id) + ' v' + e.versao, hora(e.recebido_em), e.caixa.map((c) => c.nome + (c.em_substituicao_de ? ' (em substituição de ' + c.em_substituicao_de + ')' : '')).join(', ') || 'sem registro',
    e.lido ? hora(e.lido_em) : (e.destaque ? 'NÃO LIDO (destaque)' : 'não lido'), e.tratado ? (e.tratado_por + ' · ' + hora(e.tratado_em)) : (e.pendente_dias === null ? '—' : 'pendente há ' + e.pendente_dias + ' d')];
  const colunas = [{ rotulo: 'Unidade', largura: 1.5 }, { rotulo: 'Competência', largura: 1 }, { rotulo: 'Chegou', largura: 1.3 }, { rotulo: 'Caixa de', largura: 1.6 }, { rotulo: 'Lido', largura: 1.2 }, { rotulo: 'Tratado', largura: 1.6 }];
  for (const a of d.analistas) {
    blocos.push({ tipo: 'titulo', nivel: 1, texto: a.nome });
    blocos.push({ tipo: 'paragrafo', texto: a.resumo.entregas + ' entrega(s) · ' + a.resumo.nao_lidas + ' não lida(s) · ' + a.resumo.pendentes + ' pendente(s) · ' + a.resumo.destacadas + ' destacada(s)' });
    blocos.push({ tipo: 'tabela', colunas, linhas: a.unidades.flatMap((u) => u.entregas.map(linha)) });
  }
  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Unidades sem responsável (caixa da superintendente)' });
  blocos.push(d.sem_responsavel.length ? { tipo: 'tabela', colunas, linhas: d.sem_responsavel.flatMap((u) => (u.entregas.length ? u.entregas.map(linha) : [[u.unidade, '—', '—', 'sem carteira', '—', '—']])) } : { tipo: 'paragrafo', texto: 'Nenhuma.' });
  return { titulo: 'Entregas por carteira – Gestão CTAI', subtitulo: 'Chegada, leitura e tratamento dos relatórios das unidades', cabecalhoCurto: 'Gestão CTAI · entregas por carteira', demo: false, rodape: 'Gestão CTAI · gerado em ' + hora(new Date().toISOString()), blocos };
}
async function gerar(d, por) { return render.renderizar(construir(d, por)); }
module.exports = { construir, gerar };
