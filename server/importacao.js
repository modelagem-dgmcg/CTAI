'use strict';
// Importação em lote de unidades e carteira (Gestão CTAI).
// O arquivo CSV tem as colunas: tipo (UPA/UPAE/Hospital), unidade, municipio (opcional), analista (login ou nome; vários separados por "|").
// Uma unidade é identificada por tipo + nome + município ("Caruaru" UPA e "Caruaru" UPAE são unidades diferentes).
// planejar() só calcula (prévia). gravar() refaz o plano com as decisões da superintendente e grava tudo numa única transação.
const crypto = require('crypto');
const L = require('../core/linhas');
const A = require('./auth');
const CART = require('./carteira');
const trilha = require('./trilha');
const config = require('./config');

const { erro } = A;
const TIPOS = ['UPA', 'UPAE', 'HOSPITAL'];
const ROTULO = { UPA: 'UPA', UPAE: 'UPAE', HOSPITAL: 'Hospital' };
const MODOS = ['acrescentar', 'substituir'];

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-').toUpperCase();
const slugLogin = (s) => norm(s).replace(/ /g, '.').slice(0, 40);

function tipoDe(v) {
  const t = norm(v).replace(/ /g, '');
  if (t === 'hospital' || t === 'hosp') return 'HOSPITAL';
  if (t === 'upa') return 'UPA';
  if (t === 'upae') return 'UPAE';
  return null;
}

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Nome de exibição: "UPAE Caruaru" (o tipo vira prefixo, sem duplicar se o arquivo já trouxe).
function nomeLimpo(tipo, nome) {
  const n = String(nome).replace(/\s+/g, ' ').trim();
  const pre = new RegExp('^' + (tipo === 'HOSPITAL' ? 'hospital' : tipo.toLowerCase()) + '\\b[\\s\\-:]*', 'i');
  return n.replace(pre, '').trim() || n;
}
const exibicao = (tipo, nome) => ROTULO[tipo] + ' ' + nome;
const idDa = (tipo, nome, municipio) => {
  const n = slug(nome), m = municipio ? slug(municipio) : '';
  return tipo + '-' + n + (m && m !== n ? '-' + m : '');
};
const chaveDe = (tipo, nome, municipio) => tipo + '|' + norm(nome) + '|' + (municipio && norm(municipio) !== norm(nome) ? norm(municipio) : '');

function unidadesExistentes(db) {
  const mapa = new Map();
  for (const c of db.all('SELECT contrato_id, unidade, tipo, municipio FROM contratos')) {
    const t = c.tipo ? tipoDe(c.tipo) : null;
    if (t) mapa.set(chaveDe(t, nomeLimpo(t, c.unidade), c.municipio), c);
    mapa.set('id|' + c.contrato_id, c);
  }
  return mapa;
}

function achaUsuario(db, valor) {
  const v = String(valor).trim();
  const us = db.all('SELECT usuario_id, login, nome, perfil, ativo FROM usuarios');
  const porLogin = us.find((u) => u.login === v.toLowerCase());
  if (porLogin) return porLogin;
  const n = norm(v);
  const porNome = us.filter((u) => norm(u.nome) === n);
  if (porNome.length === 1) return porNome[0];
  if (porNome.length > 1) return { ambiguo: true };
  return null;
}

// Lê o CSV e devolve as linhas já validadas.
function lerLinhas(texto) {
  const { cabecalho, registros } = L.lerCSV(texto);
  const col = {};
  for (const c of cabecalho) col[norm(c).replace(/ /g, '_')] = c;
  const achar = (...nomes) => { for (const n of nomes) if (col[n]) return col[n]; return null; };
  const cT = achar('tipo'), cU = achar('unidade', 'nome_da_unidade'), cM = achar('municipio'), cA = achar('analista', 'responsavel_ctai');
  if (!cT || !cU) throw erro(400, 'O arquivo precisa ter as colunas "tipo" e "unidade" (e, se quiser, "municipio" e "analista"). Baixe o modelo.');
  const brutas = String(texto).replace(/^\uFEFF/, '').replace(/(\r?\n)+$/, '').split(/\r?\n/).length - 1;
  return { registros, cT, cU, cM, cA, semAnalista: !cA, vaziasBrutas: Math.max(0, brutas - registros.length) };
}

