'use strict';
// GAOCG (leitura): conexão, cópia local e conferências do Analista CTAI. Só a CTAI usa; a unidade nunca acessa.
// A chave fica só nas variáveis da hospedagem. Aqui nada é gravado de volta no GAOCG.
const { criar, ENDPOINTS } = require('../adapters/gaocg');
const trilha = require('./trilha');
const { erro } = require('./auth');

const TTL_MS = 6 * 3600 * 1000;
const agora = () => new Date().toISOString();
const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ligada = () => criar().ligada;
const IA = require('./ia-config');
let origem = null; // 'servidor' (variáveis da hospedagem) ou 'tela' (digitado pela administração)

// Liga o GAOCG com o que foi digitado na tela, se a hospedagem não tiver as variáveis. Chamado ao iniciar e depois de salvar.
function carregar(db) {
  if (origem !== 'tela' && process.env.GAOCG_API_URL && process.env.GAOCG_API_CHAVE) { origem = 'servidor'; return; }
  const c = db.get('SELECT url, chave_cifrada FROM gaocg_config WHERE id = 1');
  const chave = c ? IA.decifrar(c.chave_cifrada) : '';
  if (c && chave) { process.env.GAOCG_API_URL = c.url; process.env.GAOCG_API_CHAVE = chave; origem = 'tela'; }
}
function salvarConfig(db, usuario, b) {
  const url = String((b && b.url) || '').trim(), chave = String((b && b.chave) || '').trim();
  if (!/^https:\/\/\S+$/.test(url)) throw erro(400, 'O endereço deve começar com https:// (é o link terminado em /exec).');
  if (chave.length < 12 || /\s/.test(chave)) throw erro(400, 'A chave parece incompleta. Cole a chave inteira, sem espaços.');
  const cifrada = IA.cifrar(chave), final = chave.slice(-4);
  db.run('INSERT INTO gaocg_config (id, url, chave_cifrada, final, atualizado_em, atualizado_por) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, chave_cifrada = excluded.chave_cifrada, final = excluded.final, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por', url, cifrada, final, agora(), usuario.login);
  origem = 'tela'; process.env.GAOCG_API_URL = url; process.env.GAOCG_API_CHAVE = chave;
  trilha.registrar(db, { usuario: usuario.login, tabela: 'gaocg', registro: 'conexao', campo: 'chave_trocada', valor_novo: 'final ' + final });
  return { ok: true, final };
}

function campo(obj, apelidos) {
  const ks = Object.keys(obj || {}).map((k) => [k, norm(k)]);
  for (const a of apelidos) { const n = norm(a); const k = ks.find((x) => x[1] === n); if (k && obj[k[0]] !== '' && obj[k[0]] !== null && obj[k[0]] !== undefined) return obj[k[0]]; }
  for (const a of apelidos) { const n = norm(a); const k = ks.find((x) => x[1].includes(n)); if (k && obj[k[0]] !== '' && obj[k[0]] !== null && obj[k[0]] !== undefined) return obj[k[0]]; }
  return null;
}
function marcarUso(db, usuario) {
  db.run('INSERT INTO gaocg_estado (id, ultimo_uso_em, ultimo_uso_por) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET ultimo_uso_em = excluded.ultimo_uso_em, ultimo_uso_por = excluded.ultimo_uso_por', agora(), usuario || null);
}

function estado(db) {
  const e = db.get('SELECT * FROM gaocg_estado WHERE id = 1') || {};
  const cfg = db.get('SELECT final, atualizado_em, atualizado_por FROM gaocg_config WHERE id = 1');
  return { configurada: ligada(), origem, chave_final: origem === 'tela' && cfg ? cfg.final : null, trocada_em: origem === 'tela' && cfg ? cfg.atualizado_em : null, teste: e.teste_em ? { em: e.teste_em, ok: !!e.teste_ok, ms: e.teste_ms, mensagem: e.teste_msg } : null, ultimo_uso: e.ultimo_uso_em ? { em: e.ultimo_uso_em, por: e.ultimo_uso_por } : null,
    copias: db.all('SELECT endpoint, filtros, total, lido_em FROM gaocg_cache ORDER BY lido_em DESC LIMIT 20') };
}

