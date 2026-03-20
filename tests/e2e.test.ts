import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
const CLI_PATH = path.resolve(__dirname, "../dist/index.js");

describe("Aurex CLI End-to-End Tests", () => {
    jest.setTimeout(30000);

    it("should display help", async () => {
        const { stdout } = await execAsync(`node ${CLI_PATH} --help`);
        expect(stdout).toContain("AurexAI - Local CLI Agent");
        expect(stdout).toContain("Usage: aurex [options] [command]");
    });

    it("should enforce timeout for exec command", async () => {
        try {
            // Sleep 3s but timeout after 1s — should fail
            await execAsync(
                `node ${CLI_PATH} exec -t 1000 --no-sandbox "node -e \\"setTimeout(()=>{}, 3000)\\""`,
                { env: { ...process.env, AUREX_AUTO_YES: "1", OPENROUTER_API_KEY: "dummy" } }
            );
            fail("Command should have thrown a timeout error");
        } catch (error: unknown) {
            const err = error as { code?: number; stderr?: string; killed?: boolean };
            // Local executor returns exitCode 1 on timeout (124 is docker-only)
            expect(err.code).toBeGreaterThan(0);
        }
    });

    it("should execute a simple safe command", async () => {
        const { stdout } = await execAsync(
            `node ${CLI_PATH} exec -t 15000 --no-sandbox "echo e2e-ok"`,
            { env: { ...process.env, AUREX_AUTO_YES: "1", OPENROUTER_API_KEY: "dummy" } }
        );
        expect(stdout).toContain("e2e-ok");
    });
});
