'use strict';
// Contratos e Termos Aditivos (Google Drive da diretoria): leitura pelo servidor, ligação com cada unidade e quadro do contrato conferido pela pessoa.
// Regras: (1) só leitura e só pelo servidor (o navegador nunca chama o script); (2) a chave é OPCIONAL (documentos públicos): vazia, não é enviada;
// (3) a IA só propõe: tudo nasce 'rascunho' e só vale depois que a pessoa da carteira confirma; (4) o texto lido é mascarado antes de guardar ou ir à nuvem;
// (5) aviso na Caixa de entrada quando aparece arquivo novo ou alterado na pasta da unidade (checado ao abrir a unidade e no Testar, sem agendador).
const { criar: criarAdaptador } = require('../adapters/contratos-drive');
const IA = require('./ia-config');
const trilha = require('./trilha');
const CART = require('./carteira');
const CAIXA = require('./caixa');
const U = require('../core/util');
const { mascarar } = require('./mascara');
const { erro } = require('./auth');

const TTL_MS = 3600 * 1000;
const TIPO_DOC = 'application/vnd.google-apps.document';
const TIPOS = ['contrato', 'aditivo', 'outro'];
const CATEGORIAS = ['valor', 'repasse', 'meta', 'indicador', 'desconto', 'art15a', 'vigencia', 'outro'];
const EFEITOS = ['novo', 'altera', 'revoga', 'mantem'];
const agora = () => new Date().toISOString();
const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isoData = (v) => { const t = String(v || '').trim(); if (!t) return null; let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[0]; m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t); return m ? m[3] + '-' + m[2] + '-' + m[1] : undefined; };
let origem = null; // 'servidor' (variáveis da hospedagem) ou 'tela' (digitado pela administração)

// ---------- configuração ----------
function carregar(db) {
  if (origem !== 'tela' && process.env.CONTRATOS_DRIVE_URL) { origem = 'servidor'; return; }
  const c = db.get('SELECT url, chave_cifrada FROM contratos_drive_config WHERE id = 1');
  if (!c) return;
  process.env.CONTRATOS_DRIVE_URL = c.url;
  const chave = c.chave_cifrada ? IA.decifrar(c.chave_cifrada) : '';
  if (chave) process.env.CONTRATOS_DRIVE_CHAVE = chave; else delete process.env.CONTRATOS_DRIVE_CHAVE;
  origem = 'tela';
}
function salvarConfig(db, usuario, b) {
  const url = String((b && b.url) || '').trim(), chave = String((b && b.chave) || '').trim();
  if (!/^https:\/\/\S+$/.test(url)) throw erro(400, 'O endereço deve começar com https:// (é o link terminado em /exec).');
  if (chave && (chave.length < 8 || /\s/.test(chave))) throw erro(400, 'A chave parece incompleta. Cole a chave inteira, sem espaços, ou deixe em branco se o script não exige chave.');
  const cifrada = chave ? IA.cifrar(chave) : null, final = chave ? chave.slice(-4) : null;
  db.run('INSERT INTO contratos_drive_config (id, url, chave_cifrada, final, atualizado_em, atualizado_por) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, chave_cifrada = excluded.chave_cifrada, final = excluded.final, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por',
    url, cifrada, final, agora(), usuario.login);
  origem = 'tela'; process.env.CONTRATOS_DRIVE_URL = url;
  if (chave) process.env.CONTRATOS_DRIVE_CHAVE = chave; else delete process.env.CONTRATOS_DRIVE_CHAVE;
  db.run('DELETE FROM contratos_drive_cache');
  trilha.registrar(db, { usuario: usuario.login, tabela: 'contratos_drive', registro: 'conexao', campo: 'configuracao', valor_novo: chave ? 'endereço e chave final ' + final : 'endereço, sem chave' });
  return { ok: true, final, com_chave: !!chave };
}
const ligada = () => criarAdaptador().ligada;

function estado(db) {
  const e = db.get('SELECT * FROM contratos_drive_estado WHERE id = 1') || {};
  const cfg = db.get('SELECT final, atualizado_em FROM contratos_drive_config WHERE id = 1');
  return { configurada: ligada(), origem, com_chave: !!String(process.env.CONTRATOS_DRIVE_CHAVE || '').trim(), chave_final: origem === 'tela' && cfg ? cfg.final : null, trocada_em: origem === 'tela' && cfg ? cfg.atualizado_em : null,
    teste: e.teste_em ? { em: e.teste_em, ok: !!e.teste_ok, ms: e.teste_ms, mensagem: e.teste_msg } : null };
}

