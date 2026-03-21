"""
Workspace-Aware Search — Import/dependency graph builder.

Analyzes import/require/from statements to build a dependency graph.
Allows finding all files that depend on a given file, or all dependencies
of a given file.

Reference: Phase 6.2 — Workspace-Aware Search
"""

import os
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Import patterns for common languages
IMPORT_PATTERNS = [
    # Python: import x, from x import y
    re.compile(r"^\s*(?:from|import)\s+([^\s;]+)", re.MULTILINE),
    # JS/TS: import ... from 'x', require('x')
    re.compile(r"""(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]""", re.MULTILINE),
    # Go: import "x"
    re.compile(r'import\s+"([^"]+)"', re.MULTILINE),
    # Rust: use x;
    re.compile(r"^\s*use\s+([^;]+);", re.MULTILINE),
]

# File extensions to scan
SCANNABLE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java"}


def _resolve_import(import_path: str, source_file: str, workspace_root: str) -> Optional[str]:
    """Try to resolve an import path to an actual file."""
    source_dir = os.path.dirname(source_file)

    # Relative imports (./foo, ../bar)
    if import_path.startswith("."):
        candidates = [
            os.path.join(source_dir, import_path),
            os.path.join(source_dir, import_path + ".ts"),
            os.path.join(source_dir, import_path + ".tsx"),
            os.path.join(source_dir, import_path + ".js"),
            os.path.join(source_dir, import_path + ".py"),
            os.path.join(source_dir, import_path, "index.ts"),
            os.path.join(source_dir, import_path, "index.js"),
            os.path.join(source_dir, import_path, "__init__.py"),
        ]
        for candidate in candidates:
            resolved = os.path.normpath(candidate)
            if os.path.isfile(resolved):
                return resolved

    # Python dotted imports
    if "." in import_path and not import_path.startswith("."):
        py_path = import_path.replace(".", os.sep)
        candidates = [
            os.path.join(workspace_root, py_path + ".py"),
            os.path.join(workspace_root, py_path, "__init__.py"),
        ]
        for candidate in candidates:
            if os.path.isfile(candidate):
                return candidate

    return None


def _get_scannable_files(workspace_root: str) -> list[str]:
    """Get all scannable files in the workspace."""
    files = []
    for root, dirs, filenames in os.walk(workspace_root):
        # Skip common non-source directories
        dirs[:] = [
            d for d in dirs
            if d not in {"node_modules", ".git", "__pycache__", ".venv", "dist", "build", ".aurex"}
        ]
        for filename in filenames:
            _, ext = os.path.splitext(filename)
            if ext in SCANNABLE_EXTENSIONS:
                files.append(os.path.join(root, filename))
    return files


class WorkspaceSearch:
    """Regex-based workspace dependency analyzer."""

    def __init__(self, workspace_root: str = "."):
        self.workspace_root = os.path.abspath(workspace_root)
        self._import_cache: dict[str, list[str]] = {}

    def _extract_imports(self, file_path: str) -> list[str]:
        """Extract import paths from a file."""
        if file_path in self._import_cache:
            return self._import_cache[file_path]

        imports = []
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read(50_000)  # cap at 50KB

            for pattern in IMPORT_PATTERNS:
                for match in pattern.finditer(content):
                    import_path = match.group(1).strip()
                    if import_path:
                        imports.append(import_path)
        except Exception as e:
            logger.debug(f"Failed to read {file_path}: {e}")

        self._import_cache[file_path] = imports
        return imports

    def find_dependencies(self, file_path: str) -> list[str]:
        """Find all files that the given file imports from."""
        abs_path = os.path.abspath(file_path)
        imports = self._extract_imports(abs_path)
        resolved = []
        for imp in imports:
            resolved_path = _resolve_import(imp, abs_path, self.workspace_root)
            if resolved_path:
                resolved.append(resolved_path)
        return resolved

    def find_dependents(self, file_path: str) -> list[str]:
        """Find all files that import from the given file."""
        abs_path = os.path.abspath(file_path)
        rel_path = os.path.relpath(abs_path, self.workspace_root)
        dependents = []

        # Build the possible import strings that would reference this file
        base_name = os.path.splitext(rel_path)[0]
        possible_refs = {
            rel_path,
            base_name,
            "./" + base_name,
            "./" + rel_path,
        }

        for source_file in _get_scannable_files(self.workspace_root):
            if source_file == abs_path:
                continue
            imports = self._extract_imports(source_file)
            for imp in imports:
                resolved = _resolve_import(imp, source_file, self.workspace_root)
                if resolved and os.path.normpath(resolved) == os.path.normpath(abs_path):
                    dependents.append(source_file)
                    break

        return dependents

    def clear_cache(self):
        """Clear the import cache."""
        self._import_cache.clear()
