"""Citation tracking - every context excerpt carries source metadata."""

from typing import Optional
from pydantic import BaseModel


class Citation(BaseModel):
    """Standard citation format used across all search providers."""

    url: str
    title: str
    excerpt: str = ""
    date: Optional[str] = None
    provider: Optional[str] = None

    def short(self) -> str:
        """Short display format."""
        date_str = f" ({self.date})" if self.date else ""
        return f"[{self.title}]{date_str} - {self.url}"

    def markdown(self) -> str:
        """Markdown format for LLM context."""
        return f"**{self.title}**{f' ({self.date})' if self.date else ''}\n{self.excerpt}\nSource: {self.url}"


class CitationManager:
    """Tracks citations across a session for proper attribution."""

    def __init__(self):
        self.citations: list[Citation] = []
        self._seen_urls: set[str] = set()

    def add(self, citation: Citation) -> int:
        """Add a citation, returns its index (1-based)."""
        if citation.url in self._seen_urls:
            # Return existing index
            for i, c in enumerate(self.citations):
                if c.url == citation.url:
                    return i + 1
            return len(self.citations)

        self._seen_urls.add(citation.url)
        self.citations.append(citation)
        return len(self.citations)

    def get(self, index: int) -> Optional[Citation]:
        """Get citation by 1-based index."""
        if 1 <= index <= len(self.citations):
            return self.citations[index - 1]
        return None

    def format_references(self) -> str:
        """Format all citations as a numbered reference list."""
        if not self.citations:
            return ""

        lines = ["## References"]
        for i, c in enumerate(self.citations, 1):
            lines.append(f"{i}. [{c.title}]({c.url})")
        return "\n".join(lines)

    def clear(self):
        self.citations.clear()
        self._seen_urls.clear()
