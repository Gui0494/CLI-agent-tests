import json
import codecs

targets = [
    'src/index.ts', 'src/verifier/typecheck.ts', 'src/verifier/linter.ts',
    'src/bridge/protocol.ts', 'src/cli/repl.ts', 'src/cli/commands.ts',
    'src/agent/loop.ts', 'src/agent/tools.ts', 'src/executor/docker-sandbox.ts',
    'src/executor/runner.ts', 'src/bridge/python-bridge.ts', 'tsconfig.json',
    'package.json'
]
targets = [t.lower() for t in targets]

with codecs.open('eslint_out.json', 'r', encoding='utf-8-sig') as f:
    try:
        data = json.load(f)
    except json.JSONDecodeError:
        # fallback to utf-16
        with codecs.open('eslint_out.json', 'r', encoding='utf-16le') as f2:
            data = json.load(f2)

with open('eslint_targets.txt', 'w', encoding='utf-8') as out:
    for f in data:
        path = f.get('filePath', '').replace('\\', '/').lower()
        if any(path.endswith(t) for t in targets) and f.get('messages'):
            out.write(f"{f['filePath']}\n")
            for m in f['messages']:
                out.write(f"  Line {m.get('line', '?')}: {m.get('message', '')} ({m.get('ruleId', '')})\n")
