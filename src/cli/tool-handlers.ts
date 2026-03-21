import chalk from "chalk";
import * as diff from "diff";
import { readFile, writeFile } from "../editor/file-ops.js";
import { ToolResult } from "../agent/base-tool.js";

import { AppContext } from "../context.js";
import { getHookEngine, HookEvent, HookAction } from "../hooks/engine.js";
import { fuzzyFind } from "../editor/fuzzy-edit.js";
import { FileCache } from "../memory/file-cache.js";

type AskFunction = (q: string) => Promise<string>;

export interface ExecArgs { cmd: string; }
export interface ReadFileArgs { path: string; }
export interface ListFilesArgs { dir?: string; }
export interface EditFileArgs { path: string; old_text: string; new_text: string; replace_all?: boolean; }
export interface WriteFileArgs { path: string; content: string; }
export interface GrepArgs { path?: string; pattern: string; }
export interface CreateAgentArgs { agent_name: string; purpose: string; triggers: string[]; tools: string[]; output_dir?: string; }

export async function handleExec(tool_args: ExecArgs, executor: { run: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> }, appContext?: AppContext): Promise<ToolResult> {
    if (appContext) {
        const hookEngine = getHookEngine();
        const hookRes = await hookEngine.emit(HookEvent.PRE_SHELL, { mode: appContext.modeManager.getMode(), command: tool_args.cmd });
        if (hookRes.action === HookAction.BLOCK) {
            return { ok: false, error: `Blocked by system hook: ${hookRes.reason}`, exit_code: -1 };
        }
    }
    try {
        const runRes = await executor.run(tool_args.cmd);
        let finalStderr = runRes.stderr;
        if (runRes.exitCode !== 0 || runRes.timedOut) {
            const { isTransientError } = await import("../executor/retry.js");
            const isTransient = isTransientError({ stderr: runRes.stderr, code: runRes.exitCode, killed: runRes.timedOut });
            if (isTransient) {
                finalStderr = `[ErrorClass: TRANSIENT]\n${runRes.stderr}`;
            }
        }
        return { ok: runRes.exitCode === 0, stdout: runRes.stdout, stderr: finalStderr, exit_code: runRes.exitCode };
    } catch (cmdErr: any) {
        const { isTransientError } = await import("../executor/retry.js");
        const isTransient = isTransientError(cmdErr);
        return { ok: false, stdout: "", stderr: `[ErrorClass: ${isTransient ? 'TRANSIENT' : 'UNKNOWN'}]\n${cmdErr.message}`, exit_code: -1 };
    }
}

export async function handleReadFile(tool_args: ReadFileArgs, fileCache?: FileCache): Promise<ToolResult> {
    // Check cache first
    if (fileCache) {
        const cached = await fileCache.get(tool_args.path);
        if (cached) {
            return { ok: true, content: cached.content.slice(0, 50000), truncated: cached.content.length > 50000, fromCache: true };
        }
    }
    const content = await readFile(tool_args.path);
    // Store in cache
    if (fileCache) {
        await fileCache.set(tool_args.path, content);
    }
    return { ok: true, content: content.slice(0, 50000), truncated: content.length > 50000 };
}

export async function handleListFiles(tool_args: ListFilesArgs): Promise<ToolResult> {
    const { listFiles } = await import("../editor/file-ops.js");
    const files = await listFiles(tool_args.dir || ".");
    return { ok: true, files: files.slice(0, 500), truncated: files.length > 500 };
}

