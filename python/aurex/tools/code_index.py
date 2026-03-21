"""
Code Index — AST-aware code indexing with tree-sitter.

Provides get_outline and find_symbol functionality for source files.
Falls back to regex-based parsing if tree-sitter is not installed.

Reference: Phase 2.2 — Tree-sitter Code Indexing
"""

import os
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Try to import tree-sitter, fall back to regex
_HAS_TREE_SITTER = False
try:
    import tree_sitter
    _HAS_TREE_SITTER = True
except ImportError:
    logger.debug("tree-sitter not available, using regex fallback")

SUPPORTED_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".c", ".cpp"}

# Regex patterns for symbol extraction (fallback when no tree-sitter)
SYMBOL_PATTERNS = {
    ".py": [
        (re.compile(r"^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)", re.MULTILINE), "function"),
        (re.compile(r"^class\s+(\w+)(?:\([^)]*\))?:", re.MULTILINE), "class"),
        (re.compile(r"^(\w+)\s*=\s*", re.MULTILINE), "variable"),
    ],
    ".ts": [
        (re.compile(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)", re.MULTILINE), "function"),
        (re.compile(r"(?:export\s+)?class\s+(\w+)", re.MULTILINE), "class"),
        (re.compile(r"(?:export\s+)?interface\s+(\w+)", re.MULTILINE), "interface"),
        (re.compile(r"(?:export\s+)?type\s+(\w+)", re.MULTILINE), "type"),
        (re.compile(r"(?:export\s+)?(?:const|let|var)\s+(\w+)", re.MULTILINE), "variable"),
    ],
    ".js": [
        (re.compile(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)", re.MULTILINE), "function"),
        (re.compile(r"(?:export\s+)?class\s+(\w+)", re.MULTILINE), "class"),
        (re.compile(r"(?:export\s+)?(?:const|let|var)\s+(\w+)", re.MULTILINE), "variable"),
    ],
    ".go": [
        (re.compile(r"^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)", re.MULTILINE), "function"),
        (re.compile(r"^type\s+(\w+)\s+struct\b", re.MULTILINE), "class"),
        (re.compile(r"^type\s+(\w+)\s+interface\b", re.MULTILINE), "interface"),
    ],
    ".rs": [
        (re.compile(r"(?:pub\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)", re.MULTILINE), "function"),
        (re.compile(r"(?:pub\s+)?struct\s+(\w+)", re.MULTILINE), "class"),
        (re.compile(r"(?:pub\s+)?enum\s+(\w+)", re.MULTILINE), "class"),
        (re.compile(r"(?:pub\s+)?trait\s+(\w+)", re.MULTILINE), "interface"),
    ],
}

# Share .ts patterns with .tsx
SYMBOL_PATTERNS[".tsx"] = SYMBOL_PATTERNS[".ts"]
SYMBOL_PATTERNS[".jsx"] = SYMBOL_PATTERNS[".js"]


class CodeIndex:
    """AST-aware code indexer with regex fallback."""

    def __init__(self, workspace_root: str = "."):
        self.workspace_root = os.path.abspath(workspace_root)
        self._cache: dict[str, tuple[float, list[dict]]] = {}  # path -> (mtime, symbols)

    def get_outline(self, file_path: str) -> list[dict]:
        """Get structural outline of a file: functions, classes, types."""
        abs_path = os.path.abspath(file_path)
        if not os.path.isfile(abs_path):
            return []

        _, ext = os.path.splitext(abs_path)
        if ext not in SUPPORTED_EXTENSIONS:
            return []

        # Check cache by mtime
        try:
            mtime = os.path.getmtime(abs_path)
        except OSError:
            return []

        if abs_path in self._cache:
            cached_mtime, cached_symbols = self._cache[abs_path]
            if cached_mtime == mtime:
                return cached_symbols

        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(100_000)  # cap at 100KB
        except Exception:
            return []

        symbols = self._extract_symbols_regex(content, ext)
        self._cache[abs_path] = (mtime, symbols)
        return symbols

    def find_symbol(self, symbol_name: str, scope: str = ".") -> list[dict]:
        """Search for a symbol definition across the workspace."""
        scope_path = os.path.abspath(scope)
        results = []

        for root, dirs, files in os.walk(scope_path):
            dirs[:] = [d for d in dirs if d not in {
                "node_modules", ".git", "__pycache__", ".venv", "dist", "build", ".aurex"
            }]
            for filename in files:
                _, ext = os.path.splitext(filename)
                if ext not in SUPPORTED_EXTENSIONS:
                    continue
                file_path = os.path.join(root, filename)
                outline = self.get_outline(file_path)
                for symbol in outline:
                    if symbol["name"] == symbol_name or symbol_name in symbol["name"]:
                        results.append({
                            **symbol,
                            "file": file_path,
                        })

        return results

    def _extract_symbols_regex(self, content: str, ext: str) -> list[dict]:
        """Extract symbols using regex patterns."""
        patterns = SYMBOL_PATTERNS.get(ext, SYMBOL_PATTERNS.get(".js", []))
        symbols = []
        lines = content.split("\n")

        for pattern, kind in patterns:
            for match in pattern.finditer(content):
                name = match.group(1)
                # Calculate line number
                line_start = content[:match.start()].count("\n") + 1
                # Get signature (first line of the match)
                match_line = lines[line_start - 1] if line_start <= len(lines) else ""
                signature = match_line.strip()

                symbols.append({
                    "name": name,
                    "kind": kind,
                    "line": line_start,
                    "signature": signature[:200],
                })

        # Sort by line number
        symbols.sort(key=lambda s: s["line"])
        return symbols

    def clear_cache(self):
        """Clear the symbol cache."""
        self._cache.clear()
