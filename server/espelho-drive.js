'use strict';
// Espelho do histórico em uma planilha do Google Drive da CTAI.
// O banco do CTAI continua sendo a base de trabalho; a planilha é uma CÓPIA (consulta, backup e leitura por quem não usa o sistema).
// Funciona por um "webhook" em Apps Script colado na própria planilha (veja docs/ESPELHO-DRIVE.md). Sem CTAI_ESPELHO_URL, fica DESLIGADO e nada sai do servidor.
// Interface: estado(), enviar(registros), restaurar(). Nada aqui inventa credenciais: o endereço e o código secreto vêm do ambiente.
const config = require('./config');

const ABAS = {
  hist_relatorios: ['hist_id', 'contrato_id', 'trimestre', 'documento_tipo', 'numero_parecer', 'nome_arquivo', 'hash', 'paginas', 'igq', 'desconto_pct', 'desconto_valor', 'estado', 'origem', 'observacao', 'criado_por', 'criado_em', 'confirmado_por', 'confirmado_em'],
  hist_indicadores: ['id', 'hist_id', 'indicador_id', 'nome', 'valor', 'pontos', 'max', 'trecho', 'verificada'],
  hist_achados: ['id', 'hist_id', 'tipo', 'descricao', 'gravidade', 'trecho', 'verificada'],
  hist_recomendacoes: ['id', 'hist_id', 'texto', 'tema', 'situacao', 'trecho', 'verificada', 'situacao_por', 'situacao_em', 'situacao_nota'],
};
const CHAVE = { hist_relatorios: 'hist_id', hist_indicadores: 'id', hist_achados: 'id', hist_recomendacoes: 'id' };

const url = () => String(config.env('CTAI_ESPELHO_URL', '')).trim();
const token = () => String(config.env('CTAI_ESPELHO_TOKEN', '')).trim();
const ligado = () => /^https:\/\//i.test(url()) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url()); // http só para teste local

function estado() {
  return { ligado: ligado(), motivo: ligado() ? null : 'Desligado: falta o endereço da planilha (CTAI_ESPELHO_URL).', abas: Object.keys(ABAS) };
}

// Só o histórico CONFIRMADO vai para a planilha. Rascunho fica só no sistema.
function registrosConfirmados(db) {
  const rel = db.all("SELECT " + ABAS.hist_relatorios.join(', ') + " FROM hist_relatorios WHERE estado = 'confirmado' ORDER BY hist_id");
  const ids = rel.map((r) => r.hist_id);
  const filhos = (tabela) => (ids.length ? db.all('SELECT ' + ABAS[tabela].join(', ') + ' FROM ' + tabela + ' WHERE hist_id IN (' + ids.map(() => '?').join(',') + ') ORDER BY id', ...ids) : []);
  return { hist_relatorios: rel, hist_indicadores: filhos('hist_indicadores'), hist_achados: filhos('hist_achados'), hist_recomendacoes: filhos('hist_recomendacoes') };
}

async function chamar(metodo, corpo) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url() + (metodo === 'GET' ? (url().includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token()) : ''), {
      method: metodo, redirect: 'follow', signal: ctrl.signal,
      headers: metodo === 'POST' ? { 'content-type': 'text/plain;charset=utf-8' } : undefined, // Apps Script aceita assim sem pré-verificação do navegador
      body: metodo === 'POST' ? JSON.stringify(Object.assign({ token: token() }, corpo)) : undefined,
    });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { /* resposta não é JSON */ }
    if (!r.ok || !j || j.ok === false) throw new Error((j && j.erro) || ('resposta ' + r.status));
    return j;
  } finally { clearTimeout(t); }
}

// Envia o histórico confirmado (substitui o conteúdo de cada aba). Nunca derruba quem chamou: devolve { ok, motivo }.
async function enviar(registros) {
  if (!ligado()) return { ok: false, desligado: true, motivo: estado().motivo };
  try { const r = await chamar('POST', { acao: 'substituir', abas: registros, colunas: ABAS, chaves: CHAVE }); return { ok: true, linhas: r.linhas || null }; }
  catch (e) { return { ok: false, motivo: 'Não consegui falar com a planilha: ' + String(e.message || e).slice(0, 120) }; }
}

// Lê a planilha de volta (restauração depois de uma perda do banco). Devolve { abas } no mesmo formato de registrosConfirmados.
async function restaurar() {
  if (!ligado()) return { ok: false, desligado: true, motivo: estado().motivo };
  try { const r = await chamar('GET'); return { ok: true, abas: r.abas || {} }; }
  catch (e) { return { ok: false, motivo: 'Não consegui ler a planilha: ' + String(e.message || e).slice(0, 120) }; }
}

module.exports = { estado, enviar, restaurar, registrosConfirmados, ABAS, CHAVE };
