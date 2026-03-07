"""URL normalization and citation deduplication."""

from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from aurex.citations.manager import Citation


def normalize_url(url: str) -> str:
    """Normalize a URL for deduplication:
    - Lowercase scheme and host
    - Remove trailing slash
    - Remove common tracking params (utm_*, ref, source)
    - Sort query parameters
    """
    parsed = urlparse(url)

    # Lowercase scheme and netloc
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()

    # Remove trailing slash from path
    path = parsed.path.rstrip("/") or "/"

    # Filter tracking params
    tracking_prefixes = ("utm_", "ref", "source", "fbclid", "gclid")
    params = parse_qs(parsed.query)
    filtered = {
        k: v for k, v in params.items() if not any(k.startswith(p) for p in tracking_prefixes)
    }
    sorted_filtered = dict(sorted(filtered.items()))
    query = urlencode(sorted_filtered, doseq=True) if sorted_filtered else ""

    return urlunparse((scheme, netloc, path, "", query, ""))


def deduplicate_citations(citations: list["Citation"]) -> list["Citation"]:
    """Remove duplicate citations based on normalized URL."""
    seen: set[str] = set()
    unique: list["Citation"] = []

    for citation in citations:
        normalized = normalize_url(citation.url)
        if normalized not in seen:
            seen.add(normalized)
            unique.append(citation)

    return unique
