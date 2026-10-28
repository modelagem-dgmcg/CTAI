# Relatório-modelo: o que fica guardado e como o Redator CTAI vai usar

Nota de projeto. O parecer automático (Redator CTAI) **não** foi construído; esta etapa só guarda o modelo.

## O que existe hoje
- Tabela `imp_modelos`: por unidade e trimestre, guarda `texto` (texto completo do Parecer CTAI anterior, já mascarado; o original nunca é guardado), `estrutura` (JSON), `hash`, `paginas`, `caracteres`, `mascarados`, `ativo`.
- `estrutura` traz: `secoes` (numeração, título, linha), `tabelas` (Quadros e Tabelas), `indicadores` (número e nome), `fontes` (anexos e fontes citadas, com origem, periodicidade e o trecho do modelo, prefixado com a seção).
- Leitura do texto inteiro: `GET /api/importar/unidade/:contrato/modelo` (carteira respeitada). Estrutura e lista: `GET /api/importar/unidade/:contrato/:trimestre`.
- Lista por unidade, versionada: `imp_listas` / `imp_itens` (estados proposta, confirmada, substituida).

## Como o Redator deve usar
1. Pegar `texto` do modelo ativo da unidade como **molde de redação**: ordem das seções, tom, frases fixas (introdução, fundamentação legal, identificação do contrato) e forma dos quadros.
2. Usar `estrutura.secoes` como esqueleto do novo parecer e `estrutura.tabelas` / `indicadores` para saber quais quadros preencher com os números do trimestre novo (gaveta e conferência de números).
3. Trocar os dados do trimestre anterior pelos do atual; trechos que citam fonte externa (seção 7 financeira, seção 8 parecer da CMA) só entram se o item correspondente da lista de conferência estiver com check.
4. Mandar à IA em nuvem apenas texto já mascarado, como no resto do sistema; a analista revisa tudo antes de assinar.

## Origens dos itens
O extrator sugere a origem de cada fonte citada: `unidade` (upload), `pedida_setor` (despacho da Gerência de Prestação de Contas, informação financeira da GGCCG, relatório de prestação de contas), `processo_parecer` (Parecer Conclusivo da CMA) e `fonte_externa` (SIMAS). Quando o Redator montar as seções 7 e 8, deve ler a observação lançada nesses itens (`imp_checks.observacao`) e o estado "sem planilha → meta não cumprida" em `imp_ausencias`.
