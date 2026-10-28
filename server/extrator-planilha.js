'use strict';
// Leitura de NÚMEROS da Planilha de Monitoramento (Anexo II) da UPAE: determinística, sem IA.
// O PDF da planilha costuma ser lido por OCR: a ordem das linhas muda de um mês para outro, rótulos se perdem e vírgulas somem.
// Por isso o leitor só aceita linha que (1) tem rótulo conhecido ou bloco reconhecível e (2) fecha as contas (E ÷ Meta ≈ % impresso).
// O que não fecha entra com o aviso "[confira ...]" no trecho; o que não é reconhecido NÃO entra (vai para a lista "não lido").
// Tudo sai como PROPOSTO: a analista confere e confirma.
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "1.872" -> 1872 (milhar); "43,29%" -> 43.29; "125.10" -> 125.1; "38,4615" -> 38.4615
function numero(tok, ultimo) {
  const t = String(tok).replace('%', '').trim();
  if (!/^-?\d[\d.,]*$/.test(t)) return null;
  if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(t) && !ultimo) return Number(t.replace(/[.,]/g, ''));
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+[.,]\d+$/.test(t)) return Number(t.replace(',', '.'));
  return null;
}
// separa rótulo e números de uma linha ("Fisioterapia/Sessões 2112 1092 949 143 0 1108 85,65")
function linha(l) {
  const toks = String(l).replace(/[|]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let i = toks.length; const nums = [];
  while (i > 0) {
    const t = toks[i - 1];
    const n = /^-?[\d.,]+%?$/.test(t) ? numero(t, nums.length === 0 || /%$/.test(t)) : null;
    if (n === null) break;
    nums.unshift({ v: n, pct: /%$/.test(t), bruto: t }); i--;
  }
  return { rotulo: toks.slice(0, i).join(' '), nums, bruto: String(l).replace(/\s+/g, ' ').trim() };
}
const aprox = (a, b, tol) => a !== null && b !== null && Math.abs(a - b) <= tol;

function mesDoTexto(texto) {
  const m = new RegExp('Registro Mensal\\s*[-–—]?\\s*(' + MESES.join('|') + ')\\s*(?:de\\s*)?(20\\d{2})', 'i').exec(sem(texto).replace(/(\w) (\w)/g, '$1 $2') && String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '')) ;
  if (!m) return null;
  return m[2] + '-' + String(MESES.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0');
}

// Valida E ÷ Meta contra o % impresso. Devolve aviso (ou null) e o % que vale.
function conferePct(e, meta, pctImpresso) {
  if (meta === null || meta === undefined || meta === 0 || e === null) return { aviso: null, pct: pctImpresso };
  const calc = (e / meta) * 100;
  if (pctImpresso === null || pctImpresso === undefined) return { aviso: null, pct: Math.round(calc * 100) / 100 };
  if (aprox(calc, pctImpresso, 0.6)) return { aviso: null, pct: pctImpresso };
  if (aprox(calc, pctImpresso / 100, 0.6)) return { aviso: 'percentual impresso sem vírgula (OCR): usado o recalculado', pct: Math.round(calc * 100) / 100 };
  return { aviso: 'percentual impresso (' + pctImpresso + ') diverge de executado ÷ meta (' + (Math.round(calc * 100) / 100) + ')', pct: null };
}

function extrairPlanilha(texto) {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !/^--- p[aá]gina \d+ ---$/.test(l));
  const mes = mesDoTexto(texto);
  const saida = []; const naoLidos = []; const vistos = new Set();
  const poe = (chave, rotulo, campos, bruto, aviso) => {
    if (vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(Object.assign({ chave, rotulo, meta: null, ofertado: null, regulado: null, realizado: null, pct: null, pct_ofertado: null, trecho: (aviso ? '[confira: ' + aviso + '] ' : '') + String(bruto).slice(0, 300), periodo: mes }, campos));
  };
  // linhas "D A E PF C [Meta [%]]" (disponibilizado, agendado, executado, faltosos, cancelados)
  const registro = (chave, rotulo, L) => {
    const n = L.nums.map((x) => x.v);
    if (n.length < 5) return false;
    const temPct = L.nums.length >= 7 && L.nums[L.nums.length - 1].v !== null;
    const meta = n.length >= 7 ? n[5] : (n.length === 6 ? n[5] : null);
    const pctImp = n.length >= 7 ? n[6] : null;
    const c = conferePct(n[2], meta, pctImp);
    poe(chave, rotulo, { ofertado: n[0], regulado: n[1], realizado: n[2], meta, pct: c.pct }, L.bruto, c.aviso);
    void temPct;
    return true;
  };
  // blocos: acumula as linhas até um "Total" de 7 números e classifica o bloco pelos rótulos
  let bloco = [];
  const fechaBloco = (tot) => {
    const rot = bloco.map((b) => sem(b.rotulo));
    const tem = (re) => rot.some((r) => re.test(r));
    const T = tot.nums.map((x) => x.v);
    if (tem(/fisioterapia sessoes/)) {
      registro('sessoes_reabilitacao', 'Sessões de reabilitação (total)', tot);
      for (const b of bloco) { const r = sem(b.rotulo); if (/^fisioterapia sessoes/.test(r)) registro('sessoes_fisioterapia', 'Sessões: Fisioterapia', b); else if (/^fonoaudiologia sessoes/.test(r) || (/sessoes/.test(r) && /fono/.test(r))) registro('sessoes_fonoaudiologia', 'Sessões: Fonoaudiologia', b); else if (/terapeuta ocupacional sessoes/.test(r)) registro('sessoes_terapia_ocupacional', 'Sessões: Terapia Ocupacional', b); }
    } else if (tem(/pessoas com estomia/)) {
      for (const b of bloco) {
        const r = sem(b.rotulo); const n = b.nums.map((x) => x.v);
        if (/pessoas com estomia/.test(r) && n.length >= 5) registro('ostomizados_pessoas', 'Pessoas com estomia (programa de ostomizados)', b);
        else if (/bexiga neurogenica/.test(r)) { const m = b.nums.map((x) => x.v); if (m.length >= 5) registro('bexiga_neurogenica_pessoas', 'Pessoas com bexiga neurogênica', b); else if (m.length >= 3) { const meta = m.length >= 4 ? m[m.length - 1] : null; poe('bexiga_neurogenica_pessoas', 'Pessoas com bexiga neurogênica', { ofertado: m[0], regulado: m[1], realizado: m[2], meta, pct: conferePct(m[2], meta, null).pct }, b.bruto, 'linha com menos colunas que o modelo (OCR): meta tomada da última coluna, conferir'); } }
      }
      const pe = bloco.findIndex((b) => /pe diabetico/.test(sem(b.rotulo)));
      if (pe >= 0 && bloco[pe + 1] && bloco[pe + 1].nums.length >= 4) { const m = bloco[pe + 1].nums.map((x) => x.v); poe('pe_diabetico_pessoas', 'Pessoas com pé diabético e feridas complexas', { ofertado: m[0], regulado: m[1], realizado: m[2], meta: m.length >= 4 ? m[3] : null }, bloco[pe].bruto + ' / ' + bloco[pe + 1].bruto, 'linha incompleta (OCR): conferir meta'); }
      registro('programas_total', 'Programas assistenciais (total)', tot);
    } else if (tem(/neurodiversidade/) || (rot.length > 5 && T[2] > 500)) {
      registro('consultas_nao_medicas', 'Consultas de outros profissionais de nível superior (total)', tot);
    } else if (bloco.some((b) => /^enfermagem/.test(sem(b.rotulo)) && b.nums.length >= 7)) {
      // atendimentos de ostomizados em sessões (modelo anterior ao 10º termo aditivo): a linha de Enfermagem leva a meta do programa
      const enf = bloco.find((b) => /^enfermagem/.test(sem(b.rotulo)) && b.nums.length >= 7);
      registro('ostomizados_atendimentos', 'Atendimentos de ostomizados (sessões de enfermagem; NÃO é número de pacientes)', enf);
      registro('ostomizados_atendimentos_total', 'Atendimentos de ostomizados (total das sessões)', tot);
    } else if (tem(/psiquiatria/)) {
      registro('pe_acessivel_total', 'PE Acessível (total)', tot);
    } else naoLidos.push('bloco "Total" não reconhecido: ' + tot.bruto);
    bloco = [];
  };
  const tabelaConsultasMedicas = []; // linha "Total" longa da tabela de especialidades médicas
  for (let i = 0; i < linhas.length; i++) {
    const L = linha(linhas[i]);
    const r = sem(L.rotulo);
    if (!L.nums.length) { continue; }
    // queixas, satisfação, perda primária, absenteísmo
    if (/^queixas recebidas/.test(r) && L.nums.length === 1) { poe('queixas_recebidas', 'Queixas recebidas', { realizado: L.nums[0].v }, L.bruto); continue; }
    if (/^queixas tratadas/.test(r) && L.nums.length === 1) { poe('queixas_tratadas', 'Queixas tratadas', { realizado: L.nums[0].v }, L.bruto); continue; }
    if (!L.rotulo && L.nums.length === 3 && L.nums[2].pct !== undefined && /satisfa/.test(sem(linhas.slice(Math.max(0, i - 12), i).join(' ')))) { const n = L.nums.map((x) => x.v); poe('satisfacao', 'Pesquisa de satisfação (respostas positivas / aplicadas)', { realizado: n[0], regulado: n[1], pct: n[2] }, L.bruto, aprox((n[0] / n[1]) * 100, n[2], 0.6) ? null : 'índice impresso diverge de positivas ÷ aplicadas'); continue; }
    if (/^total/.test(r) && L.nums.length === 3 && /perda primaria/.test(sem(linhas.slice(Math.max(0, i - 40), i).join(' ')))) { const n = L.nums.map((x) => x.v); poe('perda_primaria', 'Perda primária (total)', { ofertado: n[0], realizado: n[1], pct: n[2] }, L.bruto, n[1] < 0 ? 'valor negativo na planilha (conferir)' : null); continue; }
    if (/^total/.test(r) && L.nums.length === 12 && /absenteismo/.test(sem(linhas.slice(Math.max(0, i - 40), i).join(' ')))) { const n = L.nums.map((x) => x.v); poe('absenteismo_consultas_medicas', 'Taxa de absenteísmo, consultas médicas (agendados e faltosos)', { regulado: n[9], realizado: n[10], pct: n[11] }, L.bruto, aprox((n[10] / n[9]) * 100, n[11], 0.6) ? null : 'taxa impressa diverge de faltosos ÷ agendados'); continue; }
    // tabela de consultas médicas: o "Total" tem muitos números; os últimos são agendado, disponibilizado, executado, meta e %
    if (/^total/.test(r) && L.nums.length >= 14) {
      const n = L.nums.map((x) => x.v); const k = n.length;
      const meta = n[k - 2], e = n[k - 3];
      const c = conferePct(e, meta, n[k - 1]);
      bloco = []; // as linhas por especialidade da tabela médica não pertencem aos blocos seguintes
      if (!tabelaConsultasMedicas.length) { tabelaConsultasMedicas.push(1); poe('consultas_medicas', 'Consultas médicas especializadas (total)', { regulado: n[k - 5], ofertado: n[k - 4], realizado: e, meta, pct: c.pct }, L.bruto, c.aviso); }
      continue;
    }
    // total de 7 números fecha um bloco
    if (/^total$/.test(r) && L.nums.length === 7) { fechaBloco(L); continue; }
    if (/^total$/.test(r) && L.nums.length >= 5 && bloco.length) { fechaBloco(L); continue; }
    // linhas soltas conhecidas
    if (/^mamografia/.test(r) && L.nums.length >= 4) { const n = L.nums.map((x) => x.v); poe('mamografia', 'Exame de mamografia', { regulado: n[0], realizado: n[1], pct: n.length >= 5 ? n[4] : null }, L.bruto, n[0] === n[1] ? null : 'agendado diferente de executado'); continue; }
    if (/^neuropediatra/.test(r) && L.nums.length >= 3) { const n = L.nums.map((x) => x.v); poe('neuropediatra', 'Neuropediatra (atendimento PE Acessível)', { ofertado: n[0], regulado: n[1], realizado: n[2] }, L.bruto, n[2] > n[1] ? 'executado maior que agendado (conferir)' : null); continue; }
    // linha de bloco (rótulo + ao menos 2 números)
    if (L.rotulo && L.nums.length >= 2) bloco.push(L);
  }
  // o que ficou em bloco sem fechar
  if (bloco.length) naoLidos.push(bloco.length + ' linha(s) numéricas fora dos blocos reconhecidos (especialidades, exames, pessoal): não usadas');
  const esperados = [['consultas_medicas', 'consultas médicas (total)'], ['consultas_nao_medicas', 'outros profissionais (total)'], ['sessoes_reabilitacao', 'sessões de reabilitação (total)'], ['mamografia', 'mamografia'], ['neuropediatra', 'neuropediatra']];
  const ostomizados = saida.some((x) => /^ostomizados/.test(x.chave));
  const faltou = esperados.filter(([c]) => !vistos.has(c)).map(([, n]) => n);
  if (!ostomizados) faltou.push('ostomizados');
  return { periodo: mes, numeros: saida, naoLidos, faltou };
}

module.exports = { extrairPlanilha, mesDoTexto, numero, linha };
