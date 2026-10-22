'use strict';
// Relatórios importados para o Redator: guardam só o TEXTO extraído (o original segue no SEI) e servem de fonte para propor os quadros
// e para conferir os números do parecer. Só quem criou o parecer importa.
const U = require('../core/util');
const M = require('./minuta');
const X = require('./extrair-texto');
const trilha = require('./trilha');
const { erro } = require('./auth');
const propor = require('../modules/analista/propor-quadros');

const agora = () => new Date().toISOString();

function listar(db, parecerId) {
  M.obter(db, parecerId);
  return db.all('SELECT rel_id, nome, tipo, tamanho, paginas, length(texto) AS caracteres, criado_por, criado_em FROM parecer_relatorios WHERE parecer_id = ? ORDER BY rel_id', Number(parecerId));
}

async function importar(db, parecerId, usuario, dados) {
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const nome = String((dados && dados.nome) || 'relatorio').replace(/[\\/\r\n"]/g, '_').slice(0, 120);
  const buf = Buffer.from(String((dados && dados.base64) || ''), 'base64');
  const ex = await X.extrair(nome, buf);
  const hash = U.sha256(ex.texto);
  if (db.get('SELECT 1 FROM parecer_relatorios WHERE parecer_id = ? AND hash = ?', p.parecer_id, hash)) throw erro(409, 'Este relatório já foi importado neste parecer.');
  const id = Number(db.run('INSERT INTO parecer_relatorios (parecer_id, nome, tipo, tamanho, paginas, texto, hash, criado_por, criado_em) VALUES (?,?,?,?,?,?,?,?,?)', p.parecer_id, nome, ex.tipo, buf.length, ex.paginas, ex.texto, hash, usuario.login, agora()).lastInsertRowid);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'parecer_relatorios', registro: id, campo: 'importacao', valor_novo: { parecer: p.parecer_id, nome, tipo: ex.tipo, caracteres: ex.texto.length } });
  return { rel_id: id, caracteres: ex.texto.length, paginas: ex.paginas };
}

function remover(db, parecerId, usuario, relId) {
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const r = db.get('SELECT * FROM parecer_relatorios WHERE rel_id = ? AND parecer_id = ?', Number(relId), p.parecer_id);
  if (!r) throw erro(404, 'Relatório não encontrado.');
  db.run('DELETE FROM parecer_relatorios WHERE rel_id = ?', r.rel_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'parecer_relatorios', registro: r.rel_id, campo: 'remocao', valor_anterior: r.nome });
}

const textoDe = (db, parecerId) => db.all('SELECT nome, texto FROM parecer_relatorios WHERE parecer_id = ? ORDER BY rel_id', Number(parecerId));

async function proporQuadros(db, parecerId, usuario) {
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const rels = textoDe(db, p.parecer_id);
  if (!rels.length) throw erro(400, 'Importe ao menos um relatório antes.');
  const texto = rels.map((r) => '### ' + r.nome + '\n' + r.texto).join('\n\n');
  const PM = require('./parecer-modelo');
  const out = await propor.propor({ texto, meses: PM.periodoPorExtenso(p.competencias) });
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'proposta_quadros', valor_novo: out.ok ? out.provedor : 'sem IA' });
  return out;
}

// Aplica as linhas escolhidas pela pessoa nos quadros (acrescenta; não repete indicador já existente).
function aplicar(db, parecerId, usuario, quadros) {
  const PM = require('./parecer-modelo');
  const p = M.obter(db, parecerId);
  M.exigirCriador(p, usuario);
  const m = p.blocos.modelo || PM.montar(db, p.parecer_id, 'branco');
  let n = 0;
  for (const q of PM.MODELO.quadros) {
    const novas = Array.isArray(quadros && quadros[q.id]) ? quadros[q.id] : [];
    const atuais = m.quadros[q.id] || [];
    const nomes = new Set(atuais.map((l) => String(l[1] || '').toLowerCase()));
    for (const l of novas.slice(0, 60)) {
      if (!Array.isArray(l) || !String(l[1] || '').trim() || nomes.has(String(l[1]).toLowerCase())) continue;
      atuais.push(q.colunas.map((_, k) => String(l[k] === undefined || l[k] === null ? '' : l[k]).slice(0, 300))); nomes.add(String(l[1]).toLowerCase()); n++;
    }
    m.quadros[q.id] = atuais;
  }
  m.atualizado_em = agora();
  db.run('UPDATE pareceres SET blocos = ?, atualizado_em = ?, atualizado_por = ? WHERE parecer_id = ?', JSON.stringify(Object.assign(p.blocos, { modelo: m })), agora(), usuario.login, p.parecer_id);
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'quadros_importados', valor_novo: n + ' linha(s) aplicada(s)' });
  return { aplicadas: n };
}

// Conferência: números dos quadros do parecer que não aparecem em nenhum relatório importado.
function conferirQuadros(db, parecerId, modelo) {
  const rels = textoDe(db, parecerId);
  if (!rels.length || !modelo) return { achados: [], usado: false };
  const fonte = rels.map((r) => r.texto).join('\n');
  const achados = [];
  for (const [q, linhas] of Object.entries(modelo.quadros || {})) for (const l of linhas) {
    if (!String(l[1] || '').trim() || !/\d/.test(String(l[3] || ''))) continue;
    if (!propor.verificada(l, fonte)) achados.push({ gravidade: 'MÉDIA', tipo: 'Número fora dos relatórios', trecho: String(l[1]).slice(0, 120), risco: 'Os valores do indicador "' + l[1] + '" (' + q.toUpperCase().replace('Q', 'Quadro 0') + ': ' + l[3] + ') não aparecem nos relatórios importados.', sugestao: 'Confira o valor no relatório da unidade ou corrija o quadro.', origem: 'relatórios importados' });
  }
  return { achados, usado: true, relatorios: rels.length };
}

module.exports = { listar, importar, remover, proporQuadros, aplicar, conferirQuadros };