function planejar(db, entrada) {
  const modo = MODOS.includes(entrada.modo) ? entrada.modo : 'acrescentar';
  const dec = entrada.decisoes || {};
  const decConf = dec.conflitos || {}, decAn = dec.analistas || {};
  const { registros, cT, cU, cM, cA, vaziasBrutas } = lerLinhas(entrada.csv);
  const exist = unidadesExistentes(db);

  const erros = [], avisos = [];
  let vazias = vaziasBrutas;
  const unidades = new Map(); // chave -> {key,...,analistas:Set(valor original normalizado)}
  const valoresAnalista = new Map(); // norm(valor) -> {valor, linhas:[]}

  registros.forEach((r, i) => {
    const linha = i + 2;
    const t = r[cT], nm = r[cU], mn = cM ? r[cM] : '', an = cA ? r[cA] : '';
    if (![t, nm, mn, an].some((x) => String(x || '').trim())) { vazias++; return; }
    const tipo = tipoDe(t);
    if (!String(t || '').trim()) return erros.push({ linha, motivo: 'Tipo em branco (use UPA, UPAE ou Hospital).' });
    if (!tipo) return erros.push({ linha, motivo: 'Tipo inválido: "' + t + '" (use UPA, UPAE ou Hospital).' });
    if (!String(nm || '').trim()) return erros.push({ linha, motivo: 'Unidade em branco.' });
    const nome = nomeLimpo(tipo, nm);
    const municipio = String(mn || '').replace(/\s+/g, ' ').trim() || null;
    const key = chaveDe(tipo, nome, municipio);
    let u = unidades.get(key);
    if (!u) { u = { key, tipo, nome, municipio, linhas: [], analistas: new Map() }; unidades.set(key, u); }
    u.linhas.push(linha);
    const nomes = String(an || '').split('|').map((x) => x.trim()).filter(Boolean);
    if (!nomes.length) avisos.push({ linha, motivo: 'Sem analista: a unidade ' + exibicao(tipo, nome) + ' ficará sem carteira.' });
    for (const v of nomes) {
      const nv = norm(v);
      if (u.analistas.has(nv)) { avisos.push({ linha, motivo: 'Repetida na mesma carteira (ignorada): ' + exibicao(tipo, nome) + ' / ' + v + '.' }); continue; }
      u.analistas.set(nv, v);
      if (!valoresAnalista.has(nv)) valoresAnalista.set(nv, { valor: v, linhas: [] });
      valoresAnalista.get(nv).linhas.push(linha);
    }
  });

  // Unidade repetida com a mesma chave sem analista novo: já tratada acima (linhas > 1).
  for (const u of unidades.values()) if (u.linhas.length > 1 && u.analistas.size <= 1) avisos.push({ linha: u.linhas[1], motivo: 'Linha repetida de ' + exibicao(u.tipo, u.nome) + ' (mantida uma só).' });

  // Nomes parecidos (mesmo tipo, nomes diferentes por pouco) e mesmo nome em tipos diferentes.
  const lista = [...unidades.values()];
  for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
    const a = lista[i], b = lista[j];
    if (a.tipo === b.tipo && a.key !== b.key) {
      const na = norm(a.nome), nb = norm(b.nome);
      if (na === nb) avisos.push({ linha: b.linhas[0], motivo: exibicao(a.tipo, a.nome) + ' aparece em municípios diferentes (' + (a.municipio || '—') + ' e ' + (b.municipio || '—') + '): serão tratadas como unidades distintas.' });
      else if (distancia(na, nb) <= 2) avisos.push({ linha: b.linhas[0], motivo: 'Nomes parecidos: "' + exibicao(a.tipo, a.nome) + '" e "' + exibicao(b.tipo, b.nome) + '". Confirme que são unidades diferentes.' });
    }
  }
  const porNome = {};
  for (const u of lista) (porNome[norm(u.nome)] = porNome[norm(u.nome)] || []).push(u);
  for (const g of Object.values(porNome)) { const tipos = [...new Set(g.map((u) => u.tipo))]; if (tipos.length > 1) avisos.push({ linha: g[0].linhas[0], motivo: '"' + g[0].nome + '" existe como ' + tipos.map((t) => ROTULO[t]).join(' e ') + ': são unidades diferentes (tipo faz parte da identidade).' }); }

  // Analistas
  const analistas = [];
  const porValor = new Map(); // nv -> {usuario|null, decisao, login}
  const loginsNovos = new Set();
  for (const [nv, info] of valoresAnalista) {
    const u = achaUsuario(db, info.valor);
    const reg = { valor: info.valor, nv, linhas: info.linhas };
    if (u && u.ambiguo) { reg.problema = 'Mais de uma pessoa com esse nome. Use o login.'; reg.situacao = 'ambiguo'; }
    else if (u && !CART.ELEGIVEIS.includes(u.perfil)) { reg.problema = 'Esse usuário é ' + u.perfil + ' e não tem carteira (só criador e colega).'; reg.situacao = 'inelegivel'; }
    else if (u && !u.ativo) { reg.problema = 'Usuário desativado.'; reg.situacao = 'inativo'; }
    else if (u) { reg.situacao = 'existe'; reg.login = u.login; reg.nome = u.nome; reg.usuario_id = u.usuario_id; }
    else {
      reg.situacao = 'nao_existe';
      let login = /^[a-z0-9._-]{3,40}$/.test(info.valor) ? info.valor : slugLogin(info.valor);
      if (login.length < 3) login = login + '.ctai';
      let n = login, k = 2;
      while (db.get('SELECT 1 FROM usuarios WHERE login = ?', n) || loginsNovos.has(n)) n = login.slice(0, 36) + (k++);
      loginsNovos.add(n);
      reg.loginProposto = n;
      reg.nomeProposto = /^[a-z0-9._-]+$/.test(info.valor) ? info.valor : info.valor.replace(/\s+/g, ' ');
      reg.decisao = decAn[info.valor] === 'criar' || decAn[nv] === 'criar' ? 'criar' : (decAn[info.valor] === 'pular' || decAn[nv] === 'pular' ? 'pular' : null);
    }
    analistas.push(reg); porValor.set(nv, reg);
  }

  // Atribuições desejadas por unidade (apenas analistas utilizáveis)
  const usavel = (reg) => reg.situacao === 'existe' || (reg.situacao === 'nao_existe' && reg.decisao === 'criar');
  const idDe = (reg) => reg.login || reg.loginProposto;

  const plano = [];
  for (const u of lista) {
    const ex = exist.get(u.key) || exist.get('id|' + idDa(u.tipo, u.nome, u.municipio));
    const contrato_id = ex ? ex.contrato_id : idDa(u.tipo, u.nome, u.municipio);
    const doArquivo = [...u.analistas.keys()].map((nv) => porValor.get(nv)).filter(usavel).map(idDe);
    const atuais = ex ? CART.responsaveis(db, contrato_id).map((x) => x.login) : [];
    const pul = [...u.analistas.keys()].map((nv) => porValor.get(nv)).filter((r) => !usavel(r));
    plano.push({ key: u.key, contrato_id, tipo: u.tipo, nome: u.nome, municipio: u.municipio, exibicao: exibicao(u.tipo, u.nome), existente: !!ex, doArquivo, atuais, ignoradosAnalistas: pul.map((r) => r.valor), linhas: u.linhas });
  }

  // Conflitos: a unidade ganha uma nova responsabilidade e terminaria com mais de um analista.
  const conflitos = [];
  for (const p of plano) {
    const novas = p.doArquivo.filter((l) => !p.atuais.includes(l));
    const finais = [...new Set(p.doArquivo.concat(p.atuais))];
    // no modo substituir, quem está no arquivo (como analista) e não recebeu esta unidade a perde; os demais atuais ficam
    let manterAtuais = p.atuais;
    if (modo === 'substituir') { const presentes = new Set(analistas.filter(usavel).map(idDe)); manterAtuais = p.atuais.filter((l) => !presentes.has(l) || p.doArquivo.includes(l)); }
    const finalSet = [...new Set(p.doArquivo.concat(manterAtuais))];
    p.finais = finalSet;
    if (novas.length && finalSet.length > 1) {
      const d = decConf[p.key] || decConf[p.contrato_id];
      const opcoes = ['dividir'].concat(finalSet);
      const c = { key: p.key, contrato_id: p.contrato_id, unidade: p.exibicao, atuais: manterAtuais, novos: p.doArquivo, opcoes, decisao: d && opcoes.includes(d) ? d : null };
      conflitos.push(c);
      if (c.decisao === 'dividir') p.finais = finalSet;
      else if (c.decisao) p.finais = [c.decisao];
    }
  }
  const conflitoSem = (p) => conflitos.find((c) => c.key === p.key && !c.decisao);

  // Pendências que impedem gravar sem decisão
  const pendencias = [];
  for (const a of analistas) if (a.situacao === 'nao_existe' && !a.decisao) pendencias.push({ tipo: 'analista', valor: a.valor, texto: 'Analista "' + a.valor + '" não existe: criar ou pular?' });
  for (const a of analistas) if (['ambiguo', 'inelegivel', 'inativo'].includes(a.situacao)) pendencias.push({ tipo: 'analista_invalido', valor: a.valor, texto: 'Analista "' + a.valor + '": ' + a.problema, bloqueia: true });
  for (const c of conflitos) if (!c.decisao) pendencias.push({ tipo: 'conflito', key: c.key, texto: c.unidade + ' está em mais de uma carteira: dividir ou manter só uma?' });

  // Contagens
  const porTipo = { UPA: 0, UPAE: 0, HOSPITAL: 0 };
  for (const p of plano) porTipo[p.tipo]++;
  const porAnalista = {};
  const conta = (login, p) => { const o = porAnalista[login] = porAnalista[login] || { login, UPA: 0, UPAE: 0, HOSPITAL: 0, total: 0 }; o[p.tipo]++; o.total++; };
  for (const p of plano) {
    const sem = conflitoSem(p);
    if (sem) continue;
    for (const l of p.finais.filter((x) => p.doArquivo.includes(x))) conta(l, p);
  }
  const saidas = [];
  const entradas = [];
  const finalPorLogin = new Map();
  for (const p of plano) {
    if (conflitoSem(p)) continue;
    for (const l of p.finais) { if (!finalPorLogin.has(l)) finalPorLogin.set(l, new Set()); finalPorLogin.get(l).add(p.contrato_id); }
    for (const l of p.finais) if (!p.atuais.includes(l)) entradas.push({ login: l, contrato_id: p.contrato_id, unidade: p.exibicao });
    for (const l of p.atuais) if (!p.finais.includes(l)) saidas.push({ login: l, contrato_id: p.contrato_id, unidade: p.exibicao });
  }
  // modo substituir: o que o analista tinha e não está mais no arquivo
  const substituiSaidas = [];
  if (modo === 'substituir') {
    for (const a of analistas.filter((x) => x.situacao === 'existe')) {
      const tinha = CART.doUsuario(db, a.usuario_id);
      const fica = finalPorLogin.get(a.login) || new Set();
      for (const c of tinha) if (!fica.has(c) && !plano.some((p) => p.contrato_id === c && !conflitoSem(p))) {
        const ct = db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', c);
        substituiSaidas.push({ login: a.login, contrato_id: c, unidade: ct ? ct.unidade : c });
      }
    }
  }
  const todasSaidas = saidas.concat(substituiSaidas);
  for (const a of Object.values(porAnalista)) { const r = analistas.find((x) => idDe(x) === a.login); a.nome = r ? (r.nome || r.nomeProposto) : a.login; a.novo = !!(r && r.situacao === 'nao_existe'); }

  const novas = plano.filter((p) => !p.existente).length;
  const resumo = {
    linhas: registros.length, vazias, comErro: erros.length, unidades: plano.length, novas, jaExistiam: plano.length - novas,
    entradas: entradas.length, saidas: todasSaidas.length, analistasNovos: analistas.filter((a) => a.situacao === 'nao_existe' && a.decisao === 'criar').length,
    semAnalista: plano.filter((p) => !p.finais.length && !conflitoSem(p)).length,
  };
  const bloqueios = pendencias.filter((p) => p.bloqueia).length;
  const decidir = pendencias.filter((p) => !p.bloqueia).length;
  const ignorar = !!entrada.ignorarErros;
  const podeGravar = plano.length > 0 && !bloqueios && (ignorar || (!erros.length && !decidir));
  return {
    modo, ignorarErros: ignorar, resumo, porTipo, porAnalista: Object.values(porAnalista).sort((a, b) => b.total - a.total),
    erros, avisos, analistas: analistas.map((a) => ({ valor: a.valor, situacao: a.situacao, login: a.login || null, nome: a.nome || null, loginProposto: a.loginProposto || null, nomeProposto: a.nomeProposto || null, decisao: a.decisao || null, problema: a.problema || null, linhas: a.linhas })),
    conflitos, pendencias, podeGravar,
    unidades: plano.map((p) => ({ key: p.key, contrato_id: p.contrato_id, tipo: p.tipo, unidade: p.exibicao, municipio: p.municipio, existente: p.existente, analistas: p.finais, conflito: !!conflitoSem(p), ignorados: p.ignoradosAnalistas })),
    saidas: todasSaidas, _plano: plano, _analistas: analistas,
  };
}

