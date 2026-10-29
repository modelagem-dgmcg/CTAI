'use strict';
// Registro de contratos e termos aditivos por unidade (planilha "CONTRATOS E T.A's OSS"): contrato vigente, aditivos, apostilamentos, TAC e vigência.
// Importado pela Gestão CTAI com prévia. O que a analista já conferiu não é sobrescrito. Não guarda valores nem metas (isso vem da leitura dos documentos).
const L = require('../core/linhas');
const A = require('./auth');
const trilha = require('./trilha');

const { erro } = A;
const INSTR = ['CONTRATO', 'ADITIVO', 'APOSTILAMENTO', 'TAC', 'OUTROS'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const agora = () => new Date().toISOString();
const iso = (s) => { const t = String(s || '').trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[1] + '-' + m[2] + '-' + m[3]; m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t); if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); return ''; };
const br = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };

function ler(db, csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw erro(400, 'Envie o conteúdo do arquivo CSV.');
  const { cabecalho, registros } = L.lerCSV(csv);
  const col = {};
  for (const c of cabecalho) col[norm(c).replace(/ /g, '_')] = c;
  const achar = (...n) => { for (const x of n) if (col[x]) return col[x]; return null; };
  const c = { ins: achar('instrumento'), num: achar('numero', 'n'), cg: achar('contrato_gestao', 'c_g'), sei: achar('sei'), oss: achar('oss'), un: achar('unidade_sistema', 'unidade'),
    obj: achar('objeto'), tipo: achar('tipo_ta', 'tipo_t_a'), reg: achar('regular'), sit: achar('vigencia_cg'), ini: achar('inicio', 'vigencia_inicio'), fim: achar('fim', 'vigencia_fim'), obs: achar('observacao') };
  if (!c.ins || !c.cg || !c.un) throw erro(400, 'O arquivo precisa ter as colunas "instrumento", "contrato_gestao" e "unidade_sistema". Use o arquivo gerado para esta tela.');
  const porNome = new Map(db.all('SELECT contrato_id, unidade FROM contratos').map((u) => [norm(u.unidade), u]));
  const linhas = [], naoCasadas = new Map(); const vistos = new Map();
  for (const r of registros) {
    const ins = String(r[c.ins] || '').trim().toUpperCase();
    if (!INSTR.includes(ins)) continue;
    const nome = String(r[c.un] || '').trim();
    const un = porNome.get(norm(nome));
    if (!un) { naoCasadas.set(nome || '(sem unidade)', (naoCasadas.get(nome || '(sem unidade)') || 0) + 1); continue; }
    const v = (k) => (c[k] ? String(r[c[k]] || '').trim() : '');
    const base = [un.contrato_id, ins, v('num').toLowerCase(), v('cg'), iso(v('ini')), v('sei')].join('|');
    const seq = (vistos.get(base) || 0) + 1; vistos.set(base, seq);
    linhas.push({ chave: base + '|' + seq, contrato_id: un.contrato_id, unidade: un.unidade, instrumento: ins, numero: v('num'), contrato_gestao: v('cg'), sei: v('sei'), oss: v('oss'), objeto: v('obj'),
      tipo_ta: v('tipo'), regular: v('reg'), situacao_cg: v('sit'), inicio: iso(v('ini')), fim: iso(v('fim')), observacao: v('obs') });
  }
  return { linhas, naoCasadas: [...naoCasadas.entries()].map(([nome, n]) => ({ nome, linhas: n })) };
}

function previa(db, csv) {
  const { linhas, naoCasadas } = ler(db, csv);
  const atuais = new Map(db.all('SELECT chave, confirmado_em FROM registro_instrumentos').map((x) => [x.chave, x]));
  const por = new Map();
  for (const l of linhas) {
    const u = por.get(l.contrato_id) || { contrato_id: l.contrato_id, unidade: l.unidade, novos: 0, atualizados: 0, mantidos: 0, contratos: 0, aditivos: 0, apostilamentos: 0 };
    const a = atuais.get(l.chave);
    if (!a) u.novos++; else if (a.confirmado_em) u.mantidos++; else u.atualizados++;
    if (l.instrumento === 'CONTRATO') u.contratos++; else if (l.instrumento === 'ADITIVO') u.aditivos++; else if (l.instrumento === 'APOSTILAMENTO') u.apostilamentos++;
    por.set(l.contrato_id, u);
  }
  const unidades = [...por.values()].sort((a, b) => a.unidade.localeCompare(b.unidade));
  const sum = (k) => unidades.reduce((t, u) => t + u[k], 0);
  return { resumo: { linhas: linhas.length, unidades: unidades.length, novos: sum('novos'), atualizados: sum('atualizados'), mantidos: sum('mantidos') }, unidades, naoCasadas, podeGravar: linhas.length > 0 };
}

