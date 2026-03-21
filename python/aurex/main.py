"""
JSON-RPC server that communicates with the Node.js CLI via stdio.
Handles: search, fetch_url, llm_chat, llm_plan, academic_search

SECURITY: All incoming JSON-RPC payloads are validated against Pydantic schemas
before dispatching to handlers. Unknown methods and malformed params are rejected.
"""

import json
import sys
import asyncio
import traceback
import re

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any, Literal

from aurex.config.loader import get_config
from aurex.llm.router import OpenRouterClient
from aurex.search.orchestrator import SearchOrchestrator
from aurex.cache.sqlite_cache import SQLiteCache
from aurex.ratelimit.limiter import RateLimiter

import os
from aurex.core.tool_registry import ToolRegistry
from aurex.core.context_manager import ContextManager
from aurex.core.adaptive_context import AdaptiveContextManager
from aurex.core.skill_loader import SkillLoader
from aurex.core.agent_loop import AgentLoop


# ─── RPC Method Parameter Schemas (Pydantic) ─────────────
# Every incoming RPC call is validated against these before handler dispatch.

class SearchParams(BaseModel):
    query: str = Field(min_length=1, max_length=10_000)
    max_results: int = Field(default=5, ge=1, le=100)

class FetchUrlParams(BaseModel):
    url: str = Field(min_length=1, max_length=8192)

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not re.match(r'^https?://', v):
            raise ValueError("URL must start with http:// or https://")
        return v

class LlmChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

class LlmChatParams(BaseModel):
    messages: List[LlmChatMessage] = Field(min_length=1)
    model: Optional[str] = Field(default=None, max_length=256)

class LlmStreamParams(BaseModel):
    prompt: str = Field(min_length=1, max_length=100_000)
    system_prompt: Optional[str] = Field(default=None, max_length=100_000)
    model: Optional[str] = Field(default=None, max_length=256)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    provider: Optional[str] = Field(default=None, max_length=64)
    api_key: Optional[str] = Field(default=None, max_length=1024)

class LlmPlanParams(BaseModel):
    task: str = Field(min_length=1, max_length=100_000)

class AgentRunParams(BaseModel):
    user_input: str = Field(min_length=1, max_length=100_000)
    max_steps: int = Field(default=10, ge=1, le=50)

