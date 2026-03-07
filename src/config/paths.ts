import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export function getCacheDir(appName = "aurex"): string {
    const platform = os.platform();
    const home = os.homedir();
    let baseDir: string;

    if (platform === "win32") {
        baseDir = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    } else if (platform === "darwin") {
        baseDir = path.join(home, "Library", "Caches");
    } else {
        // Linux and others
        baseDir = process.env.XDG_CACHE_HOME || path.join(home, ".cache");
    }

    const dir = path.join(baseDir, appName);

    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (err) {
        // If we can't create the directory, fallback to a local .aurex folder or temp
        try {
            const localDir = path.join(process.cwd(), `.${appName}`);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            return localDir;
        } catch {
            return os.tmpdir();
        }
    }

    return dir;
}

export function getConfigDir(appName = "aurex"): string {
    const platform = os.platform();
    const home = os.homedir();
    let baseDir: string;

    if (platform === "win32") {
        baseDir = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    } else if (platform === "darwin") {
        baseDir = path.join(home, "Library", "Application Support");
    } else {
        // Linux and others
        baseDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    }

    const dir = path.join(baseDir, appName);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch {
        // Fallback
        return process.cwd();
    }

    return dir;
}
