"""
Planner Facade: Acts as the orchestrator decision-maker.
It uses the existing llm/planner.py as its reasoning engine but adds logic to select skills.
"""

from typing import Dict, Any, List
from aurex.config.loader import AurexConfig
# Import the existing LLM planner as the backend reasoning engine
from aurex.llm.planner import TaskPlanner as LLMPlanner
from aurex.llm.router import OpenRouterClient

class PlannerFacade:
    def __init__(self, llm_client: OpenRouterClient, config: AurexConfig):
        self.llm_planner = LLMPlanner(llm=llm_client)
        self.config = config

    async def decide_next_action(self, user_input: str, available_skills: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Determines the next action based on the user input, current context, and available skills.
        Instead of just returning a text plan, it attempts to return a structured action.
        """
        # Create a combined prompt that includes available skills
        skills_summary = "\\n".join(
            [f"- {name}: {s['schema'].get('description', '')}" for name, s in available_skills.items()]
        )
        
        prompt = (
            f"User input: '{user_input}'\\n\\n"
            f"Available Skills:\\n{skills_summary}\\n\\n"
            f"Based on the input, decide if a specific skill should be used, or if a general subtask should be created.\\n"
            f"Respond strictly in JSON format: {{\"action\": \"use_skill|general_subtask|reply\", \"skill_name\": \"...\", \"params\": {{...}}, \"reasoning\": \"...\"}}"
        )

        # We use the underlying router client to get a structured response
        response = await self.llm_planner.llm.chat(
            messages=[
                {"role": "system", "content": "You are a task routing planner. Always reply in valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            model=getattr(self.config.llm, 'plan_model', None)
        )
        
        # Parse the JSON response
        import json
        try:
            # Strip potential markdown formatting
            clean_json = response.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
                
            decision = json.loads(clean_json.strip())
            return decision
        except Exception as e:
            # Fallback if the LLM fails to return valid JSON
            return {
                "action": "reply",
                "reasoning": f"Failed to parse LLM planner response: {e}. Raw response: {response}",
                "text": response
            }
