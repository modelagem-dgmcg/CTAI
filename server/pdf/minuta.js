'use strict';
// PDF da minuta (uma versão congelada). É a base para o parecer que a CTAI assina no SEI.
const U = require('../../core/util');
const render = require('./render');

const num = (v, c) => (v === null || v === undefined || v === '' ? '—' : (typeof v === 'number' ? U.formatarNumero(v, c === undefined ? 2 : c) : String(v)));

function construirMinuta(conteudo, versao, estado) {
  const id = conteudo.identificacao;
  const blocos = [];
  const autorizada = estado === 'autorizada';
  if (id.demo) blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'DEMONSTRAÇÃO – dados fictícios. Esta minuta não vale como parecer.' });
  blocos.push({ tipo: 'aviso', nivel: autorizada ? 'info' : 'atencao', texto: autorizada
    ? 'Versão ' + versao.numero + ' autorizada internamente. O parecer só vale depois de assinado no SEI pelas pessoas responsáveis. O "OK" do sistema é controle interno e não substitui a assinatura.'
    : 'Minuta para conferência (versão ' + versao.numero + ', situação: ' + estado + '). Não é o parecer assinado. O "OK" do sistema é controle interno e não substitui a assinatura no SEI.' });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Identificação' });
  blocos.push({ tipo: 'chaveValor', itens: [
    ['Unidade', id.unidade], ['Organização social', id.oss], ['Contrato de Gestão', id.numero_cg], ['Trimestre', id.trimestre], ['Competências', id.competencias.join(', ')],
    ['Parecer nº', id.numero_parecer || 'a definir'], ['Regra de pontuação', id.regra], ['Criado por', id.criador],
  ] });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Texto do parecer' });
  for (const [k, t] of [['abertura', 'Abertura'], ['analise', 'Análise'], ['conclusao', 'Conclusão']]) {
    blocos.push({ tipo: 'titulo', nivel: 2, texto: t });
    blocos.push({ tipo: 'paragrafo', texto: conteudo.texto[k] || '(sem texto)' });
  }

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Indicadores e pontos' });
  for (const c of conteudo.indicadores.competencias) {
    blocos.push({ tipo: 'titulo', nivel: 2, texto: 'Competência ' + c.competencia + (c.implantacao ? ' (implantação, sem desconto)' : '') });
    blocos.push({ tipo: 'tabela', colunas: [
      { rotulo: 'Item', largura: 0.7 }, { rotulo: 'Indicador', largura: 3 }, { rotulo: 'Valor OSS', largura: 1.2, alinhar: 'right' }, { rotulo: 'Pts OSS', largura: 0.8, alinhar: 'right' },
      { rotulo: 'Valor CTAI', largura: 1.2, alinhar: 'right' }, { rotulo: 'Pts CTAI', largura: 0.8, alinhar: 'right' }, { rotulo: 'Adotado', largura: 0.9, alinhar: 'right' }, { rotulo: 'Máx.', largura: 0.7, alinhar: 'right' },
    ], linhas: c.indicadores.map((i) => [i.id, i.nome, num(i.valor_oss), num(i.pontos_oss, 0), num(i.valor_ctai), num(i.pontos_recalculados, 0), num(i.pontos_adotados, 0), i.max]) });
    blocos.push({ tipo: 'chaveValor', itens: [['IGQ declarado pela OSS', num(c.igq.oss, 0)], ['IGQ recalculado pela CTAI', num(c.igq.recalculado, 0)], ['IGQ adotado', num(c.igq.adotado, 0)]] });
    const ajustes = c.indicadores.filter((i) => i.origem && i.origem !== 'recalculo');
    if (ajustes.length) blocos.push({ tipo: 'lista', itens: ajustes.map((i) => 'Indicador ' + i.id + ' – ' + i.pontos_adotados + ' ponto(s), origem: ' + i.origem + '. ' + (i.justificativa || '') + (i.motivo_do_zero ? ' Motivo do zero: ' + i.motivo_do_zero : '')) });
  }

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Divergências' });
  if (conteudo.divergencias.length) blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Competência', largura: 1.1 }, { rotulo: 'Item', largura: 0.6 }, { rotulo: 'Tema', largura: 2.6 }, { rotulo: 'Declarado', largura: 1.4 }, { rotulo: 'Recalculado', largura: 1.4 }, { rotulo: 'Grav.', largura: 0.7 }, { rotulo: 'Situação', largura: 0.9 }],
    linhas: conteudo.divergencias.map((d) => [d.competencia, d.indicador_id || '—', d.tema, num(d.declarado), num(d.recalculado), d.gravidade, d.status]) });
  else blocos.push({ tipo: 'paragrafo', texto: 'Nenhuma divergência registrada.' });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Desconto' });
  const d = conteudo.desconto;
  blocos.push({ tipo: 'chaveValor', itens: [['Base mensal', U.formatarMoeda(d.base)], ['Regra decidida', d.modo_decidido === 'fixo' ? '10% fixo abaixo de 90 pontos' : d.modo_decidido === 'faixa' ? 'Tabela de faixas' : 'AINDA NÃO DECIDIDA']] });
  if (d.base_nota) blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'Base a confirmar: ' + d.base_nota });
  if (d.cenarios.length) blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'IGQ usado', largura: 2.4 }, { rotulo: 'IGQ por mês', largura: 1.6 }, { rotulo: '10% fixo', largura: 1.6, alinhar: 'right' }, { rotulo: 'Tabela de faixas', largura: 1.6, alinhar: 'right' }],
    linhas: d.cenarios.map((c) => [c.origem, c.igqs.map((i) => i.igq).join(' / '), U.formatarMoeda(c.fixo.total), U.formatarMoeda(c.faixa.total)]) });
  if (d.adotado && d.adotado.total !== undefined) blocos.push({ tipo: 'paragrafo', texto: 'Desconto adotado no trimestre: ' + U.formatarMoeda(d.adotado.total) + '.', negrito: true });
  else blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'O valor do desconto ainda depende de decisões de regra: ' + (d.decisoesAbertas.join(', ') || '—') + '.' });
  if (d.decisoes.length) blocos.push({ tipo: 'lista', itens: d.decisoes.map((x) => x.chave + ': ' + x.valor + ' – ' + x.justificativa) });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Alertas do recálculo' });
  const al = conteudo.alertas.recalculo.filter((a) => a.gravidade !== 'baixa');
  blocos.push(al.length ? { tipo: 'lista', itens: al.map((a) => a.competencia + (a.indicador_id ? ' · item ' + a.indicador_id : '') + ' · ' + a.gravidade + ': ' + a.mensagem) } : { tipo: 'paragrafo', texto: 'Nenhum alerta de gravidade média ou alta.' });
  if (conteudo.alertas.integridade.length) blocos.push({ tipo: 'lista', itens: conteudo.alertas.integridade.map((e) => e.competencia + ': ' + e.mensagem) });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Achados do Analista fixados' });
  blocos.push(conteudo.achados.length ? { tipo: 'lista', itens: conteudo.achados.map((a) => a.competencia + ' · ' + a.gravidade + ' · ' + (a.tipo || '') + ': ' + (a.trecho || '') + (a.sugestao ? ' → ' + a.sugestao : '')) } : { tipo: 'paragrafo', texto: 'Nenhum achado fixado.' });

  return {
    titulo: id.titulo || 'Minuta de parecer',
    subtitulo: id.unidade + ' · ' + id.trimestre + ' · versão ' + versao.numero,
    cabecalhoCurto: 'Minuta · ' + id.unidade + ' · ' + id.trimestre,
    demo: !!id.demo,
    rodape: 'Minuta v' + versao.numero + ' · código de integridade ' + versao.hash.slice(0, 16) + ' · situação: ' + estado,
    blocos,
  };
}

async function gerarMinutaPdf(conteudo, versao, estado) {
  return render.renderizar(construirMinuta(conteudo, versao, estado));
}

module.exports = { construirMinuta, gerarMinutaPdf };
