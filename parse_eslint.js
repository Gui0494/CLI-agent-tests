const fs = require('fs');

const targetFiles = [
  'src/index.ts', 'src/verifier/typecheck.ts', 'src/verifier/linter.ts',
  'src/bridge/protocol.ts', 'src/cli/repl.ts', 'src/cli/commands.ts',
  'src/agent/loop.ts', 'src/agent/tools.ts', 'src/executor/docker-sandbox.ts',
  'src/executor/runner.ts', 'src/bridge/python-bridge.ts', 'tsconfig.json',
  'package.json'
].map(f => f.toLowerCase());

let report = [];

try {
  const eslintData = JSON.parse(fs.readFileSync('eslint_out.json', 'utf16le'));
  eslintData.forEach(file => {
    const fPath = file.filePath.replace(/\\/g, '/').toLowerCase();
    if (targetFiles.some(t => fPath.endsWith(t))) {
      file.messages.forEach(m => {
        report.push({
          file: fPath,
          line: m.line,
          ruleId: m.ruleId,
          message: m.message
        });
      });
    }
  });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("Error reading eslint_out.json: " + e.message);
}
