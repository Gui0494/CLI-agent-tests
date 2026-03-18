# Skill: task-planner

## Objetivo
Transforma o pedido do usuário em plano estruturado: objetivo, arquivos afetados, riscos e ordem de execução.

## Quando Usar
- Quando o modo é PLAN.
- Antes de implementação complexa (mais de 2 arquivos).
- Quando o usuário pede para planejar antes de executar.
- Automaticamente quando modo AUTO inicia.

## Trigger
```yaml
manual: true
auto: true
patterns:
  - "planeje"
  - "antes de fazer"
  - "como você faria"
  - "monte um plano"
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| request | string | sim | Pedido do usuário em linguagem natural |
| projectContext | ProjectContext | não | Contexto do projeto (se disponível via repo-intel) |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| plan | Plan | Plano estruturado com passos, riscos e critérios |

## Ferramentas Necessárias
- `fs_read` — ler arquivos relevantes para entender o contexto
- `fs_glob` — localizar arquivos que serão afetados
- `fs_grep` — buscar padrões no código

## Fluxo

```
1. ENTENDER O PEDIDO
   └── Classificar: feature, bugfix, refactor, config, docs

2. ANALISAR CONTEXTO
   ├── Se projectContext disponível → usar
   └── Se não → ativar repo-intel primeiro

3. LOCALIZAR ARQUIVOS AFETADOS
   ├── fs_grep para encontrar código relacionado
   ├── fs_glob para encontrar arquivos por pattern
   └── fs_read nos arquivos principais

4. IDENTIFICAR RISCOS
   ├── Breaking changes possíveis?
   ├── Testes existentes que podem quebrar?
   ├── Dependências afetadas?
   └── Impacto em outras features?

5. DEFINIR ORDEM DE EXECUÇÃO
   ├── Dependências entre passos
   ├── O que pode ser paralelizado
   └── O que precisa de verificação entre passos

6. GERAR PLANO
   └── Formato estruturado com checklist
```

## Formato de Saída

```markdown
## Objetivo
Adicionar toggle de dark mode ao componente Header.

## Arquivos Afetados
- `src/components/Header.tsx` — adicionar botão e lógica de toggle
- `src/styles/theme.ts` — criar variáveis de tema dark/light
- `src/context/ThemeContext.tsx` — novo arquivo: context para gerenciar tema
- `src/components/Header.test.tsx` — atualizar testes

## Riscos
- **Médio:** Snapshot tests do Header vão quebrar → precisa atualizar
- **Baixo:** CSS pode conflitar com estilos existentes → verificar com lint

## Passos
1. [ ] Criar `src/context/ThemeContext.tsx` com provider e hook
   - Tools: fs_write
   - Dependências: nenhuma
2. [ ] Atualizar `src/styles/theme.ts` com variáveis dark/light
   - Tools: fs_read, fs_write
   - Dependências: passo 1
3. [ ] Atualizar `src/components/Header.tsx` com botão de toggle
   - Tools: fs_read, fs_write
   - Dependências: passos 1 e 2
4. [ ] Atualizar testes `src/components/Header.test.tsx`
   - Tools: fs_read, fs_write
   - Dependências: passo 3
5. [ ] Rodar testes e lint
   - Tools: shell
   - Dependências: passo 4

## Critérios de Aceite
- [ ] Dark mode toggle visível no Header
- [ ] Clicar alterna entre dark e light
- [ ] Preferência persistida (localStorage)
- [ ] Todos os testes passando
- [ ] Lint sem erros
```

## Limites
- Não executa nenhuma ação (apenas leitura e planejamento).
- Máximo de 15 passos por plano.
- Timeout: 60s.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Plano muito vago | Pedido do usuário genérico | Pedir mais detalhes ao usuário |
| Muitos arquivos afetados | Feature muito grande | Sugerir dividir em sub-tarefas |
| Riscos não identificados | Projeto sem testes | Avisar que não há testes para validar |

## Exemplo Prático

**Input:** "Adicione autenticação com Google OAuth ao login"

**Análise:**
```
fs_grep("login|auth|sign", "src/")
→ src/pages/Login.tsx, src/api/auth.ts

fs_read("package.json")
→ sem dependência de OAuth

fs_read("src/pages/Login.tsx")
→ formulário básico de email/senha
```

**Output:** Plano com 8 passos incluindo: instalar dependência, configurar provider, criar callback, atualizar UI, testes, variáveis de ambiente.
