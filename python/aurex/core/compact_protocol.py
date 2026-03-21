"""
Compact Context Protocol — Smart summarization preserving critical information.

Ensures that errors, decisions, file paths, and key facts survive
context compaction even when other content is compressed.

Reference: Phase 6.1 — Compact Context Protocol
"""

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Patterns that indicate critical information to preserve verbatim
PRESERVE_PATTERNS = [
    r"(?i)error|Error|ERROR|exception|Exception|traceback|Traceback",
    r"(?i)decision:|chose:|selected:|using:|approach:",
    r"\b(?:created|modified|deleted|wrote|removed)\b.*\.\w{1,5}\b",
    r"(?i)fix(?:ed)?:|bug:|issue:|resolved:",
    r"(?i)TODO|FIXME|HACK|WARNING",
    r"(?i)api[_\s]?key|secret|token|password",  # flag but don't include values
]

# Compiled for performance
_PRESERVE_RE = [re.compile(p) for p in PRESERVE_PATTERNS]


def extract_preserved_lines(text: str) -> list[str]:
    """Extract lines matching preservation patterns."""
    preserved = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        for pattern in _PRESERVE_RE:
            if pattern.search(stripped):
                # Don't preserve lines that look like they contain actual secrets
                if re.search(r"(?i)(api[_\s]?key|secret|password)\s*[:=]\s*\S{8,}", stripped):
                    preserved.append("[REDACTED: credential reference]")
                else:
                    preserved.append(stripped)
                break
    return preserved


class CompactProtocol:
    """Smart context summarization that preserves critical information."""

    def __init__(self, max_preserved_lines: int = 50):
        self.max_preserved_lines = max_preserved_lines

    async def summarize(
        self,
        messages: list[dict],
        llm_client=None,
    ) -> str:
        """
        Summarize messages while preserving critical information.

        1. Extract must-preserve lines matching patterns
        2. Send remaining content to LLM for compression
        3. Combine preserved + summary
        """
        # Build full text from messages
        full_text = ""
        for msg in messages:
            role = msg.get("role", "unknown").upper()
            content = msg.get("content", "")
            if isinstance(content, str):
                full_text += f"[{role}]: {content}\n"

        # Extract critical lines
        preserved = extract_preserved_lines(full_text)
        preserved = preserved[:self.max_preserved_lines]

        # Generate LLM summary of the rest
        llm_summary = ""
        if llm_client:
            try:
                prompt = (
                    "Summarize the following conversation concisely. "
                    "Focus on: what was done, what files were changed, "
                    "what decisions were made, and what remains to do.\n\n"
                    f"{full_text[:8000]}"
                )
                llm_summary = await llm_client.chat(
                    [
                        {"role": "system", "content": "You are a memory summarizer. Be brief and factual."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.1,
                )
                if not isinstance(llm_summary, str):
                    llm_summary = str(llm_summary)
                llm_summary = llm_summary.strip()
            except Exception as e:
                logger.warning(f"LLM summarization failed: {e}")

        # Combine
        parts = []
        if llm_summary:
            parts.append(llm_summary)
        if preserved:
            parts.append("### Preserved Details")
            parts.extend(f"- {line}" for line in preserved)

        return "\n".join(parts) if parts else f"[Compacted {len(messages)} messages]"
