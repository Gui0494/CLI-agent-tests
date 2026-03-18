"""
Tool Registry: Manages atomic functions (tools) that skills can invoke.
Implements security features: timeouts, allowlists, and consistent error handling.
"""

import asyncio
import logging
import inspect
from typing import Dict, Callable, Any, Optional

logger = logging.getLogger(__name__)

class ToolRegistry:
    def __init__(self, require_allowlist: bool = False, allowed_tools: Optional[list] = None):
        # Maps tool name to a dictionary containing the func, timeout, etc.
        self._tools: Dict[str, Dict[str, Any]] = {}
        # Explicit denylist for tools that are generally prohibited
        self._denylist = set(["execute_rm", "drop_db"])
        # Strict allowlist mode
        self.require_allowlist = require_allowlist
        # If strict, default safe tools if none provided
        self._allowlist = set(allowed_tools) if allowed_tools is not None else set(["search_web", "fetch_url"])
        self.permission_manager = None

    def set_permission_manager(self, pm):
        self.permission_manager = pm

    def register(self, name: str, func: Callable, schema: Optional[Dict[str, Any]] = None, timeout_seconds: int = 30, 
                 requires_confirmation: bool = False, risk_level: str = "low"):
        """Register a new atomic tool with security constraints and an optional schema."""
        if name in self._denylist:
            raise ValueError(f"Tool {name} is in the denylist and cannot be registered.")
            
        if self.require_allowlist and name not in self._allowlist:
            raise ValueError(f"Tool {name} is not in the strict allowlist and cannot be registered.")
            
        self._tools[name] = {
            "func": func,
            "schema": schema,
            "timeout_seconds": timeout_seconds,
            "requires_confirmation": requires_confirmation,
            "risk_level": risk_level
        }
        logger.info(f"Registered {risk_level}-risk tool: {name}")

    def get_all_tools(self) -> Dict[str, Dict[str, Any]]:
        return self._tools

    def get_tool_metadata(self, name: str) -> Optional[Dict[str, Any]]:
        return self._tools.get(name)

    async def execute(self, name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a tool safely with timeout and standardize the output.
        Always returns a dictionary with 'result' or 'error'.
        """
        if name not in self._tools:
            return {"error": f"Tool '{name}' not found in registry."}

        tool_meta = self._tools[name]
        
        # Check permissions
        if self.permission_manager:
            perm = await self.permission_manager.check_permission(name, params)
            if not perm.get("allowed", False):
                return {"error": "Requires explicit permission. User denied permission to execute tool."}

        func = tool_meta["func"]
        timeout_seconds = tool_meta.get("timeout_seconds", 30)

        # Filter params to only include kwargs the function actually accepts.
        # This prevents crashes when the LLM sends malformed arguments (e.g., {"raw": ...}).
        try:
            sig = inspect.signature(func)
            accepted = set(sig.parameters.keys())
            has_var_keyword = any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            )
            if not has_var_keyword:
                filtered_params = {k: v for k, v in params.items() if k in accepted}
                if len(filtered_params) != len(params):
                    dropped = set(params.keys()) - accepted
                    logger.warning(f"Tool '{name}': dropped unexpected args {dropped}")
            else:
                filtered_params = params
        except (ValueError, TypeError):
            filtered_params = params

        try:
            # Check if func is async
            if inspect.iscoroutinefunction(func):
                result = await asyncio.wait_for(func(**filtered_params), timeout=timeout_seconds)
            else:
                # Run sync functions in a thread pool to unblock the event loop
                loop = asyncio.get_running_loop()
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: func(**filtered_params)), 
                    timeout=timeout_seconds
                )
            
            return {"result": result}
        except asyncio.TimeoutError:
            return {"error": f"Tool '{name}' timed out after {timeout_seconds}s"}
        except Exception as e:
            logger.exception(f"Error executing tool {name}")
            return {"error": f"Execution failed: {str(e)}"}

# Global registry instance
registry = ToolRegistry()