// ---------- termos de busca e classificação dos arquivos ----------
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no', 'unidade', 'pernambucana', 'pe']);
// "UPAE Palmares" -> ["upae palmares", "palmares"]. A busca do script exige todas as palavras no nome ou no caminho das pastas.
function termosDaUnidade(nome) {
  const palavras = norm(nome).split(' ').filter((w) => w && !VAZIAS.has(w));
  if (!palavras.length) return [];
  const completo = palavras.slice(0, 4).join(' ');
  const distintiva = palavras.filter((w) => w.length >= 4 && !['upae', 'upa', 'hospital', 'geral', 'regional', 'policlinica'].includes(w)).pop();
  return [...new Set([completo].concat(distintiva ? [distintiva] : []))];
}
function classificar(nome, caminho) {
  const n = norm(nome), c = norm(caminho);
  const ord = /(\d{1,2})\s*(?:o|a|º|°)?\s*(?:termo aditivo|aditivo|ta\b)/.exec(n) || /(?:termo aditivo|aditivo|\bta)\s*(?:n\s*)?(\d{1,2})\b/.exec(n) || /(\d{1,2})\s*(?:o|a)?\s*(?:termo aditivo|aditivo)/.exec(c);
  if (/aditiv|\bta\b/.test(n) || ord) return { tipo: 'aditivo', numero: ord ? Number(ord[1]) : null };
  if (/contrato/.test(n)) return { tipo: 'contrato', numero: null };
  if (/aditiv/.test(c)) return { tipo: 'aditivo', numero: null };
  return { tipo: 'outro', numero: null };
}
const peso = (a) => (a.tipo === 'contrato' ? 0 : a.tipo === 'aditivo' ? (a.numero || 900) : 5000);
const ordenar = (a, b) => (peso(a) - peso(b)) || String(a.atualizado_em || '').localeCompare(String(b.atualizado_em || '')) || a.nome.localeCompare(b.nome, 'pt-BR');
const rotuloDoc = (d) => (d.tipo === 'contrato' ? 'Contrato' : d.tipo === 'aditivo' ? (d.numero_aditivo ? d.numero_aditivo + 'º Termo Aditivo' : 'Termo Aditivo') : 'Outro documento');

function exigirUnidade(db, usuario, contratoId) {
  const c = db.get('SELECT contrato_id, unidade, oss, demo FROM contratos WHERE contrato_id = ?', String(contratoId || ''));
  if (!c) throw erro(404, 'Unidade não encontrada.');
  CART.exigir(db, usuario, c.contrato_id);
  return c;
}

// ---------- lista da pasta ----------
async function listarTermo(db, termo, forcar) {
  const c = db.get('SELECT * FROM contratos_drive_cache WHERE termo = ?', termo);
  if (c && !forcar && Date.now() - Date.parse(c.lido_em) < TTL_MS) return { arquivos: JSON.parse(c.arquivos), lido_em: c.lido_em, da_copia: true };
  if (!ligada()) { if (c) return { arquivos: JSON.parse(c.arquivos), lido_em: c.lido_em, da_copia: true, desatualizada: true }; throw erro(503, 'A pasta de contratos ainda não foi ligada. A administração guarda o endereço em Integrações.'); }
  try {
    const r = await criarAdaptador().listar(termo);
    db.run('INSERT INTO contratos_drive_cache (termo, arquivos, lido_em) VALUES (?,?,?) ON CONFLICT(termo) DO UPDATE SET arquivos = excluded.arquivos, lido_em = excluded.lido_em', termo, JSON.stringify(r.arquivos), agora());
    return { arquivos: r.arquivos, lido_em: agora(), da_copia: false, ms: r.ms };
  } catch (e) {
    if (c) return { arquivos: JSON.parse(c.arquivos), lido_em: c.lido_em, da_copia: true, desatualizada: true, aviso: String(e.message).slice(0, 160) };
    throw erro(502, String(e.message || e).slice(0, 200));
  }
}

