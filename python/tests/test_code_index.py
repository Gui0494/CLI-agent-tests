"""
Tests for CodeIndex — AST-aware code indexing with regex fallback.
"""

import os
import tempfile
import pytest

from aurex.tools.code_index import CodeIndex, SUPPORTED_EXTENSIONS


@pytest.fixture
def temp_workspace(tmp_path):
    """Create a temporary workspace with sample source files."""
    # Python file
    py_file = tmp_path / "example.py"
    py_file.write_text(
        "class MyClass:\n"
        "    pass\n\n"
        "def hello(name: str):\n"
        "    return f'Hello {name}'\n\n"
        "async def fetch_data(url):\n"
        "    pass\n\n"
        "MY_VAR = 42\n"
    )

    # TypeScript file
    ts_file = tmp_path / "example.ts"
    ts_file.write_text(
        "export function greet(name: string): string {\n"
        "  return `Hello ${name}`;\n"
        "}\n\n"
        "export class UserService {\n"
        "  constructor() {}\n"
        "}\n\n"
        "export interface User {\n"
        "  id: number;\n"
        "}\n\n"
        "export const MAX_RETRIES = 3;\n"
    )

    # JavaScript file
    js_file = tmp_path / "utils.js"
    js_file.write_text(
        "function formatDate(date) {\n"
        "  return date.toISOString();\n"
        "}\n\n"
        "class Logger {\n"
        "  log(msg) { console.log(msg); }\n"
        "}\n"
    )

    return tmp_path


class TestCodeIndex:
    def test_get_outline_python(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        outline = idx.get_outline(str(temp_workspace / "example.py"))

        names = [s["name"] for s in outline]
        assert "MyClass" in names
        assert "hello" in names
        assert "fetch_data" in names
        assert "MY_VAR" in names

    def test_get_outline_typescript(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        outline = idx.get_outline(str(temp_workspace / "example.ts"))

        names = [s["name"] for s in outline]
        assert "greet" in names
        assert "UserService" in names
        assert "User" in names
        assert "MAX_RETRIES" in names

    def test_get_outline_javascript(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        outline = idx.get_outline(str(temp_workspace / "utils.js"))

        names = [s["name"] for s in outline]
        assert "formatDate" in names
        assert "Logger" in names

    def test_get_outline_nonexistent_file(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        outline = idx.get_outline(str(temp_workspace / "nonexistent.py"))
        assert outline == []

    def test_get_outline_unsupported_extension(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        txt_file = temp_workspace / "readme.txt"
        txt_file.write_text("Just text")
        outline = idx.get_outline(str(txt_file))
        assert outline == []

    def test_get_outline_caching(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        path = str(temp_workspace / "example.py")

        outline1 = idx.get_outline(path)
        outline2 = idx.get_outline(path)
        assert outline1 == outline2  # Same result from cache

    def test_get_outline_symbol_kinds(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        outline = idx.get_outline(str(temp_workspace / "example.py"))

        kinds = {s["name"]: s["kind"] for s in outline}
        assert kinds["MyClass"] == "class"
        assert kinds["hello"] == "function"
        assert kinds["MY_VAR"] == "variable"

    def test_get_outline_sorted_by_line(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        outline = idx.get_outline(str(temp_workspace / "example.py"))
        lines = [s["line"] for s in outline]
        assert lines == sorted(lines)

    def test_find_symbol(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        results = idx.find_symbol("hello", str(temp_workspace))

        assert len(results) >= 1
        assert results[0]["name"] == "hello"
        assert "file" in results[0]

    def test_find_symbol_partial_match(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        results = idx.find_symbol("Class", str(temp_workspace))

        names = [r["name"] for r in results]
        assert "MyClass" in names

    def test_find_symbol_no_match(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        results = idx.find_symbol("nonexistent_symbol_xyz", str(temp_workspace))
        assert len(results) == 0

    def test_clear_cache(self, temp_workspace):
        idx = CodeIndex(str(temp_workspace))
        idx.get_outline(str(temp_workspace / "example.py"))
        assert len(idx._cache) > 0
        idx.clear_cache()
        assert len(idx._cache) == 0

    def test_supported_extensions(self):
        assert ".py" in SUPPORTED_EXTENSIONS
        assert ".ts" in SUPPORTED_EXTENSIONS
        assert ".tsx" in SUPPORTED_EXTENSIONS
        assert ".js" in SUPPORTED_EXTENSIONS
        assert ".go" in SUPPORTED_EXTENSIONS
        assert ".rs" in SUPPORTED_EXTENSIONS
