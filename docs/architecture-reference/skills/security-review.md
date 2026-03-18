# Skill: security-review

## Objetivo
Procura segredos expostos, comandos perigosos, permissões excessivas, dependências suspeitas e caminhos destrutivos no código.

## Quando Usar
- Após qualquer implementação, antes de commit.
- Quando o usuário pede review de segurança.
- Automaticamente no pipeline de git-pr-helper.

## Trigger
```yaml
manual: true        # /skill security-review
auto: true
patterns:
  - pré-commit automático
  - "review de segurança"
  - "vulnerabilidade"
  - "segurança"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| scope | string | não | "changed" (padrão) ou "all" |
| files | string[] | não | Arquivos específicos para revisar |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| findings | Finding[] | Lista de problemas encontrados |
| severity | 'critical' \| 'high' \| 'medium' \| 'low' | Severidade mais alta |
| passed | boolean | Se passou na review |
| recommendations | string[] | Recomendações de melhoria |

## Ferramentas Necessárias
- `fs_read` — ler código
- `fs_grep` — buscar padrões de segurança
- `shell` — rodar npm audit (se disponível)
- `web_search` — pesquisar CVEs (se disponível)

## Fluxo

```
1. BUSCAR SEGREDOS EXPOSTOS
   ├── fs_grep para API keys, tokens, senhas hardcoded
   │   ├── Patterns: /[A-Za-z0-9]{32,}/, /sk-[a-z0-9]+/
   │   ├── /password\s*=\s*["'][^"']+["']/
   │   ├── /AKIA[0-9A-Z]{16}/ (AWS access key)
   │   └── /ghp_[a-zA-Z0-9]{36}/ (GitHub token)
   ├── Verificar .env não está no git
   └── Verificar .gitignore inclui .env, *.pem, credentials

2. BUSCAR COMANDOS PERIGOSOS
   ├── fs_grep em shell scripts e código
   │   ├── rm -rf, del /f /q
   │   ├── eval(), exec() com input do usuário
   │   ├── child_process.exec com interpolação de string
   │   └── os.system() com input não sanitizado
   └── Verificar se há sanitização de input

3. BUSCAR VULNERABILIDADES WEB
   ├── XSS: dangerouslySetInnerHTML, innerHTML sem sanitização
   ├── SQL Injection: concatenação de string em queries
   ├── CSRF: falta de token em forms/APIs
   ├── Path Traversal: uso de user input em caminhos de arquivo
   └── Command Injection: user input em execução de shell

4. VERIFICAR DEPENDÊNCIAS
   ├── shell("npm audit") se Node.js
   ├── Verificar dependências com CVEs conhecidos
   └── Alertar sobre dependências sem manutenção

5. VERIFICAR PERMISSÕES
   ├── Arquivos com permissão 777
   ├── Dockerfile rodando como root sem necessidade
   ├── CORS permissivo (Access-Control-Allow-Origin: *)
   └── Endpoints sem autenticação

6. RELATÓRIO
   └── Lista de findings com severidade e recomendação
```

## Formato de Saída

```markdown
## Security Review

### Status: ⚠ 2 issues encontrados

#### 🔴 CRITICAL: API key exposta
**Arquivo:** src/config/api.ts:3
**Código:**
\`\`\`typescript
const API_KEY = "sk-proj-abc123..."  // ← exposta no código
\`\`\`
**Recomendação:** Mover para variável de ambiente.
\`\`\`typescript
const API_KEY = process.env.API_KEY
\`\`\`

#### 🟡 MEDIUM: innerHTML sem sanitização
**Arquivo:** src/components/Comment.tsx:12
**Código:**
\`\`\`tsx
<div dangerouslySetInnerHTML={{ __html: comment.body }} />
\`\`\`
**Recomendação:** Usar DOMPurify para sanitizar.
\`\`\`tsx
import DOMPurify from 'dompurify'
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.body) }} />
\`\`\`

### Passed
✓ Nenhum comando destrutivo encontrado
✓ .env no .gitignore
✓ npm audit: 0 vulnerabilidades
✓ Sem permissões excessivas
```

## Limites
- Não é substituto para ferramentas profissionais de SAST/DAST.
- Detecta padrões conhecidos, não zero-days.
- Timeout: 60s.
- Máximo de 50 arquivos por review.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Falso positivo | String longa confundida com key | Verificar contexto |
| Não detecta | Padrão não coberto | Manter lista de patterns atualizada |
| npm audit falha | Sem node_modules | Rodar npm install primeiro |
