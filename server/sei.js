'use strict';
// Vínculo entre os dois canais do relatório da unidade, enquanto não há API do SEI:
//   canal 1: os dados no sistema da CTAI (o que o sistema recalcula);
//   canal 2: o PDF assinado no SEI (o documento oficial).
// Sem a API, o elo é manual: depois de anexar e assinar no SEI, o gestor da unidade registra aqui o número do documento.
// O sistema NUNCA bloqueia o envio por falta desse registro: só avisa. Nada aqui guarda credencial do SEI.
// A tabela envio_sei só recebe linhas novas (registro ou correção); a vigente é a mais recente de cada versão.
const U = require('../core/util');
const D = require('./dominio');
const trilha = require('./trilha');
const { erro } = require('./auth');

const TAM_HASH = 12; // mesmo tamanho que aparece no rodapé do PDF
const hashCurto = (h) => (h ? String(h).slice(0, TAM_HASH) : '');
const agora = () => new Date().toISOString();

// Só dígitos, de 6 a 12. Não "conserta" a entrada: se vier com ponto, traço ou letra, devolve o erro para a pessoa corrigir.
function validarNumero(bruto) {
  const n = String(bruto === null || bruto === undefined ? '' : bruto).trim();
  if (!n) throw erro(400, 'Informe o número do documento no SEI.');
  if (!/^\d+$/.test(n)) throw erro(400, 'O número do documento no SEI tem só dígitos (sem pontos, traços, espaços ou letras).');
  if (n.length < 6 || n.length > 12) throw erro(400, 'O número do documento no SEI tem de 6 a 12 dígitos. O informado tem ' + n.length + '.');
  return n;
}

function podeRegistrar(usuario) { return !!usuario && ['gestor_unidade', 'admin'].includes(usuario.perfil); }

function envioDe(db, envioId) {
  const e = db.get('SELECT envio_id, cid, versao, enviado_em, hash_snapshot, pdf_hash FROM envios WHERE envio_id = ?', Number(envioId));
  if (!e) throw erro(404, 'Envio não encontrado.');
  return e;
}

// Registro vigente (o mais recente) de uma versão, mais o histórico.
function historico(db, envioId) {
  return db.all('SELECT sei_id, sei_numero, registrado_por, registrado_em, motivo FROM envio_sei WHERE envio_id = ? ORDER BY sei_id', Number(envioId));
}

function registrar(db, usuario, envioId, numero, motivo) {
  if (!podeRegistrar(usuario)) throw erro(403, 'Só o gestor da unidade registra o número do documento no SEI.');
  const e = envioDe(db, envioId);
  D.exigirContrato(usuario, D.competenciaPorCid(db, e.cid).contrato_id);
  const n = validarNumero(numero);
  const hist = historico(db, e.envio_id);
  const atual = hist.length ? hist[hist.length - 1] : null;
  const m = String(motivo || '').trim();
  if (atual && atual.sei_numero === n) throw erro(409, 'Este já é o número registrado para a versão v' + e.versao + '.');
  if (atual && !m) throw erro(400, 'Para corrigir o número, explique o motivo da correção.');
  // O mesmo documento do SEI não pode valer para duas versões da mesma competência.
  const outra = db.get('SELECT e2.versao FROM envio_sei s JOIN envios e2 ON e2.envio_id = s.envio_id WHERE s.cid = ? AND s.sei_numero = ? AND s.envio_id <> ? AND s.sei_id = (SELECT MAX(sei_id) FROM envio_sei WHERE envio_id = s.envio_id)', e.cid, n, e.envio_id);
  if (outra) throw erro(409, 'Este número já está registrado para a versão v' + outra.versao + ' desta competência. Cada versão tem o seu documento no SEI.');
  db.tx(() => {
    db.run('INSERT INTO envio_sei (envio_id, cid, sei_numero, registrado_por, registrado_em, motivo) VALUES (?,?,?,?,?,?)', e.envio_id, e.cid, n, usuario.login, agora(), m || null);
    trilha.registrar(db, {
      usuario: usuario.login, tabela: 'envio_sei', registro: e.cid + '/v' + e.versao, campo: 'sei_numero',
      valor_anterior: atual ? atual.sei_numero : null, valor_novo: n,
      motivo: atual ? 'Correção do número do SEI: ' + m : 'Número do documento no SEI registrado pela unidade (a CTAI usa para saber qual versão foi ao processo).',
    });
  });
  return { envio_id: e.envio_id, versao: e.versao, sei_numero: n, correcao: !!atual };
}

