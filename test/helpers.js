'use strict';
// Importe este arquivo ANTES de qualquer módulo do sistema: ele aponta o banco para uma pasta temporária.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctai-teste-'));
process.env.CTAI_DATA_DIR = dir;
process.env.CTAI_ENV_FILE = path.join(dir, 'sem.env');
process.env.MV_API_TOKEN = process.env.MV_API_TOKEN || 'token-de-teste';

async function iniciar() {
  const { abrir, envolver } = require('../server/db');
  const config = require('../server/config');
  const seed = require('../server/seed');
  const { criarApp } = require('../server/app');
  const db = envolver(abrir(config.arquivoBanco));
  seed.semear(db);
  const app = criarApp(db);
  const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = 'http://127.0.0.1:' + servidor.address().port;
  return { db, base, dir, servidor, fechar: () => new Promise((ok) => servidor.close(() => { db.fechar(); ok(); })) };
}

// Cliente com cookie de sessão. Devolve { status, json, buffer, headers }.
function cliente(base) {
  let cookie = '';
  const c = {
    async req(metodo, url, corpo, extra) {
      const h = Object.assign({ 'content-type': 'application/json', 'x-ctai': '1' }, extra && extra.headers);
      if (cookie) h.cookie = cookie;
      const r = await fetch(base + url, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const buffer = Buffer.from(await r.arrayBuffer());
      let json = null;
      if ((r.headers.get('content-type') || '').includes('json')) { try { json = JSON.parse(buffer.toString('utf8')); } catch (_) { /* nada */ } }
      return { status: r.status, json, buffer, headers: r.headers };
    },
    get: (u) => c.req('GET', u), post: (u, b) => c.req('POST', u, b === undefined ? {} : b), put: (u, b) => c.req('PUT', u, b), patch: (u, b) => c.req('PATCH', u, b), del: (u) => c.req('DELETE', u),
    // Entra, troca a senha temporária e entra de novo.
    async entrar(login, senha) {
      const nova = senha || 'Senha@12345';
      let r = await c.post('/api/auth/login', { login, senha: 'Trocar@123' });
      if (r.status === 200 && r.json.usuario.trocar_senha) {
        r = await c.post('/api/auth/trocar-senha', { atual: 'Trocar@123', nova });
        if (r.status !== 200) throw new Error('trocar senha: ' + JSON.stringify(r.json));
      } else if (r.status !== 200) { r = await c.post('/api/auth/login', { login, senha: nova }); }
      r = await c.post('/api/auth/login', { login, senha: nova });
      if (r.status !== 200) throw new Error('login ' + login + ': ' + JSON.stringify(r.json));
      return r.json.usuario;
    },
  };
  return c;
}

module.exports = { iniciar, cliente, dir };
