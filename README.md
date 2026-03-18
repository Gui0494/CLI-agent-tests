# AurexAI CLI Agent

AurexAI is a powerful, local Command-Line Agent designed for code editing, intelligent web search, advanced execution planning, and multi-step agentic repository management. 

It utilizes a hardened Hybrid Architecture relying on **TypeScript/Node.js for interface tooling and executing rapid native operations**, tethered via Reverse JSON-RPC to **Python for the core semantic Cognitive LLM orchestration, structured API interactions, and advanced caching schemas.**

---

## 🏗️ Architecture

- **`node dist/index.js` (Frontend / Execution Driver)**: Exposes CLI standard inputs (e.g. `aurex exec`, `aurex search`, `aurex interactive`). Capable of fast raw system interactions and running a Dockerized executor sandbox.
- **`python/aurex/main.py` (Backend Engine / Cognitive Loop)**: Holds the `PermissionManager`, `ContextManager`, LLM abstractions, and the `AgentLoop`. 

When you run `aurex exec`, the command is caught by the Node UI, routed down via JSON-RPC to the Python `PermissionManager` to check risk, and then passed *back up* to Node via `execute_tool` if cleared. This guarantees strict capability auditing across environments.

## 🚀 Setup & Installation

### 1. Requirements
* Node.js (>= 18.0.0)
* Python (>= 3.10)
* Docker (Optional, required for fully sandboxed execution)

### 2. Dependency Installation
Initialize both stacks to run the bridge flawlessly.

```bash
# Node Dependencies
npm install

# Python Dependencies (we rely on pyproject.toml)
pip install -e ./python
```

### 3. API Key Configuration
AurexAI defaults its semantic processing to OpenRouter (`meta-llama/llama-3.3-70b-instruct:free`). You must export an API Key strictly within your `~/.bashrc` or your system environment variables to boot the UI.

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
# OR Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 4. Build Engine
```bash
npm run build
```

---

## 💻 Usage

The CLI behaves identically whether run directly from the compiled distributables `node dist/index.js` or through a linked alias `aurex`.

### 1. Interactive REPL (Agent Mode)
Starts the stateful context stream allowing continuous interaction with the agent and file system.
```bash
aurex interactive
```

### 2. Isolated Execution Sandbox
Runs a native bash command within a secure Docker footprint tracked by Python. You can bypass the sandbox with strict explicit parameters.
```bash
aurex exec "npm install" 
aurex exec --timeout 3000 --no-sandbox "go build ."
```

### 3. Isolated Web Search
Trigger the Tavily -> Serper -> Firecrawl internal fallback chain manually.
```bash
aurex search "Latest React 19 documentation features" --max-results 3
```

### 4. Direct AI File Editing
Edit targeted files autonomously using prompt instructions.
```bash
aurex edit src/index.ts -i "Change the console.log output to yellow"
```

## 🔒 Security Principles

AurexAI treats developer environments securely by actively denying opaque destructive operations.
* **Default Deny:** The `PermissionManager` falls back cleanly to deny unless actively confirmed on risky operations (`format`, `rm -rf`, `reset --hard`, etc.).
* **No Silent Bypasses:** The execution sandbox will natively fail fast (`RuntimeError`) if Docker defaults fail, explicitly preventing code mutations directly on your OS disk without the precise `--no-sandbox` command override.
* **Secrets Scrubber:** Application tracing and error reporting safely sanitize outgoing `Bearer` tokens natively in transit avoiding log poisoning.

---

### Tests and Verification
The complete CI safety loop for both runtime contexts:

```bash
npm run build 
npm run test           # Executes Node/Jest assertions
cd python && pytest    # Executes Python LLM mock loop assertions
```
