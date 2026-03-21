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
from aurex.core.verification import VerificationPipeline

try:
    from aurex.skills.function_calling.run import run as function_calling_run
except ImportError:
    function_calling_run = None

logger = logging.getLogger(__name__)

class AgentLoop:
    def __init__(self, config: AurexConfig, context_manager: ContextManager,
                 tool_registry: ToolRegistry, skill_loader: SkillLoader,
                 call_client=None):
        self.config = config
        self.context = context_manager
        self.registry = tool_registry
        self.loader = skill_loader
        self.call_client = call_client

        # Self-healing verification pipeline
        self.verifier = VerificationPipeline(
            call_client=call_client,
            max_retries=3,
        ) if call_client else None

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
        
        # Load .aurex/rules.md if present (Phase 6.4)
        import os
        rules_content = ""
        rules_path = os.path.join(os.getcwd(), ".aurex", "rules.md")
        if os.path.exists(rules_path):
            try:
                with open(rules_path, "r", encoding="utf-8") as f:
                    rules_content = f.read(10_000)
            except Exception:
                pass

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
            "system_prompt": (
                (f"## Project Rules\n{rules_content}\n\n" if rules_content else "")
                + sop_prompt
                + ("\n".join(system_context_parts) if system_context_parts else "")
            )
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

        # 5.5. Self-Healing Verification Pipeline
        # If files were modified, run real verification (typecheck + lint + test)
        # instead of the old LLM-based auto-reviewer which could corrupt code.
        import os
        import sys
        modified_file_paths = self.verifier.extract_modified_files(tool_calls) if self.verifier else []
        if modified_file_paths and self.verifier and os.environ.get("AUREX_VERIFY", "1") == "1":
            print(f"\n[agent] Verifying {len(modified_file_paths)} modified file(s)...", file=sys.stderr)

            # Snapshot for rollback
            snapshot = self.verifier.create_snapshot(modified_file_paths)

            for attempt in range(1, self.verifier.max_retries + 1):
                verification = await self.verifier.verify()

                if verification.passed:
                    print(f"[agent] Verification passed.", file=sys.stderr)
                    final_response += "\n\n### Verification\nAll checks passed (typecheck, lint, test)."
                    break

                print(f"[agent] Verification failed (attempt {attempt}/{self.verifier.max_retries}).", file=sys.stderr)

                if attempt == self.verifier.max_retries:
                    # Max retries exhausted — rollback
                    print("[agent] Max fix attempts reached. Rolling back changes.", file=sys.stderr)
                    restored = self.verifier.restore_snapshot(snapshot)
                    final_response += (
                        f"\n\n### Verification Failed\n"
                        f"Could not fix errors after {self.verifier.max_retries} attempts. "
                        f"Changes rolled back for {len(restored)} file(s).\n\n"
                        f"Errors:\n{verification.error_summary}"
                    )
                    break

                # Inject real errors into context and re-run the agent loop
                error_prompt = self.verifier.build_error_injection_prompt(verification, attempt)
                messages.append({"role": "assistant", "content": final_response})
                messages.append({"role": "user", "content": error_prompt})

                fix_params = fc_params.copy()
                fix_params["messages"] = messages
                fix_params["max_rounds"] = 5

                try:
                    fix_result = await function_calling_run(fix_params)
                    fix_response = fix_result.get("response", "")
                    final_response += f"\n\n### Fix Attempt {attempt}\n{fix_response}"
                    tool_calls.extend(fix_result.get("tool_calls", []))
                except Exception as e:
                    logger.error(f"Fix attempt {attempt} failed: {e}")
                    final_response += f"\n\n### Fix Attempt {attempt}\nFailed: {e}"
                    break

        # 6. Update context with final overarching result
        await self.context.add_to_long_term({"role": "assistant", "content": final_response})

        return {
            "status": "success",
            "output": final_response,
            "tool_calls": fc_result.get("tool_calls", []),
            "rounds": fc_result.get("rounds", 0)
        }
