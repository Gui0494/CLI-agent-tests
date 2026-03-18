import { spawn } from "child_process";

const cli = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let outputStr = "";

cli.stdout.on("data", (data) => {
  const text = data.toString();
  outputStr += text;
  process.stdout.write(text);

  // Send interactive commands based on prompts
  if (text.includes("aurex [")) {
    if (!outputStr.includes("/doctor\\n")) {
      console.log("\\n>>> Sending /doctor");
      cli.stdin.write("/doctor\\n");
    } else if (!outputStr.includes("/mode plan")) {
      console.log("\\n>>> Sending /mode plan");
      cli.stdin.write("/mode plan\\n");
    } else if (!outputStr.includes("/mode chat")) {
      console.log("\\n>>> Sending /mode chat");
      cli.stdin.write("/mode chat\\n");
    } else if (!outputStr.includes("/exit")) {
      console.log("\\n>>> Sending /exit");
      cli.stdin.write("/exit\\n");
    }
  }
});

cli.stderr.on("data", (data) => console.error(data.toString()));