// Aviso de arquivo novo ou alterado. A primeira consulta de uma unidade só grava a base (sem aviso). Devolve o que mudou.
function conferirNovidades(db, c, arquivos, termo) {
  const t = agora();
  const ja = db.get('SELECT 1 AS x FROM contrato_pasta_estado WHERE contrato_id = ?', c.contrato_id);
  const novidades = [];
  db.tx(() => {
    for (const a of arquivos) {
      const antes = db.get('SELECT atualizado_em FROM contrato_pasta WHERE contrato_id = ? AND drive_id = ?', c.contrato_id, a.id);
      if (ja && (!antes || (antes.atualizado_em || '') !== (a.atualizado_em || ''))) novidades.push({ arquivo: a, novo: !antes });
      db.run('INSERT INTO contrato_pasta (contrato_id, drive_id, nome, caminho, tipo, url, atualizado_em, visto_em) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(contrato_id, drive_id) DO UPDATE SET nome = excluded.nome, caminho = excluded.caminho, tipo = excluded.tipo, url = excluded.url, atualizado_em = excluded.atualizado_em, visto_em = excluded.visto_em',
        c.contrato_id, a.id, a.nome, a.caminho, a.tipo, a.url, a.atualizado_em, t);
    }
    const ultima = arquivos.map((a) => a.atualizado_em).filter(Boolean).sort().pop() || null;
    db.run('INSERT INTO contrato_pasta_estado (contrato_id, verificado_em, termo, total, pasta_atualizada_em) VALUES (?,?,?,?,?) ON CONFLICT(contrato_id) DO UPDATE SET verificado_em = excluded.verificado_em, termo = excluded.termo, total = excluded.total, pasta_atualizada_em = excluded.pasta_atualizada_em', c.contrato_id, t, termo, arquivos.length, ultima);
  });
  const destinos = novidades.length ? CAIXA.destinosDaUnidade(db, c.contrato_id) : [];
  for (const n of novidades) {
    CAIXA.criar(db, { chave: 'aditivo:' + c.contrato_id + ':' + n.arquivo.id + ':' + (n.arquivo.atualizado_em || ''), tipo: 'aditivo_novo', contrato_id: c.contrato_id,
      titulo: (n.novo ? 'Novo arquivo na pasta de contratos: ' : 'Arquivo alterado na pasta de contratos: ') + c.unidade,
      texto: n.arquivo.nome + (n.arquivo.atualizado_em ? ' · atualizado em ' + n.arquivo.atualizado_em.slice(0, 10).split('-').reverse().join('/') : '') + '. Abra a unidade e leia o documento.', link: '#/u/' + c.contrato_id, destinos }, 'sistema');
  }
  return novidades.map((n) => ({ id: n.arquivo.id, nome: n.arquivo.nome, novo: n.novo }));
}

// Lista os arquivos da pasta que dizem respeito à unidade (por nome e caminho), na ordem: contrato, aditivos por número.
async function listarDaUnidade(db, usuario, contratoId, opc) {
  const o = opc || {};
  const c = exigirUnidade(db, usuario, contratoId);
  const manual = txt(o.termo, 80);
  const termos = manual ? [manual] : termosDaUnidade(c.unidade);
  if (!termos.length) throw erro(400, 'Não consegui montar um termo de busca a partir do nome da unidade.');
  let usado = termos[0], r = null;
  for (const t of termos) { r = await listarTermo(db, t, o.forcar); usado = t; if (r.arquivos.length) break; }
  const docs = db.all("SELECT doc_id, drive_id, estado, drive_atualizado_em FROM contrato_docs WHERE contrato_id = ? AND estado != 'substituido' ORDER BY doc_id", c.contrato_id);
  const arquivos = r.arquivos.map((a) => Object.assign({}, a, { classe: classificar(a.nome, a.caminho) })).map((a) => ({
    id: a.id, nome: a.nome, caminho: a.caminho, tipo: a.tipo, e_doc: a.tipo === TIPO_DOC, tipo_doc: a.classe.tipo, numero_aditivo: a.classe.numero, atualizado_em: a.atualizado_em, url: a.url, tamanho_kb: a.tamanho_kb,
  })).sort((a, b) => ordenar({ tipo: a.tipo_doc, numero: a.numero_aditivo, atualizado_em: a.atualizado_em, nome: a.nome }, { tipo: b.tipo_doc, numero: b.numero_aditivo, atualizado_em: b.atualizado_em, nome: b.nome }))
    .map((a) => { const d = docs.filter((x) => x.drive_id === a.id).pop(); return Object.assign(a, { lido: d ? { doc_id: d.doc_id, estado: d.estado } : null, mudou_depois_da_leitura: !!(d && d.drive_atualizado_em && a.atualizado_em && d.drive_atualizado_em !== a.atualizado_em) }); });
  let novidades = [];
  if (!manual && !r.da_copia) { try { novidades = conferirNovidades(db, c, r.arquivos, usado); } catch (_) { /* o aviso nunca derruba a tela */ } }
  const est = db.get('SELECT verificado_em, pasta_atualizada_em FROM contrato_pasta_estado WHERE contrato_id = ?', c.contrato_id) || {};
  return {
    contrato_id: c.contrato_id, unidade: c.unidade, termo: usado, termo_manual: !!manual, termos_tentados: termos, amplo: !manual && usado !== termos[0], arquivos, novidades,
    pasta_atualizada_em: arquivos.map((a) => a.atualizado_em).filter(Boolean).sort().pop() || est.pasta_atualizada_em || null, lido_em: r.lido_em, da_copia: !!r.da_copia, desatualizada: !!r.desatualizada, aviso: r.aviso || null,
  };
}

