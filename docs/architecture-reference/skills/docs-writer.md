# Skill: docs-writer

## Objetivo
Atualiza README, exemplos, instalação, troubleshooting e docs de comando sempre que algo muda.

## Quando Usar
- Após adicionar feature nova.
- Após mudar API pública.
- Após mudar comandos de instalação/configuração.
- Quando o usuário pede para documentar.

## Trigger
```yaml
manual: true        # /skill docs-writer
auto: true
patterns:
  - "documente"
  - "atualize o README"
  - "documentação"
  - automático quando API pública muda
```

## Entradas
| Input | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| scope | string | não | "readme", "api", "changelog", "all" (padrão: auto-detect) |
| changes | string | não | Descrição das mudanças que precisam ser documentadas |

## Saídas
| Output | Tipo | Descrição |
|---|---|---|
| updatedFiles | string[] | Arquivos de docs atualizados |
| sections | string[] | Seções modificadas |

## Ferramentas Necessárias
- `fs_read` — ler docs existentes e código
- `fs_write` — atualizar docs
- `fs_grep` — buscar padrões de uso

## Fluxo

```
1. IDENTIFICAR O QUE MUDOU
   ├── Analisar diff das mudanças recentes
   ├── Identificar se afeta API pública
   ├── Identificar se afeta instalação/config
   └── Identificar se afeta comandos

2. LER DOCS EXISTENTES
   ├── README.md
   ├── CHANGELOG.md
   ├── docs/ (se existir)
   └── Comentários JSDoc/docstrings

3. ATUALIZAR DOCS
   ├── Manter estrutura e estilo existente
   ├── Atualizar seções afetadas
   ├── Adicionar exemplos se necessário
   └── Não reescrever seções não afetadas

4. VERIFICAR CONSISTÊNCIA
   ├── Exemplos de código funcionam?
   ├── Comandos estão corretos?
   └── Links internos estão válidos?
```

## Regras

1. **Manter estilo existente** — se o README usa bullets, use bullets; se usa tabelas, use tabelas.
2. **Exemplos devem funcionar** — nunca escrever exemplo de código que não compila.
3. **Não sobreescrever** — atualizar seções específicas, não reescrever o documento inteiro.
4. **Changelog segue padrão** — Keep a Changelog ou padrão do projeto.

## Limites
- Não cria documentação do zero sem pedir (apenas atualiza existente ou pergunta).
- Timeout: 30s.
- Máximo de 5 arquivos de docs por execução.

## Falhas Comuns
| Falha | Causa | Solução |
|---|---|---|
| README não existe | Projeto sem docs | Perguntar ao usuário se deve criar |
| Estilo inconsistente | Docs com formatos misturados | Seguir o estilo predominante |
| Exemplo desatualizado | Código mudou, exemplo não | Atualizar exemplo junto com código |