class ExecuteToolParams(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    params: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def validate_tool_name(cls, v: str) -> str:
        if not re.match(r'^[a-z_][a-z0-9_]*$', v, re.IGNORECASE):
            raise ValueError(f"Invalid tool name format: {v}")
        return v

class ManageHistoryParams(BaseModel):
    action: Literal["load", "clear", "undo", "status"] = "status"

class AcademicSearchParams(BaseModel):
    query: str = Field(min_length=1, max_length=10_000)

class RunVerificationParams(BaseModel):
    stages: List[str] = Field(default=["test", "lint", "typecheck"])

class CreateBackupParams(BaseModel):
    files: List[str] = Field(min_length=1)
    label: str = Field(default="manual", max_length=64)

class RestoreBackupParams(BaseModel):
    backup_path: str = Field(min_length=1, max_length=4096)


# Map method names to their Pydantic schema
RPC_PARAM_SCHEMAS: Dict[str, type] = {
    "search": SearchParams,
    "fetch_url": FetchUrlParams,
    "llm_chat": LlmChatParams,
    "llm_stream": LlmStreamParams,
    "llm_plan": LlmPlanParams,
    "agent_run": AgentRunParams,
    "execute_tool": ExecuteToolParams,
    "manage_history": ManageHistoryParams,
    "academic_search": AcademicSearchParams,
    "run_verification": RunVerificationParams,
    "create_backup": CreateBackupParams,
    "restore_backup": RestoreBackupParams,
}


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
        
        # Setup permission system
        from aurex.skills.permission_system.run import PermissionManager
        
        async def ask_user(action, args, risk, reason):
            result = await self.call_client("permission_request", {
                "action": action,
                "args": args,
                "risk_level": risk,
                "reason": reason
            })
            return "y" if result.get("allowed") else "n"

        self.permission_manager = PermissionManager(ask_callback=ask_user)
        self.tool_registry.set_permission_manager(self.permission_manager)
        
        # Register atomic tools using search orchestrator wrappers
        async def search_web_tool(query: str, max_results: int = 5):
            results = await self.search.search(query, max_results=max_results)
            return {"citations": [r.model_dump() for r in results]}
            
        async def fetch_url_tool(url: str):
            content = await self.search.fetch_url(url)
            return {"content": content}

        # Node Proxied Tools
        async def exec_command_tool(cmd: str):
            result = await self.call_client("run_node_tool", {"tool_name": "exec_command", "tool_args": {"cmd": cmd}})
            return result

        async def read_file_tool(path: str):
            result = await self.call_client("run_node_tool", {"tool_name": "read_file", "tool_args": {"path": path}})
            return result

        async def list_files_tool(dir: str = "."):
            result = await self.call_client("run_node_tool", {"tool_name": "list_files", "tool_args": {"dir": dir}})
            return result

        async def edit_file_tool(path: str, old_text: str, new_text: str, replace_all: bool = False):
            result = await self.call_client("run_node_tool", {"tool_name": "edit_file", "tool_args": {
                "path": path, "old_text": old_text, "new_text": new_text, "replace_all": replace_all
            }})
            return result

        async def write_file_tool(path: str, content: str):
            result = await self.call_client("run_node_tool", {"tool_name": "write_file", "tool_args": {
                "path": path, "content": content
            }})
            return result

        async def grep_tool(pattern: str, path: str = "."):
            result = await self.call_client("run_node_tool", {"tool_name": "grep", "tool_args": {
                "pattern": pattern, "path": path
            }})
            return result
            
        # SECURITY: create_agent dynamic tool has been removed.
        # Dynamic hot-loading of LLM-generated code is a critical attack surface.
        # Skills must be installed via declarative YAML manifests (no executable code).
        # See: SkillLoader.install_from_manifest() for the safe alternative.

        self.tool_registry.register("search_web", search_web_tool, schema={
            "name": "search_web",
            "description": "Searches the web for recent information.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."}
                },
                "required": ["query"]
            }
        }, timeout_seconds=15)
        
        self.tool_registry.register("fetch_url", fetch_url_tool, schema={
            "name": "fetch_url",
            "description": "Fetches raw text content from a specified URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch."}
                },
                "required": ["url"]
            }
        }, timeout_seconds=30)

        self.tool_registry.register("exec_command", exec_command_tool, schema={
            "name": "exec_command",
            "description": "Run a bash command in a secure, isolated Docker sandbox. Returns stdout, stderr, and exit_code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "Command to run in the Docker sandbox"}
                },
                "required": ["cmd"]
            }
        }, timeout_seconds=600, risk_level="medium")

        self.tool_registry.register("read_file", read_file_tool, schema={
            "name": "read_file",
            "description": "Read the contents of a file in the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to read"}
                },
                "required": ["path"]
            }
        }, timeout_seconds=15, risk_level="safe")

        self.tool_registry.register("list_files", list_files_tool, schema={
            "name": "list_files",
            "description": "List all files in a directory recursively.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dir": {"type": "string", "description": "Directory to list files from (default: .)"}
                }
            }
        }, timeout_seconds=15, risk_level="safe")

        self.tool_registry.register("edit_file", edit_file_tool, schema={
            "name": "edit_file",
            "description": "Edit an existing file using FIM or localized diff patching. You MUST prioritize this tool over write_file to modify existing code. old_text must be an exact unique substring. new_text replaces it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to edit"},
                    "old_text": {"type": "string", "description": "Exact text to find in the file (must be unique)"},
                    "new_text": {"type": "string", "description": "Text to replace old_text with"},
                    "replace_all": {"type": "boolean", "description": "Replace all occurrences instead of requiring uniqueness (default: false)"}
                },
                "required": ["path", "old_text", "new_text"]
            }
        }, timeout_seconds=300, risk_level="low")

        self.tool_registry.register("write_file", write_file_tool, schema={
            "name": "write_file",
            "description": "Create a new file. ONLY use this for entirely new files. For modifying existing files, you MUST use the edit_file tool to apply non-destructive patches.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to create/overwrite"},
                    "content": {"type": "string", "description": "Content to write to the file"}
                },
                "required": ["path", "content"]
            }
        }, timeout_seconds=300, risk_level="medium")

        self.tool_registry.register("grep", grep_tool, schema={
            "name": "grep",
            "description": "Search for a text pattern across files. Returns matching lines with file paths and line numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Text pattern to search for"},
                    "path": {"type": "string", "description": "File or directory to search in (default: current directory)"}
                },
                "required": ["pattern"]
            }
        }, timeout_seconds=15, risk_level="safe")
        
        # REMOVED: create_agent tool — dynamic code generation + hot-loading is a critical
        # security vulnerability. Skills are now installed via declarative manifests only.
        
        self.context_manager = AdaptiveContextManager(llm_client=self.llm)
        skills_dir = os.path.join(os.path.dirname(__file__), "skills")
        self.skill_loader = SkillLoader(skills_dir=skills_dir, tool_registry=self.tool_registry)
        
        # Instantiate loops using native function calling
        self.agent_loop = AgentLoop(
            config=self.config,
            context_manager=self.context_manager,
            tool_registry=self.tool_registry,
            skill_loader=self.skill_loader,
            call_client=self.call_client,
        )

        self.handlers = {
            "search": self._handle_search,
            "fetch_url": self._handle_fetch_url,
            "llm_chat": self._handle_llm_chat,
            "llm_stream": self._handle_llm_stream,
            "llm_plan": self._handle_llm_plan,
            "academic_search": self._handle_academic_search,
            "agent_run": self._handle_agent_run,
            "execute_tool": self._handle_execute_tool,
            "manage_history": self._handle_manage_history,
            "run_verification": self._handle_run_verification,
            "create_backup": self._handle_create_backup,
            "restore_backup": self._handle_restore_backup,
        }

        self.pending_requests = {}
        self.request_id_counter = 10000

    async def _handle_execute_tool(self, params: dict) -> dict:
        name = params.get("name")
        args = params.get("params", {})
        if not name:
            return {"error": "Tool name is required"}
        result = await self.tool_registry.execute(name, args)
        return result

    async def _handle_run_verification(self, params: dict) -> dict:
        """Proxy verification request to Node-side verifier."""
        stages = params.get("stages", ["test", "lint", "typecheck"])
        result = await self.call_client("run_verification", {"stages": stages})
        return result

    async def _handle_create_backup(self, params: dict) -> dict:
        """Create a file backup snapshot."""
        from aurex.core.verification import VerificationPipeline
        verifier = VerificationPipeline(call_client=self.call_client)
        files = params.get("files", [])
        label = params.get("label", "manual")
        snapshot = verifier.create_snapshot(files)
        backup_path = verifier.save_backup_to_disk(snapshot, label)
        return {"backup_path": backup_path, "file_count": snapshot.file_count}

    async def _handle_restore_backup(self, params: dict) -> dict:
        """Restore files from a backup."""
        import json as json_mod
        backup_path = params.get("backup_path", "")
        manifest_path = os.path.join(backup_path, "manifest.json")
        if not os.path.exists(manifest_path):
            return {"error": f"Backup not found: {backup_path}"}
        with open(manifest_path) as f:
            manifest = json_mod.load(f)
        restored = []
        for abs_path, safe_name in manifest.items():
            file_backup = os.path.join(backup_path, safe_name)
            if os.path.exists(file_backup):
                with open(file_backup, "rb") as bf:
                    content = bf.read()
                os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                with open(abs_path, "wb") as wf:
                    wf.write(content)
                restored.append(abs_path)
        return {"restored": restored, "count": len(restored)}

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

    async def _handle_llm_stream(self, params: dict) -> dict:
        prompt = params.get("prompt", "")
        
        try:
            from aurex.skills.streaming_engine.run import run as stream_run
        except ImportError:
            return {"error": "streaming_engine module not found"}

        def on_token(chunk):
            self.send_notification("stream_token", chunk)

        stream_params = {
            "prompt": prompt,
            "stream_mode": "callback",
            "callback": on_token,
        }

        # Auto-inject model from config if not passed
        if "model" not in params:
            params["model"] = self.config.llm.default_model

        for k in ["system_prompt", "model", "temperature", "provider", "api_key"]:
            if k in params:
                stream_params[k] = params[k]

        # Auto-inject provider based on model
        if "provider" not in stream_params:
            if "deepseek" in stream_params.get("model", "").lower():
                stream_params["provider"] = "deepseek"
            else:
                stream_params["provider"] = "openrouter"

        # Auto-inject API key from environment if not provided
        if "api_key" not in stream_params or not stream_params["api_key"]:
            provider = stream_params.get("provider", "openrouter")
            if provider == "anthropic":
                stream_params["api_key"] = os.environ.get("ANTHROPIC_API_KEY", "")
            elif provider == "deepseek":
                stream_params["api_key"] = os.environ.get("DEEPSEEK_API_KEY", "")
            else:
                stream_params["api_key"] = os.environ.get("OPENROUTER_API_KEY", "")

        result = await stream_run(stream_params, tool_registry=self.tool_registry)
        return result

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

    async def _handle_manage_history(self, params: dict) -> dict:
        action = params.get("action", "status")
        if action == "load":
            success = self.context_manager.load_from_disk()
            return {"success": success, "message": "History loaded" if success else "No history found", "length": len(self.context_manager.long_term_memory)}
        elif action == "clear":
            self.context_manager.clear_history()
            return {"success": True, "message": "History cleared"}
        elif action == "undo":
            self.context_manager.undo_last_interaction()
            return {"success": True, "message": "Undid recent interaction steps", "length": len(self.context_manager.long_term_memory)}
        else:
            return {"success": True, "length": len(self.context_manager.long_term_memory)}

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

        # Validate params against Pydantic schema (if defined)
        schema_cls = RPC_PARAM_SCHEMAS.get(method)
        if schema_cls:
            try:
                validated = schema_cls(**params)
                params = validated.model_dump()
            except Exception as e:
                return {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32602,
                        "message": f"Invalid params for '{method}': {str(e)}"
                    },
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

    def send_notification(self, method: str, params: dict):
        """Sends a JSON-RPC notification (no ID) to the client."""
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        sys.stdout.write(json.dumps(notification) + "\n")
        sys.stdout.flush()

    async def call_client(self, method: str, params: dict) -> dict:
        """Calls a method on the client (Node.js) and waits for the response."""
        req_id = self.request_id_counter
        self.request_id_counter += 1
        
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": req_id
        }
        
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending_requests[req_id] = future
        
        sys.stdout.write(json.dumps(request) + "\n")
        sys.stdout.flush()
        
        return await future

    async def _process_and_reply(self, request: dict):
        try:
            response = await self.handle_request(request)
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error processing request: {e}\n")
            sys.stderr.flush()

    async def run(self):
        # Signal ready
        sys.stdout.write(json.dumps({"ready": True}) + "\n")
        sys.stdout.flush()

        loop = asyncio.get_running_loop()

        while True:
            try:
                line = await loop.run_in_executor(None, sys.stdin.readline)
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                request = json.loads(line)
                
                # Check if it's a response to a server-initiated request
                if ("result" in request or "error" in request) and "method" not in request:
                    req_id = request.get("id")
                    if req_id in self.pending_requests:
                        future = self.pending_requests.pop(req_id)
                        if "error" in request:
                            future.set_exception(Exception(request["error"].get("message", "Unknown error")))
                        else:
                            future.set_result(request.get("result"))
                        continue
                
                # Otherwise, it's a request from Node to Python
                asyncio.create_task(self._process_and_reply(request))

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