async function testar(db, usuario, termo) {
  let ok = false, ms = null, msg;
  try {
    const manual = txt(termo, 80);
    if (manual) { const r = await criarAdaptador().listar(manual); ok = true; ms = r.ms; msg = 'Conectado. ' + r.arquivos.length + ' arquivo(s) para "' + manual + '".'; }
    else {
      const escopo = CART.permitidos(db, usuario);
      const c = db.all('SELECT contrato_id, unidade FROM contratos ORDER BY demo, unidade').find((x) => !escopo || escopo.has(x.contrato_id));
      if (!c) { const r = await criarAdaptador().listar('aditivo'); ok = true; ms = r.ms; msg = 'Conectado. ' + r.arquivos.length + ' arquivo(s) para "aditivo".'; }
      else { const t0 = Date.now(); const l = await listarDaUnidade(db, usuario, c.contrato_id, { forcar: true }); ok = true; ms = Date.now() - t0; msg = 'Conectado. ' + l.arquivos.length + ' arquivo(s) para "' + l.termo + '" (' + c.unidade + ')' + (l.novidades.length ? ' · ' + l.novidades.length + ' novidade(s) avisada(s) na Caixa de entrada.' : '.'); }
    }
  } catch (e) { msg = String(e.message || e).slice(0, 200); }
  db.run('INSERT INTO contratos_drive_estado (id, teste_em, teste_ok, teste_ms, teste_msg) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET teste_em = excluded.teste_em, teste_ok = excluded.teste_ok, teste_ms = excluded.teste_ms, teste_msg = excluded.teste_msg', agora(), ok ? 1 : 0, ms, msg);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'contratos_drive', registro: 'conexao', campo: 'teste', valor_novo: ok ? 'ok' : 'falhou' });
  return { ok, ms, mensagem: msg };
}

