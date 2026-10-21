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

## Lista de IPs internos (hospedagem em nuvem, como o Render)

Em hospedagem na nuvem **todos chegam por URL pública**, então host e cabeçalhos de túnel não distinguem a SES dos demais. Nesse caso use **`CTAI_IPS_INTERNOS`**:

```
CTAI_IPS_INTERNOS=200.123.45.67, 10.0.0.0/8, 2001:db8::/32   # IPs ou CIDR (IPv4 e IPv6)
CTAI_PROXY_SALTOS=2                                          # quantos valores o proxy da plataforma acrescenta ao X-Forwarded-For
```

Regras: quando a variável está definida, **só é interna a requisição cujo IP de cliente esteja na lista**; as demais são externas (só o Portal da Unidade). **IP que não pode ser determinado = externa.** Os critérios de host e de túnel deixam de valer. **Sem a variável, tudo funciona como antes.**

### Como o IP do cliente é obtido (premissa)

Um cliente pode escrever o `X-Forwarded-For` que quiser, então o primeiro valor **não é confiável**. Cada proxy da plataforma **acrescenta no fim** o IP de quem falou com ele. Por isso o sistema conta **do fim**: com `CTAI_PROXY_SALTOS=2`, o cliente é o 2º valor contado do fim (`forjado, CLIENTE, ip-do-proxy`); tudo que está à esquerda é ignorado. Premissa para o Render: o proxy dele acrescenta 1 valor, logo o cliente é o 2º do fim (relato de usuários do Render; **confirme no seu serviço**).

Alternativas:
- `CTAI_IP_CABECALHO=true-client-ip` (ou outro): usa um cabeçalho que a **plataforma** define e sobrescreve. Só use se a documentação da plataforma garantir isso; os demais cabeçalhos (`cf-connecting-ip`, `x-real-ip`…) são ignorados.
- `CTAI_PROXY_SALTOS=0`: sem proxy (rede interna direta); vale o IP da conexão.
- `CTAI_PROXIES_CONFIAVEIS=ip/CIDR`: só aceita cabeçalhos se a conexão vier desses proxies.

### Como verificar

Abra **`/api/origem`** (não exige login) de um computador da SES e de um celular em 4G. A página mostra `seuIp`, `classe` (`interna`/`externa`), `comoFoiObtido` e os cabeçalhos recebidos. Na SES deve aparecer o IP da SES e `interna`. Se o IP mostrado estiver errado, ajuste `CTAI_PROXY_SALTOS`. Falhando, o sistema fica no lado seguro (todos externos).

Limites: o IP da SES pode ser compartilhado e pode mudar; se o proxy da plataforma mudar o número de valores acrescentados, o `/api/origem` mostra o problema. Guia passo a passo: `docs/GUIA-RENDER.md`.

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
