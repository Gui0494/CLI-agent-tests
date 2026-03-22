"""
Prompt loader — reads .md prompt templates from the prompts/ directory.

Externalizing prompts from source code allows rapid iteration without rebuild.
"""

import os
import logging

logger = logging.getLogger(__name__)

_PROMPTS_DIR = os.path.dirname(os.path.abspath(__file__))

_FALLBACK_SOP = (
    "You are an autonomous CLI Agent. "
    "NEVER claim to have performed an action unless you called a tool and it succeeded. "
    "Follow this pipeline: READ → PLAN → CODE → REVIEW → TEST → DELIVER."
)


def load_prompt(name: str) -> str:
    """Load a prompt template by name (without extension).

    Looks for ``<name>.md`` in the prompts directory.
    Returns the file contents, or a minimal fallback with a warning if not found.
    """
    file_path = os.path.join(_PROMPTS_DIR, f"{name}.md")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read(50_000)
    except FileNotFoundError:
        logger.warning("Prompt file '%s.md' not found at %s — using fallback", name, file_path)
        if name == "sop":
            return _FALLBACK_SOP
        return f"[Prompt '{name}' not found]"
    except Exception as e:
        logger.error("Failed to load prompt '%s': %s", name, e)
        if name == "sop":
            return _FALLBACK_SOP
        return f"[Error loading prompt '{name}']"
