"""
Agent Loop: The central orchestrator.
Flow: User Input -> Context update -> Planner -> Output/Skill Selection -> Context update.
"""

import logging
from typing import Dict, Any

from aurex.config.loader import AurexConfig
from aurex.core.context_manager import ContextManager
from aurex.core.tool_registry import ToolRegistry
from aurex.core.skill_loader import SkillLoader

try:
    from aurex.skills.function_calling.run import run as function_calling_run
except ImportError:
    function_calling_run = None

logger = logging.getLogger(__name__)

class AgentLoop:
    def __init__(self, config: AurexConfig, context_manager: ContextManager, 
                 tool_registry: ToolRegistry, skill_loader: SkillLoader):
        self.config = config
        self.context = context_manager
        self.registry = tool_registry
        self.loader = skill_loader
        
        # Load skills on initialization
        self.loader.load_all_skills()

    async def run(self, user_input: str, max_steps: int = 10) -> Dict[str, Any]:
        """
        Executes a multi-step turn of the agent loop using native Function Calling.
        """
        if not function_calling_run:
            return {"error": "function_calling skill not found."}
            
        # 1. Update long-term memory with user input
        await self.context.add_to_long_term({"role": "user", "content": user_input})
        
        # 2. Get all available tool schemas
        tools = []
        for name, tool in self.registry.get_all_tools().items():
            if tool.get("schema"):
                tools.append(tool["schema"])
                
        for name, skill in self.loader.loaded_skills.items():
            if skill.get("schema"):
                tools.append(skill["schema"])

        # 4. Prepare parameters for function_calling
        # Filter out system-role messages from history (Anthropic doesn't allow them in messages array)
        raw_messages = self.context.get_long_term_context()
        system_context_parts = []
        messages = []
        for msg in raw_messages:
            if msg.get("role") == "system":
                system_context_parts.append(msg.get("content", ""))
            else:
                messages.append(msg)

        model = getattr(self.config.llm, "default_model", "meta-llama/llama-3.3-70b-instruct:free")
        
        provider = "openrouter"
        if "deepseek" in model.lower():
            provider = "deepseek"
        
        # Enforce strict SOP for the agent 
        sop_prompt = (
            "You are an elite, autonomous Senior CLI Agent.\n"
            "THE GOLDEN RULE OF HONESTY: NEVER say you created, saved, moved, installed, or edited a file unless you have specifically called a tool to do so AND that tool returned a success message. DO NOT simulate execution.\n"
            "You MUST strictly follow this execution pipeline for every request:\n"
            "1. READ: Use `list_files` and `read_file` to understand the user's current project structure. If the project doesn't exist, prepare to build it from scratch.\n"
            "2. THINK & PLAN: Analyze the requirements and mentally plan the architecture.\n"
            "3. CODE: Use `write_file` (for new files) or `edit_file` (for existing files) to implement the plan.\n"
            "4. REVIEW: Review your own code carefully. Fix any obvious errors immediately using `edit_file`.\n"
            "5. TEST: Use `exec_command` to run tests, linters, or compile the code (e.g. `npm run build`, `python -m pytest`, `node script.js`). If tests fail, YOU MUST FIX THEM and run tests again.\n"
            "6. DELIVER: Only when the code is written, reviewed, and tests pass, deliver the final summary to the user.\n\n"
            "MISSION PANEL FORMAT:\n"
            "You MUST discard conversational filler (e.g., 'Estou pensando', 'Beleza!'). "
            "Your final text response MUST strictly use this exact format:\n\n"
            "[Goal]\n(Brief 1 sentence objective)\n\n"
            "[Understanding]\n- (Bullet points about current architecture and constraints)\n\n"
            "[Plan]\n1. (Step 1)\n2. (Step 2)\n\n"
            "[Actions]\n- (Summarize tool calls made, e.g., 'Read src/auth.ts', 'Patched middleware.ts')\n\n"
        )
        
        fc_params = {
            "messages": messages,
            "tools": tools,
            "provider": provider,
            "model": model,
            "max_rounds": max_steps,
            "system_prompt": (sop_prompt + "\n".join(system_context_parts)) if system_context_parts else sop_prompt
        }

        # Tool executor — skills are declarative-only (no executable modules),
        # so all execution goes through the registry.
        async def combined_executor(tool_name: str, args: dict) -> Any:
            if tool_name in self.loader.loaded_skills:
                skill = self.loader.loaded_skills[tool_name]
                if skill.get("module") is not None and hasattr(skill["module"], "run"):
                    # Legacy skill with executable module (pre-installed, trusted)
                    run_func = skill["module"].run
                    try:
                        return await run_func(args, self.registry)
                    except Exception as e:
                        return {"error": f"Skill execution failed: {str(e)}"}
                else:
                    # Declarative skill — no executable code
                    return {"error": f"Skill '{tool_name}' is declarative-only and cannot be directly executed as a tool."}
            else:
                # Core tool from registry
                try:
                    return await self.registry.execute(tool_name, args)
                except Exception as e:
                    return {"error": f"Tool execution failed: {str(e)}"}

        fc_params["tool_executor"] = combined_executor

        # 5. Execute the Observe-Think-Act loop via function_calling
        try:
            fc_result = await function_calling_run(fc_params)
        except Exception as e:
            logger.exception("Function calling loop failed ungracefully.")
            return {"error": f"Loop failed: {str(e)}"}

        tool_calls = fc_result.get("tool_calls", [])
        final_response = fc_result.get("response", str(fc_result))

        # 5.5. Autoreviewer Guardrail: Second Pass Execution
        # If the Coder modified files, explicitly invoke a Senior Review pass to catch duplicated logic and bugs.
        modified_files = any(tc.get("name") in ["write_file", "edit_file", "patch_file"] for tc in tool_calls)
        import os
        import sys
        if modified_files and os.environ.get("AUREX_AUTO_REVIEW", "1") == "1":
            print("\n[agent] 🔍 Code modifications detected. Running automated Reviewer pass...", file=sys.stderr)
            reviewer_prompt = (
                "You are an elite Senior Code Reviewer evaluating the previous modifications. "
                "Critically analyze the code changes. Look for: "
                "1. Architectural flaws or omitted requirements. "
                "2. Potential bugs, edge cases, and performance/UX issues. "
                "3. Duplicated logic or placeholder comments (e.g. '// rest of code').\n"
                "If you find issues, explicitly use the `edit_file` tool to patch them immediately. "
                "If no changes are necessary and the code is perfect, just say 'LGTM' (Looks Good To Me)."
            )
            
            messages.append({"role": "assistant", "content": final_response})
            messages.append({"role": "user", "content": reviewer_prompt})
            
            review_params = fc_params.copy()
            review_params["messages"] = messages
            review_params["system_prompt"] = reviewer_prompt
            review_params["max_rounds"] = 5  # Give it a few rounds to apply patches
            
            try:
                review_result = await function_calling_run(review_params)
                review_response = review_result.get("response", "")
                final_response += "\n\n### 🔍 Automated Code Review\n" + review_response
                tool_calls.extend(review_result.get("tool_calls", []))
            except Exception as e:
                logger.error(f"Reviewer pass failed: {e}")
                final_response += f"\n\n### 🔍 Automated Code Review\nFailed to complete review: {e}"

        # 6. Update context with final overarching result
        await self.context.add_to_long_term({"role": "assistant", "content": final_response})

        return {
            "status": "success",
            "output": final_response,
            "tool_calls": fc_result.get("tool_calls", []),
            "rounds": fc_result.get("rounds", 0)
        }
