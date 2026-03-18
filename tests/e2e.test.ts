import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
const CLI_PATH = path.resolve(__dirname, "../dist/index.js");

describe("Aurex CLI End-to-End Tests", () => {
    // Increase global timeout as CLI bootstrap + Python bridge takes warm-up time
    jest.setTimeout(30000);

    it("should display help when no arguments are provided to the alias", async () => {
        try {
            await execAsync(`node ${CLI_PATH} --help`);
        } catch (error: unknown) {
            const err = error as any;
            expect(err.stdout).toContain("AurexAI - Local CLI Agent");
            expect(err.stdout).toContain("Usage: aurex [options] [command]");
            return;
        }
        const { stdout } = await execAsync(`node ${CLI_PATH} --help`);
        expect(stdout).toContain("AurexAI - Local CLI Agent");
        expect(stdout).toContain("Usage: aurex [options] [command]");
    });

    // Requires OPENROUTER_API_KEY / mock environment
    it("should enforce global wall-clock timeout for exec command", async () => {
        try {
            // Sleep for 3 seconds, but timeout the CLI aggressively after 1 second (1000ms)
            // Since sandbox could be disabled, use Windows or cross-platform sleep mechanism
            // Pinging localhost is a common cross-platform sleep trick, but python bridge might fail.
            // We will test the pure timeout failure mechanism on a dummy task

            // Node -e "setTimeout(()=>{}, 3000)" is a true cross-platform sleep
            await execAsync(`node ${CLI_PATH} exec -t 1000 --no-sandbox "node -e \\"setTimeout(()=>{}, 3000)\\""`, { env: { ...process.env, AUREX_AUTO_YES: "1", OPENROUTER_API_KEY: "dummy" } });
            fail("Command should have thrown a timeout error");
        } catch (error: unknown) {
            const err = error as any;
            expect(err.code).toBe(124);
            expect(err.stderr).toContain("Command timed out after 1000ms (wall-clock)");
        }
    });

    it.skip("should successfully execute a simple safe command", async () => {
        const { stdout, stderr } = await execAsync(`node ${CLI_PATH} exec -t 15000 --no-sandbox "echo e2e-ok"`, { env: { ...process.env, AUREX_AUTO_YES: "1", OPENROUTER_API_KEY: "dummy" } });
        expect(stdout).toContain("e2e-ok");
        // Ensure the JSON-RPC error or stderr is clean
        expect(stderr).not.toContain("Error");
    });
});
