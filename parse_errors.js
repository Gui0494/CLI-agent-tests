const fs = require('fs');

const targetFiles = [
  '.gitignore', 'python/aurex/llm/prompts.py', 'python/aurex/search/orchestrator.py',
  'python/tests/test_core.py', 'python/aurex/skills/web_research/run.py',
  'python/aurex/llm/planner.py', 'python/aurex/core/agent_loop.py',
  'python/aurex/core/planner.py', 'python/aurex/core/context_manager.py',
  'python/aurex/core/skill_loader.py', 'python/aurex/core/tool_registry.py',
  'python/pyproject.toml', 'src/index.ts', 'src/verifier/typecheck.ts',
  'src/verifier/linter.ts', 'src/bridge/protocol.ts', 'test_gemma.py',
  'config.yaml', 'src/cli/repl.ts', 'src/cli/commands.ts', 'src/agent/loop.ts',
  'src/agent/tools.ts', 'python/aurex/llm/router.py', 'python/aurex/main.py',
  'src/executor/docker-sandbox.ts', 'src/executor/runner.ts',
  'python/aurex/config/loader.py', 'python/aurex/ratelimit/limiter.py',
  'src/bridge/python-bridge.ts', 'tsconfig.json', 'package.json',
  'python/tests/test_cache.py', 'python/tests/test_search.py'
].map(f => f.replace(/\\/g, '/').toLowerCase());

let report = [];

try {
  const eslintData = JSON.parse(fs.readFileSync('eslint_out.json', 'utf8'));
  eslintData.forEach(file => {
    const fPath = file.filePath.replace(/\\/g, '/').toLowerCase();
    if (targetFiles.some(t => fPath.endsWith(t))) {
      file.messages.forEach(m => {
        report.push(`[ESLint] ${fPath}:${m.line} ${m.message}`);
      });
    }
  });
} catch (e) {
  report.push("Error reading eslint_out.json: " + e.message);
}

try {
  const pyrightData = JSON.parse(fs.readFileSync('pyright_out.json', 'utf8'));
  pyrightData.generalDiagnostics.forEach(d => {
    const fPath = d.file.replace(/\\/g, '/').toLowerCase();
    if (targetFiles.some(t => fPath.endsWith(t))) {
      report.push(`[Pyright] ${fPath}:${d.range.start.line + 1} ${d.message}`);
    }
  });
} catch (e) {
  report.push("Error reading pyright_out.json: " + e.message);
}

fs.writeFileSync('filtered_errors.txt', report.join('\n'));
console.log(`Found ${report.length} errors. Wrote to filtered_errors.txt`);
