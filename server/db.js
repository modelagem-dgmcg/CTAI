'use strict';
// Banco SQLite (módulo embutido do Node 22). Esquema: as 10 tabelas do esquema-banco.md
// mais usuários, sessões, fichas, envios, conferências, versões da minuta, achados e integrações.
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contratos (
  contrato_id TEXT PRIMARY KEY, unidade TEXT NOT NULL, oss TEXT, numero_cg TEXT, vigencia_inicio TEXT, vigencia_fim TEXT,
  valor_mensal_global REAL, base_desconto_mensal REAL, observacao TEXT, demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS termos_aditivos (
  ta_id TEXT PRIMARY KEY, contrato_id TEXT, numero TEXT, data_assinatura TEXT, vigencia_inicio TEXT, vigencia_fim TEXT, efeito TEXT, processo_sei TEXT
);
CREATE TABLE IF NOT EXISTS regras (
  regra_id TEXT PRIMARY KEY, versao TEXT NOT NULL, contrato_id TEXT, vigente_de TEXT, vigente_ate TEXT, arquivo_json TEXT, conteudo TEXT NOT NULL,
  pendencias TEXT, aprovada_por TEXT, data_aprovacao TEXT
);
CREATE TABLE IF NOT EXISTS competencias (
  cid INTEGER PRIMARY KEY AUTOINCREMENT, competencia_id TEXT NOT NULL, contrato_id TEXT NOT NULL, regra_id TEXT,
  mes_implantacao INTEGER NOT NULL DEFAULT 0, processo_sei TEXT, parecer_numero TEXT, status TEXT NOT NULL DEFAULT 'aberta',
  aberta_por TEXT, aberta_em TEXT, UNIQUE (contrato_id, competencia_id)
);
CREATE TABLE IF NOT EXISTS indicadores_oss (
  cid INTEGER NOT NULL, indicador_id TEXT NOT NULL, valor_declarado TEXT, pontos_declarados REAL, texto_analise TEXT, documento_id TEXT, envio_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ind_oss ON indicadores_oss (cid, indicador_id);
CREATE TABLE IF NOT EXISTS indicadores_ctai (
  cid INTEGER NOT NULL, indicador_id TEXT NOT NULL, valor_adotado TEXT, pontos_adotados REAL NOT NULL, motivo_do_zero TEXT,
  origem TEXT NOT NULL, justificativa TEXT, responsavel TEXT, atualizado_em TEXT, PRIMARY KEY (cid, indicador_id)
);
CREATE TABLE IF NOT EXISTS evidencias (
  evidencia_id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER NOT NULL, indicador_id TEXT NOT NULL, documento_id TEXT, tipo TEXT, paginas TEXT,
  hash_arquivo TEXT, lido_por TEXT, data_leitura TEXT, periodo_ok INTEGER, assinado_ok INTEGER, tipo_correto_ok INTEGER, aceita INTEGER, observacao TEXT,
  UNIQUE (cid, indicador_id)
);
CREATE TABLE IF NOT EXISTS linhas_rascunho (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER NOT NULL, fonte TEXT NOT NULL, protocolo TEXT, data_inicio TEXT, hora_inicio TEXT, data_fim TEXT, hora_fim TEXT,
  minutos REAL, categoria TEXT, dados TEXT, origem TEXT NOT NULL DEFAULT 'portal', lote_id INTEGER, confirmada INTEGER NOT NULL DEFAULT 1, criado_por TEXT, criado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_rasc ON linhas_rascunho (cid, fonte);
CREATE TABLE IF NOT EXISTS linhas_brutas (
  linha_id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER NOT NULL, envio_id INTEGER NOT NULL, fonte TEXT NOT NULL, protocolo TEXT, data_inicio TEXT, hora_inicio TEXT,
  data_fim TEXT, hora_fim TEXT, minutos REAL, categoria TEXT, dados TEXT, origem TEXT, documento_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_brutas ON linhas_brutas (envio_id, fonte);
CREATE TABLE IF NOT EXISTS divergencias (
  divergencia_id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER NOT NULL, indicador_id TEXT, tema TEXT NOT NULL, declarado TEXT, recalculado TEXT, diferenca REAL,
  gravidade TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aberta', documento_id TEXT, observacao TEXT, origem TEXT NOT NULL DEFAULT 'recalculo', envio_id INTEGER, chave TEXT
);
CREATE INDEX IF NOT EXISTS ix_div ON divergencias (cid);
CREATE TABLE IF NOT EXISTS pareceres_descontos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER, cenario TEXT, igq_oss REAL, igq_ctai REAL, modo_desconto TEXT, desconto_pct REAL, desconto_valor REAL,
  parecer_numero TEXT, data_parecer TEXT, fonte TEXT
);
CREATE TABLE IF NOT EXISTS totais_igq (
  cid INTEGER PRIMARY KEY, igq_oss REAL, igq_parecer REAL, igq_pagina3_faixas REAL, observacao TEXT
);
CREATE TABLE IF NOT EXISTS trilha_auditoria (
  evento_id INTEGER PRIMARY KEY AUTOINCREMENT, data_hora TEXT NOT NULL, usuario TEXT, tabela TEXT, registro TEXT, campo TEXT, valor_anterior TEXT, valor_novo TEXT, motivo TEXT,
  hash_anterior TEXT, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usuarios (
  usuario_id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL UNIQUE, nome TEXT NOT NULL, perfil TEXT NOT NULL, contrato_id TEXT, setor TEXT,
  senha_hash TEXT NOT NULL, trocar_senha INTEGER NOT NULL DEFAULT 1, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT, ultimo_login TEXT, tentativas INTEGER NOT NULL DEFAULT 0, bloqueado_ate TEXT
);
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criada_em TEXT, expira_em TEXT
);
CREATE TABLE IF NOT EXISTS fichas (
  cid INTEGER NOT NULL, setor TEXT NOT NULL, dados TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'rascunho', atualizado_por TEXT, atualizado_em TEXT,
  PRIMARY KEY (cid, setor)
);
CREATE TABLE IF NOT EXISTS envios (
  envio_id INTEGER PRIMARY KEY AUTOINCREMENT, cid INTEGER NOT NULL, versao INTEGER NOT NULL, motivo TEXT, enviado_por TEXT NOT NULL, enviado_em TEXT NOT NULL,
  snapshot TEXT NOT NULL, hash_snapshot TEXT NOT NULL, pdf_arquivo TEXT, pdf_hash TEXT, recebido_em TEXT, recebido_por TEXT, UNIQUE (cid, versao)
);
-- Vínculo com o SEI. Cada linha é um registro ou uma correção do número do documento no SEI para uma versão de envio.
-- Só se acrescenta: a linha vigente é a mais recente da versão; as anteriores ficam como histórico (migração segura: tabela nova, nada existente muda).
CREATE TABLE IF NOT EXISTS envio_sei (
  sei_id INTEGER PRIMARY KEY AUTOINCREMENT, envio_id INTEGER NOT NULL, cid INTEGER NOT NULL, sei_numero TEXT NOT NULL,
  registrado_por TEXT NOT NULL, registrado_em TEXT NOT NULL, motivo TEXT
);
CREATE INDEX IF NOT EXISTS ix_envio_sei ON envio_sei (envio_id, sei_id);
CREATE TABLE IF NOT EXISTS decisoes_regra (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contrato_id TEXT NOT NULL, chave TEXT NOT NULL, valor TEXT, justificativa TEXT, decidido_por TEXT, decidido_em TEXT, UNIQUE (contrato_id, chave)
);
CREATE TABLE IF NOT EXISTS avaliacoes_linha (
  cid INTEGER NOT NULL, fonte TEXT NOT NULL, protocolo TEXT NOT NULL, campo TEXT NOT NULL, valor TEXT, avaliado_por TEXT, em TEXT, PRIMARY KEY (cid, fonte, protocolo, campo)
);
CREATE TABLE IF NOT EXISTS pareceres (
  parecer_id INTEGER PRIMARY KEY AUTOINCREMENT, contrato_id TEXT NOT NULL, trimestre TEXT NOT NULL, competencias TEXT NOT NULL, numero_parecer TEXT, titulo TEXT,
  criador_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'rascunho', blocos TEXT NOT NULL DEFAULT '{}', criado_em TEXT, atualizado_em TEXT, atualizado_por TEXT,
  versao_alterada INTEGER NOT NULL DEFAULT 0, sei_numero TEXT, sei_anexado_em TEXT, sei_anexado_por TEXT, UNIQUE (contrato_id, trimestre)
);
CREATE TABLE IF NOT EXISTS versoes_minuta (
  versao_id INTEGER PRIMARY KEY AUTOINCREMENT, parecer_id INTEGER NOT NULL, numero INTEGER NOT NULL, conteudo TEXT NOT NULL, hash TEXT NOT NULL, criada_por INTEGER NOT NULL,
  criada_em TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'em conferência', convocados TEXT NOT NULL DEFAULT '[]', motivo TEXT, autorizada_por INTEGER, autorizada_em TEXT,
  UNIQUE (parecer_id, numero)
);
CREATE TABLE IF NOT EXISTS conferencias (
  conf_id INTEGER PRIMARY KEY AUTOINCREMENT, versao_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, papel TEXT NOT NULL, item_id TEXT NOT NULL, status TEXT NOT NULL,
  comentario TEXT, data_hora TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_conf ON conferencias (versao_id);
CREATE TABLE IF NOT EXISTS achados (
  achado_id INTEGER PRIMARY KEY AUTOINCREMENT, origem_tipo TEXT NOT NULL, origem_id INTEGER NOT NULL, cid INTEGER, gravidade TEXT NOT NULL, tipo TEXT, trecho TEXT, risco TEXT,
  sugestao TEXT, setor_sugerido TEXT, provedor TEXT, status TEXT NOT NULL DEFAULT 'novo', fixado_por TEXT, criado_em TEXT, atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_ach ON achados (origem_tipo, origem_id);
-- Normas por unidade: o que vale para cada contrato (cláusula, portaria, regra do IGQ). O Analista as sugere junto de cada achado.
CREATE TABLE IF NOT EXISTS normas (
  norma_id INTEGER PRIMARY KEY AUTOINCREMENT, contrato_id TEXT, titulo TEXT NOT NULL, referencia TEXT, tema TEXT, texto TEXT NOT NULL,
  vigente INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0, criado_por TEXT, criado_em TEXT, atualizado_em TEXT
);
-- Checklist de recebimento da Secretaria, por competência e por item obrigatório da UPA (core/obrigatorios.js).
-- status_manual = 1 quando uma pessoa decidiu o status; sem isso, o sistema o recalcula a cada novo envio.
CREATE TABLE IF NOT EXISTS checklist_itens (
  cid INTEGER NOT NULL, item_id TEXT NOT NULL, status TEXT NOT NULL, status_manual INTEGER NOT NULL DEFAULT 0, data_recebimento TEXT, responsavel TEXT,
  validacao TEXT, observacao TEXT, atualizado_por TEXT, atualizado_em TEXT, PRIMARY KEY (cid, item_id)
);
CREATE TABLE IF NOT EXISTS integracoes (
  integracao_id INTEGER PRIMARY KEY AUTOINCREMENT, contrato_id TEXT NOT NULL, tipo TEXT NOT NULL, nome TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', ativo INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'não configurada', ultima_sync TEXT, ultimo_erro TEXT
);
CREATE TABLE IF NOT EXISTS integracao_log (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT, integracao_id INTEGER NOT NULL, data_hora TEXT NOT NULL, acao TEXT, endpoint TEXT, status TEXT, ms INTEGER, registros INTEGER, erro TEXT
);
CREATE TABLE IF NOT EXISTS lotes_api (
  lote_id INTEGER PRIMARY KEY AUTOINCREMENT, integracao_id INTEGER, cid INTEGER NOT NULL, fonte TEXT NOT NULL, criado_em TEXT, registros INTEGER, recusados INTEGER, status TEXT NOT NULL DEFAULT 'pendente'
);
-- Acessos: entradas, falhas, bloqueios, saídas e cadastros feitos por gestores de unidade. Só se acrescenta (gatilhos abaixo); cada linha aponta para o evento da trilha encadeada.
CREATE TABLE IF NOT EXISTS acessos (
  acesso_id INTEGER PRIMARY KEY AUTOINCREMENT, data_hora TEXT NOT NULL, evento TEXT NOT NULL, login TEXT, usuario_id INTEGER, perfil TEXT, contrato_id TEXT,
  origem TEXT, ip TEXT, agente TEXT, detalhe TEXT, hash_trilha TEXT
);
CREATE INDEX IF NOT EXISTS ix_acessos ON acessos (data_hora);
-- Gestão CTAI: carteira (quais unidades cada funcionário acompanha, com histórico), configurações, IA (chave cifrada) e uso mensal.
CREATE TABLE IF NOT EXISTS carteira (
  carteira_id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL, contrato_id TEXT NOT NULL, desde TEXT NOT NULL, ate TEXT,
  atribuido_por TEXT, removido_por TEXT, motivo TEXT
);
CREATE INDEX IF NOT EXISTS ix_carteira ON carteira (contrato_id, ate);
CREATE INDEX IF NOT EXISTS ix_carteira_u ON carteira (usuario_id, ate);
CREATE TABLE IF NOT EXISTS importacoes (
  importacao_id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT NOT NULL, quem TEXT NOT NULL, modo TEXT NOT NULL, arquivo_hash TEXT, resumo TEXT
);
-- Caixa de entrada da CTAI: item (um só por evento), destinatários (lido por pessoa) e histórico (só acrescenta).
CREATE TABLE IF NOT EXISTS caixa_itens (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, contrato_id TEXT, cid INTEGER, competencia_id TEXT,
  titulo TEXT NOT NULL, texto TEXT, link TEXT, urgencia INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL,
  tratado_por TEXT, tratado_em TEXT, tratado_obs TEXT
);
CREATE INDEX IF NOT EXISTS ix_caixa_contrato ON caixa_itens (contrato_id, tipo);
CREATE TABLE IF NOT EXISTS caixa_destinos (
  item_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, em_substituicao_de INTEGER, lido_em TEXT, PRIMARY KEY (item_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_caixa_dest_u ON caixa_destinos (usuario_id, lido_em);
CREATE TABLE IF NOT EXISTS caixa_historico (
  hist_id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, em TEXT NOT NULL, quem TEXT NOT NULL, acao TEXT NOT NULL, detalhe TEXT
);
CREATE TABLE IF NOT EXISTS caixa_substituicoes (
  subst_id INTEGER PRIMARY KEY AUTOINCREMENT, de_usuario_id INTEGER NOT NULL, para_usuario_id INTEGER NOT NULL, desde TEXT NOT NULL, ate TEXT NOT NULL,
  motivo TEXT, criado_por TEXT NOT NULL, criado_em TEXT NOT NULL, cancelado_por TEXT, cancelado_em TEXT
);
CREATE TABLE IF NOT EXISTS gestao_config (chave TEXT PRIMARY KEY, valor TEXT, atualizado_por TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS ia_config (
  provedor TEXT PRIMARY KEY, ativo INTEGER NOT NULL DEFAULT 0, modelo TEXT, url TEXT, chave_cifrada TEXT, chave_final TEXT,
  juridico_por TEXT, juridico_em TEXT, atualizado_por TEXT, atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS ia_chaves (
  chave_id INTEGER PRIMARY KEY AUTOINCREMENT, provedor TEXT NOT NULL, rotulo TEXT, chave_cifrada TEXT, chave_final TEXT, modelo TEXT, url TEXT,
  ordem INTEGER NOT NULL DEFAULT 1, ativa INTEGER NOT NULL DEFAULT 1, juridico_por TEXT, juridico_em TEXT, criado_por TEXT, criado_em TEXT, atualizado_por TEXT, atualizado_em TEXT,
  teste_em TEXT, teste_ok INTEGER, teste_ms INTEGER
);
CREATE TABLE IF NOT EXISTS ia_chave_uso (
  chave_id INTEGER NOT NULL, mes TEXT NOT NULL, chamadas INTEGER NOT NULL DEFAULT 0, falhas INTEGER NOT NULL DEFAULT 0, ultimo_uso TEXT, PRIMARY KEY (chave_id, mes)
);
CREATE TABLE IF NOT EXISTS ia_uso (
  provedor TEXT NOT NULL, mes TEXT NOT NULL, chamadas INTEGER NOT NULL DEFAULT 0, falhas INTEGER NOT NULL DEFAULT 0, ultimo_uso TEXT, PRIMARY KEY (provedor, mes)
);
`;

// Gatilhos que impedem alterar ou apagar o que precisa ficar imutável.
// Em contrato de demonstração é permitido apagar (para limpar os dados fictícios).
const GATILHOS = `
CREATE TRIGGER IF NOT EXISTS trg_acessos_no_update BEFORE UPDATE ON acessos BEGIN SELECT RAISE(ABORT, 'O registro de acessos não pode ser alterado.'); END;
CREATE TRIGGER IF NOT EXISTS trg_acessos_no_delete BEFORE DELETE ON acessos BEGIN SELECT RAISE(ABORT, 'O registro de acessos não pode ser apagado.'); END;
CREATE TRIGGER IF NOT EXISTS trg_trilha_no_update BEFORE UPDATE ON trilha_auditoria BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria não pode ser alterada.'); END;
CREATE TRIGGER IF NOT EXISTS trg_trilha_no_delete BEFORE DELETE ON trilha_auditoria BEGIN SELECT RAISE(ABORT, 'A trilha de auditoria não pode ser apagada.'); END;
CREATE TRIGGER IF NOT EXISTS trg_envios_no_update BEFORE UPDATE ON envios
  WHEN OLD.snapshot <> NEW.snapshot OR OLD.hash_snapshot <> NEW.hash_snapshot OR OLD.versao <> NEW.versao OR OLD.enviado_por <> NEW.enviado_por OR OLD.enviado_em <> NEW.enviado_em OR OLD.cid <> NEW.cid OR IFNULL(OLD.pdf_hash,'') <> IFNULL(NEW.pdf_hash,'')
  BEGIN SELECT RAISE(ABORT, 'Um envio não pode ser alterado. Faça uma nova versão com o motivo da correção.'); END;
CREATE TRIGGER IF NOT EXISTS trg_envios_no_delete BEFORE DELETE ON envios
  WHEN (SELECT IFNULL(c.demo,0) FROM competencias k JOIN contratos c ON c.contrato_id = k.contrato_id WHERE k.cid = OLD.cid) = 0
  BEGIN SELECT RAISE(ABORT, 'Um envio não pode ser apagado.'); END;
CREATE TRIGGER IF NOT EXISTS trg_sei_no_update BEFORE UPDATE ON envio_sei BEGIN SELECT RAISE(ABORT, 'O registro do SEI não pode ser alterado. Registre a correção com o motivo.'); END;
CREATE TRIGGER IF NOT EXISTS trg_sei_no_delete BEFORE DELETE ON envio_sei
  WHEN (SELECT IFNULL(c.demo,0) FROM competencias k JOIN contratos c ON c.contrato_id = k.contrato_id WHERE k.cid = OLD.cid) = 0
  BEGIN SELECT RAISE(ABORT, 'O registro do SEI não pode ser apagado.'); END;
CREATE TRIGGER IF NOT EXISTS trg_brutas_no_update BEFORE UPDATE ON linhas_brutas BEGIN SELECT RAISE(ABORT, 'Linhas de um envio não podem ser alteradas.'); END;
CREATE TRIGGER IF NOT EXISTS trg_brutas_no_delete BEFORE DELETE ON linhas_brutas
  WHEN (SELECT IFNULL(c.demo,0) FROM competencias k JOIN contratos c ON c.contrato_id = k.contrato_id WHERE k.cid = OLD.cid) = 0
  BEGIN SELECT RAISE(ABORT, 'Linhas de um envio não podem ser apagadas.'); END;
CREATE TRIGGER IF NOT EXISTS trg_versao_no_update BEFORE UPDATE ON versoes_minuta
  WHEN OLD.conteudo <> NEW.conteudo OR OLD.hash <> NEW.hash OR OLD.numero <> NEW.numero OR OLD.criada_por <> NEW.criada_por
  BEGIN SELECT RAISE(ABORT, 'Uma versão congelada não pode ser alterada. Crie uma nova versão.'); END;
CREATE TRIGGER IF NOT EXISTS trg_versao_no_delete BEFORE DELETE ON versoes_minuta
  WHEN (SELECT IFNULL(c.demo,0) FROM pareceres p JOIN contratos c ON c.contrato_id = p.contrato_id WHERE p.parecer_id = OLD.parecer_id) = 0
  BEGIN SELECT RAISE(ABORT, 'Uma versão congelada não pode ser apagada.'); END;
CREATE TRIGGER IF NOT EXISTS trg_conf_no_update BEFORE UPDATE ON conferencias BEGIN SELECT RAISE(ABORT, 'O registro de conferência não pode ser alterado.'); END;
CREATE TRIGGER IF NOT EXISTS trg_conf_no_delete BEFORE DELETE ON conferencias
  WHEN (SELECT IFNULL(c.demo,0) FROM versoes_minuta v JOIN pareceres p ON p.parecer_id = v.parecer_id JOIN contratos c ON c.contrato_id = p.contrato_id WHERE v.versao_id = OLD.versao_id) = 0
  BEGIN SELECT RAISE(ABORT, 'O registro de conferência não pode ser apagado.'); END;
`;

// Colunas acrescentadas depois da primeira versão (migração segura: só acrescenta, nunca altera o que existe).
const COLUNAS_NOVAS = {
  usuarios: ['setores TEXT'],
  contratos: ['tipo TEXT', 'municipio TEXT', 'criado_por TEXT', 'criado_em TEXT'],
  competencias: ['simas_enviado_em TEXT', 'simas_registrado_por TEXT', 'simas_registrado_em TEXT'],
  achados: ['encaminhado_a TEXT', 'encaminhado_por TEXT', 'encaminhado_em TEXT', 'mensagem TEXT', 'prazo TEXT', 'resposta TEXT', 'respondido_por TEXT', 'respondido_em TEXT'],
};
function migrar(db) {
  for (const [tabela, colunas] of Object.entries(COLUNAS_NOVAS)) {
    const existentes = new Set(db.prepare('PRAGMA table_info(' + tabela + ')').all().map((c) => c.name));
    for (const def of colunas) if (!existentes.has(def.split(' ')[0])) db.exec('ALTER TABLE ' + tabela + ' ADD COLUMN ' + def);
  }
}

function abrir(arquivo) {
  const db = new DatabaseSync(arquivo || config.arquivoBanco);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrar(db);
  db.exec(GATILHOS);
  return db;
}

// Envoltório com os métodos usados no resto do sistema.
function envolver(db) {
  let prof = 0;
  const api = {
    raw: db,
    all: (sql, ...p) => db.prepare(sql).all(...p).map((r) => Object.assign({}, r)),
    get: (sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? Object.assign({}, r) : undefined; },
    run: (sql, ...p) => db.prepare(sql).run(...p),
    exec: (sql) => db.exec(sql),
    // Transação que aceita ser chamada dentro de outra (a de fora é quem confirma ou desfaz tudo).
    tx(fn) {
      if (prof > 0) return fn();
      db.exec('BEGIN IMMEDIATE'); prof = 1;
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* já revertido */ } throw e; } finally { prof = 0; }
    },
    fechar: () => db.close(),
  };
  return api;
}

module.exports = { abrir, envolver, SCHEMA, GATILHOS };
