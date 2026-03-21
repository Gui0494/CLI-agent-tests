import { fuzzyFind, editDistance } from "../../src/editor/fuzzy-edit.js";

describe("editDistance", () => {
  test("identical strings have distance 0", () => {
    expect(editDistance("hello", "hello")).toBe(0);
  });

  test("single character difference", () => {
    expect(editDistance("hello", "hallo")).toBe(1);
  });

  test("insertion", () => {
    expect(editDistance("helo", "hello")).toBe(1);
  });

  test("deletion", () => {
    expect(editDistance("hello", "helo")).toBe(1);
  });

  test("empty strings", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("fuzzyFind", () => {
  test("finds exact match", () => {
    const content = "function hello() { return 1; }";
    const result = fuzzyFind(content, "function hello() { return 1; }");
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(0);
  });

  test("finds match with whitespace differences", () => {
    const content = "function  hello()  { return 1; }";
    const target = "function hello() { return 1; }";
    const result = fuzzyFind(content, target);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(0); // whitespace normalization
  });

  test("finds match with minor typo", () => {
    const content = "const x = 1;\nconst y = 2;\nconst z = 3;";
    const target = "const y = 2;"; // exact match exists
    const result = fuzzyFind(content, target);
    expect(result).not.toBeNull();
    expect(result!.match).toContain("const y = 2;");
  });

  test("returns null when no reasonable match", () => {
    const content = "function hello() {}";
    const target = "completely different text that has nothing in common";
    const result = fuzzyFind(content, target);
    expect(result).toBeNull();
  });

  test("handles multiline targets", () => {
    const content = "line 1\nline 2\nline 3\nline 4";
    const target = "line 2\nline 3";
    const result = fuzzyFind(content, target);
    expect(result).not.toBeNull();
    expect(result!.match).toBe("line 2\nline 3");
  });

  test("finds match with indentation differences", () => {
    const content = "  if (true) {\n    return 1;\n  }";
    const target = "if (true) {\n  return 1;\n}";
    const result = fuzzyFind(content, target, 20);
    expect(result).not.toBeNull();
  });
});
