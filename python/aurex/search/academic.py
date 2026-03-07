"""OpenAlex + Crossref - academic paper search and citations."""

import httpx

OPENALEX_URL = "https://api.openalex.org/works"
CROSSREF_URL = "https://api.crossref.org/works"


async def search_academic(query: str, max_results: int = 5) -> list[dict]:
    """Search academic papers via OpenAlex, fallback to Crossref."""
    try:
        return await _search_openalex(query, max_results)
    except Exception:
        return await _search_crossref(query, max_results)


async def _search_openalex(query: str, max_results: int) -> list[dict]:
    params = {
        "search": query,
        "per_page": max_results,
        "select": "id,title,doi,publication_date,authorships,cited_by_count",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(OPENALEX_URL, params=params)
        response.raise_for_status()
        data = response.json()

    results = []
    for work in data.get("results", []):
        authors = [
            a.get("author", {}).get("display_name", "")
            for a in work.get("authorships", [])[:3]
        ]
        results.append({
            "title": work.get("title", ""),
            "doi": work.get("doi", ""),
            "date": work.get("publication_date", ""),
            "authors": authors,
            "citations": work.get("cited_by_count", 0),
            "source": "openalex",
        })

    return results


async def _search_crossref(query: str, max_results: int) -> list[dict]:
    params = {
        "query": query,
        "rows": max_results,
        "select": "DOI,title,author,published-print,is-referenced-by-count",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(CROSSREF_URL, params=params)
        response.raise_for_status()
        data = response.json()

    results = []
    for item in data.get("message", {}).get("items", []):
        authors = [
            f"{a.get('given', '')} {a.get('family', '')}"
            for a in item.get("author", [])[:3]
        ]
        date_parts = item.get("published-print", {}).get("date-parts", [[]])
        date_str = "-".join(str(d) for d in date_parts[0]) if date_parts[0] else ""

        results.append({
            "title": (item.get("title") or [""])[0],
            "doi": item.get("DOI", ""),
            "date": date_str,
            "authors": authors,
            "citations": item.get("is-referenced-by-count", 0),
            "source": "crossref",
        })

    return results
