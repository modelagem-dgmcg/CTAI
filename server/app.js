'use strict';
const express = require('express');
const path = require('path');
const A = require('./auth');
const D = require('./dominio');
const F = require('../core/formularios');
const R = require('../core/regras');
const M = require('./minuta');

function criarApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(require('./exposicao').barreira()); // origem externa só alcança o Portal da Unidade
  app.use(express.json({ limit: '6mb' }));

  // Cabeçalhos de segurança.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Proteção contra requisições de outro site: escrita só com o cabeçalho que o nosso front-end envia.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('x-ctai') !== '1') return res.status(403).json({ erro: 'Requisição recusada.' });
    next();
  });

  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/unidade', require('./routes/unidade')(db));
  app.use('/api/ctai', require('./routes/ctai')(db));
  app.use('/api/caixa', require('./routes/caixa')(db));
  app.use('/api/analista', require('./routes/analista')(db));
  app.use('/api/integracoes', require('./routes/integracoes')(db));
  app.use('/api/admin', require('./routes/admin')(db));
  require('./ia-config').instalar(db);
  app.use('/api/gestao', require('./routes/gestao')(db));

  app.get('/api/meta', A.exigir(db), (req, res) => {
    res.json({
      setores: F.SETORES, perfis: A.PERFIS, itensMesa: M.ITENS, questoesRegra: D.QUESTOES_REGRA.map((q) => ({ chave: q.chave, pergunta: q.pergunta, opcoes: q.opcoes })),
      fontes: Object.fromEntries(Object.entries(F.FONTES).map(([k, f]) => [k, { nome: f.nome, setor: f.setor }])),
    });
  });

  app.get('/api/regras/:contrato', A.exigir(db), (req, res) => {
    D.exigirContrato(req.usuario, req.params.contrato);
    const { regras } = D.regrasDoContrato(db, req.params.contrato);
    res.json({ versao: regras.versao, soma_maxima: regras.soma_maxima, indicadores: regras.indicadores.map((i) => ({ id: i.id, nome: i.nome, max: i.max, unidade: i.unidade || null, faixas: R.descricaoFaixas(i), pendente: i.pendente || null })), faixas_pagamento: regras.faixas_pagamento, pendencias: R.pendencias(regras) });
  });

  app.get(['/api/saude', '/saude'], (req, res) => res.json({ ok: true }));

  // Diagnóstico de origem: mostra a quem pergunta o IP que o servidor enxerga e como foi classificado (serve para calibrar o proxy).
  // Só devolve dados da própria requisição; não exige login.
  app.get('/api/origem', (req, res) => {
    const EX = require('./exposicao');
    const o = EX.origemDe(req), c = EX.clienteIp(req);
    const pega = (n) => (req.headers[n] === undefined ? null : String(req.headers[n]).slice(0, 300));
    res.json({
      classe: o.tipo, motivo: o.motivo, seuIp: c.ip, comoFoiObtido: c.fonte, listaDeIpsInternosDefinida: EX.listaInternaDefinida(), modo: EX.modo(),
      cabecalhos: { 'x-forwarded-for': pega('x-forwarded-for'), 'cf-connecting-ip': pega('cf-connecting-ip'), 'true-client-ip': pega('true-client-ip'), 'x-real-ip': pega('x-real-ip'), forwarded: pega('forwarded'), 'x-forwarded-host': pega('x-forwarded-host'), host: pega('host') },
      conexao: String((req.socket && req.socket.remoteAddress) || ''),
      orientacao: 'Se "seuIp" não for o seu IP público, ajuste CTAI_PROXY_SALTOS (quantos proxies da plataforma acrescentam endereço) ou CTAI_IP_CABECALHO. Veja docs/EXPOSICAO.md.',
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // Páginas: três "apps" estáticos no mesmo servidor.
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { extensions: ['html'], maxAge: 0, setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/'); if (p.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get(['/unidade', '/ctai'], (req, res) => res.sendFile(path.join(pub, req.path.slice(1) + '.html')));

  // Erros: mensagem clara em português, sem detalhes internos.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    const esperado = !!err.status && err.expose !== false && !err.type; // erro lançado de propósito pelo sistema (erro())
    if (status >= 500 && !esperado) console.error('[erro]', req.method, req.originalUrl, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err);
    const msg = status === 413 ? 'O conteúdo enviado é grande demais.'
      : err.type === 'entity.parse.failed' ? 'O corpo da requisição não é um JSON válido.'
      : esperado ? err.message
      : status >= 500 ? (/constraint|não pode ser|não podem ser/i.test(String(err.message)) ? 'O banco recusou a operação: ' + String(err.message).replace(/^.*?: /, '') : 'Erro interno. Tente de novo; se continuar, avise o administrador.')
      : err.message;
    res.status(status).json({ erro: msg });
  });
  return app;
}

module.exports = { criarApp };
