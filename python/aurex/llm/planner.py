"""Task planning with LLM - decomposes complex tasks into executable steps."""

from aurex.llm.router import OpenRouterClient
from aurex.llm.prompts import PLANNER_PROMPT


class TaskPlanner:
    def __init__(self, llm: OpenRouterClient):
        self.llm = llm

    async def create_plan(self, task: str) -> str:
        # NOTE: OpenRouterClient.chat() already injects a system prompt,
        # so we pass the planner instructions as a user message to avoid
        # conflicting dual system prompts.
        
        import os
        target_model = None
        if os.environ.get("DEEPSEEK_API_KEY"):
            # Natively use deepseek-reasoner as the Senior Architect
            target_model = "deepseek-reasoner"
            
        response = await self.llm.chat(
            messages=[
                {"role": "user", "content": f"{PLANNER_PROMPT}\n\nCreate a plan for: {task}"},
            ],
            model=target_model,
        )
        return response
