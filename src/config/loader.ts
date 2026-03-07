import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";
import { ConfigSchema, AurexConfig } from "./schema.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let cachedConfig: AurexConfig | null = null;

export function loadConfig(configPath?: string): AurexConfig {
    if (cachedConfig && !configPath) return cachedConfig;

    // 1. Resolve config file path (defaults to project root config.yaml)
    const defaultPath = path.resolve(__dirname, "../../config.yaml");
    const targetPath = configPath || defaultPath;

    let fileConfig = {};

    // 2. Load YAML if it exists
    if (fs.existsSync(targetPath)) {
        try {
            const fileContent = fs.readFileSync(targetPath, "utf8");
            const parsed = yaml.load(fileContent) as any;
            if (parsed && typeof parsed === "object") {
                fileConfig = parsed;
            }
        } catch (err) {
            console.warn(`[config] Failed to parse ${targetPath}, using defaults.`);
        }
    }

    // 3. Override with Environment Variables (AUREX_*)
    applyEnvOverrides(fileConfig);

    // 4. Validate and apply defaults using Zod
    const result = ConfigSchema.safeParse(fileConfig);
    if (!result.success) {
        console.error("[config] Validation errors:");
        for (const error of result.error.errors) {
            console.error(`  - ${error.path.join('.')}: ${error.message}`);
        }
        // Return safe defaults if totally broken
        cachedConfig = ConfigSchema.parse({});
    } else {
        cachedConfig = result.data;
    }

    return cachedConfig;
}

function parseEnvValue(value: string): unknown {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
    return value;
}

function applyEnvOverrides(config: Record<string, any>) {
    const prefix = "AUREX_";
    const sections = ["executor", "verifier", "search", "llm", "repo_agent"] as const;

    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith(prefix) || !value) continue;

        const raw = key.slice(prefix.length);
        const section = sections.find((s) => raw === s.toUpperCase() || raw.startsWith(`${s.toUpperCase()}_`));
        if (!section) continue;

        const field = raw.slice(section.toUpperCase().length + 1).toLowerCase();
        if (!field) continue;

        if (!config[section]) config[section] = {};
        config[section][field] = parseEnvValue(value);
    }
}

// Automatically load on import
export const config = loadConfig();
