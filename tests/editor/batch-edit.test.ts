import { BatchEditor, BatchEditOperation } from "../../src/editor/batch-edit.js";
import * as fileOps from "../../src/editor/file-ops.js";

jest.mock("../../src/editor/file-ops.js");

const mockReadFile = fileOps.readFile as jest.MockedFunction<typeof fileOps.readFile>;
const mockWriteFile = fileOps.writeFile as jest.MockedFunction<typeof fileOps.writeFile>;

describe("BatchEditor", () => {
  let editor: BatchEditor;

  beforeEach(() => {
    editor = new BatchEditor();
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as any);
  });

  test("applies single edit successfully", async () => {
    mockReadFile.mockResolvedValue("const x = 1;\nconst y = 2;\n");

    const ops: BatchEditOperation[] = [
      { path: "test.ts", old_text: "const x = 1;", new_text: "const x = 42;" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockWriteFile).toHaveBeenCalledWith("test.ts", "const x = 42;\nconst y = 2;\n");
  });

  test("applies multiple edits to different files", async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === "a.ts") return "const a = 1;";
      if (p === "b.ts") return "const b = 2;";
      return "";
    });

    const ops: BatchEditOperation[] = [
      { path: "a.ts", old_text: "const a = 1;", new_text: "const a = 10;" },
      { path: "b.ts", old_text: "const b = 2;", new_text: "const b = 20;" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  test("fails when old_text not found", async () => {
    mockReadFile.mockResolvedValue("const x = 1;");

    const ops: BatchEditOperation[] = [
      { path: "test.ts", old_text: "nonexistent text", new_text: "replacement" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("old_text not found");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test("fails when old_text is ambiguous (multiple occurrences)", async () => {
    mockReadFile.mockResolvedValue("const x = 1;\nconst x = 1;\n");

    const ops: BatchEditOperation[] = [
      { path: "test.ts", old_text: "const x = 1;", new_text: "const x = 2;" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("ambiguous");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test("aborts all edits if any single edit fails", async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === "a.ts") return "const a = 1;";
      if (p === "b.ts") return "const b = 2;";
      return "";
    });

    const ops: BatchEditOperation[] = [
      { path: "a.ts", old_text: "const a = 1;", new_text: "const a = 10;" },
      { path: "b.ts", old_text: "nonexistent", new_text: "replacement" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test("generates diffs for applied edits", async () => {
    mockReadFile.mockResolvedValue("const x = 1;");

    const ops: BatchEditOperation[] = [
      { path: "test.ts", old_text: "const x = 1;", new_text: "const x = 42;" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(true);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].path).toBe("test.ts");
    expect(result.diffs[0].diff).toContain("const x = 42;");
  });

  test("rollback restores original files", async () => {
    const backups = new Map<string, string>();
    backups.set("a.ts", "original content");
    backups.set("b.ts", "original b content");

    await editor.rollback(backups);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledWith("a.ts", "original content");
    expect(mockWriteFile).toHaveBeenCalledWith("b.ts", "original b content");
  });

  test("applies multiple edits to same file sequentially", async () => {
    mockReadFile.mockResolvedValue("line1\nline2\nline3\n");

    const ops: BatchEditOperation[] = [
      { path: "test.ts", old_text: "line1", new_text: "LINE1" },
      { path: "test.ts", old_text: "line3", new_text: "LINE3" },
    ];

    const result = await editor.apply(ops);
    expect(result.ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith("test.ts", "LINE1\nline2\nLINE3\n");
  });
});
