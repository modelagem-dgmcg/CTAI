'use strict';
// Adaptador da API do sistema da unidade (MV). Interface: testar(), buscar(fonte, inicio, fim).
// Aguarda o dicionário real de campos: ajuste adapters/mv/mapeamento.json. Nada aqui grava no banco.
const fs = require('fs');
const path = require('path');
const config = require('../../server/config');
const { cabecalhosDeAuth, obterJson } = require('./cliente');
const { transformarRegistro } = require('./transformar');

function carregarMapeamento(cfg) {
  const arq = path.resolve(config.RAIZ, (cfg && cfg.mapeamento) || 'adapters/mv/mapeamento.json');
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

function lerCaminho(obj, caminho) {
  if (!caminho) return obj;
  return String(caminho).split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function criar(cfg, log) {
  const base = String((cfg && cfg.baseUrl) || config.env('MV_API_URL', '')).replace(/\/$/, '');
  const mapa = carregarMapeamento(cfg);
  const registrar = log || (() => {});
  return {
    tipo: 'mv-api', nome: 'API do sistema da unidade', mapa,
    async testar() {
      if (!base) throw new Error('Informe o endereço da API (baseUrl ou MV_API_URL).');
      const r = await obterJson(base + (cfg.ping || '/api/v1/ping'), cabecalhosDeAuth(cfg.auth), cfg.timeoutMs);
      registrar({ acao: 'testar', endpoint: cfg.ping || '/api/v1/ping', status: String(r.status), ms: r.ms, registros: 0 });
      return { ok: true, ms: r.ms };
    },
    // Devolve { registros: [colunas do sistema], brutos: n } para a fonte e o período.
    async buscar(fonte, inicio, fim) {
      const def = mapa.fontes[fonte];
      if (!def) throw new Error('A fonte ' + fonte + ' não está no mapeamento.');
      if (!base) throw new Error('Informe o endereço da API (baseUrl ou MV_API_URL).');
      const cab = cabecalhosDeAuth(cfg.auth);
      const todos = [];
      const tam = (def.paginacao && def.paginacao.tamanho) || 0;
      for (let pagina = 1; pagina <= 200; pagina++) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(def.parametros || {})) params.set(k, String(v).replace('{inicio}', inicio).replace('{fim}', fim));
        if (def.paginacao) { params.set(def.paginacao.param, String(pagina)); params.set(def.paginacao.paramTamanho, String(tam)); }
        const url = base + def.endpoint + '?' + params.toString();
        let r;
        try { r = await obterJson(url, cab, cfg.timeoutMs); } catch (e) {
          registrar({ acao: 'buscar ' + fonte, endpoint: def.endpoint, status: e.status ? String(e.status) : 'erro', ms: e.ms || 0, registros: 0, erro: e.message });
          throw e;
        }
        const lista = lerCaminho(r.corpo, def.listaEm);
        if (!Array.isArray(lista)) { registrar({ acao: 'buscar ' + fonte, endpoint: def.endpoint, status: String(r.status), ms: r.ms, registros: 0, erro: 'A resposta não tem a lista em "' + def.listaEm + '".' }); throw new Error('A resposta não tem a lista em "' + def.listaEm + '".'); }
        registrar({ acao: 'buscar ' + fonte, endpoint: def.endpoint, status: String(r.status), ms: r.ms, registros: lista.length });
        for (const reg of lista) todos.push(transformarRegistro(reg, def.campos, mapa.fusoHorario));
        if (!tam || lista.length < tam) break;
      }
      return { registros: todos, brutos: todos.length };
    },
  };
}

module.exports = { criar, carregarMapeamento };