function previa(db, entrada) {
  const p = planejar(db, entrada);
  delete p._plano; delete p._analistas;
  return p;
}

function gravar(db, quem, entrada) {
  if (!String(entrada.csv || '').trim()) throw erro(400, 'Arquivo vazio.');
  const p = planejar(db, entrada);
  const ignorar = !!entrada.ignorarErros;
  if (!p.unidades.length) throw erro(400, 'Nenhuma unidade válida no arquivo.');
  if (p.pendencias.some((x) => x.bloqueia)) throw erro(409, 'Há analistas que não podem receber carteira. Corrija o arquivo e confira a prévia.');
  if (!ignorar && p.erros.length) throw erro(409, 'Há ' + p.erros.length + ' linha(s) com erro. Corrija o arquivo ou marque "ignorar linhas com erro".');
  const faltam = p.pendencias.filter((x) => !x.bloqueia);
  if (!ignorar && faltam.length) throw erro(409, 'Faltam decisões: ' + faltam.map((x) => x.texto).join(' '));
  const hash = crypto.createHash('sha256').update(String(entrada.csv)).digest('hex');
  const agora = new Date().toISOString();
  const motivoBase = 'Importação em lote';

  const feito = db.tx(() => {
    const imp = db.run('INSERT INTO importacoes (em, quem, modo, arquivo_hash, resumo) VALUES (?,?,?,?,?)', agora, quem, p.modo, hash, null);
    const impId = Number(imp.lastInsertRowid);
    const motivo = motivoBase + ' #' + impId;
    // 1. analistas novos
    const logins = new Map();
    for (const a of p._analistas) {
      if (a.situacao === 'existe') logins.set(a.login, a.usuario_id);
      else if (a.situacao === 'nao_existe' && a.decisao === 'criar') logins.set(a.loginProposto, A.criarUsuario(db, { login: a.loginProposto, nome: a.nomeProposto, perfil: 'criador' }, quem));
    }
    // 2. unidades novas
    const criadas = [];
    for (const u of p._plano) {
      if (u.existente) continue;
      if (db.get('SELECT 1 FROM contratos WHERE contrato_id = ?', u.contrato_id)) continue;
      db.run('INSERT INTO contratos (contrato_id, unidade, tipo, municipio, demo, criado_por, criado_em) VALUES (?,?,?,?,0,?,?)', u.contrato_id, u.exibicao, u.tipo, u.municipio, quem, agora);
      trilha.registrar(db, { usuario: quem, tabela: 'contratos', registro: u.contrato_id, campo: 'unidade_criada', valor_novo: u.exibicao + (u.municipio ? ' / ' + u.municipio : ''), motivo });
      criadas.push(u.contrato_id);
    }
    // 3. carteiras: calcula o conjunto final por analista e aplica (entradas/saídas ficam no histórico)
    const alvo = new Map(); // login -> Set(contrato)
    const afetados = new Set();
    const saidasPorLogin = new Map();
    const conflitoSemDecisao = new Set(p.unidades.filter((u) => u.conflito).map((u) => u.contrato_id));
    for (const u of p._plano) {
      if (conflitoSemDecisao.has(u.contrato_id)) continue; // só com ignorarErros: unidade criada, carteira não mexe
      for (const l of u.finais) { if (!alvo.has(l)) alvo.set(l, new Set()); alvo.get(l).add(u.contrato_id); afetados.add(l); }
      for (const l of u.atuais) if (!u.finais.includes(l)) { afetados.add(l); if (!saidasPorLogin.has(l)) saidasPorLogin.set(l, new Set()); saidasPorLogin.get(l).add(u.contrato_id); }
    }
    if (p.modo === 'substituir') for (const a of p._analistas) if (a.situacao === 'existe' || (a.situacao === 'nao_existe' && a.decisao === 'criar')) afetados.add(a.login || a.loginProposto);
    let entrou = 0, saiu = 0;
    for (const login of afetados) {
      const uid = logins.get(login) || (db.get('SELECT usuario_id FROM usuarios WHERE login = ?', login) || {}).usuario_id;
      if (!uid) continue;
      const atuais = CART.doUsuario(db, uid);
      let novos;
      if (p.modo === 'substituir' && logins.has(login) && p._analistas.some((a) => (a.login || a.loginProposto) === login)) novos = [...(alvo.get(login) || [])];
      else novos = atuais.filter((c) => !(saidasPorLogin.get(login) || new Set()).has(c)).concat([...(alvo.get(login) || [])]);
      const r = CART.definir(db, quem, uid, novos, motivo);
      entrou += r.entraram.length; saiu += r.sairam.length;
    }
    const resumo = { arquivo_hash: hash.slice(0, 16), modo: p.modo, linhas: p.resumo.linhas, unidades: p.resumo.unidades, unidades_novas: criadas.length, entradas: entrou, saidas: saiu, analistas_criados: p.resumo.analistasNovos, linhas_com_erro_ignoradas: ignorar ? p.erros.length : 0 };
    db.run('UPDATE importacoes SET resumo = ? WHERE importacao_id = ?', JSON.stringify(resumo), impId);
    trilha.registrar(db, { usuario: quem, tabela: 'importacoes', registro: String(impId), campo: 'carteira_importada', valor_novo: JSON.stringify(resumo), motivo });
    return Object.assign({ importacao_id: impId, criadas }, resumo);
  });
  return Object.assign(feito, { senhaTemporaria: feito.analistas_criados ? config.senhaTemporaria : undefined });
}

