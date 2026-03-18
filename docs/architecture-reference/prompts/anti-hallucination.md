# Prompt — Anti-Alucinação de Side Effects

## Objetivo

Impedir que o agent alucine efeitos colaterais — diga que fez algo sem ter feito, mostre resultados inventados, ou afirme estados falsos.

## Regras Absolutas

### 1. Toda ação requer tool call

```
❌ PROIBIDO:
"Executei o comando npm install e todas as dependências foram instaladas."
→ Sem tool call de shell, isso é alucinação.

✓ OBRIGATÓRIO:
[tool_call: shell("npm install")]
→ Resultado real: "added 150 packages in 12s"
"Dependências instaladas. npm adicionou 150 pacotes em 12s."
```

### 2. Todo resultado vem da execução

```
❌ PROIBIDO:
"O arquivo contém a seguinte função:"
→ Sem tool call de fs_read, isso é alucinação.

✓ OBRIGATÓRIO:
[tool_call: fs_read("src/utils.ts")]
→ Conteúdo real do arquivo
"O arquivo src/utils.ts contém: [conteúdo real lido]"
```

### 3. Todo estado é verificado

```
❌ PROIBIDO:
"Os testes estão passando."
→ Sem ter rodado os testes, isso é alucinação.

✓ OBRIGATÓRIO:
[tool_call: shell("npm test")]
→ Resultado real: "Tests: 15 passed, 0 failed"
"Testes executados: 15 passaram, 0 falharam."
```

### 4. Toda pesquisa é real

```
❌ PROIBIDO:
"De acordo com a documentação do React 19, o hook use() funciona assim..."
→ Sem ter pesquisado, isso é alucinação.

✓ OBRIGATÓRIO:
[tool_call: web_search("React 19 use hook documentation")]
→ Resultados reais com URLs
"De acordo com react.dev (acessado via pesquisa real): [conteúdo]"
```

## Verificação em Runtime

O sistema deve validar que o agent não alucina:

```typescript
class HallucinationGuard {
  private executedToolCalls: Set<string> = new Set();

  // Registra toda tool call executada
  onToolExecuted(toolCall: ToolCall): void {
    this.executedToolCalls.add(this.getToolCallId(toolCall));
  }

  // Verifica se o agent referencia ação que não executou
  validateResponse(response: string): ValidationResult {
    const claims = this.extractActionClaims(response);

    for (const claim of claims) {
      if (!this.hasMatchingToolCall(claim)) {
        return {
          valid: false,
          violation: `Agent afirmou "${claim.text}" sem tool call correspondente.`,
          claim,
        };
      }
    }

    return { valid: true };
  }

  private extractActionClaims(text: string): ActionClaim[] {
    const ACTION_PATTERNS = [
      /(?:executei|rodei|instalei|criei|editei|salvei|commitei)\s+(.+)/gi,
      /(?:arquivo|comando|teste|build)\s+(?:foi|está|foram)\s+(.+)/gi,
      /(?:de acordo com|segundo|conforme)\s+(?:a documentação|os docs|a página)/gi,
    ];

    const claims: ActionClaim[] = [];
    for (const pattern of ACTION_PATTERNS) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({ text: match[0], fullMatch: match });
      }
    }
    return claims;
  }
}
```

## Padrões de Linguagem Seguros

### Quando executou de fato:
```
"Executei `npm test`: 15 testes passaram, 0 falharam."
"Li o arquivo src/Header.tsx: contém um componente funcional com 45 linhas."
"Editei a linha 12 de src/Header.tsx: adicionei o prop `isDark`."
```

### Quando NÃO executou:
```
"Para resolver isso, você pode rodar `npm test`."           ← sugestão, não afirmação
"O arquivo provavelmente contém..."                         ← se não leu, use "provavelmente"
"Baseado no que discutimos, a abordagem seria..."           ← não afirma execução
```

### Quando não tem ferramenta:
```
"Não posso pesquisar na web — ferramenta web_search não está configurada."
"Não posso subir preview — o projeto não tem dev server detectado."
"Não posso executar comandos — estou em modo CHAT. Use /mode act."
```

## Checklist Anti-Alucinação

Antes de cada resposta, o agent deve verificar internamente:

```
□ Toda afirmação de execução tem tool call correspondente?
□ Todo conteúdo de arquivo vem de fs_read real?
□ Todo resultado de comando vem de shell real?
□ Toda informação de pesquisa vem de web_search/web_fetch real?
□ Se não executei, estou usando linguagem condicional/sugestiva?
□ Se ferramenta está indisponível, declarei isso explicitamente?
```

## Consequência de Violação

Se o HallucinationGuard detecta violação:

```typescript
function handleHallucinationViolation(violation: ValidationResult): void {
  // 1. Log da violação para debug
  logger.error('HALLUCINATION_DETECTED', violation);

  // 2. Corrigir a resposta
  const corrected = correctResponse(violation);

  // 3. Informar ao usuário (em desenvolvimento)
  if (isDevelopment()) {
    console.warn(
      chalk.yellow('⚠ Resposta corrigida: agent tentou afirmar ação sem execução real.')
    );
  }

  // 4. Enviar resposta corrigida
  return corrected;
}
```
