'use strict';
// PDF da minuta (uma versão congelada). É a base para o parecer que a CTAI assina no SEI.
const U = require('../../core/util');
const render = require('./render');
const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

const num = (v, c) => (v === null || v === undefined || v === '' ? '—' : (typeof v === 'number' ? U.formatarNumero(v, c === undefined ? 2 : c) : String(v)));

function construirMinuta(conteudo, versao, estado) {
  const id = conteudo.identificacao;
  const blocos = [];
  const autorizada = estado === 'autorizada';
  const rascunho = versao && versao.numero === 'rascunho';
  if (id.demo) blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'DEMONSTRAÇÃO – dados fictícios. Esta minuta não vale como parecer.' });
  blocos.push({ tipo: 'aviso', nivel: autorizada ? 'info' : 'atencao', texto: rascunho ? 'Rascunho para leitura e impressão (ainda não foi congelado nem conferido). Não é o parecer assinado.' : autorizada
    ? 'Versão ' + versao.numero + ' autorizada internamente. O parecer só vale depois de assinado no SEI pelas pessoas responsáveis. O "OK" do sistema é controle interno e não substitui a assinatura.'
    : 'Minuta para conferência (versão ' + versao.numero + ', situação: ' + estado + '). Não é o parecer assinado. O "OK" do sistema é controle interno e não substitui a assinatura no SEI.' });

  blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Identificação' });
  blocos.push({ tipo: 'chaveValor', itens: [
    ['Unidade', id.unidade], ['Organização social', id.oss], ['Contrato de Gestão', id.numero_cg], ['Trimestre', id.trimestre], ['Competências', id.competencias.join(', ')],
    ['Parecer nº', id.numero_parecer || 'a definir'], ['Regra de pontuação', id.regra], ['Criado por', id.criador],
  ] });

  if (conteudo.modelo) {
    const PM = require('../parecer-modelo');
    blocos.push({ tipo: 'titulo', nivel: 1, texto: PM.MODELO.titulo.replace('{numero}', id.numero_parecer || 'xxx') });
    for (const sc of PM.MODELO.secoes) {
      const t = conteudo.modelo.secoes[sc.id];
      if (!t) continue;
      blocos.push({ tipo: 'titulo', nivel: 2, texto: sc.titulo });
      for (const par of String(t).split(/\n{2,}/)) blocos.push({ tipo: 'paragrafo', texto: par });
      if (sc.id === 'analise') for (const q of PM.MODELO.quadros) {
        const l = conteudo.modelo.quadros[q.id] || [];
        if (!l.length) continue;
        blocos.push({ tipo: 'tabela', titulo: q.titulo, colunas: q.colunas.map((r, i) => ({ rotulo: r, largura: i === 1 ? 3 : 1 })), linhas: l });
      }
    }
  } else {
    blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Texto do parecer' });
    for (const [k, t] of [['abertura', 'Abertura'], ['analise', 'Análise'], ['conclusao', 'Conclusão']]) {
      blocos.push({ tipo: 'titulo', nivel: 2, texto: t });
      blocos.push({ tipo: 'paragrafo', texto: conteudo.texto[k] || '(sem texto)' });
    }
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

  const comCheck = conteudo.indicadores.competencias.filter((c) => c.checklist || c.prazos);
  if (comCheck.length) {
    blocos.push({ tipo: 'titulo', nivel: 1, texto: 'Checklist de recebimento e prazos' });
    for (const c of comCheck) {
      blocos.push({ tipo: 'titulo', nivel: 2, texto: 'Competência ' + c.competencia });
      if (c.prazos) blocos.push({ tipo: 'chaveValor', itens: [
        ['Prazo no SEI (dia 20)', dataBr(c.prazos.sei.prazo) + ' · ' + c.prazos.sei.situacao + (c.prazos.sei.entregue_em ? ' em ' + dataBr(c.prazos.sei.entregue_em) : '') + (c.prazos.sei.dias && c.prazos.sei.situacao !== 'no prazo' ? ' (' + c.prazos.sei.dias + ' dia(s))' : '')],
        ['Prazo no SIMAS (dia 25)', dataBr(c.prazos.simas.prazo) + ' · ' + c.prazos.simas.situacao + (c.prazos.simas.entregue_em ? ' em ' + dataBr(c.prazos.simas.entregue_em) : '') + (c.prazos.simas.dias && c.prazos.simas.situacao !== 'no prazo' ? ' (' + c.prazos.simas.dias + ' dia(s))' : '')],
      ] });
      if (c.checklist) {
        const k = c.checklist;
        blocos.push({ tipo: 'chaveValor', itens: [['Data de recebimento', dataBr(k.data_recebimento)], ['Responsável pelo envio', k.responsavel_envio || '—'], ['Versão recebida', k.versao ? 'v' + k.versao : '—'],
          ['Resumo (itens obrigatórios)', k.resumo.recebido + ' recebido(s) · ' + k.resumo.incompleto + ' incompleto(s) · ' + k.resumo.pendente + ' pendente(s) · ' + k.resumo['não aplicável'] + ' não aplicável(is)']] });
        blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Item', largura: 3.4 }, { rotulo: 'Status', largura: 1.1 }, { rotulo: 'Recebido em', largura: 1.1 }, { rotulo: 'Responsável', largura: 1.3 }, { rotulo: 'Validação', largura: 1.4 }, { rotulo: 'Observações', largura: 2 }],
          linhas: k.itens.map((i) => [i.titulo, i.status, dataBr(i.data_recebimento), i.responsavel || '—', (i.validacao || 'não registrada') + (i.divergencias_abertas ? ' (' + i.divergencias_abertas + ' divergência(s) aberta(s))' : ''), i.observacao || '—']) });
      }
    }
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
    subtitulo: id.unidade + ' · ' + id.trimestre + (rascunho ? ' · rascunho' : ' · versão ' + versao.numero),
    cabecalhoCurto: (rascunho ? 'Rascunho · ' : 'Minuta · ') + id.unidade + ' · ' + id.trimestre,
    demo: !!id.demo,
    rodape: rascunho ? 'Rascunho do parecer · gerado para leitura e impressão' : 'Minuta v' + versao.numero + ' · código de integridade ' + versao.hash.slice(0, 16) + ' · situação: ' + estado,
    blocos,
  };
}

async function gerarMinutaPdf(conteudo, versao, estado) {
  return render.renderizar(construirMinuta(conteudo, versao, estado));
}

module.exports = { construirMinuta, gerarMinutaPdf };
