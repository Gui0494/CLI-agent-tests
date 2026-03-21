/**
 * project-yaml.ts — Generator for .aurex/project.yaml.
 *
 * Serializes DetectedProject into a human-readable YAML config file.
 *
 * Reference: Phase 4.2 — Project Initialization Intelligence
 */

import fs from "fs/promises";
import path from "path";
import { DetectedProject } from "./project-detector.js";

function toYaml(project: DetectedProject): string {
  const lines: string[] = [
    `# AurexAI Project Configuration`,
    `# Auto-generated — edit as needed`,
    ``,
    `name: ${project.name}`,
    ``,
    `stack:`,
    ...project.stack.map(s => `  - ${s}`),
    ``,
    `packageManager: ${project.packageManager}`,
    ``,
    `commands:`,
    `  test: "${project.testCommand}"`,
  ];

  if (project.buildCommand) lines.push(`  build: "${project.buildCommand}"`);
  if (project.lintCommand) lines.push(`  lint: "${project.lintCommand}"`);

  lines.push(``);

  if (project.entryPoints.length > 0) {
    lines.push(`entryPoints:`);
    project.entryPoints.forEach(e => lines.push(`  - ${e}`));
    lines.push(``);
  }

  if (project.srcDirs.length > 0) {
    lines.push(`srcDirs:`);
    project.srcDirs.forEach(d => lines.push(`  - ${d}`));
    lines.push(``);
  }

  lines.push(`conventions:`);
  if (project.conventions.style) lines.push(`  style: ${project.conventions.style}`);
  if (project.conventions.testPattern) lines.push(`  testPattern: "${project.conventions.testPattern}"`);
  lines.push(`  importStyle: ${project.conventions.importStyle}`);
  lines.push(``);

  return lines.join("\n");
}

export async function generateProjectYaml(
  project: DetectedProject,
  outputDir?: string,
): Promise<string> {
  const dir = outputDir || path.join(process.cwd(), ".aurex");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "project.yaml");
  const content = toYaml(project);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}
