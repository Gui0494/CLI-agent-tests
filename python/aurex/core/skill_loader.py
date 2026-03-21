"""
Skill Loader: Loads and validates declarative skill manifests from the `skills/` directory.

SECURITY: Skills are declarative YAML manifests only. No dynamic code execution (run.py)
is loaded at runtime. This prevents LLM-generated or injected code from executing
arbitrary logic in the agent's process.

Skills define: name, description, allowed tools, triggers, and system prompts.
They do NOT contain executable code — they configure the agent's behavior declaratively.
"""

import os
import yaml
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Tools that skills are NEVER allowed to request
SKILL_DENIED_TOOLS = frozenset([
    "create_agent",   # removed — dynamic agent creation is forbidden
    "exec_command",   # shell access must go through permission system, not skills
])

REQUIRED_MANIFEST_KEYS = frozenset(["name", "description", "tools", "inputs", "outputs"])
MAX_SKILL_NAME_LENGTH = 64
SKILL_NAME_PATTERN = r'^[a-z][a-z0-9_-]*$'


class SkillLoader:
    def __init__(self, skills_dir: str, tool_registry):
        self.skills_dir = skills_dir
        self.tool_registry = tool_registry
        self.loaded_skills: Dict[str, Dict[str, Any]] = {}

    def load_all_skills(self) -> Dict[str, Dict[str, Any]]:
        """Scans the skills directory, validates manifests, and registers declarative skills."""
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

        if not os.path.exists(yaml_path):
            logger.debug(f"Skipping {folder_name}: Missing skill.yaml")
            return

        # 1. Parse and validate manifest
        try:
            with open(yaml_path, 'r', encoding='utf-8') as f:
                schema = yaml.safe_load(f)
        except Exception as e:
            logger.error(f"Failed to parse skill.yaml for {folder_name}: {e}")
            return

        if not self._validate_schema(folder_name, schema):
            return

        # 2. Validate declared tools exist in registry and are not denied
        declared_tools = schema.get("tools", [])
        for tool_name in declared_tools:
            if tool_name in SKILL_DENIED_TOOLS:
                logger.error(
                    f"Skill '{folder_name}' requests denied tool '{tool_name}'. "
                    f"Denied tools: {sorted(SKILL_DENIED_TOOLS)}"
                )
                return
            if not self.tool_registry.get_tool_metadata(tool_name):
                logger.error(f"Skill '{folder_name}' requests tool '{tool_name}' which is not in ToolRegistry.")
                return

        # 3. Register as declarative skill (NO code execution)
        # If a run.py exists, log a warning but do NOT import it
        run_path = os.path.join(skill_path, "run.py")
        if os.path.exists(run_path):
            logger.warning(
                f"Skill '{folder_name}' contains run.py which will be IGNORED. "
                f"Dynamic code execution in skills is disabled for security. "
                f"Use declarative manifest configuration only."
            )

        self.loaded_skills[schema['name']] = {
            "schema": schema,
            "module": None,  # No dynamic code — declarative only
            "folder_path": skill_path
        }
        logger.info(f"Successfully loaded declarative skill: {schema['name']}")

    def _validate_schema(self, folder_name: str, schema: Any) -> bool:
        import re

        if not isinstance(schema, dict):
            logger.error(f"Skill {folder_name} schema must be a dictionary.")
            return False

        for key in REQUIRED_MANIFEST_KEYS:
            if key not in schema:
                logger.error(f"Skill {folder_name} missing required key '{key}' in skill.yaml.")
                return False

        # Validate skill name format (prevent path traversal via name)
        name = schema.get('name', '')
        if not isinstance(name, str) or len(name) > MAX_SKILL_NAME_LENGTH:
            logger.error(f"Skill {folder_name}: name must be a string of max {MAX_SKILL_NAME_LENGTH} chars.")
            return False

        if not re.match(SKILL_NAME_PATTERN, name):
            logger.error(
                f"Skill {folder_name}: name '{name}' must match pattern {SKILL_NAME_PATTERN} "
                f"(lowercase alphanumeric, hyphens, underscores)."
            )
            return False

        if schema['name'] != folder_name:
            logger.warning(f"Skill name '{schema['name']}' does not match folder '{folder_name}'")

        # Validate tools is a list of strings
        tools = schema.get('tools', [])
        if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
            logger.error(f"Skill {folder_name}: 'tools' must be a list of strings.")
            return False

        return True

    def get_skill(self, name: str) -> Optional[Dict[str, Any]]:
        return self.loaded_skills.get(name)

    def list_installed(self) -> List[str]:
        """List all installed skill names."""
        return sorted(self.loaded_skills.keys())
