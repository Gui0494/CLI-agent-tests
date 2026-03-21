import chalk from "chalk";
import { marked, type MarkedExtension } from "marked";
// @ts-expect-error -- marked-terminal has no type declarations
import { markedTerminal } from "marked-terminal";
import { noColor } from "./detect-mode.js";

// Configure marked with terminal renderer
marked.use(
  markedTerminal({
    code: noColor ? undefined : chalk.yellow,
    heading: noColor ? undefined : chalk.green.bold,
    strong: noColor ? undefined : chalk.bold,
    codespan: noColor ? undefined : chalk.yellow,
    link: noColor ? undefined : chalk.blue,
    width: 80,
    emoji: false,
  }) as MarkedExtension
);

export interface Citation {
  url: string;
  title: string;
  date?: string;
  excerpt: string;
  provider?: string;
}

export function renderMarkdown(text: string): void {
  const rendered = marked.parse(text);
  if (typeof rendered === "string") {
    process.stdout.write(rendered);
  }
}

export function renderCitations(citations: Citation[]): void {
  if (citations.length === 0) {
    console.log(chalk.yellow("No results found."));
    return;
  }

  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    console.log(chalk.bold.white(`\n[${i + 1}] ${c.title}`));
    console.log(chalk.blue(`    ${c.url}`));
    if (c.date) console.log(chalk.gray(`    ${c.date}`));
    console.log(chalk.white(`    ${c.excerpt.slice(0, 200)}...`));
    if (c.provider) console.log(chalk.gray(`    via ${c.provider}`));
  }
  console.log();
}
