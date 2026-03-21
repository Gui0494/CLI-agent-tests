import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface ToolDefinition {
    name: string;
    description: string;
    schema: any;
}

export interface ToolResult<T = unknown> {
    ok: boolean;
    error?: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    content?: string;
    truncated?: boolean;
    files?: string[];
    message?: string;
    replacements?: number;
    matches?: string;
    count?: number;
    details?: unknown;
    data?: T;
    fromCache?: boolean;
}

export abstract class BaseTool<T> {
    abstract get name(): string;
    abstract get description(): string;
    abstract get schema(): z.ZodType<T>;

    abstract execute(args: T): Promise<ToolResult>;

    getToolDefinition(): ToolDefinition {
        const jsonSchema: any = zodToJsonSchema(this.schema, { target: "jsonSchema7" });
        return {
            name: this.name,
            description: this.description,
            schema: {
                type: "object",
                properties: jsonSchema.properties || {},
                required: jsonSchema.required || []
            }
        };
    }
}