// ---------- quadro do contrato (rascunho -> confirmado) ----------
const pontosDe = (db, id) => db.all('SELECT * FROM contrato_pontos WHERE doc_id = ? ORDER BY ordem, ponto_id', id).map((p) => Object.assign(p, { verificada: !!p.verificada }));
const cabeca = (d) => { const { texto, ...r } = d; return Object.assign(r, { tem_texto: !!texto, truncado: !!d.truncado, rotulo: rotuloDoc(d) }); };
function doc(db, usuario, id) {
  const d = db.get('SELECT * FROM contrato_docs WHERE doc_id = ?', Number(id));
  if (!d) throw erro(404, 'Quadro do contrato não encontrado.');
  CART.exigir(db, usuario, d.contrato_id);
  return d;
}
function gravarPontos(db, id, lista) {
  db.run('DELETE FROM contrato_pontos WHERE doc_id = ?', id);
  let ordem = 0;
  for (const p of Array.isArray(lista) ? lista.slice(0, 150) : []) {
    const titulo = txt(p.titulo, 160); if (!titulo) continue;
    db.run('INSERT INTO contrato_pontos (doc_id, categoria, titulo, valor, descricao, efeito, trecho, verificada, ordem) VALUES (?,?,?,?,?,?,?,?,?)', id, CATEGORIAS.includes(p.categoria) ? p.categoria : 'outro', titulo, txt(p.valor, 200) || null, txt(p.descricao, 600) || null,
      EFEITOS.includes(p.efeito) ? p.efeito : 'novo', txt(p.trecho, 400) || null, p.verificada ? 1 : 0, ordem++);
  }
}
function cabecalho(b, base) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : (base ? base.tipo : 'outro');
  const dt = (v, nome) => { if (v === undefined || v === null || v === '') return null; const x = isoData(v); if (x === undefined) throw erro(400, 'A data de "' + nome + '" deve estar no formato dd/mm/aaaa.'); return x; };
  let numero = b.numero_aditivo === undefined || b.numero_aditivo === null || b.numero_aditivo === '' ? null : Number(b.numero_aditivo);
  if (numero !== null && (!Number.isInteger(numero) || numero < 1 || numero > 99)) throw erro(400, 'O número do termo aditivo deve ser um inteiro de 1 a 99.');
  if (tipo !== 'aditivo') numero = null;
  const ini = dt(b.vigencia_inicio, 'início da vigência'), fim = dt(b.vigencia_fim, 'fim da vigência');
  if (ini && fim && fim < ini) throw erro(400, 'O fim da vigência é anterior ao início.');
  return { tipo, numero_aditivo: numero, data_doc: dt(b.data_doc, 'data do documento'), objeto: txt(b.objeto, 800) || null, vigencia_inicio: ini, vigencia_fim: fim, valor_total: txt(b.valor_total, 120) || null, muda: txt(b.muda, 800) || null };
}

// Lê o documento da pasta (Google Doc), mascara, propõe com IA (se houver) e deixa em rascunho. Nada vale até a pessoa confirmar.
async function lerDocumento(db, usuario, contratoId, driveId, opc) {
  const o = opc || {};
  const c = exigirUnidade(db, usuario, contratoId);
  const lista = await listarDaUnidade(db, usuario, c.contrato_id, { termo: o.termo });
  const arq = lista.arquivos.find((a) => a.id === String(driveId || ''));
  if (!arq) throw erro(400, 'Este arquivo não está na pasta desta unidade.');
  if (!arq.e_doc) throw erro(422, 'Só Google Docs são lidos. Este arquivo é um ' + (arq.tipo === 'application/pdf' ? 'PDF' : 'arquivo Word/outro') + '. Peça que o texto seja salvo como Google Doc na pasta (ou abra no Drive e use o quadro à mão).');
  const atual = db.get("SELECT * FROM contrato_docs WHERE contrato_id = ? AND drive_id = ? AND estado != 'substituido' ORDER BY doc_id DESC", c.contrato_id, arq.id);
  if (atual && atual.estado === 'confirmado' && atual.drive_atualizado_em === arq.atualizado_em) throw erro(409, 'Este documento já foi lido e confirmado, e não mudou no Drive desde então.');
  let lido;
  try { lido = await criarAdaptador().ler(arq.id); } catch (e) { throw erro(502, String(e.message || e).slice(0, 200)); }
  if (!lido.texto.trim()) throw erro(422, 'O documento está vazio ou o texto não pôde ser lido.');
  const m = mascarar(lido.texto);
  const propor = o.semIA ? { ok: false, motivo: 'Leitura por IA não usada. Preencha à mão.' } : await (o.propor || require('../modules/analista/propor-contrato').propor)({ texto: m.texto, nome: arq.nome, unidade: c.unidade });
  const cl = classificar(arq.nome, arq.caminho);
  const tipo = propor.ok && propor.tipo ? propor.tipo : cl.tipo, numero = propor.ok && propor.numero_aditivo ? propor.numero_aditivo : cl.numero;
  const hash = U.sha256(m.texto);
  const id = db.tx(() => {
    let alvo = null;
    if (atual && atual.estado === 'rascunho') { alvo = atual.doc_id; db.run('DELETE FROM contrato_pontos WHERE doc_id = ?', alvo); }
    const campos = [tipo, tipo === 'aditivo' ? numero : null, propor.ok ? propor.data_doc : null, propor.ok ? propor.objeto || null : null, propor.ok ? propor.vigencia_inicio : null, propor.ok ? propor.vigencia_fim : null, propor.ok ? propor.valor_total || null : null, propor.ok ? propor.muda || null : null];
    if (alvo) db.run('UPDATE contrato_docs SET nome = ?, caminho = ?, url = ?, drive_atualizado_em = ?, tipo = ?, numero_aditivo = ?, data_doc = ?, objeto = ?, vigencia_inicio = ?, vigencia_fim = ?, valor_total = ?, muda = ?, origem = ?, provedor = ?, hash = ?, texto = ?, truncado = ?, atualizado_em = ? WHERE doc_id = ?',
      arq.nome, arq.caminho, arq.url, arq.atualizado_em, ...campos, propor.ok ? 'ia' : 'manual', propor.ok ? propor.provedor : null, hash, m.texto, lido.truncado ? 1 : 0, agora(), alvo);
    else alvo = Number(db.run('INSERT INTO contrato_docs (contrato_id, drive_id, nome, caminho, url, drive_atualizado_em, tipo, numero_aditivo, data_doc, objeto, vigencia_inicio, vigencia_fim, valor_total, muda, estado, origem, provedor, hash, texto, truncado, substitui_id, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.contrato_id, arq.id, arq.nome, arq.caminho, arq.url, arq.atualizado_em, ...campos, 'rascunho', propor.ok ? 'ia' : 'manual', propor.ok ? propor.provedor : null, hash, m.texto, lido.truncado ? 1 : 0, atual ? atual.doc_id : null, usuario.login, agora(), agora()).lastInsertRowid);
    if (propor.ok) gravarPontos(db, alvo, propor.pontos);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'contrato_docs', registro: alvo, campo: 'leitura', valor_novo: { contrato: c.contrato_id, arquivo: arq.nome, caracteres: m.texto.length, mascarados: m.total, leitura: propor.ok ? 'IA (' + propor.provedor + ')' : 'em branco' } });
    return alvo;
  });
  return { doc_id: id, ia: { ok: !!propor.ok, provedor: propor.ok ? propor.provedor : null, motivo: propor.ok ? null : propor.motivo }, truncado: !!lido.truncado, mascarados: m.total };
}

