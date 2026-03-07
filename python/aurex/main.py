"""
JSON-RPC server that communicates with the Node.js CLI via stdio.
Handles: search, fetch_url, llm_chat, llm_plan, academic_search
"""

import json
import sys
import asyncio
import traceback

from aurex.config.loader import get_config
from aurex.llm.router import OpenRouterClient
from aurex.search.orchestrator import SearchOrchestrator
from aurex.cache.sqlite_cache import SQLiteCache
from aurex.ratelimit.limiter import RateLimiter

import os
from aurex.core.tool_registry import ToolRegistry
from aurex.core.context_manager import ContextManager
from aurex.core.planner import PlannerFacade
from aurex.core.skill_loader import SkillLoader
from aurex.core.agent_loop import AgentLoop


class JsonRpcServer:
    def __init__(self):
        self.config = get_config()
        self.cache = SQLiteCache(ttl=int(self.config.search.cache_ttl_hours * 3600))
        
        # Convert Pydantic RateLimitConfig to the tuple format expected by RateLimiter
        custom_limits = {
            name: (limit.max_requests, limit.window_seconds) 
            for name, limit in self.config.rate_limits.items()
        }
        self.rate_limiter = RateLimiter(custom_limits=custom_limits)
        
        self.llm = OpenRouterClient(rate_limiter=self.rate_limiter, config=self.config.llm)
        self.search = SearchOrchestrator(cache=self.cache, rate_limiter=self.rate_limiter)
        
        # Original task planner kept for backwards compatibility of llm_plan endpoint
        from aurex.llm.planner import TaskPlanner
        self.legacy_planner = TaskPlanner(llm=self.llm)
        
        # New Core Agent Architecture
        self.tool_registry = ToolRegistry()
        
        # Register atomic tools using search orchestrator wrappers
        async def search_web_tool(query: str, max_results: int = 5):
            results = await self.search.search(query, max_results=max_results)
            return {"citations": [r.model_dump() for r in results]}
            
        async def fetch_url_tool(url: str):
            content = await self.search.fetch_url(url)
            return {"content": content}
            
        self.tool_registry.register("search_web", search_web_tool, timeout_seconds=15)
        self.tool_registry.register("fetch_url", fetch_url_tool, timeout_seconds=30)
        
        self.context_manager = ContextManager(llm_client=self.llm)
        self.planner_facade = PlannerFacade(llm_client=self.llm, config=self.config)
        self.skill_loader = SkillLoader(
            skills_dir=os.path.join(os.path.dirname(__file__), "skills"),
            tool_registry=self.tool_registry
        )
        self.agent_loop = AgentLoop(
            config=self.config,
            planner=self.planner_facade,
            context_manager=self.context_manager,
            tool_registry=self.tool_registry,
            skill_loader=self.skill_loader
        )

        self.handlers = {
            "search": self._handle_search,
            "fetch_url": self._handle_fetch_url,
            "llm_chat": self._handle_llm_chat,
            "llm_plan": self._handle_llm_plan,
            "academic_search": self._handle_academic_search,
            "agent_run": self._handle_agent_run,
        }

    async def _handle_search(self, params: dict) -> dict:
        query = params.get("query", "")
        max_results = params.get("max_results", 5)
        results = await self.search.search(query, max_results=max_results)
        return {
            "citations": [r.model_dump() for r in results],
            "count": len(results),
        }

    async def _handle_fetch_url(self, params: dict) -> dict:
        url = params.get("url", "")
        content = await self.search.fetch_url(url)
        return {"content": content}

    async def _handle_llm_chat(self, params: dict) -> dict:
        messages = params.get("messages", [])
        model = params.get("model")
        response = await self.llm.chat(messages, model=model)
        return {"content": response}

    async def _handle_llm_plan(self, params: dict) -> dict:
        task = params.get("task", "")
        plan = await self.legacy_planner.create_plan(task)
        return {"plan": plan}

    async def _handle_agent_run(self, params: dict) -> dict:
        user_input = params.get("user_input", "")
        max_steps = params.get("max_steps", 10)
        result = await self.agent_loop.run(user_input, max_steps=max_steps)
        return result

    async def _handle_academic_search(self, params: dict) -> dict:
        query = params.get("query", "")
        from aurex.search.academic import search_academic
        results = await search_academic(query)
        return {"results": results}

    async def handle_request(self, request: dict) -> dict:
        method = request.get("method", "")
        params = request.get("params", {})
        req_id = request.get("id", 0)

        handler = self.handlers.get(method)
        if not handler:
            return {
                "jsonrpc": "2.0",
                "error": {"code": -32601, "message": f"Method not found: {method}"},
                "id": req_id,
            }

        try:
            result = await handler(params)
            return {"jsonrpc": "2.0", "result": result, "id": req_id}
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return {
                "jsonrpc": "2.0",
                "error": {"code": -32000, "message": str(e)},
                "id": req_id,
            }

    async def run(self):
        # Signal ready
        sys.stdout.write(json.dumps({"ready": True}) + "\n")
        sys.stdout.flush()

        loop = asyncio.get_event_loop()

        while True:
            try:
                line = await loop.run_in_executor(None, sys.stdin.readline)
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                request = json.loads(line)
                response = await self.handle_request(request)

                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()

            except json.JSONDecodeError as e:
                sys.stderr.write(f"JSON parse error: {e}\n")
                sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"Server error: {e}\n")
                sys.stderr.flush()


def main():
    server = JsonRpcServer()
    asyncio.run(server.run())


if __name__ == "__main__":
    main()
