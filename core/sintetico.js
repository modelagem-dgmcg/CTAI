'use strict';
// Gerador de linhas FICTÍCIAS, determinístico. Serve ao contrato de demonstração e ao servidor de teste da API.
// Não existe dado real de paciente neste repositório. Os protocolos começam com DEMO-.
const F = require('./formularios');

function prng(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const pad = (n) => String(n).padStart(2, '0');
const dataStr = (ano, mes, dia) => ano + '-' + pad(mes) + '-' + pad(dia);

function somar(dataIso, hora, minutos) {
  const [a, m, d] = dataIso.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d, h, mi + Math.round(minutos)));
  return { data: t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()), hora: pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) };
}

// competencia: 'AAAA-MM'. Retorna { fonte: [ {coluna: valor} ] } com os nomes de coluna das FONTES.
function gerar(competencia, opcoes) {
  const op = Object.assign({ semente: 20260600, escala: 1 }, opcoes || {});
  const rnd = prng(op.semente + Number(competencia.replace('-', '')));
  const [ano, mes] = competencia.split('-').map(Number);
  const diasMes = new Date(ano, mes, 0).getDate();
  const dia = () => 1 + Math.floor(rnd() * Math.min(diasMes, 28));
  const hora = () => pad(Math.floor(rnd() * 24)) + ':' + pad(Math.floor(rnd() * 60));
  const exp = (media) => Math.max(1, Math.round(-Math.log(1 - rnd()) * media));
  const out = {};
  let seq = 1000;
  const prot = (p) => 'DEMO-' + p + '-' + String(++seq);

  const comTempo = (fonte, n, media, colIni, colFim, extra) => {
    out[fonte] = [];
    for (let i = 0; i < n; i++) {
      const d = dataStr(ano, mes, dia()), h = hora();
      const min = exp(media);
      const fim = somar(d, h, min);
      const r = { protocolo: prot(fonte.slice(0, 3).toUpperCase()) };
      r[colIni[0]] = d; r[colIni[1]] = h; r[colFim[0]] = fim.data; r[colFim[1]] = fim.hora;
      Object.assign(r, extra ? extra(i) : {});
      out[fonte].push(r);
    }
  };

  // Classificação: verdes, amarelos, vermelhos, alguns azuis.
  out.classificacao = [];
  for (const [cor, n, media] of [['verde', 120, 27], ['amarelo', 60, 24], ['vermelho', 12, 5], ['azul', 20, 40]]) {
    for (let i = 0; i < Math.round(n * op.escala); i++) {
      const d = dataStr(ano, mes, dia()), h = hora(), min = exp(media), fim = somar(d, h, min);
      out.classificacao.push({ protocolo: prot('CLS'), cor, data_classificacao: d, hora_classificacao: h, data_atendimento: fim.data, hora_atendimento: fim.hora, minutos: String(min) });
    }
  }
  out.retorno = [];
  for (let i = 0; i < Math.round(300 * op.escala); i++) out.retorno.push({ protocolo: prot('RET'), retornou_24h: rnd() < 0.012 ? 'sim' : 'não' });
  comTempo('dor_toracica', 12, 8, ['data_chegada', 'hora_chegada'], ['data_ecg', 'hora_ecg']);
  comTempo('iamcsst', 4, 28, ['data_classificacao', 'hora_classificacao'], ['data_saida', 'hora_saida'], () => ({ contagem_desde: 'classificação' }));
  comTempo('ave', 6, 11, ['data_admissao', 'hora_admissao'], ['data_avaliacao', 'hora_avaliacao']);
  comTempo('sepse', 5, 40, ['data_chegada', 'hora_chegada'], ['data_antibiotico', 'hora_antibiotico']);
  comTempo('transferencias', 14, 380, ['data_solicitacao', 'hora_solicitacao'], ['data_saida', 'hora_saida'], (i) => ({ destino: i % 2 ? 'Hospital de referência' : 'UTI regulada' }));
  out.obitos = [];
  for (let i = 0; i < 6; i++) {
    const d = dataStr(ano, mes, dia()), h = hora();
    const horas = i < 3 ? 30 + Math.floor(rnd() * 90) : 2 + Math.floor(rnd() * 10);
    const fim = somar(d, h, horas * 60);
    out.obitos.push({ protocolo: prot('OBT'), data_admissao: d, hora_admissao: h, data_obito: fim.data, hora_obito: fim.hora, revisado: i === 1 ? 'não' : 'sim' });
  }
  out.queixas = [];
  for (let i = 0; i < 8; i++) {
    const d = dataStr(ano, mes, dia());
    const fim = somar(d, '08:00', (2 + Math.floor(rnd() * 12)) * 1440);
    out.queixas.push({ protocolo: prot('QXA'), identificada: i < 6 ? 'sim' : 'não', data_recebimento: d, data_resposta: fim.data, resposta_propria: i === 4 ? 'não' : 'sim' });
  }
  out.quadro_pessoal = []; out.educacao_participacao = [];
  const temas = ['Segurança do paciente', 'Higiene das mãos', 'Protocolo de sepse', 'Acolhimento'];
  for (let i = 1; i <= 50; i++) {
    const area = i <= 40 ? 'assistencial' : 'administrativa';
    const cod = 'DEMO-F' + String(i).padStart(3, '0');
    out.quadro_pessoal.push({ codigo_pessoa: cod, area, categoria_profissional: area === 'assistencial' ? (i % 3 ? 'técnico' : 'enfermeiro') : 'administrativo', ativo: 'sim' });
    const part = area === 'assistencial' ? i <= 29 : i <= 46;
    if (part) {
      out.educacao_participacao.push({ codigo_pessoa: cod, area, categoria_profissional: 'x', tema: temas[i % 4], data: dataStr(ano, mes, dia()), participou: 'sim' });
      if (i % 5 === 0) out.educacao_participacao.push({ codigo_pessoa: cod, area, categoria_profissional: 'x', tema: temas[(i + 1) % 4], data: dataStr(ano, mes, dia()), participou: 'sim' });
    }
  }
  void F;
  return out;
}

module.exports = { gerar, prng };