export async function handleEditFile(tool_args: EditFileArgs, ask: AskFunction, appContext?: AppContext): Promise<ToolResult> {
    const filePath = tool_args.path;
    const oldText = tool_args.old_text;
    const newText = tool_args.new_text;
    const content = await readFile(filePath);
    
    if (!content.includes(oldText)) {
        // Fuzzy matching fallback
        const fuzzyResult = fuzzyFind(content, oldText);
        if (fuzzyResult) {
            console.log(chalk.yellow(`  Exact match not found. Using fuzzy match (distance: ${fuzzyResult.distance})`));
            return handleEditFile(
                { ...tool_args, old_text: fuzzyResult.match },
                ask,
                appContext,
            );
        }
        return { ok: false, error: "old_text not found in file (even with fuzzy matching). Ensure it is an exact match including whitespace." };
    }
    
    const occurrences = content.split(oldText).length - 1;
    if (occurrences > 1 && !tool_args.replace_all) {
        return { ok: false, error: `old_text found ${occurrences} times. Provide more context to make it unique, or set replace_all: true.` };
    }
    
    const updated = tool_args.replace_all ? content.split(oldText).join(newText) : content.replace(oldText, newText);
    const diffLines = diff.diffLines(content, updated);
    let additions = 0, deletions = 0;
    for (const part of diffLines) {
        const lines = part.value.split('\n').filter((l: string) => l.length > 0).length;
        if (part.added) additions += lines;
        if (part.removed) deletions += lines;
    }

    console.log(`\n${chalk.cyan(`📄 Patch ready for ${filePath}`)} ${chalk.green(`+${additions}`)} ${chalk.red(`-${deletions}`)}`);

    let allowed = false;
    let answered = false;
    while (!answered) {
        const answer = await ask(`  [a] apply   [d] view diff   [x] cancel: `);
        const cmd = answer.trim().toLowerCase();

        if (cmd === "a" || cmd === "y" || cmd === "yes") {
            allowed = true;
            answered = true;
        } else if (cmd === "x" || cmd === "n" || cmd === "no") {
            allowed = false;
            answered = true;
        } else if (cmd === "d" || cmd === "v") {
            console.log(`\n${chalk.cyan(`📄 Diff:`)}`);
            for (const part of diffLines) {
                const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
                const prefix = part.added ? "+ " : part.removed ? "- " : "  ";
                const lines = part.value.split('\n');
                if (lines[lines.length - 1] === '') lines.pop();
                for (const line of lines) { console.log(color(prefix + line)); }
            }
            console.log();
        }
    }

    if (!allowed) {
        return { ok: false, error: "User rejected the patch" };
    }
    if (appContext) {
        const preWrite = await getHookEngine().emit(HookEvent.PRE_WRITE, { mode: appContext.modeManager.getMode(), filePath: tool_args.path });
        if (preWrite.action === HookAction.BLOCK) {
            return { ok: false, error: `Blocked by hook: ${preWrite.reason}` };
        }
    }
    await writeFile(filePath, updated);
    if (appContext) {
        await getHookEngine().emit(HookEvent.POST_EDIT, { mode: appContext.modeManager.getMode(), filePath: tool_args.path });
    }
    return { ok: true, message: `Edited ${filePath}`, replacements: tool_args.replace_all ? occurrences : 1 };
}

export async function handleWriteFile(tool_args: WriteFileArgs, ask: AskFunction, appContext?: AppContext): Promise<ToolResult> {
    let content = "";
    try { content = await readFile(tool_args.path); } catch { /* file may not exist yet — treat as new file */ }

    const diffLines = diff.diffLines(content, tool_args.content);
    let additions = 0, deletions = 0;
    for (const part of diffLines) {
        const lines = part.value.split('\n').filter((l: string) => l.length > 0).length;
        if (part.added) additions += lines;
        if (part.removed) deletions += lines;
    }

    console.log(`\n${chalk.cyan(`📄 File write ready for ${tool_args.path}`)} ${chalk.green(`+${additions}`)} ${chalk.red(`-${deletions}`)}`);

    let allowed = false;
    let answered = false;
    while (!answered) {
        const answer = await ask(`  [a] apply   [d] view diff   [x] cancel: `);
        const cmd = answer.trim().toLowerCase();

        if (cmd === "a" || cmd === "y" || cmd === "yes") {
            allowed = true;
            answered = true;
        } else if (cmd === "x" || cmd === "n" || cmd === "no") {
            allowed = false;
            answered = true;
        } else if (cmd === "d" || cmd === "v") {
            console.log(`\n${chalk.cyan(`📄 Diff:`)}`);
            for (const part of diffLines) {
                const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
                const prefix = part.added ? "+ " : part.removed ? "- " : "  ";
                const lines = part.value.split('\n');
                if (lines[lines.length - 1] === '') lines.pop();
                if (part.added || part.removed || lines.length <= 10) {
                    for (const line of lines) { console.log(color(prefix + line)); }
                } else {
                    for (const line of lines.slice(0, 3)) { console.log(color(prefix + line)); }
                    console.log(chalk.gray("  ..."));
                    for (const line of lines.slice(-3)) { console.log(color(prefix + line)); }
                }
            }
            console.log();
        }
    }

    if (!allowed) {
        return { ok: false, error: "User rejected the file write" };
    }
    if (appContext) {
        const preWrite = await getHookEngine().emit(HookEvent.PRE_WRITE, { mode: appContext.modeManager.getMode(), filePath: tool_args.path });
        if (preWrite.action === HookAction.BLOCK) {
            return { ok: false, error: `Blocked by hook: ${preWrite.reason}` };
        }
    }
    await writeFile(tool_args.path, tool_args.content);
    return { ok: true, message: `Created/Overwritten ${tool_args.path}` };
}

