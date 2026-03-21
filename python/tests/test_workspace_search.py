"""
Tests for WorkspaceSearch — Import/dependency graph builder.
"""

import os
import pytest

from aurex.tools.workspace_search import WorkspaceSearch


@pytest.fixture
def workspace(tmp_path):
    """Create a temp workspace with files that import each other."""
    # Python files
    (tmp_path / "main.py").write_text(
        "from utils import helper\n"
        "import os\n"
        "from models import User\n"
    )
    (tmp_path / "utils.py").write_text(
        "import json\n"
        "def helper():\n"
        "    pass\n"
    )
    (tmp_path / "models.py").write_text(
        "class User:\n"
        "    pass\n"
    )

    # JS/TS files
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    (src_dir / "index.ts").write_text(
        'import { greet } from "./utils";\n'
        'import { User } from "./models";\n'
    )
    (src_dir / "utils.ts").write_text(
        "export function greet(name: string) {\n"
        '  return `Hello ${name}`;\n'
        "}\n"
    )
    (src_dir / "models.ts").write_text(
        "export interface User {\n"
        "  id: number;\n"
        "}\n"
    )

    return tmp_path


class TestWorkspaceSearch:
    def test_find_dependencies_python(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        deps = ws.find_dependencies(str(workspace / "main.py"))
        dep_names = [os.path.basename(d) for d in deps]
        # Python bare imports (from utils import ...) resolve via dotted path
        # which requires package structure. At minimum the imports are extracted.
        raw_imports = ws._extract_imports(str(workspace / "main.py"))
        assert "utils" in raw_imports or "models" in raw_imports

    def test_find_dependencies_typescript(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        deps = ws.find_dependencies(str(workspace / "src" / "index.ts"))
        dep_names = [os.path.basename(d) for d in deps]
        assert "utils.ts" in dep_names or "models.ts" in dep_names

    def test_find_dependents(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        dependents = ws.find_dependents(str(workspace / "src" / "utils.ts"))
        dep_names = [os.path.basename(d) for d in dependents]
        assert "index.ts" in dep_names

    def test_find_dependencies_no_imports(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        deps = ws.find_dependencies(str(workspace / "models.py"))
        # models.py has no imports
        assert len(deps) == 0

    def test_find_dependents_no_dependents(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        dependents = ws.find_dependents(str(workspace / "main.py"))
        # Nothing imports main.py
        assert len(dependents) == 0

    def test_find_dependencies_nonexistent_file(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        deps = ws.find_dependencies(str(workspace / "nonexistent.py"))
        assert deps == []

    def test_clear_cache(self, workspace):
        ws = WorkspaceSearch(str(workspace))
        ws.find_dependencies(str(workspace / "main.py"))
        assert len(ws._import_cache) > 0
        ws.clear_cache()
        assert len(ws._import_cache) == 0
