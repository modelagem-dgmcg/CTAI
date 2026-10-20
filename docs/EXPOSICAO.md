# Exposição na internet (túnel) – guia

Objetivo: deixar o **Portal da Unidade** acessível de fora (por túnel, ex.: Cloudflare Tunnel) sem expor o console da CTAI, a Gestão CTAI, a análise e a administração.

## Como funciona

Cada requisição é classificada como **interna** ou **externa**:

| É externa quando… | Configuração |
|---|---|
| o `Host` ou `X-Forwarded-Host` está na lista de hosts públicos | `CTAI_HOSTS_PUBLICOS=portal.exemplo.gov.br` |
| traz cabeçalho de túnel: `Cf-Connecting-Ip`, `Cf-Ray`, `Cf-Visitor`, `Cf-Ipcountry`, `Cdn-Loop`, `X-Tunnel` | automático |
| traz `X-Forwarded-Host` ou `Forwarded` de um host que **não** está em `CTAI_HOSTS_INTERNOS` (proxy desconhecido = não confiar) | `CTAI_HOSTS_INTERNOS=proxy.interno` (opcional) |

**Origem externa alcança só:** a página de entrada, o Portal da Unidade (`/unidade`), `/api/unidade`, `/api/auth` (login), arquivos estáticos do portal.
**Origem externa recebe 404** em: `/ctai`, `/js/ctai.js`, `/js/gestao.js`, `/api/ctai`, `/api/analista`, `/api/gestao`, `/api/admin`, `/api/integracoes`.
Além disso, **usuários da CTAI (admin, criador, colega, superintendente) não entram por origem externa**: o login responde "Usuário ou senha incorretos" (sem revelar o motivo), e uma sessão deles não vale se for usada por fora.
**Rede interna** acessa tudo.

## Configuração

```
CTAI_EXPOSICAO=restrita        # padrão e recomendado; "aberta" só para desenvolvimento local
CTAI_HOSTS_PUBLICOS=portal.exemplo.gov.br
CTAI_HOSTS_INTERNOS=           # só se houver proxy interno que envia X-Forwarded-Host
CTAI_IP_COMPLETO=nao           # registros de acesso guardam o IP com o último trecho oculto
```

## Roteiro com túnel

1. Suba o sistema só em rede interna (porta 3000) e confirme `/ctai` funcionando por lá.
2. Aponte o túnel para `http://localhost:3000` e anote o host público; coloque-o em `CTAI_HOSTS_PUBLICOS`.
3. Teste de fora: `/unidade` abre; `/ctai` e `/api/ctai/contratos` devem dar 404; login de usuário da CTAI deve ser recusado.
4. Acompanhe na **Gestão CTAI > Acessos** (origem "externa", tentativas falhas e bloqueios).

## Limites

- A classificação depende dos cabeçalhos que o túnel/proxy envia. Se um proxy esconder todos eles e usar o mesmo host interno, a requisição parecerá interna: **não publique o sistema por proxy que remova esses cabeçalhos**, e prefira sempre listar o host público em `CTAI_HOSTS_PUBLICOS`.
- O bloqueio é uma camada a mais; não substitui HTTPS (`CTAI_COOKIE_SEGURO=sim` atrás de HTTPS), senhas fortes e a troca da senha temporária.
- Use só dados de demonstração até a hospedagem ser aprovada.
