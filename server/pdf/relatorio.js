'use strict';
// Modelo padrão do relatório da unidade. A estrutura vem de templates/relatorio-v1.json.
const fs = require('fs');
const path = require('path');
const R = require('../../core/regras');
const U = require('../../core/util');
const F = require('../../core/formularios');
const render = require('./render');

const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'relatorio-v1.json');

function carregarTemplate() {
  return JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
}

const simNao = (v) => (v === true || v === 'sim') ? 'sim' : (v === false || v === 'não' ? 'não' : '—');

function valorTexto(ind, v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') return U.formatarNumero(v, ind.unidade === '%' ? 1 : 2) + (ind.unidade ? ' ' + ind.unidade : '');
  return String(v);
}

const ORIGEM = { digitado: 'digitado pelo setor', apoio: 'calculado das contagens', linhas: 'calculado das linhas' };

// snapshot: ver server/envios.js. regras: conteúdo do igq_v1.
function construirRelatorio(snapshot, regras, template) {
  const t = template || carregarTemplate();
  const flat = {};
  for (const f of Object.values(snapshot.fichas)) Object.assign(flat, f.dados);
  const blocos = [];
  const secao = (id) => t.secoes.find((s) => s.id === id && s.ativa !== false);
  const titulo = (id) => { const s = secao(id); if (s) blocos.push({ tipo: 'titulo', nivel: 1, texto: s.titulo }); return !!s; };
  const hashCurto = snapshot.hash ? snapshot.hash.slice(0, 12) : '';

  for (const s of t.secoes) {
    if (s.ativa === false) continue;
    if (s.id === 'identificacao' && titulo('identificacao')) {
      blocos.push({ tipo: 'chaveValor', itens: [
        ['Unidade', snapshot.contrato.unidade], ['Organização social', snapshot.contrato.oss], ['Contrato de Gestão', snapshot.contrato.numero_cg],
        ['Competência', snapshot.competencia.competencia_id + (snapshot.competencia.mes_implantacao ? ' (mês de implantação)' : '')],
        ['Processo SEI', snapshot.competencia.processo_sei], ['Regra de pontuação', snapshot.regra.versao],
        ['Versão do envio', 'v' + snapshot.versao + (snapshot.motivo ? ' · motivo da correção: ' + snapshot.motivo : '')],
        ['Enviado por', snapshot.enviadoPor ? snapshot.enviadoPor.nome : '—'],
      ] });
    } else if (s.id === 'igq' && titulo('igq')) {
      const linhas = regras.indicadores.map((ind) => {
        const c = snapshot.indicadores[ind.id] || {};
        return [ind.id, ind.nome, R.descricaoFaixas(ind), valorTexto(ind, c.valor), c.origem ? ORIGEM[c.origem] : '—', c.pontos === undefined ? '—' : c.pontos, ind.max, c.anexo || '—'];
      });
      blocos.push({ tipo: 'tabela', colunas: [
        { rotulo: 'Item', largura: 0.7 }, { rotulo: 'Indicador', largura: 3 }, { rotulo: 'Faixas de pontos', largura: 3 }, { rotulo: 'Valor', largura: 1.3, alinhar: 'right' },
        { rotulo: 'Origem do valor', largura: 1.7 }, { rotulo: 'Pts', largura: 0.7, alinhar: 'right' }, { rotulo: 'Máx.', largura: 0.7, alinhar: 'right' }, { rotulo: 'Anexo', largura: 1.4 },
      ], linhas });
      blocos.push({ tipo: 'chaveValor', itens: [['Pontos pelas regras do contrato', snapshot.igqDeclarado + ' de 100'], ['Observação', 'Os pontos são calculados pelo sistema a partir do valor informado. A conferência e a pontuação final são da CTAI.']] });
    } else if (s.id === 'bid' && titulo('bid')) {
      const ids = F.camposDoSetor('bid').filter((c) => c.tipo === 'inteiro' || c.tipo === 'numero');
      blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Item', largura: 4 }, { rotulo: 'Valor', largura: 1.2, alinhar: 'right' }], linhas: ids.map((c) => [c.rotulo, flat[c.id] === undefined || flat[c.id] === '' ? '—' : U.formatarNumero(U.numero(flat[c.id]), c.tipo === 'inteiro' ? 0 : 2)]) });
      if (flat.i_bid_anexo) blocos.push({ tipo: 'paragrafo', texto: 'Anexo do BID: ' + flat.i_bid_anexo });
    } else if (s.id === 'tempos' && titulo('tempos')) {
      const rows = [];
      const nomes = Object.fromEntries(Object.entries(F.FONTES).map(([k, v]) => [k, v.nome]));
      for (const [fonte, r] of Object.entries(snapshot.resumoLinhas || {})) {
        if (fonte === 'educacao_participacao' || fonte === 'quadro_pessoal' || fonte === 'queixas' || fonte === 'retorno' || fonte === 'obitos') continue;
        if (fonte === 'classificacao' && r.porCor) {
          for (const [cor, rc] of Object.entries(r.porCor)) rows.push([nomes[fonte] + ' · ' + cor, rc.n, rc.media === null ? '—' : U.formatarNumero(rc.media), rc.mediana === null ? '—' : U.formatarNumero(rc.mediana), rc.maximo === null ? '—' : U.formatarNumero(rc.maximo)]);
        } else rows.push([nomes[fonte] || fonte, r.n, r.media === null ? '—' : U.formatarNumero(r.media), r.mediana === null ? '—' : U.formatarNumero(r.mediana), r.maximo === null ? '—' : U.formatarNumero(r.maximo)]);
      }
      if (rows.length) blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Fonte das linhas', largura: 4 }, { rotulo: 'Casos', largura: 0.9, alinhar: 'right' }, { rotulo: 'Média (min)', largura: 1.2, alinhar: 'right' }, { rotulo: 'Mediana (min)', largura: 1.2, alinhar: 'right' }, { rotulo: 'Máximo (min)', largura: 1.2, alinhar: 'right' }], linhas: rows });
      else blocos.push({ tipo: 'aviso', nivel: 'atencao', texto: 'Nenhuma linha bruta foi enviada. Os valores dos indicadores de tempo foram informados pelo setor e a CTAI não poderá recalculá-los.' });
    } else if (s.id === 'educacao' && titulo('educacao')) {
      const campos = F.camposDoSetor('educacao').filter((c) => c.tipo === 'inteiro' || c.tipo === 'percentual');
      blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Item', largura: 4 }, { rotulo: 'Valor', largura: 1.2, alinhar: 'right' }], linhas: campos.map((c) => {
        const m = /^i(2_\d+)_valor$/.exec(c.id);
        const consolidado = m ? snapshot.indicadores[m[1].replace('_', '.')] : null; // percentual calculado das contagens, quando a ficha não digitou
        const v = flat[c.id] !== undefined && flat[c.id] !== '' ? U.numero(flat[c.id]) : (consolidado ? consolidado.valor : null);
        return [c.rotulo + (consolidado && (flat[c.id] === undefined || flat[c.id] === '') && v !== null ? ' (calculado das contagens)' : ''), v === null || v === undefined ? '—' : U.formatarNumero(v, c.tipo === 'inteiro' ? 0 : 1)];
      }) });
      blocos.push({ tipo: 'paragrafo', texto: 'Adesão contada por pessoas únicas (cada pessoa conta uma vez). Regra a confirmar com a CTAI.' });
    } else if (s.id === 'queixas' && titulo('queixas')) {
      const ls = (snapshot.linhas.queixas || []);
      if (ls.length) blocos.push({ tipo: 'tabela', colunas: [{ rotulo: 'Protocolo', largura: 2 }, { rotulo: 'Identificada', largura: 1.1 }, { rotulo: 'Recebida em', largura: 1.4 }, { rotulo: 'Respondida em', largura: 1.4 }, { rotulo: 'Resposta própria', largura: 1.3 }], linhas: ls.map((l) => [l.protocolo, l.categoria, l.data_inicio, l.data_fim || '—', (l.dados && l.dados.resposta_propria) || '—']) });
      else blocos.push({ tipo: 'paragrafo', texto: 'Nenhuma linha de queixa enviada. Recebidas: ' + (flat.queixas_recebidas || '—') + '; identificadas: ' + (flat.queixas_identificadas || '—') + '; respostas aceitas: ' + (flat.queixas_aceitas || '—') + '.' });
    } else if (s.id === 'transferencias' && titulo('transferencias')) {
      const r = (snapshot.resumoLinhas || {}).transferencias;
      if (r) blocos.push({ tipo: 'chaveValor', itens: [['Transferências na lista', r.n], ['Remoções no BID', flat.bid_remocoes || '—'], ['Tempo médio calculado das linhas (min)', r.media === null ? '—' : U.formatarNumero(r.media)], ['Mediana (min)', r.mediana === null ? '—' : U.formatarNumero(r.mediana)], ['Tempo médio informado (min)', flat.transf_media_declarada || '—']] });
      else blocos.push({ tipo: 'paragrafo', texto: 'Nenhuma lista de transferências enviada.' });
    } else if (s.id === 'pessoal' && titulo('pessoal')) {
      blocos.push({ tipo: 'chaveValor', itens: [['Gasto com pessoal (% do repasse; limite de 80%)', flat.gasto_pessoal_pct === undefined || flat.gasto_pessoal_pct === '' ? '—' : U.formatarNumero(U.numero(flat.gasto_pessoal_pct)) + '%'], ['Quadro assistencial ativo', flat.quadro_assist_ativos || '—'], ['Quadro administrativo ativo', flat.quadro_adm_ativos || '—'], ['Anexo das escalas', flat.i_rh_anexo || '—']] });
    } else if (s.id === 'conferencias' && titulo('conferencias')) {
      if (snapshot.avisos && snapshot.avisos.length) blocos.push({ tipo: 'lista', itens: snapshot.avisos.map((a) => a.mensagem) });
      else blocos.push({ tipo: 'paragrafo', texto: 'O sistema não encontrou pontos a conferir antes do envio.' });
      blocos.push({ tipo: 'paragrafo', texto: 'Estas conferências são da unidade. A CTAI recalcula os indicadores de forma independente, a partir das linhas brutas.' });
    } else if (s.id === 'observacoes' && titulo('observacoes')) {
      const obs = [];
      for (const c of Object.values(F.CAMPOS).flat()) if (c.id.endsWith('_obs') && flat[c.id] && String(flat[c.id]).trim()) obs.push(c.rotulo.replace(/^Observações d[aoe]s? /, '') + ': ' + String(flat[c.id]).trim());
      blocos.push(obs.length ? { tipo: 'lista', itens: obs } : { tipo: 'paragrafo', texto: 'Nenhuma observação registrada pelos setores.' });
    } else if (s.id === 'declaracao' && titulo('declaracao')) {
      blocos.push({ tipo: 'paragrafo', texto: t.declaracao });
      blocos.push({ tipo: 'espaco', altura: 22 });
      blocos.push({ tipo: 'chaveValor', itens: [['Responsável pelo envio', snapshot.enviadoPor ? snapshot.enviadoPor.nome : '—'], ['Assinatura', 'No SEI, pela pessoa responsável. O sistema não guarda senha nem credencial do SEI.']] });
    }
  }
  if (snapshot.contrato.demo) blocos.unshift({ tipo: 'aviso', nivel: 'atencao', texto: 'DEMONSTRAÇÃO – dados fictícios. Este relatório foi gerado com dados de teste e não vale como relatório oficial.' });

  return {
    titulo: t.titulo,
    subtitulo: snapshot.contrato.unidade + ' · Competência ' + snapshot.competencia.competencia_id + ' · versão v' + snapshot.versao,
    cabecalhoCurto: snapshot.contrato.unidade + ' · ' + snapshot.competencia.competencia_id,
    demo: !!snapshot.contrato.demo,
    rodape: t.rodape + ' Versão v' + snapshot.versao + ' · código de integridade ' + hashCurto + ' · ' + (snapshot.geradoEm || ''),
    blocos,
  };
}

async function gerarRelatorioPdf(snapshot, regras, template) {
  const modelo = construirRelatorio(snapshot, regras, template);
  return { modelo, pdf: await render.renderizar(modelo) };
}

module.exports = { construirRelatorio, gerarRelatorioPdf, carregarTemplate, valorTexto };