async function testar(db, usuario) {
  let ok = false, ms = null, msg;
  try { const r = await criar().consultar('api_unidades', { pageSize: 1 }); ok = true; ms = r.ms; msg = 'Conectado. A chave foi aceita.'; } catch (e) { msg = String(e.message || e).slice(0, 200); }
  db.run('INSERT INTO gaocg_estado (id, teste_em, teste_ok, teste_ms, teste_msg) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET teste_em = excluded.teste_em, teste_ok = excluded.teste_ok, teste_ms = excluded.teste_ms, teste_msg = excluded.teste_msg', agora(), ok ? 1 : 0, ms, msg);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'gaocg', registro: 'conexao', campo: 'teste', valor_novo: ok ? 'ok' : 'falhou' });
  return { ok, ms, mensagem: msg };
}

// Lê do GAOCG (ou da cópia local, se tiver menos de 6 h). Sem a chave, usa a cópia que existir, sem falhar.
async function ler(db, endpoint, filtros, opc) {
  if (!ENDPOINTS.includes(endpoint)) throw erro(400, 'Consulta desconhecida.');
  const o = opc || {};
  const chave = endpoint + '?' + JSON.stringify(Object.entries(filtros || {}).sort());
  const c = db.get('SELECT * FROM gaocg_cache WHERE chave = ?', chave);
  const fresca = c && Date.now() - Date.parse(c.lido_em) < TTL_MS;
  if (c && fresca && !o.forcar) return { linhas: JSON.parse(c.linhas), lido_em: c.lido_em, da_copia: true };
  if (!ligada()) { if (c) return { linhas: JSON.parse(c.linhas), lido_em: c.lido_em, da_copia: true, desatualizada: true }; throw erro(503, 'GAOCG não configurado.'); }
  try {
    const r = await criar().consultar(endpoint, filtros);
    db.run('INSERT INTO gaocg_cache (chave, endpoint, filtros, linhas, total, ms, lido_em) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chave) DO UPDATE SET linhas = excluded.linhas, total = excluded.total, ms = excluded.ms, lido_em = excluded.lido_em', chave, endpoint, JSON.stringify(filtros || {}), JSON.stringify(r.linhas), r.linhas.length, r.ms, agora());
    marcarUso(db, o.usuario);
    return { linhas: r.linhas, lido_em: agora(), da_copia: false };
  } catch (e) {
    if (c) return { linhas: JSON.parse(c.linhas), lido_em: c.lido_em, da_copia: true, desatualizada: true, aviso: String(e.message).slice(0, 160) };
    throw erro(502, String(e.message || e).slice(0, 200));
  }
}

// Quais nomes de campo o GAOCG devolve (só os nomes, sem valores), para conferir o mapeamento.
async function campos(db, endpoint, usuario) {
  const r = await ler(db, endpoint, { pageSize: 3 }, { usuario });
  return { total_amostra: r.linhas.length, campos: [...new Set(r.linhas.flatMap((l) => Object.keys(l || {})))] };
}

const NUMCG = /(\d{1,3})\s*\/\s*(\d{4})/;
const numeroCg = (s) => { const m = NUMCG.exec(String(s || '')); return m ? m[1].padStart(3, '0') + '/' + m[2] : null; };

// Acha a unidade do GAOCG que corresponde ao contrato do CTAI: primeiro pelo número do contrato, depois pelo nome.
function casar(linhas, contrato) {
  const alvoCg = numeroCg(contrato.numero_cg);
  const nome = norm(contrato.unidade);
  let achada = null;
  if (alvoCg) achada = linhas.find((l) => Object.values(l).some((v) => typeof v === 'string' && numeroCg(v) === alvoCg));
  if (!achada && nome) achada = linhas.find((l) => { const n = norm(campo(l, ['unidade', 'nome', 'nomeunidade'])); return n && (n === nome || n.includes(nome) || nome.includes(n)); });
  return achada || null;
}

