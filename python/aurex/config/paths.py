"""Platform-aware paths for caching and configuration."""

import platform
import os
from pathlib import Path


def get_cache_dir(app_name: str = "aurex") -> Path:
    """Get the platform-specific cache directory."""
    system = platform.system()
    home = Path.home()
    
    if system == "Windows":
        base_dir = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
    elif system == "Darwin":
        base_dir = home / "Library" / "Caches"
    else:  # Linux
        base_dir = Path(os.environ.get("XDG_CACHE_HOME", home / ".cache"))
        
    cache_dir = base_dir / app_name
    
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Fallback to local directory if permissions fail
        cache_dir = Path.cwd() / f".{app_name}"
        cache_dir.mkdir(parents=True, exist_ok=True)
        
    return cache_dir


def get_config_dir(app_name: str = "aurex") -> Path:
    """Get the platform-specific config directory."""
    system = platform.system()
    home = Path.home()
    
    if system == "Windows":
        base_dir = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
    elif system == "Darwin":
        base_dir = home / "Library" / "Application Support"
    else:  # Linux
        base_dir = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
        
    config_dir = base_dir / app_name
    
    try:
        config_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Fallback
        return Path.cwd()
        
    return config_dir
