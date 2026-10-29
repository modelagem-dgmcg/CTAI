'use strict';
// Remove unidades de exemplo ("Exemplo Alfa/Beta/Gama") criadas por engano ao gravar o arquivo modelo da importação.
// Só apaga se a unidade não tem nenhum dado ligado a ela (envios, carteira, relatórios etc.).
const trilha = require('./trilha');
const PADRAO = /^(UPA|UPAE|Hospital) Exemplo (Alfa|Beta|Gama)\b/;

function limpar(db) {
  const removidas = [];
  const tabelas = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name)
    .filter((n) => n !== 'contratos' && !/^(trilha|imp_carteira|importacoes)/.test(n));
  const comColuna = tabelas.filter((n) => db.all('PRAGMA table_info("' + n + '")').some((c) => c.name === 'contrato_id'));
  for (const c of db.all('SELECT contrato_id, unidade, demo FROM contratos')) {
    if (c.demo || !PADRAO.test(c.unidade)) continue;
    const usada = comColuna.some((n) => db.get('SELECT 1 FROM "' + n + '" WHERE contrato_id = ? LIMIT 1', c.contrato_id));
    if (usada) continue;
    db.run('DELETE FROM contratos WHERE contrato_id = ?', c.contrato_id);
    trilha.registrar(db, { usuario: 'sistema', tabela: 'contratos', registro: c.contrato_id, campo: 'unidade_removida', valor_anterior: c.unidade, motivo: 'Unidade de exemplo criada pelo arquivo modelo' });
    removidas.push(c.unidade);
  }
  return removidas;
}
module.exports = { limpar };
