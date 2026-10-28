'use strict';
// Relatório "METAS ATINGIDAS - CONSOLIDADO" do SIMAS (PDF gerado no próprio SIMAS pela analista da CTAI e anexado na importação).
// Leitor determinístico (sem IA): cabeçalho, grupos com linhas "Descrição | Previsto | Realizado | Atingido%", "Total do Grupo" e a parte
// "Indicadores". Os números só são PROPOSTOS; a analista confere e confirma. O relatório consolida 3 meses; os blocos de indicadores aparecem
// repetidos sem rótulo de mês: o mês é PRESUMIDO pela ordem em que aparecem e a analista precisa confirmar.
// Também faz o conferidor SIMAS x RM (Anexo I) x planilha de monitoramento (Anexo II): só sinaliza diferenças, nunca diz quem está certo.
const C = require('./catalogo');
const E = require('./extrator-rm');
const trilha = require('./trilha');
const G = require('./gaveta');
const { erro } = require('./auth');

const agora = () => new Date().toISOString();
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ITEM_CODIGO = 'simas_metas';
const NOME_ITEM = 'SIMAS – Metas atingidas (consolidado do trimestre)';

// ---------- reconhecer ----------
const eRelatorioSimas = (texto) => /metas atingidas consolidado/.test(sem(String(texto || '').slice(0, 1500)));

// ---------- leitor ----------
const RUIDO = [
  /Pg\.?:\s*\d+\s*\/\s*\d+/i, /^METAS ATINGIDAS\b/i, /^\s*Descri[cç][aã]o\b/i, /^\s*Pontua[cç][aã]o\s*$/i, /^\s*Atingida\s*$/i, /^\s*Organiza[cç][aã]o Social\s*\//i,
  /Powered by/i, /^\s*Agrupamento:/i, /^\s*[-–]\s*$/, /^\s*Total:\s*\d+/i,
];
const ehRuido = (l) => RUIDO.some((r) => r.test(l));
const LINHA_NUM = /^\s*(?:(.*?)\s+)?(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*(?:,\d+)?\s*%)\s*$/;
const TOTAL = /^\s*Total do Grupo:?\s+(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*(?:,\d+)?)\s+(\d[\d.]*(?:,\d+)?\s*%)\s*$/i;
const REGRA = '(N\\/A\\s*\\d+(?:[.,]\\d+)?|(?:Maior ou igual a|Menor ou igual a|Igual a|Maior que|Menor que)\\s*\\d+(?:[.,]\\d+)?)';
const LINHA_IND = new RegExp('^\\s*(.*?)\\s*' + REGRA + '\\s+(-?\\d+(?:[.,]\\d+)?)\\s+(Sim|N[aã]o)\\s+(\\S+)\\s*$', 'i');
const pct = (s) => E.numeroBR(String(s).replace(/\s/g, ''));
const decimalPonto = (s) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; }; // indicadores usam ponto decimal: "94.12"

