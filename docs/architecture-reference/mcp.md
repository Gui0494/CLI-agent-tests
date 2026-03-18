# MCP — Integrações e Política de Confiança

## 1. O que é MCP

Model Context Protocol (MCP) é o protocolo padrão para conectar o agent a ferramentas e serviços externos. Cada MCP server expõe tools que o agent pode chamar.

**Princípio:** MCP servers de terceiros não são auditados automaticamente. Toda integração MCP requer classificação de confiança explícita.

## 2. Integrações Recomendadas

### 2.1 GitHub / GitLab

**Prioridade:** Alta
**Trust:** Trusted (source oficial)

```json
{
  "name": "github",
  "server": "@modelcontextprotocol/server-github",
  "trust": "trusted",
  "tools": [
    "create_issue",
    "list_issues",
    "create_pull_request",
    "list_pull_requests",
    "get_pull_request_diff",
    "create_review",
    "search_repositories",
    "get_file_contents",
    "push_files"
  ],
  "permissions": {
    "read": "allow",
    "write": "ask",
    "delete": "deny"
  },
  "env": ["GITHUB_TOKEN"]
}
```

**Quando usar:**
- `git-pr-helper` skill para criar PRs.
- `bug-investigator` para consultar issues relacionadas.
- `researcher` subagent para buscar código de referência.

### 2.2 Documentação Oficial

**Prioridade:** Alta (obrigatória para `current-docs` skill)
**Trust:** Trusted

```json
{
  "name": "docs",
  "server": "@modelcontextprotocol/server-fetch",
  "trust": "trusted",
  "tools": [
    "fetch_url",
    "search_docs"
  ],
  "permissions": {
    "read": "allow"
  },
  "config": {
    "allowedDomains": [
      "docs.anthropic.com",
      "react.dev",
      "nextjs.org",
      "vuejs.org",
      "nodejs.org",
      "developer.mozilla.org",
      "docs.python.org",
      "docs.rs",
      "pkg.go.dev"
    ],
    "timeout": 10000,
    "maxContentLength": 500000
  }
}
```

**Quando usar:**
- Antes de qualquer implementação que envolva API/SDK/framework.
- Quando a skill `current-docs` é ativada.
- Quando o `researcher` subagent precisa consultar docs.

### 2.3 Banco de Dados (Read-Only)

**Prioridade:** Média
**Trust:** Verified (requer setup local)

```json
{
  "name": "database",
  "server": "@modelcontextprotocol/server-postgres",
  "trust": "verified",
  "tools": [
    "query",
    "list_tables",
    "describe_table"
  ],
  "permissions": {
    "read": "allow",
    "write": "deny",
    "ddl": "deny"
  },
  "config": {
    "readOnly": true,
    "maxRows": 1000,
    "timeout": 5000
  }
}
```

**Regras de segurança:**
- Conexão DEVE ser read-only.
- Queries de DDL (CREATE, ALTER, DROP) são **BLOQUEADAS**.
- Queries de DML write (INSERT, UPDATE, DELETE) são **BLOQUEADAS**.
- Limit automático em queries sem LIMIT.

### 2.4 CI/CD

**Prioridade:** Média
**Trust:** Verified

```json
{
  "name": "cicd",
  "server": "custom-cicd-mcp-server",
  "trust": "verified",
  "tools": [
    "get_pipeline_status",
    "get_build_logs",
    "trigger_build",
    "list_deployments"
  ],
  "permissions": {
    "read": "allow",
    "trigger": "ask",
    "cancel": "deny"
  }
}
```

**Quando usar:**
- `release-deploy-checklist` skill para verificar status do pipeline.
- `test-lint-fix` skill para consultar resultados de CI.
- Antes de deploy para verificar se build está verde.

### 2.5 Issue Tracker

**Prioridade:** Média
**Trust:** Trusted (se GitHub/GitLab) ou Verified (Jira, Linear)

```json
{
  "name": "issues",
  "server": "@modelcontextprotocol/server-github",
  "trust": "trusted",
  "tools": [
    "list_issues",
    "get_issue",
    "create_issue",
    "update_issue",
    "search_issues"
  ],
  "permissions": {
    "read": "allow",
    "create": "ask",
    "update": "ask",
    "close": "ask"
  }
}
```

### 2.6 Package Registries

**Prioridade:** Média
**Trust:** Trusted (npm, PyPI, crates.io)

```json
{
  "name": "packages",
  "server": "custom-package-registry-mcp",
  "trust": "trusted",
  "tools": [
    "search_packages",
    "get_package_info",
    "get_package_versions",
    "get_package_dependencies"
  ],
  "permissions": {
    "read": "allow",
    "publish": "deny"
  }
}
```

