# AurexAI - CLI Agent Architecture

## Overview
AurexAI is a hybrid Node.js + Python CLI agent that runs locally in the terminal.
It can edit code/files, search the web, plan tasks, execute commands in sandbox, run tests, and automate GitHub workflows.

## Tech Stack
- **CLI Shell & File Ops**: Node.js (TypeScript)
- **AI/ML & Web Search**: Python
- **Communication**: JSON-RPC over stdio pipes
- **Sandbox**: Docker
- **Cache**: SQLite
- **Config**: dotenv + YAML

## Directory Structure
```
aurex-ai/
├── package.json                 # Node.js root
├── tsconfig.json
├── .env.example
├── config.yaml                  # Runtime config
├── Dockerfile.sandbox           # Sandbox image
│
├── src/                         # Node.js (TypeScript)
│   ├── index.ts                 # Entry point + REPL
│   ├── cli/
│   │   ├── repl.ts              # Interactive REPL loop
│   │   ├── commands.ts          # Command registry
│   │   └── renderer.ts          # Terminal output (chalk/ora)
│   ├── bridge/
│   │   ├── python-bridge.ts     # Spawn & communicate with Python
│   │   └── protocol.ts          # JSON-RPC types
│   ├── editor/
│   │   ├── file-ops.ts          # Read/write/patch files
│   │   ├── diff.ts              # Unified diff generation
│   │   └── search.ts            # Local code search (ripgrep)
│   ├── executor/
│   │   ├── docker-sandbox.ts    # Docker container lifecycle
│   │   ├── runner.ts            # Command execution + capture
│   │   └── retry.ts             # Smart retry with backoff
│   ├── verifier/
│   │   ├── test-runner.ts       # Jest/pytest/mocha dispatcher
│   │   ├── linter.ts            # ESLint/Ruff/Pylint
│   │   ├── typecheck.ts         # tsc/mypy/pyright
│   │   └── e2e.ts               # Playwright runner
│   └── repo-agent/
│       ├── github.ts            # GitHub API (Octokit)
│       ├── pr-manager.ts        # Create/review/merge PRs
│       ├── issue-tracker.ts     # Issue automation
│       └── code-search.ts       # GitHub code search
│
├── python/                      # Python package
│   ├── pyproject.toml
│   ├── aurex/
│   │   ├── __init__.py
│   │   ├── main.py              # JSON-RPC server (stdio)
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   ├── router.py        # OpenRouter client
│   │   │   ├── planner.py       # Task planning/decomposition
│   │   │   └── prompts.py       # System prompts
│   │   ├── search/
│   │   │   ├── __init__.py
│   │   │   ├── orchestrator.py  # Search with fallback chain
│   │   │   ├── tavily_client.py # Tavily API
│   │   │   ├── jina_client.py   # Jina Reader
│   │   │   ├── serper_client.py # Serper.dev fallback
│   │   │   ├── firecrawl_client.py
│   │   │   └── academic.py      # OpenAlex + Crossref
│   │   ├── cache/
│   │   │   ├── __init__.py
│   │   │   ├── sqlite_cache.py  # 24h TTL cache
│   │   │   └── dedup.py         # URL normalization + dedup
│   │   ├── ratelimit/
│   │   │   ├── __init__.py
│   │   │   └── limiter.py       # Per-provider rate limits
│   │   └── citations/
│   │       ├── __init__.py
│   │       └── manager.py       # Citation tracking
│   └── tests/
│       ├── test_search.py
│       ├── test_cache.py
│       └── test_llm.py
│
└── tests/                       # Node.js tests
    ├── executor.test.ts
    ├── verifier.test.ts
    └── repo-agent.test.ts
```

## Core Modules

### 1. Executor (Node.js)
- Spawns Docker containers for sandboxed execution
- Captures stdout/stderr in real-time (streaming)
- Smart retries: exponential backoff, max 3 attempts
- Timeout per command (configurable, default 60s)
- Resource limits: memory (512MB), CPU (1 core)

### 2. Verifier (Node.js)
- Auto-detects project type (package.json → Node, pyproject.toml → Python)
- Runs: unit tests → lint → typecheck → e2e (pipeline)
- Returns structured results: {passed, failed, errors, warnings}
- Can run in Docker sandbox for isolation

### 3. Repo Agent (Node.js)
- GitHub API via Octokit (5k req/hour)
- Auto-create PRs with AI-generated descriptions
- Review PRs: diff analysis + inline comments
- Issue triage: label, assign, link to PRs
- Code search across repos

### 4. Web Search Layer (Python)
**Fallback Chain**: Tavily → Serper.dev → Firecrawl
**URL Extraction**: Jina Reader (primary) → Firecrawl (heavy)
**Academic**: OpenAlex → Crossref

**Cache**: SQLite with 24h TTL
- Key: normalized URL or search query hash
- Value: JSON response + metadata
- Auto-cleanup expired entries

**Rate Limits**:
| Provider    | Limit        | Window  |
|-------------|-------------|---------|
| Tavily      | 33/day      | 24h     |
| Jina Reader | 200/day     | 24h     |
| Serper.dev  | 100/month   | 30d     |
| OpenRouter  | 50/day      | 24h     |
| GitHub API  | 5000/hour   | 1h      |
| Firecrawl   | 500/total   | forever |

**Citations Format**:
```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "date": "2024-01-15",
  "excerpt": "Relevant text excerpt...",
  "provider": "tavily"
}
```

### 5. LLM Integration (Python)
- OpenRouter free tier (50/day)
- Models: meta-llama/llama-3-8b-instruct:free, google/gemma-7b-it:free
- Structured output via JSON mode
- Conversation memory (last 10 turns)

## Node.js ↔ Python Communication
```
[Node.js CLI] ←→ [JSON-RPC over stdio] ←→ [Python Process]

Request:  {"jsonrpc":"2.0","method":"search","params":{"query":"..."},"id":1}
Response: {"jsonrpc":"2.0","result":{...},"id":1}
```

Methods exposed by Python:
- `search(query, max_results)` → search results with citations
- `fetch_url(url)` → extracted text content
- `llm_chat(messages, model?)` → LLM response
- `llm_plan(task_description)` → structured plan
- `academic_search(query)` → papers/citations

## CLI Commands
```
aurex                          # Start interactive REPL
aurex exec <command>           # Run command in sandbox
aurex edit <file>              # Edit file with AI assistance
aurex search <query>           # Web search
aurex test                     # Run verifier pipeline
aurex pr create                # Create PR
aurex pr review <number>       # Review PR
aurex plan <task>              # Generate execution plan
aurex issue <action>           # Issue management
```

## Configuration (.env)
```
TAVILY_API_KEY=
SERPER_API_KEY=
OPENROUTER_API_KEY=
GITHUB_TOKEN=
JINA_API_KEY=
FIRECRAWL_API_KEY=
OPENAI_API_KEY=              # optional fallback
```
