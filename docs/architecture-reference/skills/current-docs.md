# Skill: current-docs

## Objetivo
Consulta documentação atual via web/MCP antes de mexer com qualquer API, SDK, framework ou biblioteca. Esta skill é **obrigatória** — nunca implementar baseado em conhecimento possivelmente desatualizado.

## Quando Usar
- **SEMPRE** antes de usar qualquer API/SDK/framework.
- Quando o usuário pede para implementar algo que usa biblioteca externa.
- Quando há dúvida sobre sintaxe ou breaking changes.
- Quando a versão instalada é diferente da que o agent conhece.

## Trigger
```yaml
manual: true        # /skill current-docs react
auto: true          # ativa automaticamente quando detecta uso de API externa
patterns:
  - implementação que usa import de biblioteca
  - menção a API/SDK/framework
  - "como usar [pacote]"
  - "documentação de [pacote]"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| package | string | sim | Nome do pacote/framework |
| version | string | não | Versão específica (auto-detectada do package.json se possível) |
| topic | string | não | Tópico específico (ex: "routing", "hooks", "auth") |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| docs | string | Documentação relevante extraída |
| version | string | Versão da documentação consultada |
| url | string | URL da fonte |
| breakingChanges | string[] | Breaking changes relevantes (se upgrade) |
| examples | string[] | Exemplos de código da documentação |

## Ferramentas Necessárias
- `web_search` — pesquisar documentação
- `web_fetch` — buscar conteúdo de URLs de documentação
- MCP `docs` — se configurado, preferir MCP

## Fluxo

```
1. DETECTAR PACOTE E VERSÃO
   ├── Se version informada → usar
   ├── Se não → ler package.json para versão instalada
   └── Se não encontrar → pesquisar última versão

2. BUSCAR DOCUMENTAÇÃO
   ├── Se MCP docs disponível → usar MCP (preferido)
   ├── Se web_search disponível:
   │   ├── Query: "[pacote] [versão] [tópico] documentation"
   │   ├── Filtrar resultados: priorizar docs oficiais
   │   └── web_fetch nos top 3 resultados
   └── Se NENHUMA ferramenta disponível:
       └── BLOQUEAR IMPLEMENTAÇÃO. Declarar:
            "Não posso prosseguir com a implementação.
             Esta tarefa depende de API/SDK/framework externo
             e nenhuma ferramenta de pesquisa está disponível
             (web_search, web_fetch, MCP docs).
             Sem consultar documentação atual, há risco de
             implementar com API desatualizada ou incorreta.
             Para habilitar:
             1. Configure web_search tool, ou
             2. Configure MCP docs server, ou
             3. Use /mode research para pesquisar manualmente antes."
       └── NÃO prosseguir com implementação baseada em conhecimento
            possivelmente desatualizado. Este é um bloqueio intencional.

3. EXTRAIR INFORMAÇÃO RELEVANTE
   ├── Sintaxe e API atual
   ├── Breaking changes (se versão diferente)
   ├── Exemplos de código
   └── Gotchas e caveats

4. RETORNAR RESULTADO ESTRUTURADO
   └── Docs com fonte, versão e data de acesso
```

## Regras

1. **Obrigatória e BLOQUEANTE** — esta skill DEVE rodar antes de implementar com qualquer API externa. Se não tiver ferramenta de pesquisa, a implementação NÃO prossegue.
2. **Nunca pular** — mesmo que o agent "saiba" a API, consultar porque pode ter mudado.
3. **Citar fonte** — sempre incluir URL da documentação consultada.
4. **Versão específica** — buscar docs da versão que está no projeto, não da latest.
5. **Nunca fazer fallback para "conhecimento possivelmente desatualizado"** — se não puder pesquisar, parar e informar. Não implementar no chute.

## Limites
- Timeout: 30s por consulta web.
- Máximo de 5 URLs consultadas por skill execution.
- Se MCP docs falhar, fallback para web_search.
- Se web_search falhar, declarar indisponibilidade.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Docs desatualizadas | Site oficial com cache | Tentar URL direta da versão |
| Versão não encontrada | Versão muito antiga/nova | Buscar versão mais próxima |
| Nenhuma ferramenta | Sem web_search e sem MCP | **BLOQUEAR implementação**. Não prosseguir sem docs reais. |
| Conteúdo muito grande | Página com muita informação | Filtrar por seção relevante |

## Exemplo Prático

**Input:**
```
package: "next"
version: "15.1.0" (detectado do package.json)
topic: "server actions"
```

**Execução:**
```
web_search("next.js 15.1 server actions documentation")
→ Top result: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations

web_fetch("https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations")
→ Conteúdo da página

Extrair:
- Sintaxe: "use server" directive
- Uso: async functions que rodam no server
- Exemplo de código do docs
- Caveats: não usar em client components sem form action
```

**Output:**
```markdown
## Documentação: Next.js 15.1 — Server Actions

**Fonte:** https://nextjs.org/docs/app/...
**Versão:** 15.1
**Acessado em:** 2024-01-15

### Como usar:
Server Actions são funções assíncronas executadas no servidor.
Declare com a directive `"use server"` no topo do arquivo.

### Exemplo (da documentação oficial):
\`\`\`typescript
'use server'

export async function createTodo(formData: FormData) {
  const title = formData.get('title')
  await db.todo.create({ data: { title } })
  revalidatePath('/todos')
}
\`\`\`

### Breaking changes (v14 → v15):
- Server Actions agora são estáveis (não mais experimental)
- Mudança no comportamento de revalidatePath
```