function gravar(db, quem, csv) {
  const { linhas } = ler(db, csv);
  if (!linhas.length) throw erro(400, 'Nenhuma linha do arquivo corresponde a uma unidade cadastrada.');
  let novos = 0, atualizados = 0, mantidos = 0;
  db.tx(() => {
    for (const l of linhas) {
      const a = db.get('SELECT id, confirmado_em FROM registro_instrumentos WHERE chave = ?', l.chave);
      if (a && a.confirmado_em) { mantidos++; continue; }
      if (a) {
        db.run('UPDATE registro_instrumentos SET numero=?, contrato_gestao=?, sei=?, oss=?, objeto=?, tipo_ta=?, regular=?, situacao_cg=?, inicio=?, fim=?, observacao=?, importado_por=?, importado_em=? WHERE id = ?',
          l.numero, l.contrato_gestao, l.sei, l.oss, l.objeto, l.tipo_ta, l.regular, l.situacao_cg, l.inicio, l.fim, l.observacao, quem, agora(), a.id); atualizados++;
      } else {
        db.run('INSERT INTO registro_instrumentos (chave, contrato_id, instrumento, numero, contrato_gestao, sei, oss, objeto, tipo_ta, regular, situacao_cg, inicio, fim, observacao, importado_por, importado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          l.chave, l.contrato_id, l.instrumento, l.numero, l.contrato_gestao, l.sei, l.oss, l.objeto, l.tipo_ta, l.regular, l.situacao_cg, l.inicio, l.fim, l.observacao, quem, agora()); novos++;
      }
    }
    trilha.registrar(db, { usuario: quem, tabela: 'registro_instrumentos', registro: 'importacao', campo: 'importado', valor_novo: { linhas: linhas.length, novos, atualizados, mantidos } });
  });
  return { novos, atualizados, mantidos, linhas: linhas.length };
}

const ordinal = (n) => { const m = /\d+/.exec(String(n || '')); return m ? Number(m[0]) : 0; };

// Contrato vigente da unidade e o que veio com ele (aditivos, apostilamentos, vigência final).
function resumo(db, contratoId) {
  const rows = db.all('SELECT * FROM registro_instrumentos WHERE contrato_id = ? ORDER BY inicio, id', contratoId);
  if (!rows.length) return null;
  const contratos = rows.filter((r) => r.instrumento === 'CONTRATO');
  const vigentes = contratos.filter((r) => !/ENCERR/i.test(r.situacao_cg));
  const base = (vigentes.length ? vigentes : contratos).slice().sort((a, b) => String(a.inicio).localeCompare(String(b.inicio))).pop();
  if (!base) return null;
  const grupo = rows.filter((r) => r.contrato_gestao === base.contrato_gestao && (!r.oss || !base.oss || norm(r.oss) === norm(base.oss)));
  const por = (i) => grupo.filter((r) => r.instrumento === i);
  const aditivos = por('ADITIVO'), apost = por('APOSTILAMENTO'), tac = por('TAC');
  const ult = aditivos.slice().sort((a, b) => ordinal(a.numero) - ordinal(b.numero)).pop();
  const fim = grupo.map((r) => r.fim).filter(Boolean).sort().pop() || base.fim || '';
  const encerrado = /ENCERR/i.test(base.situacao_cg);
  const conferido = grupo.length > 0 && grupo.every((r) => r.confirmado_em);
  const partes = ['Contrato de Gestão n.º ' + base.contrato_gestao + (base.oss ? ' (' + base.oss + ')' : '') + (encerrado ? ', encerrado' : '')];
  partes.push(aditivos.length ? aditivos.length + ' termo(s) aditivo(s) (último: ' + (ult && ult.numero ? ult.numero.replace(/\s+/g, '') + ' TA' : 'sem número') + (ult && ult.inicio ? ', de ' + br(ult.inicio) : '') + ')' : 'sem termo aditivo registrado');
  if (apost.length) partes.push(apost.length + ' apostilamento(s)');
  if (tac.length) partes.push(tac.length + ' TAC');
  const texto = partes.join('; ') + (fim ? '; vigência até ' + br(fim) : '') + '.';
  return { contrato: { numero: base.contrato_gestao, oss: base.oss, sei: base.sei, inicio: base.inicio, situacao: base.situacao_cg, encerrado }, vigencia_fim: fim, contagem: { aditivos: aditivos.length, apostilamentos: apost.length, tac: tac.length },
    ultimo_aditivo: ult ? { numero: ult.numero, inicio: ult.inicio, objeto: ult.objeto } : null, texto, conferido,
    instrumentos: grupo.map((r) => ({ id: r.id, instrumento: r.instrumento, numero: r.numero, sei: r.sei, objeto: r.objeto, tipo_ta: r.tipo_ta, regular: r.regular, inicio: r.inicio, fim: r.fim, observacao: r.observacao, confirmado: !!r.confirmado_em })) };
}

// A analista confere o que o sistema mostra; daí em diante uma nova importação não mexe nessas linhas.
function confirmar(db, usuario, contratoId) {
  const n = db.run('UPDATE registro_instrumentos SET confirmado_por = ?, confirmado_em = ? WHERE contrato_id = ? AND confirmado_em IS NULL', usuario.login, agora(), contratoId).changes;
  trilha.registrar(db, { usuario: usuario.login, tabela: 'registro_instrumentos', registro: contratoId, campo: 'confirmado', valor_novo: { linhas: n } });
  return { confirmadas: Number(n) };
}

// Para o Redator: linhas da seção 3 (Identificação).
function paraParecer(db, contratoId) {
  const r = resumo(db, contratoId);
  if (!r) return null;
  return { oss: r.contrato.oss || null, contrato: r.contrato.numero, vigencia_texto: r.texto.replace(/^Contrato de Gestão n\.º [^;]*; /, '') };
}

module.exports = { previa, gravar, resumo, confirmar, paraParecer };
