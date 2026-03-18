# Skill: dependency-research

## Objetivo
Pesquisa versões atuais, breaking changes, alternativas e compatibilidade antes de atualizar libs.

## Quando Usar
- Antes de atualizar qualquer dependência.
- Quando o usuário pede para migrar versão.
- Quando npm audit sugere atualização.

## Trigger
```yaml
manual: true        # /skill dependency-research react@19
auto: true
patterns:
  - "atualizar"
  - "upgrade"
  - "migrar versão"
  - "npm audit fix"
  - "breaking change"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| package | string | sim | Nome do pacote |
| targetVersion | string | não | Versão alvo (padrão: latest) |
| currentVersion | string | não | Versão atual (auto-detectada do package.json) |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| currentVersion | string | Versão instalada |
| latestVersion | string | Última versão disponível |
| breakingChanges | BreakingChange[] | Lista de breaking changes entre versões |
| migrationGuide | string | Guia de migração se disponível |
| alternatives | Alternative[] | Pacotes alternativos se relevante |
| compatibility | CompatibilityInfo | Compatibilidade com outras deps do projeto |
| recommendation | string | Recomendação: atualizar, aguardar ou trocar |

## Ferramentas Necessárias
- `web_search` — pesquisar breaking changes e guias de migração
- `web_fetch` — acessar changelogs e docs
- `shell` — npm view, npm outdated
- `fs_read` — ler package.json

## Fluxo

```
1. DETECTAR VERSÃO ATUAL
   ├── fs_read("package.json") → extrair versão da dependência
   └── shell("npm list [package]") para versão exata instalada

2. VERIFICAR VERSÃO MAIS RECENTE
   └── shell("npm view [package] version")

3. PESQUISAR BREAKING CHANGES
   ├── web_search("[package] changelog [from] to [to]")
   ├── web_fetch do CHANGELOG.md do repositório
   ├── web_search("[package] migration guide [version]")
   └── Listar cada breaking change com impacto

4. VERIFICAR COMPATIBILIDADE
   ├── Peer dependencies do pacote
   ├── Conflitos com outras deps do projeto
   └── Versão mínima de Node/runtime

5. PESQUISAR ALTERNATIVAS (se relevante)
   ├── Se pacote está deprecated ou sem manutenção
   ├── web_search("[package] alternatives [year]")
   └── Comparar: tamanho, performance, manutenção

6. GERAR RECOMENDAÇÃO
   ├── Seguro para atualizar → instruções
   ├── Breaking changes significativos → plano de migração
   └── Pacote deprecated → sugerir alternativa
```

## Limites
- Requer web_search para funcionar completamente.
- Se web_search indisponível, usa apenas npm view (informação limitada).
- Timeout: 60s.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Sem web_search | Ferramenta não configurada | Usar apenas npm view + avisar limitação |
| Changelog não encontrado | Repo sem changelog | Usar git tags/releases |
| Versão não existe | Versão alvo não publicada | Verificar npm view versions |

## Exemplo Prático

**Input:** `package: "react", targetVersion: "19"`

**Output:**
```markdown
## Dependency Research: react@19

### Versões
- **Atual:** 18.2.0 (no projeto)
- **Alvo:** 19.0.0
- **Última:** 19.0.0

### Breaking Changes (18 → 19)
1. **`use()` hook** — novo hook para consumir promises e context
2. **React Compiler** — compilação automática (opt-in)
3. **`ref` como prop** — não precisa mais de forwardRef
4. **`<Context>` como provider** — sem `.Provider`
5. **Remoção de APIs legadas** — createFactory, PropTypes built-in

### Impacto no Projeto
- 12 arquivos usam forwardRef → precisam atualizar
- 3 arquivos usam Context.Provider → atualizar sintaxe
- 0 arquivos usam APIs removidas ✓

### Compatibilidade
- react-dom: precisa atualizar para 19 também ✓
- @testing-library/react: compatível com React 19 ✓
- next: requer Next.js 15+ para React 19 ⚠

### Recomendação
**Atualizar com cuidado.** Criar branch separada, atualizar react + react-dom,
corrigir forwardRef e Context.Provider, rodar testes completos.

Estimativa: 12 arquivos afetados, mudanças são mecânicas (search/replace).
```
