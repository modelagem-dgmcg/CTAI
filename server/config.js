'use strict';
// Configuração por variáveis de ambiente (arquivo .env opcional). Nenhum segredo fica no código.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');

function lerEnv(arquivo) {
  const out = {};
  if (!fs.existsSync(arquivo)) return out;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const arquivoEnv = lerEnv(process.env.CTAI_ENV_FILE || path.join(RAIZ, '.env'));
const env = (k, padrao) => (process.env[k] !== undefined ? process.env[k] : (arquivoEnv[k] !== undefined ? arquivoEnv[k] : padrao));

const dataDir = path.resolve(RAIZ, env('CTAI_DATA_DIR', 'data'));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'envios'), { recursive: true });
fs.mkdirSync(path.join(dataDir, 'pareceres'), { recursive: true });

// Chave para gerar códigos irreversíveis (pseudônimos). Criada uma vez e guardada fora do banco.
function chaveLocal() {
  const f = path.join(dataDir, 'chave-pseudonimo.txt');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

module.exports = {
  RAIZ,
  porta: Number(env('PORT', '3000')),
  dataDir,
  arquivoBanco: path.resolve(RAIZ, env('CTAI_DB', path.join(dataDir, 'ctai.sqlite'))),
  sessaoHoras: Number(env('CTAI_SESSAO_HORAS', '12')),
  // CTAI_PAINEL_ANALISTA=sim devolve o item "Painel" (e a tela inicial) a criadores e colegas. Padrão: não (começam na Caixa de entrada).
  painelAnalista: env('CTAI_PAINEL_ANALISTA', 'nao').toLowerCase() === 'sim',
  senhaTemporaria: env('CTAI_SENHA_TEMPORARIA', 'Trocar@123'),
  cookieSeguro: env('CTAI_COOKIE_SEGURO', 'nao') === 'sim',
  chavePseudonimo: env('CTAI_CHAVE_PSEUDONIMO', '') || chaveLocal(),
  semear: env('CTAI_SEMEAR', 'sim') !== 'nao',
  env,
};
