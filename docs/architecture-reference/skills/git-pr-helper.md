# Skill: git-pr-helper

## Objetivo
Gera nome de branch, commit message seguindo padrão do projeto, changelog e resumo de PR.

## Quando Usar
- Quando o usuário pede para commitar ou fazer PR.
- Após implementação concluída e testada.
- Automaticamente no final de um ciclo AUTO.

## Trigger
```yaml
manual: true        # /skill git-pr-helper
auto: true
patterns:
  - "commit"
  - "push"
  - "pull request"
  - "PR"
  - "branch"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| changes | string | sim | Descrição das mudanças |
| type | string | não | feat, fix, chore, docs, refactor, test (auto-detectado) |
| scope | string | não | Escopo da mudança (auto-detectado) |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| branchName | string | Nome da branch sugerido |
| commitMessage | string | Commit message formatada |
| prTitle | string | Título do PR |
| prBody | string | Corpo do PR com resumo |
| changelog | string | Entrada para changelog |

## Ferramentas Necessárias
- `git` — operações git
- `shell` — rodar git commands
- `fs_read` — ler conventions

## Fluxo

```
1. DETECTAR CONVENÇÕES
   ├── Ler .agent/conventions.json para commit pattern
   ├── Ler CONTRIBUTING.md se existir
   └── Se não definido → usar Conventional Commits

2. CLASSIFICAR MUDANÇA
   ├── Analisar diff real (git diff)
   ├── Tipo: feat, fix, chore, docs, refactor, test
   └── Escopo: componente/módulo afetado

3. GERAR BRANCH NAME
   └── pattern: {type}/{scope}-{descrição-curta}
       ex: feat/header-dark-mode

4. GERAR COMMIT MESSAGE
   ├── Header: {type}({scope}): {descrição} (max 72 chars)
   ├── Body: o que mudou e por quê (se necessário)
   └── Footer: breaking changes, issue refs

5. GERAR PR DESCRIPTION
   ├── Título: mesmo do commit header
   ├── Resumo: 3-5 bullets do que mudou
   ├── Screenshots/preview: se aplicável
   ├── Teste: como verificar a mudança
   └── Checklist: items de review

6. EXECUTAR (se no modo ACT/AUTO e aprovado)
   ├── git checkout -b {branchName}
   ├── git add {files}
   ├── git commit -m "{message}"
   └── git push (se aprovado pelo usuário)
```

## Formato de Commit

```
feat(header): add dark mode toggle

Add dark/light theme toggle button to the Header component.
Theme preference is stored in localStorage and applied
via Tailwind CSS dark: variants.

Closes #42
```

## Formato de PR

```markdown
## Summary
- Added dark mode toggle to Header component
- Created ThemeContext for managing theme state
- Theme preference persisted in localStorage

## Changes
- `src/components/Header.tsx` — toggle button + theme class
- `src/context/ThemeContext.tsx` — new context provider
- `src/styles/theme.ts` — dark/light CSS variables

## Test Plan
- [ ] Toggle button visible in Header
- [ ] Click toggles between dark and light
- [ ] Preference persists across page reload
- [ ] All existing tests pass
- [ ] No visual regressions

## Screenshots
[Se preview disponível, incluir URL]
```

## Limites
- Git push requer aprovação explícita do usuário.
- Nunca faz force push.
- Nunca commita em main/master diretamente (cria branch).
- Timeout: 30s.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Sem git | Projeto não é repositório git | Avisar e perguntar se deve inicializar |
| Conflitos | Branch desatualizada | Sugerir rebase/merge |
| Commit vazio | Nenhuma mudança staged | Verificar git status antes |
| Push rejeitado | Branch protegida | Criar branch e abrir PR |
