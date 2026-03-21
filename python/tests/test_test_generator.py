"""
Tests for TestGenerator — LLM-powered test generation.
"""

import os
import pytest
from unittest.mock import AsyncMock

from aurex.tools.test_generator import TestGenerator, FRAMEWORK_MAP


class TestTestGen:
    def test_detect_framework_python(self):
        gen = TestGenerator()
        info = gen.detect_framework("example.py")
        assert info["framework"] == "pytest"

    def test_detect_framework_typescript(self):
        gen = TestGenerator()
        info = gen.detect_framework("example.ts")
        assert info["framework"] == "jest"

    def test_detect_framework_javascript(self):
        gen = TestGenerator()
        info = gen.detect_framework("example.js")
        assert info["framework"] == "jest"

    def test_detect_framework_go(self):
        gen = TestGenerator()
        info = gen.detect_framework("main.go")
        assert info["framework"] == "go test"

    def test_detect_framework_rust(self):
        gen = TestGenerator()
        info = gen.detect_framework("main.rs")
        assert info["framework"] == "cargo test"

    def test_detect_framework_unknown(self):
        gen = TestGenerator()
        info = gen.detect_framework("example.xyz")
        assert info["framework"] == "unknown"

    def test_get_test_path_python(self):
        gen = TestGenerator()
        assert gen.get_test_path("example.py") == os.path.join("tests", "test_example.py")

    def test_get_test_path_typescript(self):
        gen = TestGenerator()
        assert gen.get_test_path("example.ts") == os.path.join("tests", "example.test.ts")

    def test_get_test_path_go(self):
        gen = TestGenerator()
        assert gen.get_test_path("main.go") == "main_test.go"

    @pytest.mark.asyncio
    async def test_generate_file_not_found(self):
        gen = TestGenerator()
        result = await gen.generate("/nonexistent/file.py")
        assert "error" in result
        assert "not found" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_generate_no_llm_client(self, tmp_path):
        py_file = tmp_path / "example.py"
        py_file.write_text("def hello():\n    return 'world'\n")

        gen = TestGenerator()
        result = await gen.generate(str(py_file))
        assert "error" in result
        assert "No LLM client" in result["error"]
        assert result["framework"] == "pytest"

    @pytest.mark.asyncio
    async def test_generate_with_llm(self, tmp_path):
        py_file = tmp_path / "example.py"
        py_file.write_text("def hello():\n    return 'world'\n")

        mock_llm = AsyncMock()
        mock_llm.chat.return_value = "def test_hello():\n    assert hello() == 'world'\n"

        gen = TestGenerator()
        result = await gen.generate(str(py_file), llm_client=mock_llm)
        assert "test_content" in result
        assert "test_hello" in result["test_content"]
        assert result["framework"] == "pytest"

    @pytest.mark.asyncio
    async def test_generate_strips_markdown_blocks(self, tmp_path):
        py_file = tmp_path / "example.py"
        py_file.write_text("def hello():\n    return 'world'\n")

        mock_llm = AsyncMock()
        mock_llm.chat.return_value = "```python\ndef test_hello():\n    assert True\n```"

        gen = TestGenerator()
        result = await gen.generate(str(py_file), llm_client=mock_llm)
        assert "test_content" in result
        assert not result["test_content"].startswith("```")
        assert "test_hello" in result["test_content"]

    def test_framework_map_coverage(self):
        assert ".py" in FRAMEWORK_MAP
        assert ".ts" in FRAMEWORK_MAP
        assert ".tsx" in FRAMEWORK_MAP
        assert ".js" in FRAMEWORK_MAP
        assert ".jsx" in FRAMEWORK_MAP
        assert ".go" in FRAMEWORK_MAP
        assert ".rs" in FRAMEWORK_MAP
