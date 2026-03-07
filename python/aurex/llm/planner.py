"""Task planning with LLM - decomposes complex tasks into executable steps."""

from aurex.llm.router import OpenRouterClient
from aurex.llm.prompts import PLANNER_PROMPT


class TaskPlanner:
    def __init__(self, llm: OpenRouterClient):
        self.llm = llm

    async def create_plan(self, task: str) -> str:
        response = await self.llm.chat(
            messages=[
                {"role": "system", "content": PLANNER_PROMPT},
                {"role": "user", "content": f"Create a plan for: {task}"},
            ],
            temperature=0.5,
        )
        return response