// Os dois canais de uma competência, lado a lado, e os alertas.
function canais(db, cid) {
  const envios = db.all('SELECT envio_id, versao, motivo, enviado_por, enviado_em, recebido_em, hash_snapshot, pdf_hash FROM envios WHERE cid = ? ORDER BY versao DESC', Number(cid));
  const versoes = envios.map((e) => {
    const hist = historico(db, e.envio_id);
    const v = hist.length ? hist[hist.length - 1] : null;
    return {
      envio_id: e.envio_id, versao: e.versao, motivo: e.motivo, enviado_por: e.enviado_por, enviado_em: e.enviado_em, recebido_em: e.recebido_em,
      hash_curto: hashCurto(e.hash_snapshot), hash_completo: e.hash_snapshot,
      situacao: v ? 'Registrado no SEI' : 'Enviado ao sistema',
      sei: v ? { numero: v.sei_numero, primeiro_registro_em: hist[0].registrado_em, registrado_por: v.registrado_por, registrado_em: v.registrado_em, correcoes: hist.length - 1, motivo_ultima_correcao: hist.length > 1 ? v.motivo : null, historico: hist } : null,
    };
  });
  const ultima = versoes[0] || null;
  // Versão mais nova que tem registro de SEI. Para os alertas vale a hora do PRIMEIRO registro: corrigir o número depois não muda quando a unidade declarou aquela versão no SEI.
  const registrada = versoes.find((v) => v.sei) || null;
  const alertas = [];
  if (ultima && !ultima.sei) {
    if (!registrada) {
      alertas.push({ codigo: 'sem_registro_sei', gravidade: 'atenção', versao: ultima.versao,
        mensagem: 'Recebido no sistema sem registro de SEI: a versão v' + ultima.versao + ' entrou em ' + ultima.enviado_em + ' e ninguém registrou o número do documento no SEI.',
        mensagemUnidade: 'A versão v' + ultima.versao + ' foi enviada ao sistema, mas o número do documento no SEI ainda não foi registrado. Depois de anexar e assinar no SEI, registre o número aqui.' });
    } else if (registrada.sei.primeiro_registro_em < ultima.enviado_em) {
      alertas.push({ codigo: 'nova_versao_depois_sei', gravidade: 'alta', versao: ultima.versao, versao_sei: registrada.versao,
        mensagem: 'Nova versão no sistema depois do SEI: a v' + ultima.versao + ' entrou depois do registro do SEI nº ' + registrada.sei.numero + ' (v' + registrada.versao + '). O documento no SEI pode estar desatualizado.',
        mensagemUnidade: 'Você enviou a v' + ultima.versao + ' depois de registrar o SEI da v' + registrada.versao + '. Se a v' + ultima.versao + ' vai ao processo, anexe e assine no SEI e registre o novo número.' });
    }
  }
  if (ultima && registrada && registrada.versao < ultima.versao && registrada.sei.primeiro_registro_em >= ultima.enviado_em) {
    alertas.push({ codigo: 'sei_versao_antiga', gravidade: 'alta', versao: ultima.versao, versao_sei: registrada.versao,
      mensagem: 'O registro de SEI aponta versão antiga: o SEI nº ' + registrada.sei.numero + ' é da v' + registrada.versao + ', e já existe a v' + ultima.versao + ' no sistema.',
      mensagemUnidade: 'O número registrado no SEI (' + registrada.sei.numero + ') é da v' + registrada.versao + ', mas a versão mais nova no sistema é a v' + ultima.versao + '. Confirme qual delas está no processo.' });
  }
  return { versoes, ultima, registrada: registrada ? { versao: registrada.versao, numero: registrada.sei.numero } : null, alertas };
}

// Resumo curto para listas (painel): quantos alertas a competência tem.
function resumoAlertas(db, cid) { return canais(db, cid).alertas.length; }

// Comparação OPCIONAL: a CTAI sobe o PDF que está no SEI e o sistema compara com o PDF que gerou.
// O SEI pode reprocessar o arquivo (carimbos, metadados), então hash diferente NÃO prova que o conteúdo mudou. Nada é bloqueado.
function compararArquivo(db, usuario, envioId, bufferSei) {
  const e = envioDe(db, envioId);
  const hashSei = U.sha256(bufferSei.toString('latin1'));
  const igual = hashSei === e.pdf_hash;
  trilha.registrar(db, { usuario: usuario.login, tabela: 'envio_sei', registro: e.cid + '/v' + e.versao, campo: 'comparacao_arquivo', valor_novo: { igual, hash_arquivo: hashSei.slice(0, TAM_HASH) }, motivo: 'Comparação opcional do PDF baixado do SEI com o PDF gerado pelo sistema.' });
  return {
    igual, versao: e.versao, hash_arquivo: hashCurto(hashSei), hash_sistema: hashCurto(e.pdf_hash),
    aviso: igual
      ? 'O arquivo é idêntico, byte a byte, ao PDF gerado pelo sistema para a v' + e.versao + '.'
      : 'O arquivo é diferente do PDF gerado para a v' + e.versao + '. Isso não prova divergência: o SEI pode alterar o arquivo (carimbo de assinatura, metadados) e o código muda. Confira o código de integridade no rodapé do PDF e, se precisar, olhe o conteúdo.',
  };
}

module.exports = { TAM_HASH, hashCurto, validarNumero, podeRegistrar, registrar, historico, canais, resumoAlertas, compararArquivo };
