'use strict';
// PDF do painel da superintendente (Gestão CTAI). Mesmo renderizador dos demais PDFs.
const render = require('./render');

const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const sit = (s) => (s ? s.situacao + (s.dias && ['vencido', 'entregue com atraso', 'a vencer'].includes(s.situacao) ? ' (' + s.dias + ' d)' : '') : '—');
const n1 = (v) => (v === null || v === undefined ? '—' : String(v).replace('.', ','));

function construir(p, geradoPor) {
  const demo = p.unidades.some((u) => u.demo);
  const c = p.cartoes;
  const blocos = [];
  if (demo) blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'DEMONSTRAÇÃO – inclui unidade com dados fictícios. Os números não valem como acompanhamento real.' });
  blocos.push({ tipo: 'chaveValor', itens: [
    ['Trimestre', p.trimestre + ' (comparação com ' + p.trimestre_anterior + ')'], ['Unidades no painel', c.unidades],
    ['Situação em', br(p.hoje)], ['Gerado por', geradoPor],
  ] });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Resumo' });
  blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Indicador', largura: 3 }, { rotulo: 'Valor', largura: 1, alinhar: 'right' }], linhas: [
    ['Envios recebidos (completos)', c.recebidos], ['Envios incompletos', c.incompletos], ['Envios pendentes', c.pendentes],
    ['Prazos no prazo ou entregues no prazo', c.prazos.no_prazo], ['Prazos a vencer', c.prazos.a_vencer], ['Prazos vencidos', c.prazos.vencido], ['Entregues com atraso', c.prazos.atraso],
    ['Achados abertos', c.achados_abertos], ['Achados vencidos', c.achados_vencidos],
    ['Pareceres em rascunho', c.pareceres_rascunho], ['Pareceres congelados', c.pareceres_congelados], ['Unidades sem carteira', c.sem_carteira],
  ] });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Por unidade' });
  blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Unidade', largura: 1.8 }, { rotulo: 'Responsável', largura: 1.3 }, { rotulo: 'Fase', largura: 1.6 }, { rotulo: 'Pior prazo', largura: 1.4 }, { rotulo: 'Achados (ab./venc.)', largura: 1, alinhar: 'right' }],
    linhas: p.unidades.map((u) => [u.unidade, u.responsaveis.map((r) => r.nome).join(', ') || 'sem carteira', u.fase, u.pior_prazo ? u.pior_prazo.canal + ' ' + u.pior_prazo.situacao : '—', u.achados.abertos + ' / ' + u.achados.vencidos]) });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Prazos e envios por competência' });
  const linhas = [];
  for (const u of p.unidades) for (const k of u.competencias) linhas.push([u.unidade, k.competencia_id, k.envio.estado, sit(k.prazos && k.prazos.sei), sit(k.prazos && k.prazos.simas), k.divergencias_abertas]);
  blocos.push(linhas.length ? { tipo: 'tabela', colunas: [{ rotulo: 'Unidade', largura: 1.8 }, { rotulo: 'Competência', largura: 1 }, { rotulo: 'Envio', largura: 1 }, { rotulo: 'SEI (dia 20)', largura: 1.5 }, { rotulo: 'SIMAS (dia 25)', largura: 1.5 }, { rotulo: 'Diverg.', largura: 0.7, alinhar: 'right' }], linhas }
    : { tipo: 'paragrafo', texto: 'Não há competências nesse trimestre para o filtro escolhido.' });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'IGQ, pontos e faixa de pagamento' });
  blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Unidade', largura: 1.8 }, { rotulo: 'IGQ médio (pontos)', largura: 1.2, alinhar: 'right' }, { rotulo: 'Pago (média %)', largura: 1.1, alinhar: 'right' }, { rotulo: p.trimestre_anterior, largura: 1, alinhar: 'right' }, { rotulo: 'Variação', largura: 0.9, alinhar: 'right' }],
    linhas: p.unidades.map((u) => [u.unidade, u.igq ? n1(u.igq.medio) + ' de ' + u.igq.soma_maxima : '—', u.igq ? n1(u.igq.pct_pago_medio) : '—', u.igq_anterior ? n1(u.igq_anterior.medio) : '—', u.igq_delta === null ? '—' : (u.igq_delta > 0 ? '+' : '') + n1(u.igq_delta)]) });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Divergências recorrentes por indicador' });
  blocos.push(p.recorrentes.length ? { tipo: 'tabela', colunas: [{ rotulo: 'Item', largura: 0.6 }, { rotulo: 'Indicador', largura: 2.6 }, { rotulo: 'Competências', largura: 1, alinhar: 'right' }, { rotulo: 'Divergências', largura: 1, alinhar: 'right' }, { rotulo: 'Abertas', largura: 0.8, alinhar: 'right' }, { rotulo: 'Recorrente', largura: 0.9 }],
    linhas: p.recorrentes.map((r) => [r.indicador_id, r.nome || '—', r.competencias, r.divergencias, r.abertas, r.recorrente ? 'sim' : 'não']) } : { tipo: 'paragrafo', texto: 'Nenhuma divergência registrada no período.' });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Alertas' });
  blocos.push(p.alertas.length ? { tipo: 'lista', itens: p.alertas.map((a) => '[' + a.nivel + '] ' + a.unidade + ' · ' + a.tipo + ': ' + a.texto) } : { tipo: 'paragrafo', texto: 'Nenhum alerta no momento.' });

  return {
    titulo: 'Painel da superintendência – Gestão CTAI', subtitulo: 'Trimestre ' + p.trimestre + ' · situação em ' + br(p.hoje), cabecalhoCurto: 'Gestão CTAI · painel ' + p.trimestre, demo,
    rodape: 'Gestão CTAI · gerado em ' + new Date(p.gerado_em).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) + ' · trilha ' + (p.trilha.ok ? 'íntegra' : 'COM FALHAS'), blocos,
  };
}

async function gerar(p, geradoPor) { return render.renderizar(construir(p, geradoPor)); }
module.exports = { construir, gerar };