function historico(db) {
  return db.all('SELECT importacao_id, em, quem, modo, resumo FROM importacoes ORDER BY importacao_id DESC LIMIT 20').map((r) => Object.assign(r, { resumo: r.resumo ? JSON.parse(r.resumo) : null }));
}

const MODELO = 'tipo;unidade;municipio;analista';
// Carteira como está hoje, no mesmo formato da importação: serve de ponto de partida para ajustar e reenviar.
function atualCsv(db) {
  const linhas = db.all("SELECT c.tipo, c.unidade, c.municipio, c.demo, GROUP_CONCAT(u.login, '|') AS analistas FROM contratos c LEFT JOIN carteira k ON k.contrato_id = c.contrato_id AND k.ate IS NULL LEFT JOIN usuarios u ON u.usuario_id = k.usuario_id GROUP BY c.contrato_id ORDER BY c.tipo, c.unidade").filter((r) => !r.demo);
  return '\ufeff' + [MODELO].concat(linhas.map((r) => [r.tipo || '', r.unidade, r.municipio || '', r.analistas || ''].join(';'))).join('\n') + '\n';
}
const modeloCsv = () => '﻿' + MODELO + '\n';

module.exports = { previa, gravar, historico, modeloCsv, atualCsv, tipoDe, TIPOS };