function obter(db, usuario, id, comTexto) {
  const d = doc(db, usuario, id);
  const out = Object.assign(cabeca(d), { pontos: pontosDe(db, d.doc_id) });
  if (comTexto) out.texto = d.texto || '';
  return out;
}
function salvar(db, usuario, id, b) {
  const d = doc(db, usuario, id);
  if (d.estado !== 'rascunho') throw erro(409, 'Este quadro já foi confirmado e não pode mais ser editado.');
  const cab = cabecalho(b || {}, d);
  db.tx(() => {
    db.run('UPDATE contrato_docs SET tipo = ?, numero_aditivo = ?, data_doc = ?, objeto = ?, vigencia_inicio = ?, vigencia_fim = ?, valor_total = ?, muda = ?, atualizado_em = ? WHERE doc_id = ?', cab.tipo, cab.numero_aditivo, cab.data_doc, cab.objeto, cab.vigencia_inicio, cab.vigencia_fim, cab.valor_total, cab.muda, agora(), d.doc_id);
    gravarPontos(db, d.doc_id, (b || {}).pontos);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'contrato_docs', registro: d.doc_id, campo: 'rascunho_salvo', valor_novo: { tipo: cab.tipo, numero_aditivo: cab.numero_aditivo, pontos: ((b || {}).pontos || []).length } });
  });
  return obter(db, usuario, d.doc_id);
}
function confirmar(db, usuario, id) {
  const d = doc(db, usuario, id);
  if (d.estado === 'confirmado') throw erro(409, 'Este quadro já está confirmado.');
  if (d.estado !== 'rascunho') throw erro(409, 'Este quadro foi substituído por outro mais novo.');
  if (!d.objeto && !d.vigencia_fim && !d.valor_total && !d.muda && !pontosDe(db, d.doc_id).length) throw erro(400, 'Não há nada para confirmar: preencha ao menos o objeto, a vigência, o valor ou um ponto do quadro.');
  db.tx(() => {
    if (d.substitui_id) db.run("UPDATE contrato_docs SET estado = 'substituido', atualizado_em = ? WHERE doc_id = ? AND estado = 'confirmado'", agora(), d.substitui_id);
    db.run("UPDATE contrato_docs SET estado = 'confirmado', confirmado_por = ?, confirmado_em = ?, atualizado_em = ?, texto = NULL WHERE doc_id = ?", usuario.login, agora(), agora(), d.doc_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'contrato_docs', registro: d.doc_id, campo: 'confirmado', valor_novo: { contrato: d.contrato_id, tipo: d.tipo, numero_aditivo: d.numero_aditivo, arquivo: d.nome } });
  });
  return obter(db, usuario, d.doc_id);
}
function descartar(db, usuario, id) {
  const d = doc(db, usuario, id);
  if (d.estado !== 'rascunho') throw erro(409, 'Só rascunho pode ser descartado. O quadro confirmado não se apaga.');
  db.tx(() => {
    db.run('DELETE FROM contrato_pontos WHERE doc_id = ?', d.doc_id); db.run('DELETE FROM contrato_docs WHERE doc_id = ?', d.doc_id);
    trilha.registrar(db, { usuario: usuario.login, tabela: 'contrato_docs', registro: d.doc_id, campo: 'rascunho_descartado', valor_anterior: { contrato: d.contrato_id, arquivo: d.nome } });
  });
}

