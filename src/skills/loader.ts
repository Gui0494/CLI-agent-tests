/**
 * loader.ts — Skill loader for AurexAI CLI Agent
 *
 * @deprecated Not yet connected to REPL or AgentLoop. TODO: Wire SkillLoader
 * into AppContext for /skill commands.
 *
 * Loads skill definitions from YAML/MD files in the skills/ directory.
 * Supports both built-in skills (docs/architecture-reference/skills/)
 * and custom project skills (skills/ in workspace).
 *
 * @deprecated Not yet connected to REPL or AgentLoop.
 * TODO: Wire SkillLoader into AppContext for /skill commands in the REPL.
 * The loader is fully implemented and tested but no production code path uses it.
 *
 * Reference: docs/architecture-reference/specs/skill-user.md
 */

import * as fs from "fs/promises";
import * as path from "path";
import yaml from "js-yaml";

// ─── Interfaces ──────────────────────────────────────────

export interface SkillTrigger {
  manual: boolean;
  auto: boolean;
  patterns: string[];
}

export interface SkillInput {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface SkillOutput {
  name: string;
  type: string;
  description: string;
}

export interface SkillStep {
  id: string;
  action: string;
  tool?: string;
  command?: string;
  path?: string;
  condition?: string;
  onError: 'retry' | 'skip' | 'abort' | 'continue' | 'ask_user';
  errorMessage?: string;
  output?: string;
}

export interface SkillLimits {
  maxDuration: number;       // seconds
  maxToolCalls: number;
  requiresApproval: boolean;
}

export interface SkillDefinition {
  name: string;
  version: string;
  description: string;
  trigger: SkillTrigger;
  requiredTools: string[];
  inputs: SkillInput[];
  outputs: SkillOutput[];
  steps: SkillStep[];
  limits: SkillLimits;
  source: string;           // file path where this was loaded from
}

export type ToolAvailability = 'available' | 'unavailable' | 'dev-only';

export interface SkillStatus {
  skill: SkillDefinition;
  available: boolean;
  missingTools: string[];
}

// ─── Skill Loader ────────────────────────────────────────

export class SkillLoader {
  private skills: Map<string, SkillDefinition> = new Map();
  private searchPaths: string[];

  constructor(searchPaths?: string[]) {
    this.searchPaths = searchPaths ?? [
      path.resolve("skills"),                   // project-level custom skills
    ];
  }

  /**
   * Load all skills from configured search paths.
   */
  async loadAll(): Promise<void> {
    for (const searchPath of this.searchPaths) {
      await this.loadFromDirectory(searchPath);
    }
  }

  /**
   * Load skills from a specific directory.
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.yaml' && ext !== '.yml' && ext !== '.md') continue;

        const filePath = path.join(dirPath, entry.name);
        try {
          const skill = await this.loadFile(filePath);
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        } catch (err: unknown) {
          console.warn(`Warning: Failed to load skill from ${filePath}: ${(err as Error).message}`);
        }
      }
    } catch {
      // Directory doesn't exist, skip silently
    }
  }

  /**
   * Load a single skill from a file.
   */
  async loadFile(filePath: string): Promise<SkillDefinition | null> {
    const content = await fs.readFile(filePath, "utf-8");
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.yaml' || ext === '.yml') {
      return this.parseYaml(content, filePath);
    } else if (ext === '.md') {
      return this.parseMarkdown(content, filePath);
    }
    return null;
  }

  /**
   * Get all loaded skills.
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name.
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Check skill availability based on available tools.
   */
  checkAvailability(
    skill: SkillDefinition,
    availableTools: Set<string>
  ): SkillStatus {
    const missingTools = skill.requiredTools.filter(t => !availableTools.has(t));
    return {
      skill,
      available: missingTools.length === 0,
      missingTools,
    };
  }

  /**
   * Get all skills with availability status.
   */
  getAllWithStatus(availableTools: Set<string>): SkillStatus[] {
    return this.getAll().map(s => this.checkAvailability(s, availableTools));
  }

  /**
   * Find skills that match a given input text (for auto-triggering).
   */
  findMatchingSkills(input: string): SkillDefinition[] {
    return this.getAll().filter(skill => {
      if (!skill.trigger.auto) return false;
      return skill.trigger.patterns.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(input);
        } catch {
          return input.toLowerCase().includes(pattern.toLowerCase());
        }
      });
    });
  }

  // ─── Private Parsers ────────────────────────────────────

  private parseYaml(content: string, filePath: string): SkillDefinition {
    const raw = yaml.load(content) as unknown;
    return this.normalizeDefinition(raw, filePath);
  }

  private parseMarkdown(content: string, filePath: string): SkillDefinition | null {
    // Try to extract YAML frontmatter from markdown
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // Try to find a YAML code block
      const yamlBlock = content.match(/```ya?ml\n([\s\S]*?)```/);
      if (yamlBlock) {
        return this.parseYaml(yamlBlock[1], filePath);
      }
      return null;
    }
    return this.parseYaml(frontmatterMatch[1], filePath);
  }

  private normalizeDefinition(raw: any, filePath: string): SkillDefinition {
    return {
      name: raw.name || path.basename(filePath, path.extname(filePath)),
      version: String(raw.version || '1.0'),
      description: raw.description || '',
      trigger: {
        manual: raw.trigger?.manual ?? true,
        auto: raw.trigger?.auto ?? false,
        patterns: raw.trigger?.patterns ?? [],
      },
      requiredTools: raw.required_tools || raw.requiredTools || [],
      inputs: (raw.inputs || []).map((i: any) => ({
        name: i.name,
        type: i.type || 'string',
        required: i.required ?? false,
        description: i.description || '',
      })),
      outputs: (raw.outputs || []).map((o: any) => ({
        name: o.name,
        type: o.type || 'string',
        description: o.description || '',
      })),
      steps: (raw.steps || []).map((s: any) => ({
        id: s.id,
        action: s.action,
        tool: s.tool,
        command: s.command,
        path: s.path,
        condition: s.condition,
        onError: s.on_error || s.onError || 'abort',
        errorMessage: s.error_message || s.errorMessage,
        output: s.output,
      })),
      limits: {
        maxDuration: this.parseDuration(raw.limits?.max_duration) || 60,
        maxToolCalls: raw.limits?.max_tool_calls || 20,
        requiresApproval: raw.limits?.requires_approval ?? false,
      },
      source: filePath,
    };
  }

  private parseDuration(s: string | number | undefined): number {
    if (!s) return 60;
    if (typeof s === 'number') return s;
    const match = s.match(/^(\d+)(s|m|h)?$/);
    if (!match) return 60;
    const val = parseInt(match[1]);
    switch (match[2]) {
      case 'm': return val * 60;
      case 'h': return val * 3600;
      default: return val;
    }
  }
}