function cabecalho(linhas) {
  const h = { unidade: null, cnpj: null, periodos: [], trimestre: null, gerado_por: null, gerado_em: null };
  for (const l of linhas.slice(0, 12)) {
    if (!h.unidade && /\S/.test(l) && !/^METAS ATINGIDAS/i.test(l)) h.unidade = l.replace(/Pg\.?:\s*\d+\s*\/\s*\d+/i, '').trim().replace(/\.{3}$/, '').trim() || null;
    const cn = /\((\d{14})\)/.exec(l); if (cn && !h.cnpj) h.cnpj = cn[1];
    const ps = [...l.matchAll(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/g)];
    if (ps.length && !h.periodos.length && !/\d{2}\/\d{2}\/\d{4}/.test(l)) h.periodos = ps.map((m) => m[2] + '-' + m[1]);
  }
  if (h.periodos.length) { const tris = [...new Set(h.periodos.map(C.trimestreDoMes))]; h.trimestre = tris.length === 1 ? tris[0] : null; }
  const rod = linhas.map((l) => /Organiza[cç][aã]o Social\s*\/\s*CTAI\s*-\s*(.+?)\s{2,}(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/i.exec(l)).find(Boolean);
  if (rod) { h.gerado_por = rod[1].replace(/\.{3}$/, '').trim(); const [d, m, a] = rod[2].split('/'); h.gerado_em = a + '-' + m + '-' + d + 'T' + rod[3]; }
  return h;
}

// O texto de um PDF lido no navegador não traz linhas em branco (e traz "--- página N ---"); por isso o leitor não depende delas.
const PREPOSICAO = /\b(de|da|do|das|dos|e|em|no|na|nos|nas|a|ao|para|com|por|às|aos)$/i;
function lerSimas(texto) {
  const todas = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const linhas = todas.filter((l) => l.trim() && !/^--- p[aá]gina \d+ ---$/.test(l.trim()));
  const cab = cabecalho(linhas);
  const avisos = [];
  const grupos = []; const indicadores = [];
  let secao = null; let grupo = null; let emIndicadores = false; const consumido = new Set();
  const novoGrupo = (nome) => { grupo = { secao, nome, linhas: [], total: null }; grupos.push(grupo); };
  const L = (k) => (k >= 0 && k < linhas.length ? linhas[k] : '');
  const dadoVazio = (k) => { const m = LINHA_NUM.exec(L(k)); return !!m && !(m[1] || '').trim(); };
  const indVazio = (k) => { const m = LINHA_IND.exec(L(k)); return !!m && !m[1].trim(); };
  const ruido = (k) => ehRuido(L(k)) || /\(\d{14}\)\s*$/.test(L(k)) || /\[SIMAS\]\s*$/.test(L(k)) || /^\s*\d{2}\/\d{4}(?:,\s*\d{2}\/\d{4})*\s*$/.test(L(k)) || /^UPAE\b.*Pg\./.test(L(k)) || /^\s*Pontua[cç][aã]o\s*$/i.test(L(k));
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (consumido.has(i) || ruido(i)) continue;
    if (/^\s*Indicadores\s*$/.test(l)) { emIndicadores = true; grupo = null; continue; }
    if (emIndicadores) {
      const m = LINHA_IND.exec(l);
      if (!m) continue;
      // nome: linha de cima (se a linha de dados vem sem nome), o que está na própria linha e a continuação de baixo, se for dela
      const partes = [];
      if (!m[1].trim() && i > 0 && !ruido(i - 1) && !LINHA_IND.test(L(i - 1)) && !consumido.has(i - 1)) { partes.push(L(i - 1).trim()); consumido.add(i - 1); }
      if (m[1].trim()) partes.push(m[1].trim());
      if (!m[1].trim() || partes.length) { // a continuação só vale se a linha seguinte não for o início do próximo item (linha de nome antes de uma linha de dados sem nome)
        const k = i + 1;
        if (k < linhas.length && !ruido(k) && !LINHA_IND.test(L(k)) && !indVazio(k + 1) && !/^\s*Total:/i.test(L(k))) { partes.push(L(k).trim()); consumido.add(k); }
      }
      const nome = partes.join(' ').replace(/\s+/g, ' ').trim();
      if (!nome) continue;
      indicadores.push({ nome, chave: sem(nome).replace(/\s+/g, '_'), regra: m[2].replace(/\s+/g, ' '), realizado: decimalPonto(m[3]), atingido: /^sim$/i.test(m[4]) ? 'Sim' : 'Não', pontuacao: m[5] === '-' ? null : m[5], trecho: (nome + ' | ' + m[2] + ' | ' + m[3] + ' | ' + m[4]).replace(/\s+/g, ' ') });
      continue;
    }
    const tot = TOTAL.exec(l);
    if (tot) { if (grupo) grupo.total = { previsto: E.numeroBR(tot[1]), realizado: E.numeroBR(tot[2]), pct: pct(tot[3]), trecho: ('Total do Grupo ' + tot[1] + ' ' + tot[2] + ' ' + tot[3]).trim() }; continue; }
    const m = LINHA_NUM.exec(l);
    if (m) {
      let desc = (m[1] || '').trim();
      if (!desc) { // descrição quebrada: a linha de cima começa; a de baixo termina quando parece continuação
        const partes = [];
        const ant = L(i - 1); if (i > 0 && !ruido(i - 1) && !LINHA_NUM.test(ant) && !TOTAL.test(ant) && !consumido.has(i - 1)) partes.push(ant.trim());
        const prox = L(i + 1);
        if (prox && !ruido(i + 1) && !LINHA_NUM.test(prox) && !TOTAL.test(prox) && !/^\s*Indicadores\s*$/.test(prox) && !dadoVazio(i + 2)) {
          const minuscula = /^\s*[a-zà-ý]/.test(prox);
          const fimComPreposicao = partes.length && PREPOSICAO.test(partes[0]);
          const antesDoTotal = TOTAL.test(L(i + 2));
          if (minuscula || fimComPreposicao || antesDoTotal) { partes.push(prox.trim()); consumido.add(i + 1); }
        }
        desc = partes.join(' ').replace(/\s+/g, ' ').trim();
      }
      if (!desc) continue;
      if (!grupo) novoGrupo(secao || 'Sem grupo');
      const previsto = E.numeroBR(m[2]); const realizado = E.numeroBR(m[3]); const p = pct(m[4]);
      grupo.linhas.push({ descricao: desc, previsto, realizado, pct: p, sem_meta: previsto === 0, trecho: (desc + ' ' + m[2] + ' ' + m[3] + ' ' + m[4].replace(/\s/g, '')).slice(0, 300) });
      continue;
    }
    // linha de texto sem números: cabeçalho de seção ("Ambulatorial", "SADT") ou de grupo
    const t = l.trim();
    if (/^[a-zà-ý]/.test(t)) continue;
    if (/^\s*Descri[cç][aã]o\b.*Previsto/i.test(L(i + 1))) { secao = t; grupo = null; continue; }
    if (dadoVazio(i + 1)) continue; // início de uma descrição quebrada (tratada na linha dos números)
    novoGrupo(t);
  }
  for (const g of grupos.filter((x) => !x.linhas.length && !x.total)) grupos.splice(grupos.indexOf(g), 1);
  // meses presumidos pela ordem: a 1ª vez que cada indicador aparece é o 1º mês do período, e assim por diante
  const visto = new Map();
  for (const ind of indicadores) {
    const n = (visto.get(ind.chave) || 0) + 1; visto.set(ind.chave, n);
    ind.ocorrencia = n;
    ind.mes_presumido = cab.periodos[n - 1] || null;
  }
  const ocorrencias = new Set(indicadores.map((x) => x.ocorrencia));
  if (indicadores.length && cab.periodos.length && Math.max(...ocorrencias) !== cab.periodos.length) avisos.push('Os indicadores aparecem ' + Math.max(...ocorrencias) + ' vez(es), mas o período tem ' + cab.periodos.length + ' mês(es). Confira a ordem.');
  if (!cab.periodos.length) avisos.push('Não achei os meses do período no cabeçalho.');
  if (cab.periodos.length && !cab.trimestre) avisos.push('Os meses do cabeçalho não fecham um único trimestre.');
  if (!grupos.some((g) => g.linhas.length)) avisos.push('Não achei linhas de produção.');
  if (!indicadores.length) avisos.push('Não achei a parte de indicadores.');
  return { versao: 1, cabecalho: cab, grupos, indicadores, avisos, resumo: { grupos: grupos.length, linhas: grupos.reduce((s, g) => s + g.linhas.length, 0), indicadores: indicadores.length } };
}

