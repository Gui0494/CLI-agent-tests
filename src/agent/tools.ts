import { z } from "zod";
import { createExecutor } from "../executor/runner.js";
import { readFile, writeFile, listFiles, patchFile } from "../editor/file-ops.js";
import { generateDiff } from "../editor/diff.js";
import { PythonBridge } from "../bridge/python-bridge.js";
import { BaseTool, ToolDefinition } from "./base-tool.js";

// --- Tool Implementations ---

export class ExecTool extends BaseTool<{ cmd: string }> {
    name = "exec";
    description = "Run a bash command in a secure, isolated Docker sandbox. Returns stdout, stderr, and exit_code.";
    schema = z.object({
        cmd: z.string().describe("Command to run in the Docker sandbox"),
    });

    constructor(private executor = createExecutor()) {
        super();
    }

    async execute(args: { cmd: string }): Promise<any> {
        const result = await this.executor.run(args.cmd);
        return {
            ok: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exitCode
        };
    }
}

export class ReadFileTool extends BaseTool<{ path: string }> {
    name = "read_file";
    description = "Read the contents of a file in the workspace.";
    schema = z.object({
        path: z.string().describe("Path to the file to read"),
    });

    private readonly MAX_CHARS = 50_000;

    async execute(args: { path: string }): Promise<any> {
        try {
            const content = await readFile(args.path);
            return {
                ok: true,
                content: content.slice(0, this.MAX_CHARS),
                truncated: content.length > this.MAX_CHARS,
            };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}

export class ListFilesTool extends BaseTool<{ dir?: string }> {
    name = "list_files";
    description = "List all files in a directory recursively.";
    schema = z.object({
        dir: z.string().describe("Directory to list files from (default: .)").default("."),
    });

    async execute(args: { dir: string }): Promise<any> {
        try {
            const files = await listFiles(args.dir);
            return {
                ok: true,
                files: files.slice(0, 500),
                truncated: files.length > 500,
            };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}

const EditPatchSchema = z.object({
    mode: z.enum(["replace", "create"]),
    old_text: z.string().default(""),
    new_text: z.string().default(""),
});

export class EditFileTool extends BaseTool<{ path: string; instruction: string }> {
    name = "edit_file";
    description = "Edit a file in the workspace using an LLM. Provide the file path and instructions on what to change.";
    schema = z.object({
        path: z.string().describe("Path to the file to edit"),
        instruction: z.string().describe("Instructions on what to change in the file"),
    });

    constructor(private bridge: PythonBridge) {
        super();
    }

    async execute(args: { path: string; instruction: string }): Promise<any> {
        try {
            const original = await readFile(args.path).catch(() => "");

            const edited = await this.bridge.call("llm_chat", {
                messages: [
                    {
                        role: "system",
                        content: [
                            "You edit files by returning JSON only.",
                            'Schema: {"mode":"replace"|"create","old_text":"...","new_text":"..."}',
                            'Use "create" only if the file is empty or missing.',
                            "old_text must be an exact unique snippet from the original file.",
                            "Do not return markdown fences or explanations."
                        ].join("\n"),
                    },
                    {
                        role: "user",
                        content: JSON.stringify({
                            path: args.path,
                            instruction: args.instruction,
                            content: original,
                        }),
                    },
                ],
            });

            const patch = EditPatchSchema.parse(JSON.parse(edited.content));

            if (patch.mode === "create") {
                await writeFile(args.path, patch.new_text);
                return { ok: true, created: true, message: `Created ${args.path}` };
            }

            const applied = await patchFile(args.path, patch.old_text, patch.new_text);
            if (!applied) {
                return { ok: false, error: "Patch target not found in file" };
            }

            const updated = await readFile(args.path);
            return {
                ok: true,
                message: `Successfully edited ${args.path}`,
                diff: generateDiff(original, updated, args.path),
            };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}

export class SearchWebTool extends BaseTool<{ query: string }> {
    name = "search_web";
    description = "Search the web for current information, documentation, or answers.";
    schema = z.object({
        query: z.string().describe("Search query to look up on the web"),
    });

    constructor(private bridge: PythonBridge) {
        super();
    }

    async execute(args: { query: string }): Promise<any> {
        try {
            const searchResults = await this.bridge.call("search", { query: args.query });
            return { ok: true, results: searchResults.citations };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}

export class FetchUrlTool extends BaseTool<{ url: string }> {
    name = "fetch_url";
    description = "Fetch and extract markdown content from a specific URL.";
    schema = z.object({
        url: z.string().describe("URL to fetch and read content from"),
    });

    constructor(private bridge: PythonBridge) {
        super();
    }

    async execute(args: { url: string }): Promise<any> {
        try {
            const fetched = await this.bridge.call("fetch_url", { url: args.url });
            return { ok: true, content: fetched.content };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}

// --- Tool Registry ---

export class ToolRegistry {
    private tools: Map<string, BaseTool<any>> = new Map();

    constructor(private bridge: PythonBridge) {
        this.register(new ExecTool());
        this.register(new ReadFileTool());
        this.register(new ListFilesTool());
        this.register(new EditFileTool(bridge));
        this.register(new SearchWebTool(bridge));
        this.register(new FetchUrlTool(bridge));
    }

    register(tool: BaseTool<any>) {
        this.tools.set(tool.name, tool);
    }

    getToolCatalog(): ToolDefinition[] {
        const catalog: ToolDefinition[] = [];
        for (const tool of this.tools.values()) {
            catalog.push(tool.getToolDefinition());
        }
        return catalog;
    }

    async executeTool(name: string, args: Record<string, unknown>): Promise<any> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
        }
        const parsedArgs = tool.schema.parse(args);
        return tool.execute(parsedArgs);
    }
}
