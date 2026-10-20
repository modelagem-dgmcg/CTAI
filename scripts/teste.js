// Teste: reproduz os três descontos da UPA Olinda (maio + junho de 2026).
const igq = require('./igq.js');
const r = igq.carregarRegras();
let falhas = 0;
function confere(nome, obtido, esperado) {
  obtido = igq.arredondar2(obtido);
  const ok = Math.abs(obtido - esperado) < 0.005;
  console.log((ok ? 'OK    ' : 'FALHA ') + nome + ': ' + obtido.toFixed(2) + (ok ? '' : ' (esperado ' + esperado.toFixed(2) + ')'));
  if (!ok) falhas++;
}

// 1) Parecer 204/2026: 10% fixo nos dois meses
const fixo = igq.descontoMensal(r, 63, 'fixo').valor + igq.descontoMensal(r, 57, 'fixo').valor;
confere('parecer, 10% fixo (63 e 57)', fixo, 329492.83);

// 2) Planilha de descontos: IGQ 65 e 64, faixa 60-69 paga 4%, desconto 6% em cada mês
const planilha = igq.descontoMensal(r, 65, 'faixa').valor + igq.descontoMensal(r, 64, 'faixa').valor;
confere('planilha, faixas (65 e 64)', planilha, 197695.70);

// 3) Faixas com os pontos do parecer: 63 (6%) e 57 (8%)
const faixas = igq.descontoMensal(r, 63, 'faixa').valor + igq.descontoMensal(r, 57, 'faixa').valor;
confere('faixas com 63 e 57', faixas, 230644.98);

// 4) Pontos máximos somam 100
const maximo = r.indicadores.reduce((s, i) => s + i.max, 0);
confere('soma dos máximos', maximo, 100);

// 5) Indicadores de abril com resultado conhecido (verde 26,73; amarelo 26,28; vermelho 23,51; retorno 0,15)
const abril = igq.calcularIGQ(r, { '2.1': 26.73, '2.2': 26.28, '2.3': 23.51, '2.4': 0.15, '2.5': true });
confere('eficiência de abril (esperado 20)', abril.total, 20);

if (falhas) { console.log('\n' + falhas + ' falha(s)'); process.exit(1); }
console.log('\nOK');
