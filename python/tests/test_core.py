import pytest
import asyncio
from unittest.mock import patch, MagicMock

from aurex.core.tool_registry import ToolRegistry
from aurex.core.context_manager import ContextManager
from aurex.core.skill_loader import SkillLoader
from aurex.core.agent_loop import AgentLoop
from aurex.config.loader import AurexConfig

@pytest.fixture
def tool_registry():
    return ToolRegistry()

@pytest.fixture
def context_manager():
    return ContextManager(max_history=5)

@pytest.mark.asyncio
async def test_tool_registry_success(tool_registry):
    async def dummy_tool(x: int):
        return x * 2

    tool_registry.register("dummy", dummy_tool)
    result = await tool_registry.execute("dummy", {"x": 21})
    assert result == {"result": 42}

@pytest.mark.asyncio
async def test_tool_registry_denylist(tool_registry):
    async def bad_tool():
        pass

    with pytest.raises(ValueError, match="denylist"):
        tool_registry.register("drop_db", bad_tool)

@pytest.mark.asyncio
async def test_tool_registry_timeout(tool_registry):
    async def slow_tool():
        await asyncio.sleep(2)
        return "done"

    tool_registry.register("slow", slow_tool, timeout_seconds=1)
    result = await tool_registry.execute("slow", {})
    assert "error" in result
    assert "timed out" in result["error"]

@pytest.mark.asyncio
async def test_context_manager_limits(context_manager):
    for i in range(10):
        await context_manager.add_to_long_term({"role": "user", "content": f"msg {i}"})
        
    history = context_manager.get_long_term_context()
    # Should enforce max_history
    assert len(history) <= context_manager.max_history
    # Should contain a summary marker
    has_summary = any("Summarized" in msg.get("content", "") for msg in history)
    assert has_summary

def test_tool_registry_allowlist():
    tr = ToolRegistry(require_allowlist=True, allowed_tools=["safe_tool"])
    
    async def dummy(): pass
    
    # Allowed tool
    tr.register("safe_tool", dummy, risk_level="low")
    assert "safe_tool" in tr._tools
    
    # Disallowed tool
    with pytest.raises(ValueError, match="allowlist"):
        tr.register("unsafe_tool", dummy)

@pytest.mark.asyncio
@patch('aurex.core.agent_loop.function_calling_run')
async def test_agent_loop_flow(mock_fc_run):
    # Mock function calling output
    mock_fc_run.return_value = {
        "response": "Hello world",
        "tool_calls": [],
        "rounds": 1
    }
    
    # Mocking dependencies
    config = AurexConfig()
    
    cm = ContextManager()
    tr = ToolRegistry()
    loader = MagicMock(spec=SkillLoader)
    loader.loaded_skills = {}
    
    loop = AgentLoop(config, cm, tr, loader)
    
    result = await loop.run("Say hello")
    
    assert result["status"] == "success"
    assert result["output"] == "Hello world"
    
    # Context should have captured the step
    trace = cm.get_long_term_context()
    assert len(trace) > 0
    assert trace[-1]["content"] == "Hello world"