// "O que vale hoje": aplica o contrato e depois cada aditivo, em ordem. Cada ponto novo ou alterado substitui o anterior de mesmo assunto; "revoga" retira.
// Enquanto algum quadro for rascunho, o resultado é uma PROPOSTA (marcada), nunca valor confirmado.
function valeHoje(docs, pontosPorDoc) {
  const mapa = new Map(); const revogados = [];
  let vigIni = null, vigFim = null, valor = null;
  for (const d of docs) {
    if (d.vigencia_inicio && (!vigIni || d.tipo === 'contrato')) vigIni = { valor: d.vigencia_inicio, doc: rotuloDoc(d), confirmado: d.estado === 'confirmado' };
    if (d.vigencia_fim) vigFim = { valor: d.vigencia_fim, doc: rotuloDoc(d), confirmado: d.estado === 'confirmado' };
    if (d.valor_total) valor = { valor: d.valor_total, doc: rotuloDoc(d), confirmado: d.estado === 'confirmado' };
    for (const p of pontosPorDoc[d.doc_id] || []) {
      const chave = p.categoria + '|' + norm(p.titulo);
      if (p.efeito === 'revoga') { if (mapa.delete(chave)) revogados.push({ categoria: p.categoria, titulo: p.titulo, doc: rotuloDoc(d), confirmado: d.estado === 'confirmado' }); continue; }
      mapa.set(chave, { categoria: p.categoria, titulo: p.titulo, valor: p.valor, descricao: p.descricao, trecho: p.trecho, doc_id: d.doc_id, doc: rotuloDoc(d), efeito: p.efeito, confirmado: d.estado === 'confirmado', verificada: !!p.verificada });
    }
  }
  const pontos = [...mapa.values()].sort((a, b) => CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
  const tudo = docs.length > 0 && docs.every((d) => d.estado === 'confirmado');
  return { vigencia_inicio: vigIni, vigencia_fim: vigFim, valor_total: valor, pontos, revogados, tudo_confirmado: tudo, proposta: !tudo };
}
function quadro(db, usuario, contratoId) {
  const c = exigirUnidade(db, usuario, contratoId);
  const docs = db.all("SELECT * FROM contrato_docs WHERE contrato_id = ? AND estado != 'substituido'", c.contrato_id)
    .sort((a, b) => ordenar({ tipo: a.tipo, numero: a.numero_aditivo, atualizado_em: a.data_doc || a.criado_em, nome: a.nome || '' }, { tipo: b.tipo, numero: b.numero_aditivo, atualizado_em: b.data_doc || b.criado_em, nome: b.nome || '' }));
  const pontos = {}; for (const d of docs) pontos[d.doc_id] = pontosDe(db, d.doc_id);
  return { contrato_id: c.contrato_id, unidade: c.unidade, documentos: docs.map((d) => Object.assign(cabeca(d), { pontos: pontos[d.doc_id].length })), vale_hoje: valeHoje(docs, pontos),
    confirmados: docs.filter((d) => d.estado === 'confirmado').length, rascunhos: docs.filter((d) => d.estado === 'rascunho').length };
}

module.exports = { carregar, salvarConfig, estado, testar, listarDaUnidade, lerDocumento, obter, salvar, confirmar, descartar, quadro, valeHoje, termosDaUnidade, classificar, ligada, TIPOS, CATEGORIAS, EFEITOS };