export async function handleGrep(tool_args: GrepArgs): Promise<ToolResult> {
    const { searchCode } = await import("../editor/search.js");
    const { getWorkspaceSandbox } = await import("../security/sandbox.js");
    const searchPath = tool_args.path || ".";
    const pattern = tool_args.pattern;

    if (!pattern || typeof pattern !== 'string') {
        return { ok: false, error: "Pattern is required for grep" };
    }

    const sandbox = getWorkspaceSandbox();
    
    const errorMsg = sandbox.validate(searchPath);
    if (errorMsg) {
        return { ok: false, error: errorMsg };
    }
    const resolvedDir = searchPath;

    const results = await searchCode(pattern, resolvedDir, { maxResults: 500 });
    const matches = results.map(r => `${r.file}:${r.line}:${r.content}`);
    const output = matches.join("\n");
    return {
        ok: true,
        matches: output.slice(0, 30000),
        truncated: matches.length >= 500 || output.length > 30000,
        count: matches.length,
        message: matches.length === 0 ? "No matches found" : undefined,
    };
}

export async function handleCreateAgent(tool_args: CreateAgentArgs, ask: AskFunction): Promise<ToolResult> {
    const { agent_name, purpose, triggers, tools, output_dir } = tool_args;
    console.log(`\n${chalk.magenta(`✨ Criando novo sub-agente especializado: ${agent_name}`)}`);
    console.log(`  💡 Propósito: ${purpose}`);
    
    const requestBody = {
        action: "create",
        agent_name: agent_name,
        requirements: { purpose, triggers, tools, output_format: "A fully functional AurexAI python skill" },
        options: { auto_test: true, max_corrections: 3, output_dir: output_dir || "./python/aurex/skills" }
    };
    
    let allowed = false;
    if (process.env.AUREX_AUTO_YES === "1") {
        console.log(`  Permitir criação automática de agente? [y/N]: y (auto)`);
        allowed = true;
    } else {
        const answer = await ask(`  Permitir criação automática de agente? [y/N]: `);
        allowed = ["y", "yes", "s", "sim"].includes(answer.trim().toLowerCase());
    }

    if (!allowed) return { ok: false, error: "Usuário rejeitou a criação do agente" };

    const { spawn } = await import("child_process");
    const path = await import("path");
    
    const bridgeScript = path.resolve(process.cwd(), "..", "skill-creator-main", "skill-creator-main", "agent-creator", "scripts", "cli_bridge.py");
    
    const runCreate = () => new Promise<{ code: number | null; response: { status?: string; error?: { message?: string }; [key: string]: unknown } }>((resolve) => {
        const proc = spawn("python3", [bridgeScript, "--create"], { env: { ...process.env, PYTHONUNBUFFERED: "1" } });
        let stdoutStr = "";
        proc.stdout.on("data", (data) => stdoutStr += data.toString());
        proc.stderr.on("data", (data) => process.stderr.write(chalk.gray(data.toString())));
        
        proc.on("close", (code) => {
            try {
                const res = JSON.parse(stdoutStr);
                resolve({ code, response: res });
            } catch (e: any) {
                resolve({ code, response: { status: "error", error: { message: `Invalid JSON from bridge: \n${stdoutStr.slice(0, 200)}` }} });
            }
        });
        
        proc.stdin.write(JSON.stringify(requestBody));
        proc.stdin.end();
    });
    
    const creationRes = await runCreate();
    if (creationRes.response.status === "success" || creationRes.response.status === "partial") {
        return { ok: true, message: `Agente ${agent_name} criado com sucesso e adicionado ao AurexAI dinamicamente!`, details: creationRes.response };
    } else {
        return { ok: false, error: `Falha na criação: ${creationRes.response?.error?.message || "Erro desconhecido"}` };
    }
}