// ---------- chave estável para cruzar com o RM ----------
const CHAVE_RM = [
  [/neuropediatra/, 'consultas_medicas_tea'], [/bexiga neurogenica/, 'bexiga_neurogenica'], [/pe diabetico/, 'pe_diabetico'], [/ostomizados/, 'ostomizados'],
  [/matriciamento/, 'matriciamento'], [/supervisao dos cuidados/, 'supervisao_cuidado'],
];
const CHAVE_TOTAL = [[/^atendimento ambulatorial medico$/, 'consultas_medicas'], [/^atendimento ambulatorial nao medico$/, 'consultas_nao_medicas'], [/^sessoes de reabilitacao$/, 'sessoes_reabilitacao'], [/^sadt especial$/, 'mamografia']];
const chaveLinha = (g, l) => { const d = sem(l.descricao); const h = CHAVE_RM.find(([re]) => re.test(d)); return h ? h[1] : null; };
const chaveTotal = (g) => { const h = CHAVE_TOTAL.find(([re]) => re.test(sem(g.nome))); return h ? h[1] : null; };

// ---------- guardar (propostas) ----------
function gravarLeitura(db, usuario, c, tri, arquivoId, leitura) {
  const antes = db.get('SELECT COUNT(*) AS n FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  const confAntes = db.get("SELECT COUNT(*) AS n FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ? AND estado = 'confirmado'", c.contrato_id, tri).n;
  db.tx(() => {
    db.run('DELETE FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
    db.run('DELETE FROM imp_simas WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
    db.run('INSERT INTO imp_simas (contrato_id, trimestre, arquivo_id, cabecalho, avisos, grupos, linhas, indicadores, lido_por, lido_em) VALUES (?,?,?,?,?,?,?,?,?,?)',
      c.contrato_id, tri, arquivoId, JSON.stringify(leitura.cabecalho), JSON.stringify(leitura.avisos), leitura.resumo.grupos, leitura.resumo.linhas, leitura.resumo.indicadores, usuario.login, agora());
    const ins = (r) => db.run('INSERT INTO imp_simas_numeros (contrato_id, trimestre, arquivo_id, fonte, tipo, secao, grupo, descricao, chave, previsto, realizado, pct, regra, atingido, pontuacao, ocorrencia, mes, mes_estado, sem_meta, trecho, estado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      c.contrato_id, tri, arquivoId, 'SIMAS', r.tipo, r.secao || null, r.grupo || null, r.descricao, r.chave || null, r.previsto === undefined ? null : r.previsto, r.realizado === undefined ? null : r.realizado, r.pct === undefined ? null : r.pct,
      r.regra || null, r.atingido || null, r.pontuacao || null, r.ocorrencia || null, r.mes || null, r.mes ? 'presumido' : null, r.sem_meta ? 1 : 0, r.trecho || null, 'proposto');
    for (const g of leitura.grupos) {
      for (const l of g.linhas) ins({ tipo: 'producao', secao: g.secao, grupo: g.nome, descricao: l.descricao, chave: chaveLinha(g, l), previsto: l.previsto, realizado: l.realizado, pct: l.pct, sem_meta: l.sem_meta, trecho: l.trecho });
      if (g.total) ins({ tipo: 'total_grupo', secao: g.secao, grupo: g.nome, descricao: 'Total do Grupo', chave: chaveTotal(g), previsto: g.total.previsto, realizado: g.total.realizado, pct: g.total.pct, trecho: g.total.trecho });
    }
    for (const x of leitura.indicadores) ins({ tipo: 'indicador', descricao: x.nome, chave: x.chave, realizado: x.realizado, regra: x.regra, atingido: x.atingido, pontuacao: x.pontuacao, ocorrencia: x.ocorrencia, mes: x.mes_presumido, trecho: x.trecho });
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_simas', registro: c.contrato_id + '/' + tri, campo: 'simas_lido', valor_anterior: antes.n ? { numeros: antes.n, confirmados: confAntes } : null, valor_novo: { arquivo: arquivoId, ...leitura.resumo, periodos: leitura.cabecalho.periodos } });
  });
  return leitura.resumo;
}
// Chamado quando o arquivo recebido é o consolidado do SIMAS.
function registrar(db, usuario, c, tri, arquivoId, texto) {
  const leitura = lerSimas(texto);
  const r = gravarLeitura(db, usuario, c, tri, arquivoId, leitura);
  const fora = leitura.cabecalho.trimestre && leitura.cabecalho.trimestre !== tri;
  const ach = gerarAchados(db, usuario, c, tri);
  return { ...r, achados: ach.novos, aviso: [fora ? 'O período do relatório (' + leitura.cabecalho.periodos.join(', ') + ') não é o trimestre ' + tri + '.' : null, ...leitura.avisos].filter(Boolean).join(' ') || null };
}

// ---------- ler / confirmar ----------
function resumoSimples(db, contratoId, tri) {
  const l = db.get('SELECT grupos, linhas, indicadores FROM imp_simas WHERE contrato_id = ? AND trimestre = ?', contratoId, tri);
  if (!l) return { lido: false };
  const n = (e) => db.get('SELECT COUNT(*) AS n FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ? AND estado = ?', contratoId, tri, e).n;
  return { lido: true, grupos: l.grupos, linhas: l.linhas, indicadores: l.indicadores, propostos: n('proposto'), confirmados: n('confirmado') };
}
function visao(db, usuario, contratoId, tri) {
  const c = G.exigirUnidade(db, usuario, contratoId);
  const l = db.get('SELECT * FROM imp_simas WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  if (!l) return { lido: false, numeros: [], divergencias: [] };
  const numeros = db.all('SELECT * FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ? ORDER BY id', c.contrato_id, tri);
  const cab = JSON.parse(l.cabecalho || '{}');
  const indic = numeros.filter((n) => n.tipo === 'indicador');
  const ordem = (cab.periodos || []).map((mes, k) => ({ ocorrencia: k + 1, mes, estado: (indic.find((n) => n.ocorrencia === k + 1) || {}).mes_estado || null }));
  return {
    lido: true, arquivo_id: l.arquivo_id, cabecalho: cab, avisos: JSON.parse(l.avisos || '[]'), lido_por: l.lido_por, lido_em: l.lido_em,
    resumo: { grupos: l.grupos, linhas: l.linhas, indicadores: l.indicadores, propostos: numeros.filter((n) => n.estado === 'proposto').length, confirmados: numeros.filter((n) => n.estado === 'confirmado').length },
    ordem_meses: ordem, numeros, divergencias: conferir(db, c, tri, numeros),
  };
}

// Confirma tudo o que foi lido. Os indicadores têm mês presumido pela ordem: a analista informa a ordem (ocorrência -> mês) para confirmar.
function confirmar(db, usuario, contratoId, tri, d) {
  const c = G.exigirUnidade(db, usuario, contratoId);
  const l = db.get('SELECT * FROM imp_simas WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  if (!l) throw erro(404, 'O consolidado do SIMAS ainda não foi lido neste trimestre.');
  const meses = C.mesesDoTrimestre(tri);
  const ordem = d && d.ordem_meses && typeof d.ordem_meses === 'object' ? d.ordem_meses : null; // { "1": "2026-07", ... }
  const indic = db.all("SELECT * FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ? AND tipo = 'indicador'", c.contrato_id, tri);
  if (indic.length) {
    const oc = [...new Set(indic.map((x) => x.ocorrencia))];
    if (!ordem || oc.some((o) => !meses.includes(String(ordem[o])))) throw erro(400, 'Confirme o mês de cada bloco de indicadores (o relatório não traz o mês; ele foi presumido pela ordem).');
    if (new Set(oc.map((o) => ordem[o])).size !== oc.length) throw erro(400, 'Dois blocos de indicadores não podem ser do mesmo mês.');
  }
  const ids = Array.isArray(d && d.ids) && d.ids.length ? new Set(d.ids.map(Number)) : null;
  let n = 0;
  db.tx(() => {
    for (const x of db.all("SELECT * FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ? AND estado = 'proposto'", c.contrato_id, tri)) {
      if (ids && !ids.has(x.id)) continue;
      if (x.tipo === 'indicador') db.run("UPDATE imp_simas_numeros SET estado = 'confirmado', mes = ?, mes_estado = 'confirmado', confirmado_por = ?, confirmado_em = ? WHERE id = ?", String(ordem[x.ocorrencia]), usuario.login, agora(), x.id);
      else db.run("UPDATE imp_simas_numeros SET estado = 'confirmado', confirmado_por = ?, confirmado_em = ? WHERE id = ?", usuario.login, agora(), x.id);
      n++;
    }
    trilha.registrar(db, { usuario: usuario.login, tabela: 'imp_simas_numeros', registro: c.contrato_id + '/' + tri, campo: 'simas_confirmado', valor_novo: { confirmados: n, ordem_meses: ordem } });
  });
  gerarAchados(db, usuario, c, tri);
  return { confirmados: n };
}

// ---------- divergências viram ACHADOS da unidade (mesma fila e mesmas ações dos outros achados) ----------
// Severidade neutra ("A CONFERIR"); sem concluir quem está certo. A analista fixa (aceita) ou descarta com motivo.
// Um achado já decidido (fixado/descartado) não é recriado; os ainda "novos" são refeitos a cada leitura.
function gerarAchados(db, usuario, c, tri) {
  const numeros = db.all('SELECT * FROM imp_simas_numeros WHERE contrato_id = ? AND trimestre = ? ORDER BY id', c.contrato_id, tri);
  const l = db.get('SELECT arquivo_id FROM imp_simas WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri);
  const arq = l && l.arquivo_id ? db.get('SELECT nome_arquivo FROM imp_arquivos WHERE id = ?', l.arquivo_id) : null;
  const divs = numeros.length ? conferir(db, c, tri, numeros) : [];
  const origemId = parseInt(require('../core/util').sha256('simas|' + c.contrato_id + '|' + tri).slice(0, 7), 16);
  const agora_ = agora(); let novos = 0;
  db.tx(() => {
    db.run("DELETE FROM achados WHERE origem_tipo = 'simas' AND contrato_id = ? AND trimestre = ? AND status = 'novo'", c.contrato_id, tri);
    for (const d of divs) {
      const chave = [d.tipo, sem(d.indicador), d.periodo].join('|');
      if (db.get("SELECT 1 AS x FROM achados WHERE origem_tipo = 'simas' AND contrato_id = ? AND trimestre = ? AND chave = ?", c.contrato_id, tri, chave)) continue;
      const trecho = d.detalhe + ' [Fonte: ' + d.a.fonte + (arq ? ', arquivo ' + arq.nome_arquivo : '') + (d.trecho_origem ? ', trecho: "' + String(d.trecho_origem).slice(0, 200) + '"' : '') + '; comparado com ' + d.b.fonte + '.]';
      db.run('INSERT INTO achados (origem_tipo, origem_id, cid, contrato_id, trimestre, chave, gravidade, tipo, trecho, risco, sugestao, setor_sugerido, provedor, status, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        'simas', origemId, null, c.contrato_id, tri, chave, 'A CONFERIR', 'SIMAS × RM × planilha: ' + d.indicador, trecho.slice(0, 1500), 'As fontes não coincidem neste ponto. O sistema só sinaliza e não diz qual está certa.', 'Conferir nas fontes e decidir: fixar (aceitar o ponto) ou descartar com observação.', null, 'conferidor SIMAS', 'novo', agora_, agora_);
      novos++;
    }
    if (novos) trilha.registrar(db, { usuario: usuario.login, tabela: 'achados', registro: 'simas/' + c.contrato_id + '/' + tri, campo: 'achados_simas', valor_novo: novos + ' ponto(s) a conferir (SIMAS × RM × planilha)' });
  });
  return { novos, total: divs.length };
}
function atualizarAchados(db, usuario, contratoId, tri) {
  const c = G.exigirUnidade(db, usuario, contratoId);
  if (!db.get('SELECT 1 AS x FROM imp_simas WHERE contrato_id = ? AND trimestre = ?', c.contrato_id, tri)) throw erro(404, 'O consolidado do SIMAS ainda não foi lido neste trimestre.');
  return gerarAchados(db, usuario, c, tri);
}

// ---------- conferidor SIMAS x RM x planilha ----------
const fmt = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
function conferir(db, c, tri, numeros) {
  const out = []; const meses = C.mesesDoTrimestre(tri);
  const div = (x) => out.push(Object.assign({ aviso: 'Só sinaliza: não diz qual fonte está certa.' }, x));
  const origem = (n) => (n && n.trecho ? n.trecho : null);
  const prod = numeros.filter((n) => n.tipo === 'producao' || n.tipo === 'total_grupo');
  // 1) RM (Anexo I) mês a mês x SIMAS (consolidado)
  const rm = db.all("SELECT mes, chave, meta, realizado, estado FROM gaveta_numeros WHERE contrato_id = ? AND fonte = 'anexo_I' AND mes IN (" + meses.map(() => '?').join(',') + ')', c.contrato_id, ...meses);
  const rmChave = (chave) => rm.filter((r) => r.chave === chave);
  const vistas = new Set();
  for (const n of prod) {
    if (!n.chave || vistas.has(n.chave + n.tipo)) continue;
    // linha prevalece sobre total quando os dois existem para a mesma chave; mamografia é tratada à parte
    if (n.chave === 'mamografia') continue;
    vistas.add(n.chave + n.tipo);
    const r = rmChave(n.chave);
    if (!r.length) continue;
    const mesesRM = r.map((x) => x.mes);
    const falta = meses.filter((m) => !mesesRM.includes(m));
    const somaMeta = r.reduce((s, x) => s + (x.meta || 0), 0), somaReal = r.reduce((s, x) => s + (x.realizado || 0), 0);
    const nota = falta.length ? 'RM de ' + falta.map(C.rotuloMes).join(', ') + ' não lido(s): a soma está incompleta.' : null;
    const metas = r.sort((a, b) => a.mes.localeCompare(b.mes)).map((x) => C.rotuloMes(x.mes) + ' ' + fmt(x.meta)).join('; ');
    if (n.previsto !== null && n.previsto !== somaMeta) div({ tipo: 'previsto', indicador: n.descricao + (n.tipo === 'total_grupo' ? ' (total do grupo)' : ''), chave: n.chave, trecho_origem: origem(n), periodo: tri, a: { fonte: 'SIMAS', valor: n.previsto }, b: { fonte: 'RM (Anexo I)', valor: somaMeta }, detalhe: 'Previsto no SIMAS ' + fmt(n.previsto) + ' x metas do RM somadas ' + fmt(somaMeta) + ' (' + metas + ').', nota });
    if (n.realizado !== null && n.realizado !== somaReal) div({ tipo: 'realizado', indicador: n.descricao + (n.tipo === 'total_grupo' ? ' (total do grupo)' : ''), chave: n.chave, trecho_origem: origem(n), periodo: tri, a: { fonte: 'SIMAS', valor: n.realizado }, b: { fonte: 'RM (Anexo I)', valor: somaReal }, detalhe: 'Realizado no SIMAS ' + fmt(n.realizado) + ' x produção do RM somada ' + fmt(somaReal) + '.', nota });
  }
  // 2) Mamografia aparece em dois lugares do SIMAS
  const mamo = prod.filter((n) => n.tipo === 'producao' && /mamografia/.test(sem(n.descricao)));
  if (mamo.length > 1) div({ tipo: 'duplicidade', indicador: 'Mamografia', chave: 'mamografia', trecho_origem: mamo.map(origem).join(' · '), periodo: tri, a: { fonte: 'SIMAS · ' + mamo[0].grupo, valor: mamo[0].realizado, previsto: mamo[0].previsto }, b: { fonte: 'SIMAS · ' + mamo[1].grupo, valor: mamo[1].realizado, previsto: mamo[1].previsto }, detalhe: 'Mamografia aparece em dois grupos do SIMAS: ' + mamo.map((m) => m.grupo + ' (previsto ' + fmt(m.previsto) + ', realizado ' + fmt(m.realizado) + ')').join(' e ') + '.' });
  const mamoRM = rmChave('mamografia');
  if (mamoRM.length && mamo.length) {
    const sr = mamoRM.reduce((s, x) => s + (x.realizado || 0), 0), sm = mamoRM.reduce((s, x) => s + (x.meta || 0), 0);
    for (const m of mamo) {
      if (m.realizado !== sr || m.previsto !== sm) div({ tipo: 'mamografia', indicador: 'Mamografia', chave: 'mamografia', trecho_origem: origem(m), periodo: tri, a: { fonte: 'SIMAS · ' + m.grupo, valor: m.realizado, previsto: m.previsto }, b: { fonte: 'RM (Anexo I)', valor: sr, previsto: sm }, detalhe: 'SIMAS (' + m.grupo + ') previsto ' + fmt(m.previsto) + ' e realizado ' + fmt(m.realizado) + ' x RM meta ' + fmt(sm) + ' e produção ' + fmt(sr) + '.' });
    }
  }
  // 3) soma das linhas x total do grupo (só informa)
  const grupos = [...new Set(numeros.filter((n) => n.tipo === 'total_grupo').map((n) => n.grupo))];
  for (const g of grupos) {
    const t = numeros.find((n) => n.tipo === 'total_grupo' && n.grupo === g);
    const ls = numeros.filter((n) => n.tipo === 'producao' && n.grupo === g);
    if (!ls.length) continue;
    const sp = ls.reduce((s, x) => s + (x.previsto || 0), 0), sr = ls.reduce((s, x) => s + (x.realizado || 0), 0);
    if (sp !== t.previsto || sr !== t.realizado) div({ tipo: 'total_grupo', indicador: g + ' (total do grupo)', trecho_origem: origem(t), periodo: tri, a: { fonte: 'SIMAS · total', valor: t.realizado, previsto: t.previsto }, b: { fonte: 'SIMAS · soma das linhas', valor: sr, previsto: sp }, detalhe: 'O total do grupo (previsto ' + fmt(t.previsto) + ', realizado ' + fmt(t.realizado) + ') não é a soma das linhas (previsto ' + fmt(sp) + ', realizado ' + fmt(sr) + '). Linhas sem meta ficam com previsto 0.' });
  }
  // 4) ostomizados e TEA: planilha de monitoramento (Anexo II). Só entram números que a planilha traz com o mesmo significado.
  //    ostomizados = PACIENTES (linha "Pessoas com estomia"); em meses anteriores ao 10º termo aditivo a planilha traz atendimentos (sessões): não é comparável.
  const plan = db.all("SELECT mes, chave, realizado, meta, estado, trecho FROM gaveta_numeros WHERE contrato_id = ? AND fonte = 'anexo_II' AND mes IN (" + meses.map(() => '?').join(',') + ')', c.contrato_id, ...meses);
  const DEF = [['ostomizados', 'ostomizados_pessoas', 'pacientes com estomia'], ['consultas_medicas_tea', 'neuropediatra', 'neuropediatra (PE Acessível)']];
  for (const [chave, chavePlan, quem] of DEF) {
    const s = numeros.find((n) => n.chave === chave && n.tipo === 'producao');
    if (!s) continue;
    const p = plan.filter((x) => x.chave === chavePlan);
    const mesesLidos = p.map((x) => x.mes);
    const faltam = meses.filter((m) => !mesesLidos.includes(m));
    const outras = chave === 'ostomizados' ? plan.filter((x) => x.chave === 'ostomizados_atendimentos').map((x) => C.rotuloMes(x.mes) + ' ' + fmt(x.realizado)) : [];
    const obs = (faltam.length ? 'Planilha sem ' + quem + ' lido em: ' + faltam.map(C.rotuloMes).join(', ') + '. ' : '') + (outras.length ? 'Nesses meses a planilha traz ATENDIMENTOS (' + outras.join('; ') + '), não pacientes: não comparável. ' : '');
    if (!p.length || faltam.length) {
      div({ tipo: 'planilha_pendente', indicador: s.descricao, chave, trecho_origem: origem(s), periodo: tri, a: { fonte: 'SIMAS', valor: s.realizado, previsto: s.previsto }, b: { fonte: 'Planilha de monitoramento (Anexo II)', valor: null }, detalhe: 'SIMAS: realizado ' + fmt(s.realizado) + ' de ' + fmt(s.previsto) + '. ' + (obs || 'Ainda não há números lidos da planilha.') + 'Confira à mão.' + (p.length ? ' Lidos: ' + p.map((x) => C.rotuloMes(x.mes) + ' ' + fmt(x.realizado) + ' (' + x.estado + ')').join('; ') + '.' : '') });
      continue;
    }
    const sp = p.reduce((a2, x) => a2 + (x.realizado || 0), 0);
    if (sp !== s.realizado) div({ tipo: 'planilha', indicador: s.descricao, chave, trecho_origem: origem(s), periodo: tri, a: { fonte: 'SIMAS', valor: s.realizado, previsto: s.previsto }, b: { fonte: 'Planilha de monitoramento (Anexo II)', valor: sp }, detalhe: 'SIMAS realizado ' + fmt(s.realizado) + ' (previsto ' + fmt(s.previsto) + ') x planilha somada ' + fmt(sp) + ' (' + p.map((x) => C.rotuloMes(x.mes) + ' ' + fmt(x.realizado)).join('; ') + ').' });
  }
  // 5) indicadores: valor 0 em todos os meses com meta "maior ou igual" (provável dado não importado)
  const porInd = new Map();
  for (const n of numeros.filter((x) => x.tipo === 'indicador')) { if (!porInd.has(n.chave)) porInd.set(n.chave, []); porInd.get(n.chave).push(n); }
  for (const [, lista] of porInd) {
    if (lista.length && lista.every((x) => x.realizado === 0) && /maior ou igual/i.test(lista[0].regra || '')) div({ tipo: 'indicador_zero', indicador: lista[0].descricao, trecho_origem: origem(lista[0]), periodo: tri, a: { fonte: 'SIMAS', valor: 0 }, b: { fonte: lista[0].regra, valor: null }, detalhe: 'O SIMAS mostra 0 e "Não" em todos os blocos (' + lista[0].regra + '). Pode ser dado não importado para o SIMAS.' });
  }
  return out;
}

module.exports = { atualizarAchados, gerarAchados, resumoSimples, ITEM_CODIGO, NOME_ITEM, eRelatorioSimas, lerSimas, registrar, visao, confirmar, conferir };
