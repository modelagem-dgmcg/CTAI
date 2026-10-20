'use strict';
// Gera adapters/mv/mapeamento.json a partir das colunas do sistema. Os nomes de campo da API (nr_atendimento, dh_*, fl_*) são FICTÍCIOS.
// Quando o dicionário real do sistema da unidade chegar, edite o mapeamento.json (ou rode este script com os nomes certos).
const fs = require('fs');
const path = require('path');
const F = require('../../core/formularios');

const mapa = { versao: 1, aviso: 'Nomes de campo fictícios. Troque a coluna "de" pelos campos reais do sistema da unidade.', fusoHorario: 'America/Recife', fontes: {} };
for (const [id, f] of Object.entries(F.FONTES)) {
  const campos = {};
  const nomes = f.colunas.map((c) => c.nome);
  for (const c of f.colunas) {
    if (c.nome === 'protocolo') campos.protocolo = { de: 'nr_atendimento' };
    else if (c.nome === 'codigo_pessoa') campos.codigo_pessoa = { de: 'cd_colaborador' };
    else if (c.tipo === 'data' || c.tipo === 'hora') {
      const sufixo = c.nome.replace(/^(data|hora)_?/, '');
      const par = nomes.includes((c.tipo === 'data' ? 'hora_' : 'data_') + sufixo);
      campos[c.nome] = { de: (par ? 'dh_' : 'dt_') + (sufixo || 'evento'), como: c.tipo };
    } else if (c.nome === 'minutos') campos.minutos = { de: 'nr_segundos', como: 'segundos_para_minutos' };
    else if (c.tipo === 'sim_nao') campos[c.nome] = { de: 'fl_' + c.nome, como: 'sim_nao' };
    else if (c.tipo === 'selecao') campos[c.nome] = { de: 'ds_' + c.nome, como: 'mapa', mapa: Object.fromEntries((c.opcoes || []).map((o) => [o.toUpperCase(), o])) };
    else campos[c.nome] = { de: 'ds_' + c.nome };
  }
  mapa.fontes[id] = {
    endpoint: '/api/v1/' + id.replace(/_/g, '-'),
    parametros: { inicio: '{inicio}', fim: '{fim}' },
    listaEm: 'dados',
    paginacao: { param: 'pagina', paramTamanho: 'limite', tamanho: 500 },
    campos,
  };
}
fs.writeFileSync(path.join(__dirname, 'mapeamento.json'), JSON.stringify(mapa, null, 2) + '\n');
console.log('mapeamento.json gerado com', Object.keys(mapa.fontes).length, 'fontes.');
