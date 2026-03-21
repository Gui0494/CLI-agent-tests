import { z } from "zod";

// ─── Single Source of Truth for Config Defaults ─────────
export const CONFIG_DEFAULTS = {
    executor: {
        timeout_ms: 60000,
        max_retries: 3,
        docker_image: "aurex-sandbox:latest",
        memory_limit: "512m",
        cpu_limit: "1.0",
    },
    verifier: {
        auto_detect: true,
        pipeline: ["unit_tests", "lint", "typecheck", "e2e"],
    },
    search: {
        cache_ttl_hours: 24,
        max_results: 10,
        fallback_chain: ["tavily", "serper", "firecrawl"],
    },
    rate_limits: {
        tavily: { max_requests: 33, window_seconds: 86400 },
        jina: { max_requests: 200, window_seconds: 86400 },
        serper: { max_requests: 3, window_seconds: 86400 },
        openrouter: { max_requests: 50, window_seconds: 86400 },
        github: { max_requests: 5000, window_seconds: 3600 },
        firecrawl: { max_requests: 500, window_seconds: 999999999 },
    },
    llm: {
        default_model: "meta-llama/llama-3.3-70b-instruct:free",
        fallback_model: "meta-llama/llama-3.2-3b-instruct:free",
        max_tokens: 4096,
        temperature: 0.7,
        memory_turns: 10,
    },
    repo_agent: {
        auto_label: true,
        pr_template: true,
        review_on_push: false,
    },
} as const;

// ─── Zod Schemas (defaults reference CONFIG_DEFAULTS) ───

export const RateLimitSchema = z.object({
    max_requests: z.number().int().positive(),
    window_seconds: z.number().int().positive(),
});

export const ConfigSchema = z.object({
    executor: z.object({
        timeout_ms: z.number().int().positive().default(CONFIG_DEFAULTS.executor.timeout_ms),
        max_retries: z.number().int().nonnegative().default(CONFIG_DEFAULTS.executor.max_retries),
        docker_image: z.string().default(CONFIG_DEFAULTS.executor.docker_image),
        memory_limit: z.string().default(CONFIG_DEFAULTS.executor.memory_limit),
        cpu_limit: z.string().default(CONFIG_DEFAULTS.executor.cpu_limit),
    }).default({}),
    verifier: z.object({
        auto_detect: z.boolean().default(CONFIG_DEFAULTS.verifier.auto_detect),
        pipeline: z.array(z.string()).default([...CONFIG_DEFAULTS.verifier.pipeline]),
    }).default({}),
    search: z.object({
        cache_ttl_hours: z.number().positive().default(CONFIG_DEFAULTS.search.cache_ttl_hours),
        max_results: z.number().int().positive().default(CONFIG_DEFAULTS.search.max_results),
        fallback_chain: z.array(z.string()).default([...CONFIG_DEFAULTS.search.fallback_chain]),
    }).default({}),
    rate_limits: z.record(z.string(), RateLimitSchema).default({ ...CONFIG_DEFAULTS.rate_limits }),
    llm: z.object({
        default_model: z.string().default(CONFIG_DEFAULTS.llm.default_model),
        fallback_model: z.string().default(CONFIG_DEFAULTS.llm.fallback_model),
        max_tokens: z.number().int().positive().default(CONFIG_DEFAULTS.llm.max_tokens),
        temperature: z.number().min(0).max(2).default(CONFIG_DEFAULTS.llm.temperature),
        memory_turns: z.number().int().positive().default(CONFIG_DEFAULTS.llm.memory_turns),
    }).default({}),
    repo_agent: z.object({
        auto_label: z.boolean().default(CONFIG_DEFAULTS.repo_agent.auto_label),
        pr_template: z.boolean().default(CONFIG_DEFAULTS.repo_agent.pr_template),
        review_on_push: z.boolean().default(CONFIG_DEFAULTS.repo_agent.review_on_push),
    }).default({}),
    mcp: z.object({
        servers: z.record(z.string(), z.object({
            command: z.string(),
            args: z.array(z.string()).default([]),
            env: z.record(z.string(), z.string()).default({}),
        })).default({}),
    }).default({}),
});

export type AurexConfig = z.infer<typeof ConfigSchema>;
