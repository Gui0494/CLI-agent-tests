"""Configuration loader using Pydantic for validation."""

import os
from pathlib import Path
from typing import Dict, List, Optional, Any
import yaml
from pydantic import BaseModel, Field

class ExecutorConfig(BaseModel):
    timeout_ms: int = Field(default=60000, ge=1000)
    max_retries: int = Field(default=3, ge=0)
    docker_image: str = Field(default="aurex-sandbox:latest")
    memory_limit: str = Field(default="512m")
    cpu_limit: str = Field(default="1.0")

class VerifierConfig(BaseModel):
    auto_detect: bool = Field(default=True)
    pipeline: List[str] = Field(default_factory=lambda: ["unit_tests", "lint", "typecheck", "e2e"])

class SearchConfig(BaseModel):
    cache_ttl_hours: float = Field(default=24)
    max_results: int = Field(default=10, ge=1)
    fallback_chain: List[str] = Field(default_factory=lambda: ["tavily", "serper", "firecrawl"])

class RateLimitConfig(BaseModel):
    max_requests: int = Field(gt=0)
    window_seconds: int = Field(gt=0)

class LLMConfig(BaseModel):
    default_model: str = Field(default="meta-llama/llama-3.3-70b-instruct:free")
    fallback_model: str = Field(default="meta-llama/llama-3.2-3b-instruct:free")
    max_tokens: int = Field(default=4096, ge=1)
    temperature: float = Field(default=0.7, ge=0, le=2)
    memory_turns: int = Field(default=10, ge=1)

class RepoAgentConfig(BaseModel):
    auto_label: bool = Field(default=True)
    pr_template: bool = Field(default=True)
    review_on_push: bool = Field(default=False)

class AurexConfig(BaseModel):
    executor: ExecutorConfig = Field(default_factory=ExecutorConfig)
    verifier: VerifierConfig = Field(default_factory=VerifierConfig)
    search: SearchConfig = Field(default_factory=SearchConfig)
    rate_limits: Dict[str, RateLimitConfig] = Field(default_factory=lambda: {
        "tavily": RateLimitConfig(max_requests=33, window_seconds=86400),
        "jina": RateLimitConfig(max_requests=200, window_seconds=86400),
        "serper": RateLimitConfig(max_requests=3, window_seconds=86400),
        "openrouter": RateLimitConfig(max_requests=50, window_seconds=86400),
        "deepseek": RateLimitConfig(max_requests=1000, window_seconds=86400),
        "github": RateLimitConfig(max_requests=5000, window_seconds=3600),
        "firecrawl": RateLimitConfig(max_requests=500, window_seconds=999999999),
    })
    llm: LLMConfig = Field(default_factory=LLMConfig)
    repo_agent: RepoAgentConfig = Field(default_factory=RepoAgentConfig)

_cached_config: Optional[AurexConfig] = None

def load_config(config_path: Optional[str | Path] = None) -> AurexConfig:
    """Load configuration from config.yaml, environment variables, and defaults."""
    global _cached_config
    if _cached_config is not None and config_path is None:
        return _cached_config

    if config_path is None:
        # Default to project root (relative to this file: aurex/config/loader.py -> ../../../config.yaml)
        root_dir = Path(__file__).resolve().parent.parent.parent.parent
        config_path = root_dir / "config.yaml"
    else:
        config_path = Path(config_path)

    config_data: dict[str, Any] = {}

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                parsed = yaml.safe_load(f)
                if isinstance(parsed, dict):
                    config_data = parsed
        except Exception as e:
            import sys
            print(f"[config] Failed to parse {config_path}: {e}", file=sys.stderr)

    # Fallback env var overrides
    _apply_env_overrides(config_data)

    try:
        _cached_config = AurexConfig(**config_data)
    except Exception as e:
        import sys
        print(f"[config] Validation error: {e}", file=sys.stderr)
        _cached_config = AurexConfig()  # Safe defaults
        
    # Check mandatory LLM credentials before returning (skip if testing)
    if "PYTEST_CURRENT_TEST" not in os.environ:
        if not os.environ.get("OPENROUTER_API_KEY") and not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("DEEPSEEK_API_KEY"):
            import sys
            print("\n[CRITICAL] Missing OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or DEEPSEEK_API_KEY in environment. LLM modules will fail.", file=sys.stderr)
            sys.exit(1)

    return _cached_config

def _apply_env_overrides(config_data: dict[str, Any]) -> None:
    prefix = "AUREX_"
    for key, value in os.environ.items():
        if not key.startswith(prefix) or not value:
            continue
            
        parts = key[len(prefix):].split("_")
        if len(parts) < 2:
            continue
            
        section = parts[0].lower()
        if section in ["executor", "verifier", "search", "llm", "repo_agent"]:
            field = "_".join(parts[1:]).lower()
            
            if section not in config_data:
                config_data[section] = {}
                
            try:
                # Try to cast properly
                if value.lower() == "true":
                    config_data[section][field] = True
                elif value.lower() == "false":
                    config_data[section][field] = False
                elif value.isdigit():
                    config_data[section][field] = int(value)
                else:
                    try:
                        config_data[section][field] = float(value)
                    except ValueError:
                        config_data[section][field] = value
            except Exception:
                config_data[section][field] = value

def get_config() -> AurexConfig:
    return load_config()
