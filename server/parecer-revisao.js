'use strict';
// Revisão completa do parecer: conferências locais (texto × dados da unidade), Analista (regras + IA mascarada, com as normas da unidade
// como contexto) e busca externa de normas e jurisprudência. Tudo vira "achado" na mesma forma do Analista.
const M = require('./minuta');
const PM = require('./parecer-modelo');
const normasDb = require('./normas');
const achadosDb = require('./achados');
const trilha = require('./trilha');
const analista = require('../modules/analista');
const busca = require('../modules/analista/busca-externa');
const gaocg = require('./gaocg');
const RP = require('./relatorios-parecer');

const achado = (gravidade, tipo, trecho, risco, sugestao, origem) => ({ gravidade, tipo, trecho, risco, sugestao, origem: origem || 'conferência local' });

function conferenciasLocais(db, c, texto) {
  const m = c.modelo;
  const out = [];
  if (!m) return [achado('ALTA', 'Modelo não iniciado', 'Parecer', 'Não há texto de parecer para revisar.', 'Escolha "Modelo padrão" ou "Em branco" e preencha.')];
  for (const s of PM.MODELO.secoes) {
    const t = String(m.secoes[s.id] || '').trim();
    if (!t) out.push(achado('MÉDIA', 'Seção vazia', s.titulo, 'A seção "' + s.titulo + '" está sem texto.', 'Preencha ou escreva que não há o que registrar.'));
    else if (/\(preencher\)|\(Insira|\(Informe|\(Registre|\(sem /.test(t) || /\{\w+\}/.test(t)) {
      const x = /\(preencher\)|\(Insira[^)]*\)|\(Informe[^)]*\)|\(Registre[^)]*\)|\(sem [^)]*\)|\{\w+\}/.exec(t)[0];
      out.push(achado('MÉDIA', 'Campo sem preencher', x, 'Há marcação de preenchimento pendente na seção "' + s.titulo + '".', 'Substitua pelo dado real antes de congelar.'));
    }
  }
  const id = c.identificacao;
  const outras = db.all('SELECT unidade FROM contratos WHERE contrato_id <> ?', id.contrato_id).map((x) => x.unidade).filter((u) => u && u.length > 6);
  for (const u of outras) if (texto.toLowerCase().includes(u.toLowerCase())) out.push(achado('ALTA', 'Nome de outra unidade', u, 'O texto cita "' + u + '", que não é a unidade deste parecer (' + id.unidade + '). Provável resto de parecer anterior.', 'Corrija o nome da unidade.'));
  const periodo = PM.periodoPorExtenso(id.competencias);
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const doPeriodo = new Set(id.competencias.map((k) => meses[Number(k.split('-')[1]) - 1]));
  const aqui = (m.secoes.analise || '') + ' ' + (m.secoes.simas || '');
  for (const mes of meses) if (!doPeriodo.has(mes) && new RegExp('\\b' + mes + '\\b', 'i').test(aqui)) out.push(achado('BAIXA', 'Mês fora do período', mes, 'O texto cita "' + mes + '", que não está no período analisado (' + periodo + '). Pode ser referência a outro trimestre (ex.: financeiro).', 'Confirme se a citação é intencional.'));
  const d = c.desconto && c.desconto.adotado;
  const txtDesc = String(m.secoes.descontos || '');
  if (d && d.total !== undefined) {
    if (d.total > 0 && /não incidir[áa] (apontamento|desconto)|n[ãa]o haver[áa] desconto/i.test(txtDesc)) out.push(achado('ALTA', 'Texto × desconto', 'Seção 6', 'O texto diz que não haverá desconto, mas o sistema apurou R$ ' + d.total + '.', 'Alinhe o texto ao valor adotado.'));
    if (d.total === 0 && /valor de R\$ [1-9]/.test(txtDesc)) out.push(achado('ALTA', 'Texto × desconto', 'Seção 6', 'O texto cita valor de desconto, mas o sistema apurou zero.', 'Alinhe o texto ao valor adotado.'));
  }
  const q3 = m.quadros.q3 || [];
  if (!q3.length) out.push(achado('BAIXA', 'Quadro 03 vazio', 'Quadro 03', 'Não há indicadores de qualidade no quadro.', 'Preencha o quadro ou use o modelo padrão com os dados do período.'));
  const parciais = q3.filter((l) => /parcial|não cumprid/i.test(l[5] || ''));
  if (parciais.length && /cumpriu (com )?(a meta de )?todos|todas as metas/i.test(m.secoes.finais + ' ' + txtDesc)) out.push(achado('ALTA', 'Texto × quadro', 'todas as metas', 'O texto diz que todas as metas foram cumpridas, mas o Quadro 03 tem ' + parciais.length + ' indicador(es) com meta parcial.', 'Revise o texto ou o quadro.'));
  for (const k of c.indicadores.competencias) if (k.igq.adotado !== null && k.igq.recalculado !== null && Math.abs(k.igq.adotado - k.igq.recalculado) > 0.001) out.push(achado('MÉDIA', 'Adotado ≠ recalculado', k.competencia, 'Em ' + k.competencia + ' o IGQ adotado (' + k.igq.adotado + ') difere do recalculado (' + k.igq.recalculado + ').', 'Registre a justificativa do ajuste no texto.'));
  return out;
}

async function revisar(db, parecerId, usuario) {
  const p = M.obter(db, parecerId);
  const c = M.conteudoAtual(db, p.parecer_id);
  const texto = PM.textoCompleto(c.modelo, c.identificacao.numero_parecer);
  const locais = conferenciasLocais(db, c, texto);
  const normas = normasDb.listar(db, { contrato_id: p.contrato_id, somenteVigentes: true }).slice(0, 15);
  const comp = c.indicadores.competencias[c.indicadores.competencias.length - 1];
  const ia = texto.trim() ? await analista.analisar({ texto, tipo: 'parecer técnico CTAI', contexto: { competencia: comp ? comp.competencia : null, unidade: c.identificacao.unidade, observacoes: normas.length ? 'Normas vigentes da unidade: ' + normas.map((n) => n.titulo).join('; ') : undefined } }) : { achados: [], provedor: 'nenhum', tentativas: [] };
  const ext = await busca.buscar({ texto, indicadores: comp ? comp.indicadores.map((i) => i.nome) : [] });
  const gc = await gaocg.conferirParecer(db, c, texto, usuario.login);
  const rq = RP.conferirQuadros(db, p.parecer_id, c.modelo);
  const todos = locais.concat(gc.achados, rq.achados, ia.achados);
  const ordem = ['ALTA', 'MÉDIA', 'BAIXA'];
  todos.sort((a, b) => ordem.indexOf(a.gravidade) - ordem.indexOf(b.gravidade));
  const salvos = achadosDb.salvar(db, { origem_tipo: 'minuta', origem_id: p.parecer_id, cid: comp ? comp.cid : null, achados: todos, provedor: 'revisão completa · ' + ia.provedor, usuario: usuario.login });
  trilha.registrar(db, { usuario: usuario.login, tabela: 'pareceres', registro: p.parecer_id, campo: 'revisao_completa', valor_novo: { achados: todos.length, busca_externa: ext.ok } });
  return { achados: todos, salvos, provedor: ia.provedor, tentativas: ia.tentativas, externa: ext, relatorios: { usado: rq.usado, n: rq.relatorios || 0 }, gaocg: { usado: gc.usado, lido_em: gc.lido_em || null, da_copia: !!gc.da_copia, informacao: gc.informacao || null }, normasDaUnidade: normas.length };
}

module.exports = { revisar, conferenciasLocais };
