"""
Skill Loader: Dynamically loads and validates skills from the `skills/` directory.
"""

import os
import yaml
import importlib.util
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class SkillLoader:
    def __init__(self, skills_dir: str, tool_registry):
        self.skills_dir = skills_dir
        self.tool_registry = tool_registry
        self.loaded_skills: Dict[str, Dict[str, Any]] = {}

    def load_all_skills(self) -> Dict[str, Dict[str, Any]]:
        """Scans the skills directory, validates schemas, and loads run modules."""
        if not os.path.exists(self.skills_dir):
            logger.warning(f"Skills directory {self.skills_dir} does not exist.")
            return {}

        for entry in os.listdir(self.skills_dir):
            skill_path = os.path.join(self.skills_dir, entry)
            if os.path.isdir(skill_path):
                self._load_skill(entry, skill_path)

        return self.loaded_skills

    def _load_skill(self, folder_name: str, skill_path: str):
        yaml_path = os.path.join(skill_path, "skill.yaml")
        run_path = os.path.join(skill_path, "run.py")

        if not os.path.exists(yaml_path):
            logger.debug(f"Skipping {folder_name}: Missing skill.yaml")
            return

        if not os.path.exists(run_path):
            logger.error(f"Failed to load {folder_name}: Missing run.py")
            return

        # 1. Validate Schema
        try:
            with open(yaml_path, 'r', encoding='utf-8') as f:
                schema = yaml.safe_load(f)
        except Exception as e:
            logger.error(f"Failed to parse skill.yaml for {folder_name}: {e}")
            return

        if not self._validate_schema(folder_name, schema):
            return

        # 2. Validate declared tools exist in registry
        declared_tools = schema.get("tools", [])
        for tool_name in declared_tools:
            if not self.tool_registry.get_tool_metadata(tool_name):
                logger.error(f"Skill '{folder_name}' requests tool '{tool_name}' which is not in ToolRegistry.")
                return

        # 3. Import run.py
        try:
            spec = importlib.util.spec_from_file_location(f"skills.{folder_name}.run", run_path)
            if spec is None or spec.loader is None:
                logger.error(f"Failed to create module spec for {folder_name}")
                return
            
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            if not hasattr(module, 'run'):
                logger.error(f"Skill '{folder_name}' run.py missing 'run' function.")
                return
                
            self.loaded_skills[schema['name']] = {
                "schema": schema,
                "module": module,
                "folder_path": skill_path
            }
            logger.info(f"Successfully loaded skill: {schema['name']}")
        except Exception as e:
            logger.exception(f"Failed to load run.py for skill {folder_name}: {e}")

    def _validate_schema(self, folder_name: str, schema: Any) -> bool:
        required_keys = ["name", "description", "tools", "inputs", "outputs"]
        if not isinstance(schema, dict):
            logger.error(f"Skill {folder_name} schema must be a dictionary.")
            return False
            
        for key in required_keys:
            if key not in schema:
                logger.error(f"Skill {folder_name} missing required key '{key}' in skill.yaml.")
                return False
                
        if schema['name'] != folder_name:
            logger.warning(f"Skill name '{schema['name']}' does not match folder '{folder_name}'")
            
        return True

    def get_skill(self, name: str) -> Optional[Dict[str, Any]]:
        return self.loaded_skills.get(name)