function dadosDaUnidade(l) {
  const v = {
    oss: campo(l, ['oss', 'organizacaosocial', 'nomeoss']),
    contrato: campo(l, ['numerocontrato', 'numerocg', 'contratodegestao', 'contrato']),
    vigencia_inicio: campo(l, ['vigenciainicio', 'iniciovigencia', 'datainicio']),
    vigencia_fim: campo(l, ['vigenciafim', 'fimvigencia', 'vigenciafinal', 'terminovigencia', 'datafim']),
    repasse_mensal: campo(l, ['repassemensal', 'valormensal', 'valorparcela', 'parcelamensal']),
    endereco: campo(l, ['endereco', 'logradouro']),
  };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null));
}

async function unidadeDoContrato(db, contratoId, usuario) {
  const ct = db.get('SELECT * FROM contratos WHERE contrato_id = ?', contratoId);
  if (!ct) throw erro(404, 'Contrato não encontrado.');
  const r = await ler(db, 'api_unidades', {}, { usuario });
  const l = casar(r.linhas, ct);
  return { encontrada: !!l, dados: l ? dadosDaUnidade(l) : null, lido_em: r.lido_em, da_copia: !!r.da_copia, desatualizada: !!r.desatualizada, aviso: r.aviso || null };
}

const fimDoMes = (comp) => { const [a, m] = String(comp).split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const isoData = (s) => { const t = String(s || ''); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[1] + '-' + m[2] + '-' + m[3]; m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; };

// Conferências do parecer com o cadastro do GAOCG (achados no formato do Analista).
async function conferirParecer(db, c, textoModelo, usuario) {
  const mk = (gravidade, tipo, trecho, risco, sugestao) => ({ gravidade, tipo, trecho, risco, sugestao, origem: 'GAOCG' });
  if (!ligada() && !db.get('SELECT 1 FROM gaocg_cache WHERE endpoint = ?', 'api_unidades')) return { achados: [], usado: false };
  let u;
  try { u = await unidadeDoContrato(db, c.identificacao.contrato_id, usuario); } catch (e) { return { achados: [mk('BAIXA', 'GAOCG indisponível', 'GAOCG', 'Não foi possível conferir com o cadastro do GAOCG agora: ' + e.message, 'Tente de novo mais tarde.')], usado: false }; }
  if (!u.encontrada) return { achados: [mk('MÉDIA', 'Unidade não encontrada no GAOCG', c.identificacao.unidade, 'Não achei esta unidade/contrato no cadastro do GAOCG (por número do contrato nem por nome).', 'Confira o número do contrato e o nome da unidade nos dois cadastros.')], usado: true, lido_em: u.lido_em };
  const d = u.dados, out = [];
  const textoNorm = norm(textoModelo);
  if (d.oss && !textoNorm.includes(norm(d.oss))) out.push(mk('MÉDIA', 'OSS diferente do GAOCG', String(d.oss), 'O GAOCG registra a OSS "' + d.oss + '", que não aparece no texto do parecer.', 'Confirme o nome da OSS.'));
  const cgs = [...String(textoModelo).matchAll(/Contrato de Gest[ãa]o(?: n\.?[ºo°]?)?\s*(\d{1,3}\s*\/\s*\d{4})/gi)].map((m) => numeroCg(m[1]));
  const cgGaocg = numeroCg(d.contrato);
  if (cgGaocg) for (const x of new Set(cgs)) if (x !== cgGaocg) out.push(mk('ALTA', 'Número do contrato diferente do GAOCG', x, 'O texto cita o contrato ' + x + ' e o GAOCG registra ' + cgGaocg + '.', 'Corrija o número do contrato.'));
  const fim = isoData(d.vigencia_fim), ult = c.identificacao.competencias.slice().sort().pop();
  if (fim && ult && fim < fimDoMes(ult)) out.push(mk('ALTA', 'Vigência anterior ao período', 'vigência', 'O GAOCG registra o fim da vigência em ' + fim.split('-').reverse().join('/') + ', antes do fim do período analisado (' + ult + ').', 'Verifique termo aditivo de prorrogação.'));
  return { achados: out, usado: true, lido_em: u.lido_em, da_copia: u.da_copia };
}

module.exports = { carregar, salvarConfig, estado, testar, ler, campos, unidadeDoContrato, conferirParecer, dadosDaUnidade, casar, campo, ligada };
