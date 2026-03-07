import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface ToolDefinition {
    name: string;
    description: string;
    schema: any;
}

export abstract class BaseTool<T> {
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly schema: z.ZodType<T>;

    abstract execute(args: T): Promise<any>;

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
