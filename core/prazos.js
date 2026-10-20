'use strict';
// Prazos de entrega do mês (lista oficial de obrigatórios da UPA):
//   SEI   até o dia 20 do mês seguinte à competência;
//   SIMAS até o dia 25 do mês seguinte.
// Funções puras, com datas em texto AAAA-MM-DD, para testar sem relógio.
const DIA_SEI = 20;
const DIA_SIMAS = 25;
const AVISO_DIAS = 5; // a partir de quantos dias antes o prazo vira "a vencer"

const pad = (n) => String(n).padStart(2, '0');

function prazosDaCompetencia(competenciaId) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competenciaId || ''));
  if (!m) return null;
  let ano = Number(m[1]), mes = Number(m[2]) + 1;
  if (mes > 12) { mes = 1; ano += 1; }
  const base = ano + '-' + pad(mes) + '-';
  return { sei: base + pad(DIA_SEI), simas: base + pad(DIA_SIMAS) };
}

const br = (iso) => iso.split('-').reverse().join('/');
const emDias = (iso) => Math.round(Date.UTC(...iso.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) / 86400000);
const diasEntre = (de, ate) => emDias(ate) - emDias(de); // positivo quando "ate" é depois de "de"

// prazo, entregue e hoje: AAAA-MM-DD. entregue pode ser null (ainda não entregue).
function avaliar(prazo, entregue, hoje) {
  if (entregue) {
    const atraso = diasEntre(prazo, entregue);
    if (atraso <= 0) return { situacao: 'entregue no prazo', nivel: 'ok', dias: 0, mensagem: 'Entregue em ' + br(entregue) + ', dentro do prazo.' };
    return { situacao: 'entregue com atraso', nivel: 'alta', dias: atraso, mensagem: 'Entregue em ' + br(entregue) + ', ' + atraso + ' dia(s) depois do prazo.' };
  }
  const resta = diasEntre(hoje, prazo);
  if (resta < 0) return { situacao: 'vencido', nivel: 'alta', dias: -resta, mensagem: 'Prazo vencido há ' + (-resta) + ' dia(s).' };
  if (resta <= AVISO_DIAS) return { situacao: 'a vencer', nivel: 'atencao', dias: resta, mensagem: resta === 0 ? 'O prazo termina hoje.' : 'Faltam ' + resta + ' dia(s) para o prazo.' };
  return { situacao: 'no prazo', nivel: 'info', dias: resta, mensagem: 'Faltam ' + resta + ' dia(s) para o prazo.' };
}

module.exports = { DIA_SEI, DIA_SIMAS, AVISO_DIAS, prazosDaCompetencia, avaliar, diasEntre };
