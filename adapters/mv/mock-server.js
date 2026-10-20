'use strict';
// Servidor de TESTE que imita uma API do sistema da unidade, com campos fictícios e dados fictícios.
// Serve para ensaiar a integração e os testes. Não é o sistema real. Uso: node adapters/mv/mock-server.js (porta 4010)
const http = require('http');
const fs = require('fs');
const path = require('path');
const sintetico = require('../../core/sintetico');
const { inverterRegistro } = require('./transformar');

const MAPA = JSON.parse(fs.readFileSync(path.join(__dirname, 'mapeamento.json'), 'utf8'));
const TOKEN = process.env.MOCK_MV_TOKEN || 'token-de-teste';

function criar(opcoes) {
  const op = opcoes || {};
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const enviar = (status, corpo) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(corpo)); };
    if (op.token !== false && req.headers.authorization !== 'Bearer ' + (op.token || TOKEN)) return enviar(401, { erro: 'não autorizado' });
    if (url.pathname === '/api/v1/ping') return enviar(200, { ok: true, sistema: 'mock-mv', aviso: 'dados fictícios' });
    const fonte = Object.keys(MAPA.fontes).find((f) => MAPA.fontes[f].endpoint === url.pathname);
    if (!fonte) return enviar(404, { erro: 'endpoint desconhecido' });
    if (op.falhar === fonte) return enviar(500, { erro: 'erro interno simulado' });
    const inicio = url.searchParams.get('inicio') || '2026-06-01';
    const competencia = inicio.slice(0, 7);
    let linhas = sintetico.gerar(competencia, { semente: op.semente || 777 })[fonte] || [];
    // Para provar que a integração ignora dado pessoal: o mock devolve campos extras que NÃO estão no mapeamento.
    const registros = linhas.map((l) => Object.assign(inverterRegistro(l, MAPA.fontes[fonte].campos), op.comDadoPessoal ? { nm_paciente: 'Fulano de Tal', nr_cpf: '123.456.789-09' } : {}));
    const limite = Number(url.searchParams.get('limite') || 500), pagina = Number(url.searchParams.get('pagina') || 1);
    return enviar(200, { dados: registros.slice((pagina - 1) * limite, pagina * limite), pagina, total: registros.length });
  });
  return server;
}

if (require.main === module) {
  const porta = Number(process.env.MOCK_MV_PORT || 4010);
  criar().listen(porta, () => console.log('API de teste (dados fictícios) em http://localhost:' + porta + ' · token: ' + TOKEN));
}

module.exports = { criar, TOKEN };
