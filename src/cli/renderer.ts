import chalk from "chalk";

export interface Citation {
  url: string;
  title: string;
  date?: string;
  excerpt: string;
  provider?: string;
}

export function renderMarkdown(text: string): void {
  // Simple terminal markdown rendering
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("# ")) {
      console.log(chalk.bold.cyan(line.slice(2)));
    } else if (line.startsWith("## ")) {
      console.log(chalk.bold.yellow(line.slice(3)));
    } else if (line.startsWith("### ")) {
      console.log(chalk.bold(line.slice(4)));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      console.log(chalk.white(`  ${line}`));
    } else if (line.startsWith("```")) {
      console.log(chalk.gray(line));
    } else if (line.match(/^\d+\.\s/)) {
      console.log(chalk.white(`  ${line}`));
    } else {
      console.log(line);
    }
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
