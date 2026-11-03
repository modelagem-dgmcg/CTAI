'use strict';
// Acervo CTAI no Google Drive: guarda o TEXTO (já sem dados de paciente) dos documentos que chegaram ao SEI.
// Estrutura: Acervo / <Unidade> / <Trimestre> / <Título> - SEI <número>.txt. O original nunca é guardado; o banco do CTAI continua sendo a base de trabalho.
// Falha do Drive nunca atrapalha quem está trabalhando: o item fica "pendente" e a administração reenvia.
const G = require('./google-drive');
const { mascarar } = require('./mascara');
const agora = () => new Date().toISOString();
const limpoNome = (s) => String(s || 'sem nome').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sem nome';

function textoDeConteudo(c) { // a minuta guarda JSON: junta só os textos, na ordem
  let o = c; if (typeof c === 'string') { try { o = JSON.parse(c); } catch (_) { return c; } }
  const out = []; const ande = (v) => { if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); } else if (Array.isArray(v)) v.forEach(ande); else if (v && typeof v === 'object') Object.values(v).forEach(ande); };
  ande(o); return out.join('\n\n');
}
function montar(db, origem, id) {
  if (origem === 'documento') {
    const d = db.get('SELECT * FROM documentos WHERE doc_id = ?', id); if (!d || !d.sei_numero) return null;
    const c = d.contrato_id ? db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', d.contrato_id) : null;
    return { unidade: c ? c.unidade : 'Sem unidade', trimestre: d.trimestre || 'Sem trimestre', titulo: d.titulo, sei: d.sei_numero, tipo: d.tipo, texto: d.texto };
  }
  if (origem === 'parecer') {
    const p = db.get('SELECT * FROM pareceres WHERE parecer_id = ?', id); if (!p || !p.sei_numero) return null;
    const v = db.get("SELECT * FROM versoes_minuta WHERE parecer_id = ? AND status = 'autorizada' ORDER BY numero DESC LIMIT 1", id) || db.get('SELECT * FROM versoes_minuta WHERE parecer_id = ? ORDER BY numero DESC LIMIT 1', id);
    const c = db.get('SELECT unidade FROM contratos WHERE contrato_id = ?', p.contrato_id);
    return { unidade: c ? c.unidade : p.contrato_id, trimestre: p.trimestre, titulo: p.titulo || ('Parecer ' + (p.numero_parecer || '')), sei: p.sei_numero, tipo: 'parecer', texto: v ? textoDeConteudo(v.conteudo) : '' };
  }
  return null;
}

async function arquivar(db, origem, id) {
  const reg = db.get('SELECT * FROM acervo_arquivos WHERE origem = ? AND origem_id = ?', origem, id);
  if (!reg) db.run("INSERT INTO acervo_arquivos (origem, origem_id, estado, tentativas, atualizado_em) VALUES (?,?,'pendente',0,?)", origem, id, agora());
  if (!G.ligado()) { db.run("UPDATE acervo_arquivos SET estado = 'pendente', erro = 'Acervo desligado: faltam as variáveis do Google Drive.', atualizado_em = ? WHERE origem = ? AND origem_id = ?", agora(), origem, id); return { ok: false, motivo: 'desligado' }; }
  try {
    const m = montar(db, origem, id); if (!m) throw new Error('Documento sem número do SEI.');
    const raiz = G.pastaRaiz();
    const pu = await G.garantirPasta(limpoNome(m.unidade), raiz);
    const pt = await G.garantirPasta(limpoNome(m.trimestre), pu);
    const nome = limpoNome(m.titulo) + ' - SEI ' + limpoNome(m.sei) + '.txt';
    const corpo = ['ACERVO CTAI — texto sem dados de paciente (o original não é guardado)', 'Unidade: ' + m.unidade, 'Trimestre: ' + m.trimestre, 'Tipo: ' + m.tipo, 'Número no SEI: ' + m.sei, 'Arquivado em: ' + agora(), '', mascarar(m.texto).texto].join('\n');
    const r = await G.gravarTexto(nome, corpo, pt);
    db.run("UPDATE acervo_arquivos SET estado = 'arquivado', drive_id = ?, caminho = ?, erro = NULL, tentativas = tentativas + 1, atualizado_em = ? WHERE origem = ? AND origem_id = ?", r.id, m.unidade + ' / ' + m.trimestre + ' / ' + nome, agora(), origem, id);
    return { ok: true };
  } catch (e) {
    db.run("UPDATE acervo_arquivos SET estado = 'pendente', erro = ?, tentativas = tentativas + 1, atualizado_em = ? WHERE origem = ? AND origem_id = ?", String(e.message || e).slice(0, 200), agora(), origem, id);
    return { ok: false, motivo: String(e.message || e) };
  }
}
// Chamado quando o número do SEI é registrado. Não espera, não quebra nada.
function agendar(db, origem, id) { Promise.resolve().then(() => arquivar(db, origem, id)).catch(() => {}); }

async function reenviarPendentes(db) {
  const l = db.all("SELECT origem, origem_id FROM acervo_arquivos WHERE estado = 'pendente' ORDER BY id LIMIT 50");
  let ok = 0; for (const x of l) if ((await arquivar(db, x.origem, x.origem_id)).ok) ok++;
  return { tentados: l.length, arquivados: ok };
}
function estado(db) {
  const n = (e) => db.get('SELECT COUNT(*) AS n FROM acervo_arquivos WHERE estado = ?', e).n;
  return { ligado: G.ligado(), conta: G.emailConta(), motivo: G.ligado() ? null : 'Desligado: falta a chave da conta de serviço (CTAI_DRIVE_CHAVE) ou a pasta do Acervo (CTAI_ACERVO_PASTA).',
    arquivados: n('arquivado'), pendentes: n('pendente'), ultimos: db.all('SELECT origem, origem_id, estado, caminho, erro, atualizado_em FROM acervo_arquivos ORDER BY atualizado_em DESC LIMIT 15') };
}
module.exports = { arquivar, agendar, reenviarPendentes, estado, textoDeConteudo };
