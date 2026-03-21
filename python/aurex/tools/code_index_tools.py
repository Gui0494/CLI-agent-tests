"""
Code Index Tool Wrappers — Registers find_symbol and get_outline with the ToolRegistry.

Reference: Phase 2.2 — Tree-sitter Code Indexing
"""

from aurex.tools.code_index import CodeIndex


_index: CodeIndex | None = None


def _get_index(workspace_root: str = ".") -> CodeIndex:
    global _index
    if _index is None:
        _index = CodeIndex(workspace_root)
    return _index


async def find_symbol(name: str, scope: str = ".") -> dict:
    """Find where a function/class/variable is defined in the codebase."""
    index = _get_index()
    results = index.find_symbol(name, scope)
    return {
        "matches": results[:50],  # cap results
        "count": len(results),
    }


async def get_outline(path: str) -> dict:
    """Get the structural outline of a file (functions, classes, exports)."""
    index = _get_index()
    symbols = index.get_outline(path)
    return {
        "symbols": symbols,
        "count": len(symbols),
    }


FIND_SYMBOL_SCHEMA = {
    "name": "find_symbol",
    "description": "Find where a function, class, or variable is defined in the codebase",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Symbol name to search for"},
            "scope": {"type": "string", "description": "Directory scope to search in", "default": "."},
        },
        "required": ["name"],
    },
}

GET_OUTLINE_SCHEMA = {
    "name": "get_outline",
    "description": "Get the structural outline of a file (functions, classes, exports)",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path to analyze"},
        },
        "required": ["path"],
    },
}


def register_code_index_tools(registry, workspace_root: str = "."):
    """Register find_symbol and get_outline tools with the registry."""
    global _index
    _index = CodeIndex(workspace_root)

    registry.register(
        "find_symbol",
        find_symbol,
        schema=FIND_SYMBOL_SCHEMA,
        timeout_seconds=30,
    )
    registry.register(
        "get_outline",
        get_outline,
        schema=GET_OUTLINE_SCHEMA,
        timeout_seconds=15,
    )
