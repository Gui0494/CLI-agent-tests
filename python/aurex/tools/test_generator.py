"""
Test Generation — Generate test files for source code using LLM.

Reference: Phase 6.3 — Test Generation
"""

import os
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Test framework detection
FRAMEWORK_MAP = {
    ".py": {"framework": "pytest", "suffix": "test_", "dir": "tests"},
    ".ts": {"framework": "jest", "suffix": ".test", "dir": "tests"},
    ".tsx": {"framework": "jest", "suffix": ".test", "dir": "tests"},
    ".js": {"framework": "jest", "suffix": ".test", "dir": "tests"},
    ".jsx": {"framework": "jest", "suffix": ".test", "dir": "tests"},
    ".go": {"framework": "go test", "suffix": "_test", "dir": ""},
    ".rs": {"framework": "cargo test", "suffix": "", "dir": ""},
}

GENERATE_PROMPT = (
    "Generate comprehensive unit tests for the following source file.\n"
    "Use the {framework} testing framework.\n"
    "Cover: happy paths, edge cases, error handling.\n"
    "Return ONLY the test file content, no explanation.\n\n"
    "Source file ({path}):\n```\n{content}\n```"
)


class TestGenerator:
    """Generates test files for source code using LLM."""

    def __init__(self, workspace_root: str = "."):
        self.workspace_root = workspace_root

    def detect_framework(self, file_path: str) -> dict:
        """Detect the appropriate test framework for a file."""
        _, ext = os.path.splitext(file_path)
        return FRAMEWORK_MAP.get(ext, {"framework": "unknown", "suffix": ".test", "dir": "tests"})

    def get_test_path(self, file_path: str) -> str:
        """Generate the expected test file path."""
        _, ext = os.path.splitext(file_path)
        info = self.detect_framework(file_path)
        base = os.path.basename(file_path)
        name_no_ext = os.path.splitext(base)[0]

        if ext == ".py":
            return os.path.join(info["dir"], f"test_{name_no_ext}.py")
        elif ext == ".go":
            return os.path.splitext(file_path)[0] + "_test.go"
        else:
            return os.path.join(info["dir"], f"{name_no_ext}.test{ext}")

    async def generate(self, file_path: str, llm_client=None) -> dict[str, Any]:
        """
        Generate tests for a source file.

        Returns: {test_path, test_content, framework}
        """
        abs_path = os.path.abspath(file_path)
        if not os.path.isfile(abs_path):
            return {"error": f"File not found: {file_path}"}

        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                content = f.read(30_000)
        except Exception as e:
            return {"error": f"Failed to read {file_path}: {e}"}

        info = self.detect_framework(file_path)
        test_path = self.get_test_path(file_path)

        if not llm_client:
            return {
                "test_path": test_path,
                "framework": info["framework"],
                "error": "No LLM client available for test generation",
            }

        prompt = GENERATE_PROMPT.format(
            framework=info["framework"],
            path=file_path,
            content=content,
        )

        try:
            response = await llm_client.chat(
                [
                    {"role": "system", "content": f"You are a test engineer. Generate {info['framework']} tests."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
            )
            test_content = response if isinstance(response, str) else str(response)

            # Strip markdown code blocks if present
            if test_content.startswith("```"):
                lines = test_content.split("\n")
                lines = lines[1:]  # remove opening ```
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                test_content = "\n".join(lines)

            return {
                "test_path": test_path,
                "test_content": test_content.strip(),
                "framework": info["framework"],
            }
        except Exception as e:
            return {
                "test_path": test_path,
                "framework": info["framework"],
                "error": f"LLM generation failed: {e}",
            }
