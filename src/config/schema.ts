import { z } from "zod";

export const RateLimitSchema = z.object({
    max_requests: z.number().int().positive(),
    window_seconds: z.number().int().positive(),
});

export const ConfigSchema = z.object({
    executor: z.object({
        timeout_ms: z.number().int().positive().default(60000),
        max_retries: z.number().int().nonnegative().default(3),
        docker_image: z.string().default("aurex-sandbox:latest"),
        memory_limit: z.string().default("512m"),
        cpu_limit: z.string().default("1.0"),
    }).default({}),
    verifier: z.object({
        auto_detect: z.boolean().default(true),
        pipeline: z.array(z.string()).default(["unit_tests", "lint", "typecheck", "e2e"]),
    }).default({}),
    search: z.object({
        cache_ttl_hours: z.number().positive().default(24),
        max_results: z.number().int().positive().default(10),
        fallback_chain: z.array(z.string()).default(["tavily", "serper", "firecrawl"]),
    }).default({}),
    rate_limits: z.record(z.string(), RateLimitSchema).default({
        tavily: { max_requests: 33, window_seconds: 86400 },
        jina: { max_requests: 200, window_seconds: 86400 },
        serper: { max_requests: 3, window_seconds: 86400 },
        openrouter: { max_requests: 50, window_seconds: 86400 },
        github: { max_requests: 5000, window_seconds: 3600 },
        firecrawl: { max_requests: 500, window_seconds: 999999999 },
    }),
    llm: z.object({
        default_model: z.string().default("meta-llama/llama-3.3-70b-instruct:free"),
        fallback_model: z.string().default("meta-llama/llama-3.2-3b-instruct:free"),
        max_tokens: z.number().int().positive().default(4096),
        temperature: z.number().min(0).max(2).default(0.7),
        memory_turns: z.number().int().positive().default(10),
    }).default({}),
    repo_agent: z.object({
        auto_label: z.boolean().default(true),
        pr_template: z.boolean().default(true),
        review_on_push: z.boolean().default(false),
    }).default({}),
});

export type AurexConfig = z.infer<typeof ConfigSchema>;
