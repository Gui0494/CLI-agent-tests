# Prompt — Pesquisa Web Real

## Objetivo

Garantir que o agent pesquise informação real na web quando necessário, nunca invente resultados e declare indisponibilidade quando não tem ferramenta.

## Regra Fundamental

```
SE tarefa requer informação atualizada:
  SE web_search está available:
    → usar web_search com query específica
    → capturar resultados reais
    → citar fontes
  SE web_fetch está available:
    → buscar URL específica
    → capturar conteúdo real
  SE MCP docs está available:
    → consultar via MCP
  SE NENHUMA ferramenta disponível:
    → DECLARAR: "Não posso pesquisar na web. Ferramentas de pesquisa
                 não estão configuradas. Para habilitar:
                 1. Configure web_search tool, ou
                 2. Configure MCP docs server."
    → NUNCA inventar resultado
```

## Quando Pesquisar

O agent DEVE pesquisar quando:

1. **Documentação de API/SDK/framework** — antes de usar qualquer API externa.
2. **Versões de pacotes** — antes de atualizar dependências.
3. **Breaking changes** — antes de migrar versões.
4. **Erros desconhecidos** — quando encontra erro que não reconhece.
5. **Melhores práticas atuais** — quando o conhecimento pode estar desatualizado.
6. **Vulnerabilidades** — quando precisa verificar CVEs.
7. **O usuário pede explicitamente** — qualquer pedido de pesquisa.

## Fluxo de Pesquisa

```
NECESSIDADE DE PESQUISA DETECTADA
    │
    ▼
FERRAMENTA DISPONÍVEL?
    │
    ├── web_search available
    │   ├── Formular query específica (não genérica)
    │   ├── Executar via tool call real
    │   ├── Receber resultados reais
    │   ├── Analisar e extrair informação relevante
    │   └── Citar fonte com URL
    │
    ├── web_fetch available (URL conhecida)
    │   ├── Buscar URL específica
    │   ├── Processar conteúdo (markdown, HTML → texto)
    │   └── Extrair informação relevante
    │
    ├── MCP docs available
    │   ├── Conectar ao MCP server
    │   ├── Usar tool do MCP para buscar
    │   └── Processar resultado
    │
    └── NENHUMA available
        └── DECLARAR INDISPONIBILIDADE
            "Pesquisa web não disponível. Respondendo com base
             no conhecimento existente, que pode estar desatualizado.
             Data de corte do conhecimento: [DATA]."
```

## Formatação de Queries

```typescript
// BOM: queries específicas
const GOOD_QUERIES = [
  "React 19 breaking changes migration guide",
  "Next.js 15 app router new features",
  "CVE-2024-XXXXX vulnerability details",
  "TypeScript 5.5 satisfies operator documentation",
  "Prisma 6 postgresql connection pooling setup",
];

// RUIM: queries vagas
const BAD_QUERIES = [
  "React",                     // muito vago
  "como fazer frontend",       // genérico demais
  "melhor framework",          // opinião, não fato
  "programação web",           // inútil
];
```

## Citação de Fontes

Toda informação obtida via pesquisa DEVE incluir fonte:

```markdown
## Resultado da Pesquisa

De acordo com a documentação oficial do React (react.dev/blog/2024/...):

> React 19 introduz o hook `use()` para consumir promises e contexto...

**Fonte:** https://react.dev/blog/2024/react-19
**Acessado em:** 2024-01-15
```

## Antipadrões — PROIBIDO

```
❌ "Pesquisei na web e encontrei que..."
   (sem ter feito tool call real de pesquisa)

❌ "De acordo com a documentação..."
   (sem ter acessado a documentação de fato)

❌ "A versão mais recente é 4.2.1"
   (sem ter verificado no registry real)

❌ "Não há breaking changes"
   (sem ter pesquisado de fato)
```

## Quando Responder Sem Pesquisa

O agent PODE responder sem pesquisa web quando:

1. **Conhecimento estável** — sintaxe de linguagem, algoritmos, padrões de design.
2. **Informação no projeto** — dados no package.json, config files, README.
3. **Contexto da conversa** — informação que o usuário já forneceu.
4. **Operações locais** — ler arquivo, listar diretório, rodar comando.

Mas DEVE declarar: "Respondendo com base no conhecimento existente. Para informação atualizada, use `/research`."

## Integração com Skill `current-docs`

A skill `current-docs` é o wrapper principal para pesquisa de documentação:

```
USUÁRIO PEDE PARA USAR API/SDK/FRAMEWORK
    │
    ▼
current-docs ATIVA AUTOMATICAMENTE
    │
    ├── Identifica o pacote/framework
    ├── Pesquisa documentação atual via web/MCP
    ├── Extrai informação relevante para a tarefa
    ├── Retorna ao agent com dados estruturados
    │
    ▼
AGENT IMPLEMENTA COM BASE EM DOCS REAIS
```
