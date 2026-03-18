# Skill: implement-minimal-diff

## Objetivo
Faz mudanças pequenas e localizadas, evitando reescrever código desnecessariamente. Edita apenas o que precisa mudar.

## Quando Usar
- Para qualquer edição de código.
- Quando o agent precisa modificar arquivos existentes.
- Automaticamente no modo ACT e AUTO.

## Trigger
```yaml
manual: false       # ativada automaticamente quando há edição
auto: true
patterns:
  - edição de arquivo detectada pelo agent loop
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| filePath | string | sim | Arquivo a editar |
| intent | string | sim | O que precisa mudar e por quê |
| context | string | não | Contexto adicional (plano, erro, etc.) |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| diff | string | Diff unificado das mudanças |
| linesChanged | number | Número de linhas alteradas |
| filesModified | string[] | Lista de arquivos modificados |

## Ferramentas Necessárias
- `fs_read` — ler o arquivo atual
- `fs_write` — escrever a edição
- `fs_grep` — buscar padrões para localizar código

## Fluxo

```
1. LER ARQUIVO COMPLETO
   └── fs_read(filePath)

2. IDENTIFICAR REGIÃO A EDITAR
   ├── Localizar a função/componente/bloco específico
   ├── Identificar linhas exatas que precisam mudar
   └── Preservar todo o resto do arquivo intacto

3. GERAR EDIÇÃO MÍNIMA
   ├── Alterar APENAS as linhas necessárias
   ├── Manter indentação original
   ├── Manter estilo do código existente
   └── Não reformatar código que não está sendo editado

4. APLICAR EDIÇÃO
   └── fs_write com conteúdo atualizado

5. MOSTRAR DIFF
   └── Diff unificado mostrando exatamente o que mudou

6. VERIFICAR
   ├── Arquivo salvo corretamente?
   └── Sintaxe válida? (hook post-edit roda lint)
```

## Regras

1. **Nunca reescrever o arquivo inteiro** se apenas 3 linhas precisam mudar.
2. **Manter estilo existente** — se o arquivo usa tabs, use tabs; se usa 4 espaços, use 4 espaços.
3. **Não adicionar imports desnecessários.**
4. **Não remover código que não está relacionado à mudança.**
5. **Não "melhorar" código adjacente** sem ser pedido.
6. **Mostrar diff antes de confirmar** (no modo ACT).

## Limites
- Máximo de 1 arquivo por execução da skill (para múltiplos, chamar várias vezes).
- Se a mudança afeta mais de 50% do arquivo, avisar o usuário.
- Timeout: 30s.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| Mudança muito grande | Agent reescreveu arquivo inteiro | Forçar diff mínimo |
| Estilo inconsistente | Agent usou estilo diferente do arquivo | Ler estilo existente antes |
| Import faltando | Adicionou código que usa import não existente | Verificar imports necessários |
| Quebrou código adjacente | Edição afetou contexto | Verificar com lint após edição |

## Exemplo Prático

**Input:**
```
filePath: "src/components/Header.tsx"
intent: "Adicionar botão de dark mode toggle"
```

**Execução:**
```typescript
// fs_read("src/components/Header.tsx") retorna:
import { useState } from 'react'

export function Header() {
  return (
    <header className="bg-white p-4">
      <h1>Meu App</h1>
      <nav>...</nav>
    </header>
  )
}
```

**Diff gerado (mínimo):**
```diff
--- a/src/components/Header.tsx
+++ b/src/components/Header.tsx
@@ -1,4 +1,5 @@
 import { useState } from 'react'
+import { Moon, Sun } from 'lucide-react'

 export function Header() {
+  const [isDark, setIsDark] = useState(false)
   return (
-    <header className="bg-white p-4">
+    <header className={isDark ? "bg-gray-900 p-4" : "bg-white p-4"}>
       <h1>Meu App</h1>
       <nav>...</nav>
+      <button onClick={() => setIsDark(!isDark)}>
+        {isDark ? <Sun size={20} /> : <Moon size={20} />}
+      </button>
     </header>
   )
 }
```

**Métricas:** 6 linhas adicionadas, 1 linha modificada, 0 linhas removidas desnecessariamente.
