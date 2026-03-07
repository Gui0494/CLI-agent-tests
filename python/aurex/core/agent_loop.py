"""
Agent Loop: The central orchestrator.
Flow: User Input -> Context update -> Planner -> Output/Skill Selection -> Context update.
"""

import logging
from typing import Dict, Any, Optional

from aurex.config.loader import AurexConfig
from aurex.core.planner import PlannerFacade
from aurex.core.context_manager import ContextManager
from aurex.core.tool_registry import ToolRegistry
from aurex.core.skill_loader import SkillLoader

logger = logging.getLogger(__name__)

class AgentLoop:
    def __init__(self, config: AurexConfig, planner: PlannerFacade, context_manager: ContextManager, 
                 tool_registry: ToolRegistry, skill_loader: SkillLoader):
        self.config = config
        self.planner = planner
        self.context = context_manager
        self.registry = tool_registry
        self.loader = skill_loader
        
        # Load skills on initialization
        self.loader.load_all_skills()

    async def run(self, user_input: str, max_steps: int = 10) -> Dict[str, Any]:
        """
        Executes a multi-step turn of the agent loop.
        """
        # 1. Update long-term memory with user input
        await self.context.add_to_long_term({"role": "user", "content": user_input})
        
        # 2. Clear short-term trace for this new task
        self.context.clear_short_term()
        self.context.add_execution_step({"action": "started", "input": user_input})

        step_count = 0
        final_result = None

        while step_count < max_steps:
            step_count += 1
            try:
                # 3. Ask planner to decide what to do
                available_skills = self.loader.loaded_skills
                current_ctx = self.context.get_full_context()
                
                self.context.add_execution_step({"action": "planning", "step": step_count})
                decision = await self.planner.decide_next_action(user_input, available_skills, current_ctx)
                
                self.context.add_execution_step({"action": "planned", "decision": decision})

                # 4. Execute decision
                action_type = decision.get("action")
                
                if action_type == "use_skill":
                    skill_name = decision.get("skill_name")
                    params = decision.get("params", {})
                    
                    skill = self.loader.get_skill(skill_name)
                    if not skill:
                        result = {"error": f"Planner chose unknown skill: {skill_name}"}
                    else:
                        self.context.add_execution_step({"action": "executing_skill", "skill": skill_name, "params": params})
                        
                        try:
                            # Pass the registry to the skill so it can call tools safely
                            run_func = skill["module"].run
                            skill_result = await run_func(params, self.registry)
                            result = {"status": "success", "skill_used": skill_name, "output": skill_result}
                        except Exception as e:
                            logger.exception(f"Error running skill {skill_name}")
                            result = {"error": f"Skill execution failed: {str(e)}"}
                            
                    # Add result to trace and allow looping to observe
                    self.context.add_execution_step({"action": "skill_completed", "result": result})
                    
                elif action_type == "general_subtask" or action_type == "reply":
                    text_response = decision.get("text", decision.get("reasoning", "Task concluded."))
                    final_result = {"status": "success", "output": text_response}
                    self.context.add_execution_step({"action": "completed", "result": final_result})
                    break
                else:
                    final_result = {"error": f"Unknown action type: {action_type}"}
                    self.context.add_execution_step({"action": "failed", "error": final_result["error"]})
                    break

            except Exception as e:
                logger.exception("Agent loop step failed ungracefully.")
                final_result = {"error": f"Agent loop failed at step {step_count}: {str(e)}"}
                self.context.add_execution_step({"action": "failed", "error": str(e)})
                break

        if final_result is None:
            final_result = {"error": f"Agent exceeded max iterations ({max_steps}) without a final reply."}
            self.context.add_execution_step({"action": "max_steps_reached"})

        # 5. Update context with final overarching result
        await self.context.add_to_long_term({"role": "assistant", "content": str(final_result.get("output", final_result))})

        return final_result
