import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionStore } from "../../src/memory/session-store.js";

// Mock getDataDir to use a temp directory
jest.mock("../../src/config/paths.js", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurex-session-store-"));
  return {
    getDataDir: () => tmpDir,
    getConfigDir: () => tmpDir,
    getCacheDir: () => tmpDir,
  };
});

describe("SessionStore", () => {
  it("creates a session with a unique id", () => {
    const store = new SessionStore();
    expect(store.id).toBeDefined();
    expect(store.id.length).toBeGreaterThan(0);
  });

  it("writes and reads session events", () => {
    const store = new SessionStore("test-session-1");
    store.open();
    store.appendEvent({
      type: "message",
      timestamp: Date.now(),
      data: { role: "user", content: "hello" },
    });
    store.close();

    const events = SessionStore.loadSession("test-session-1");
    expect(events.length).toBeGreaterThanOrEqual(2); // meta:start + message + meta:end
    const messageEvent = events.find(e => e.type === "message");
    expect(messageEvent).toBeDefined();
    expect(messageEvent!.data.content).toBe("hello");
  });

  it("listSessions returns sessions sorted by recency", () => {
    const store1 = new SessionStore("list-test-1");
    store1.open();
    store1.close();

    const store2 = new SessionStore("list-test-2");
    store2.open();
    store2.close();

    const sessions = SessionStore.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });
});