**Quando usar:**
- `dependency-research` skill para pesquisar versões e breaking changes.
- Antes de atualizar qualquer dependência.

### 2.7 Observabilidade / Logs

**Prioridade:** Baixa (v2+)
**Trust:** Verified

```json
{
  "name": "observability",
  "server": "custom-observability-mcp",
  "trust": "verified",
  "tools": [
    "query_logs",
    "get_metrics",
    "list_alerts",
    "get_traces"
  ],
  "permissions": {
    "read": "allow",
    "write": "deny"
  },
  "config": {
    "maxTimeRange": "24h",
    "maxResults": 500
  }
}
```

## 3. Política de Confiança

### Níveis de Confiança

| Nível | Definição | Requisitos | Permissões padrão |
|---|---|---|---|
| **Trusted** | MCP de fonte oficial verificada | Publicado por organização conhecida, código aberto, auditado | Read: allow, Write: ask |
| **Verified** | MCP verificado pelo usuário | Configurado localmente, testado pelo usuário | Read: allow, Write: ask, Delete: deny |
| **Untrusted** | MCP de origem desconhecida | Qualquer server não classificado | Tudo: ask |

### Regras de Segurança

```typescript
interface MCPTrustPolicy {
  // NUNCA confiar automaticamente em server externo
  autoTrust: false;

  // Verificações obrigatórias antes de conectar
  preConnect: {
    // Server está na lista de trusted?
    checkTrustList: true;
    // URL do server é HTTPS?
    requireHTTPS: true;
    // Server responde ao healthcheck?
    healthCheck: true;
  };

  // Verificações durante uso
  runtime: {
    // Logar toda tool call para auditoria
    logAllCalls: true;
    // Timeout para evitar hang
    callTimeout: 30_000;
    // Máximo de calls por sessão (proteção contra loop)
    maxCallsPerSession: 500;
  };

  // Ações quando server falha
  onFailure: {
    // Retry com backoff
    retryCount: 3;
    retryBackoff: 'exponential';
    // Após max retries, marcar como unavailable
    markUnavailable: true;
    // NUNCA simular resultado se server falhou
    simulateResult: false;
  };
}
```

### Configuração Local

O usuário configura MCPs confiáveis em `~/.config/cli-agent/trusted-mcps.json`:

```json
{
  "trusted": [
    "@modelcontextprotocol/server-github",
    "@modelcontextprotocol/server-fetch",
    "@modelcontextprotocol/server-postgres",
    "@modelcontextprotocol/server-filesystem"
  ],
  "verified": [
    "custom-cicd-mcp-server",
    "custom-package-registry-mcp"
  ],
  "blocked": [
    "suspicious-mcp-server"
  ]
}
```

## 4. Fluxo de Conexão MCP

```
AGENT PRECISA DE MCP TOOL
    │
    ▼
SERVER ESTÁ CONFIGURADO?
    ├── NÃO → declara indisponibilidade
    │         "MCP [nome] não está configurado. Para configurar: [instruções]"
    │
    └── SIM
         │
         ▼
    CHECK TRUST LEVEL
         │
         ├── trusted → prossegue
         ├── verified → prossegue com logging extra
         └── untrusted → pede aprovação do usuário
              │
              ▼
         HEALTH CHECK
              │
              ├── OK → conecta e usa
              └── FAIL → retry (3x) → marca unavailable
                   │
                   ▼
              "MCP [nome] não está respondendo. Verifique se o server está rodando."
```

## 5. Exemplo de Uso Real

### Cenário: Usuário pede para atualizar React para v19

```
1. Agent ativa skill `dependency-research`

2. Skill precisa de:
   - web_search (para pesquisar breaking changes)
   - MCP docs (para consultar react.dev/blog)
   - MCP packages (para verificar versões no npm)

3. Para cada MCP:
   a. Verifica se está configurado
   b. Verifica trust level
   c. Faz health check
   d. Executa tool call
   e. Captura resultado real

4. Se MCP docs falha:
   → tenta web_fetch direto para react.dev
   → se também falha, declara:
     "Não consegui acessar a documentação do React.
      Resultado parcial baseado apenas na pesquisa web."

5. NUNCA inventa conteúdo da documentação.
```

## 6. Adicionar Novo MCP

Para adicionar uma integração MCP:

1. Instalar o server: `npm install -g @scope/server-name`
2. Adicionar à configuração do agent:
   ```json
   {
     "mcpServers": {
       "nome": {
         "command": "npx",
         "args": ["@scope/server-name"],
         "env": { "API_KEY": "..." }
       }
     }
   }
   ```
3. Classificar trust level em `trusted-mcps.json`.
4. Testar com `/skill info` para verificar tools disponíveis.
5. Definir permissões por tool.
