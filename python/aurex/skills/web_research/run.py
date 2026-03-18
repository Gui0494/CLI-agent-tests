"""
Web Research Skill: Executes search, fetches top URLs, and returns structured data.
"""

from typing import Dict, Any
from aurex.core.tool_registry import ToolRegistry
from aurex.config.loader import get_config
from aurex.llm.router import OpenRouterClient

async def run(params: Dict[str, Any], registry: ToolRegistry) -> Dict[str, Any]:
    query = params.get("query")
    if not query:
        raise ValueError("web_research requires a 'query' input.")
        
    max_depth = int(params.get("max_depth", 3))
    
    # 1. Search the web using the tool registry
    search_res = await registry.execute("search_web", {"query": query, "max_results": max_depth})
    if "error" in search_res:
        raise Exception(f"Search failed: {search_res['error']}")
        
    citations = search_res["result"].get("citations", [])
    if not citations:
        return {
            "query": query,
            "sources": [],
            "summary": "No relevant information found on the web."
        }
        
    # 2. Extract content from the top URLs using fetch_url
    sources = []
    combined_content = ""
    for citation in citations[:max_depth]:
        url = citation.get("url")
        title = citation.get("title", "Unknown Title")
        snippet = citation.get("excerpt", "")
        
        # Deep read via fetch_url tool
        fetch_res = await registry.execute("fetch_url", {"url": url})
        
        content = ""
        if "error" not in fetch_res:
            content = fetch_res["result"].get("content", "")
            # Truncate content to avoid blowing up the LLM
            if len(content) > 3000:
                content = content[:3000] + "..."
                
        sources.append({
            "title": title,
            "url": url,
            "snippet": snippet,
            "content": content
        })
        
        combined_content += f"\n\n### Source: {title} ({url})\n{content}"

    # 3. Create a synthesis using LLM
    config = get_config()
    # Simple hardcoded router client setup for skill, sharing config limiters
    llm = OpenRouterClient(config=config.llm)
    
    prompt = f"Synthesize a summary for the query: '{query}' based on the following web content:\n{combined_content}"
    
    try:
        summary_res = await llm.chat([
            {"role": "system", "content": "You are an expert research synthesizer. Create a concise summary."},
            {"role": "user", "content": prompt}
        ], temperature=0.2)
        summary = summary_res.strip()
    except Exception as e:
        summary = f"Synthesized research for '{query}'. Found {len(sources)} sources, but LLM summarization failed: {e}. Snippets: " + " ".join([s['snippet'] for s in sources])

    return {
        "query": query,
        "sources": sources,
        "summary": summary
    }
