/**
 * update-check.ts — Non-blocking update notification.
 *
 * Spawns a detached child process that checks the npm registry for a
 * newer version.  The result is cached in XDG_CACHE_HOME for 24 hours.
 * On the *next* invocation the cached result is read synchronously and,
 * if newer, a one-line notice is printed to stderr.
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getCacheDir } from "../config/paths.js";

const CACHE_FILE = "update-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = "aurex-ai";

interface CachedCheck {
  latest: string;
  checkedAt: number;
}

function getCacheFilePath(): string {
  return path.join(getCacheDir(), CACHE_FILE);
}

/** Read cached check result (synchronous — called at startup). */
function readCache(): CachedCheck | null {
  try {
    const raw = fs.readFileSync(getCacheFilePath(), "utf-8");
    return JSON.parse(raw) as CachedCheck;
  } catch {
    return null;
  }
}

/** Compare two semver strings. Returns true if remote > local. */
function isNewer(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, "").split(".").map(Number);
  const l = local.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Check for updates and print a notice if one is available.
 *
 * This is designed to be called once at startup — it is non-blocking.
 * The actual network check happens in a detached child process so it
 * adds zero latency to the CLI startup.
 */
export function checkForUpdate(currentVersion: string): void {
  // 1. Read cache and notify if applicable
  const cached = readCache();
  if (cached && isNewer(cached.latest, currentVersion)) {
    const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
    process.stderr.write(
      yellow(`  Update available: ${currentVersion} → ${cached.latest}. Run: npm i -g ${PACKAGE_NAME}\n`)
    );
  }

  // 2. Spawn background check if cache is stale or missing
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    return; // Cache is fresh
  }

  try {
    const cacheFilePath = getCacheFilePath();

    // Inline script that fetches the registry and writes the cache file
    const script = `
      const https = require("https");
      const fs = require("fs");
      const url = "https://registry.npmjs.org/${PACKAGE_NAME}/latest";
      https.get(url, { headers: { "Accept": "application/json" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            const pkg = JSON.parse(data);
            if (pkg.version) {
              fs.writeFileSync("${cacheFilePath.replace(/\\/g, "\\\\")}", JSON.stringify({
                latest: pkg.version,
                checkedAt: Date.now()
              }));
            }
          } catch {}
        });
      }).on("error", () => {});
    `;

    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // Fire-and-forget — never block the CLI
  }
}
