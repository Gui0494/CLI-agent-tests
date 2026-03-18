import os

targets = [
    'src/index.ts', 'src/verifier/typecheck.ts', 'src/verifier/linter.ts',
    'src/bridge/protocol.ts', 'src/cli/repl.ts', 'src/cli/commands.ts',
    'src/agent/loop.ts', 'src/agent/tools.ts', 'src/executor/docker-sandbox.ts',
    'src/executor/runner.ts', 'src/bridge/python-bridge.ts'
]
existing_ts = [t for t in targets if os.path.exists(t)]

py_targets = [
    'python/aurex/llm/prompts.py', 'python/aurex/search/orchestrator.py',
    'python/tests/test_core.py', 'python/aurex/skills/web_research/run.py',
    'python/aurex/llm/planner.py', 'python/aurex/core/agent_loop.py',
    'python/aurex/core/planner.py', 'python/aurex/core/context_manager.py',
    'python/aurex/core/skill_loader.py', 'python/aurex/core/tool_registry.py',
    'test_gemma.py', 'python/aurex/llm/router.py',
    'python/aurex/main.py', 'python/aurex/config/loader.py', 'python/aurex/ratelimit/limiter.py',
    'python/tests/test_cache.py', 'python/tests/test_search.py'
]
existing_py = [p for p in py_targets if os.path.exists(p)]

with open('existing_files.txt', 'w') as f:
    f.write(' '.join(existing_ts) + '\n' + ' '.join(existing_py))

print(f"TS: {len(existing_ts)}/{len(targets)}, PY: {len(existing_py)}/{len(py_targets)}")
