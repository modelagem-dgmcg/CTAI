'use strict';
// Acervo CTAI no Drive: conta de serviço (Google simulado), pastas Unidade/Trimestre, texto sem dados de paciente, sem duplicar, falha vira "pendente".
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { iniciar, cliente } = require('./helpers');
let S, a; const arquivos = new Map(); const pastas = new Map(); let n = 0; let falhar = false;
const realFetch = global.fetch;
test.before(async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CTAI_DRIVE_CHAVE = Buffer.from(JSON.stringify({ client_email: 'ctai@teste.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })).toString('base64');
  process.env.CTAI_ACERVO_PASTA = 'RAIZ';
  global.fetch = async (url, o) => {
    url = String(url); const J = (x, st) => ({ ok: !st, status: st || 200, text: async () => JSON.stringify(x), json: async () => x });
    if (url.includes('oauth2.googleapis.com')) return J({ access_token: 'tok', expires_in: 3600 });
    if (!url.includes('googleapis.com/')) return realFetch(url, o);
    if (falhar) return J({ error: { message: 'Drive fora do ar' } }, 503);
    if (url.includes('/upload/')) {
      const m = /\/files\/(\w+)\?/.exec(url); const corpo = String(o.body); const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(corpo)[1]);
      const txt = /text\/plain; charset=UTF-8\r\n\r\n(.*)\r\n--ctai/s.exec(corpo)[1];
      if (m) { arquivos.get(m[1]).texto = txt; return J({ id: m[1] }); }
      const id = 'f' + (++n); arquivos.set(id, { nome: meta.name, pai: meta.parents[0], texto: txt }); return J({ id });
    }
    if (o && o.method === 'POST') { const b = JSON.parse(o.body); const id = 'p' + (++n); pastas.set(id, { nome: b.name, pai: b.parents[0] }); return J({ id }); }
    const q = decodeURIComponent(/q=([^&]*)/.exec(url)[1]); const nome = /name = '(.*?)' and '(\w+)'/.exec(q);
    const pasta = q.includes('folder'); const fonte = pasta ? pastas : arquivos;
    const achou = [...fonte.entries()].filter(([, v]) => v.nome === nome[1] && v.pai === nome[2]).map(([id, v]) => ({ id, name: v.nome }));
    return J({ files: achou });
  };
  S = await iniciar(); a = cliente(S.base); await a.entrar('cleuton');
});
test.after(async () => { global.fetch = realFetch; delete process.env.CTAI_DRIVE_CHAVE; delete process.env.CTAI_ACERVO_PASTA; await S.fechar(); });

test('registrar o SEI de um documento arquiva o texto mascarado em Unidade/Trimestre, sem duplicar', async () => {
  const AC = require('../server/acervo-ctai');
  S.db.run("INSERT OR IGNORE INTO contratos (contrato_id, unidade, oss, tipo, demo) VALUES ('AC-1', 'UPAE Acervo', 'OSS', 'UPAE', 0)");
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  S.db.run("INSERT INTO documentos (tipo, contrato_id, trimestre, titulo, texto, criador_id, status, sei_numero, criado_em, atualizado_em) VALUES ('oficio','AC-1','2026-T3','Ofício teste','Paciente com CPF 123.456.789-09 foi atendido.',?, 'finalizado','00012345',?,?)", cle.usuario_id, 'x', 'x');
  const id = S.db.get('SELECT MAX(doc_id) AS i FROM documentos').i;
  const r = await AC.arquivar(S.db, 'documento', id); assert.equal(r.ok, true, r.motivo);
  const f = [...arquivos.values()][0];
  assert.match(f.nome, /Ofício teste - SEI 00012345\.txt/);
  assert.ok(!/123\.456\.789-09/.test(f.texto), 'o CPF não pode ir para o Drive');
  assert.equal(pastas.get(f.pai).nome, '2026-T3'); assert.equal([...pastas.values()].some((p) => p.nome === 'UPAE Acervo'), true);
  await AC.arquivar(S.db, 'documento', id); assert.equal(arquivos.size, 1, 'arquivar de novo troca o conteúdo, não duplica');
  assert.equal(AC.estado(S.db).arquivados >= 1, true);
});
test('Drive fora do ar: não quebra, fica pendente e o reenvio resolve', async () => {
  const AC = require('../server/acervo-ctai');
  const cle = S.db.get("SELECT usuario_id FROM usuarios WHERE login = 'cleuton'");
  S.db.run("INSERT INTO documentos (tipo, contrato_id, trimestre, titulo, texto, criador_id, status, sei_numero, criado_em, atualizado_em) VALUES ('oficio','AC-1','2026-T3','Segundo','Texto.',?, 'finalizado','777',?,?)", cle.usuario_id, 'x', 'x');
  const id = S.db.get('SELECT MAX(doc_id) AS i FROM documentos').i;
  falhar = true; const r = await AC.arquivar(S.db, 'documento', id); falhar = false;
  assert.equal(r.ok, false); assert.equal(S.db.get('SELECT estado FROM acervo_arquivos WHERE origem_id = ?', id).estado, 'pendente');
  const re = await AC.reenviarPendentes(S.db); assert.ok(re.arquivados >= 1);
  assert.equal(S.db.get('SELECT estado FROM acervo_arquivos WHERE origem_id = ?', id).estado, 'arquivado');
});
test('a administração vê o estado do Acervo; colega não', async () => {
  const adm = cliente(S.base); await adm.entrar('nathalia');
  const r = await adm.get('/api/historico/acervo'); assert.equal(r.status, 200); assert.equal(r.json.ligado, true);
  assert.equal((await a.get('/api/historico/acervo')).status, 403);
});
