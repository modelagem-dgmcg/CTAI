'use strict';
// Leitura de CSV, proteção contra dado pessoal e validação das linhas brutas.
// Regra de ouro: nenhum dado de paciente entra no sistema. Só protocolo, datas, horas, minutos e categorias.
const { FONTES } = require('./formularios');
const U = require('./util');

// Nomes de coluna que indicam dado pessoal. Se aparecerem no cabeçalho, o arquivo inteiro é recusado.
const COLUNAS_PROIBIDAS = [
  'nome', 'paciente', 'nome_paciente', 'nome_do_paciente', 'nome_mae', 'mae', 'nome_da_mae', 'pai', 'cpf', 'rg', 'cns', 'cartao_sus',
  'prontuario', 'nascimento', 'data_nascimento', 'data_de_nascimento', 'dt_nascimento', 'endereco', 'logradouro', 'bairro',
  'telefone', 'celular', 'email', 'e_mail', 'responsavel', 'acompanhante', 'cid_nome_paciente',
];

function semAcento(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function chaveColuna(s) {
  return semAcento(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const RE_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
const RE_CNS = /^\d{15}$/;
const RE_EMAIL = /@[a-z0-9-]+\./i;
const RE_TELEFONE = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/;

// Devolve a razão se o valor parece dado pessoal; senão null.
function pareceDadoPessoal(valor, coluna) {
  const s = String(valor === null || valor === undefined ? '' : valor).trim();
  if (!s) return null;
  if (RE_CPF.test(s) && s.replace(/\D/g, '').length === 11) return 'parece um CPF';
  if (RE_CNS.test(s)) return 'parece um cartão SUS';
  if (RE_EMAIL.test(s)) return 'parece um e-mail';
  if (RE_TELEFONE.test(s) && coluna !== 'minutos') return 'parece um telefone';
  // Campos de identificação não aceitam nome de pessoa (duas ou mais palavras só de letras).
  if (['protocolo', 'codigo_pessoa'].includes(coluna)) {
    if (/^[A-Za-zÀ-ÿ'.-]+(\s+[A-Za-zÀ-ÿ'.-]+)+$/.test(s)) return 'parece um nome de pessoa';
  }
  return null;
}

// CSV simples: separador ; ou , (detectado), aspas duplas, BOM, linhas em branco ignoradas.
function lerCSV(texto) {
  let t = String(texto || '').replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  if (!linhas.length) return { cabecalho: [], registros: [] };
  const cabecalho = linhas[0].map((c) => c.trim());
  const registros = linhas.slice(1).map((l) => {
    const o = {};
    cabecalho.forEach((c, i) => { o[c] = (l[i] === undefined ? '' : l[i]).trim(); });
    return o;
  });
  return { cabecalho, registros };
}

function modeloCSV(fonteId) {
  const f = FONTES[fonteId];
  if (!f) throw new Error('Fonte desconhecida: ' + fonteId);
  const cab = f.colunas.map((c) => c.nome).join(';');
  const dica = f.colunas.map((c) => (c.tipo === 'data' ? 'AAAA-MM-DD' : c.tipo === 'hora' ? 'HH:MM' : c.tipo === 'sim_nao' ? 'sim' : c.tipo === 'selecao' ? (c.opcoes || [])[0] : c.tipo === 'numero' ? '0' : 'exemplo')).join(';');
  return '﻿' + cab + '\n' + dica + '\n';
}

// registros: [{coluna: valor}] com os nomes de coluna da fonte.
// Resultado: { ok, recusado, motivoRecusa, linhas: [normalizadas], erros: [], avisos: [] }
function validarLinhas(fonteId, cabecalho, registros, opcoes) {
  const f = FONTES[fonteId];
  if (!f) throw new Error('Fonte desconhecida: ' + fonteId);
  const op = opcoes || {};
  const resultado = { ok: false, recusado: false, motivoRecusa: null, linhas: [], erros: [], avisos: [] };

  // 1) Cabeçalho: recusa o arquivo se houver coluna de dado pessoal.
  const proibidas = [];
  for (const c of cabecalho) if (COLUNAS_PROIBIDAS.includes(chaveColuna(c))) proibidas.push(c);
  if (proibidas.length) {
    resultado.recusado = true;
    resultado.motivoRecusa = 'O arquivo tem coluna(s) de dado pessoal: ' + proibidas.join(', ') + '. Retire essas colunas e envie de novo. O sistema só aceita número de protocolo, datas, horas e categorias.';
    return resultado;
  }

  // 2) Colunas esperadas.
  const nomesEsperados = f.colunas.map((c) => c.nome);
  const mapa = {};
  for (const c of cabecalho) mapa[chaveColuna(c)] = c;
  const faltando = f.colunas.filter((c) => c.obrigatorio && !mapa[c.nome]).map((c) => c.nome);
  if (faltando.length) {
    resultado.erros.push({ linha: 0, coluna: faltando.join(', '), mensagem: 'Faltam colunas obrigatórias: ' + faltando.join(', ') + '. Use o modelo para baixar o cabeçalho correto.' });
    return resultado;
  }
  const extras = cabecalho.filter((c) => !nomesEsperados.includes(chaveColuna(c)));
  if (extras.length) resultado.avisos.push('Colunas ignoradas, que não fazem parte do modelo: ' + extras.join(', ') + '.');

  // 3) Linha a linha.
  const protocolosVistos = new Set();
  registros.forEach((reg, idx) => {
    const n = idx + 2; // linha na planilha (cabeçalho = 1)
    const bruto = {};
    for (const c of Object.keys(reg)) bruto[chaveColuna(c)] = reg[c];
    const out = { protocolo: null, data_inicio: null, hora_inicio: null, data_fim: null, hora_fim: null, minutos: null, categoria: null, dados: {} };
    let linhaOk = true;
    for (const col of f.colunas) {
      const v = bruto[col.nome];
      const texto = v === undefined || v === null ? '' : String(v).trim();
      if (!texto) {
        if (col.obrigatorio) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Valor obrigatório em branco.' }); linhaOk = false; }
        continue;
      }
      const pessoal = pareceDadoPessoal(texto, col.nome);
      if (pessoal) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'O valor ' + pessoal + '. Dado pessoal não é aceito.' }); linhaOk = false; continue; }
      let valor = texto;
      if (col.tipo === 'data') {
        valor = U.normalizarData(texto);
        if (!valor) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Data inválida: "' + texto + '". Use AAAA-MM-DD ou DD/MM/AAAA.' }); linhaOk = false; continue; }
        if (/nasc/i.test(col.nome)) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Data de nascimento não é aceita.' }); linhaOk = false; continue; }
      } else if (col.tipo === 'hora') {
        valor = U.normalizarHora(texto);
        if (!valor) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Hora inválida: "' + texto + '". Use HH:MM.' }); linhaOk = false; continue; }
      } else if (col.tipo === 'numero') {
        valor = U.numero(texto);
        if (valor === null || valor < 0) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Número inválido: "' + texto + '".' }); linhaOk = false; continue; }
      } else if (col.tipo === 'sim_nao') {
        const b = U.simNao(texto);
        if (b === null) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Responda "sim" ou "não" (recebido: "' + texto + '").' }); linhaOk = false; continue; }
        valor = b ? 'sim' : 'não';
      } else if (col.tipo === 'selecao') {
        const alvo = semAcento(texto).toLowerCase();
        const achada = (col.opcoes || []).find((o) => semAcento(o).toLowerCase() === alvo);
        if (!achada) { resultado.erros.push({ linha: n, coluna: col.nome, mensagem: 'Valor "' + texto + '" não é aceito. Use: ' + (col.opcoes || []).join(', ') + '.' }); linhaOk = false; continue; }
        valor = achada;
      }
      if (col.destino && col.destino !== 'dados') out[col.destino] = valor;
      else out.dados[col.nome] = valor;
    }
    // Minutos: exige minutos ou (data e hora) de início e fim.
    if (f.exige === 'minutos_ou_datas' && linhaOk) {
      if (out.minutos === null) {
        const m = U.minutosEntre(out.data_inicio, out.hora_inicio, out.data_fim, out.hora_fim);
        if (m === null) {
          resultado.erros.push({ linha: n, coluna: 'minutos', mensagem: 'Informe os minutos ou as datas e horas de início e fim (o fim não pode vir antes do início).' });
          linhaOk = false;
        } else { out.minutos = m; out.dados.minutos_calculados = true; }
      } else if (out.data_inicio && out.data_fim) {
        const m = U.minutosEntre(out.data_inicio, out.hora_inicio, out.data_fim, out.hora_fim);
        if (m !== null && Math.abs(m - out.minutos) > 1.01) resultado.avisos.push('Linha ' + n + ': os minutos informados (' + out.minutos + ') não batem com as datas e horas (' + Math.round(m) + ').');
      }
    }
    if (linhaOk && out.protocolo) {
      const chave = out.protocolo + '|' + (out.categoria || '') + '|' + (out.dados.tema || '');
      if (protocolosVistos.has(chave)) resultado.avisos.push('Linha ' + n + ': protocolo repetido (' + out.protocolo + ').');
      protocolosVistos.add(chave);
    }
    if (linhaOk) resultado.linhas.push(out);
  });
  resultado.ok = resultado.erros.length === 0;
  if (op.competencia) {
    const [ano, mes] = op.competencia.split('-').map(Number);
    let fora = 0;
    for (const l of resultado.linhas) {
      const d = l.data_inicio || l.data_fim;
      if (d) { const [a, m] = d.split('-').map(Number); if (a !== ano || m !== mes) fora++; }
    }
    if (fora) resultado.avisos.push(fora + ' linha(s) com data fora da competência ' + op.competencia + '. Confira se pertencem a este mês.');
  }
  return resultado;
}

module.exports = { lerCSV, modeloCSV, validarLinhas, pareceDadoPessoal, COLUNAS_PROIBIDAS, chaveColuna };
