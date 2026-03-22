"""Tests for the prompt loader (Finding 1 — externalized SOP prompt)."""

import os
import pytest
from aurex.prompts import load_prompt, _FALLBACK_SOP


class TestLoadPrompt:
    def test_loads_sop_prompt(self):
        result = load_prompt("sop")
        assert "GOLDEN RULE" in result
        assert "execution pipeline" in result
        assert len(result) > 100

    def test_sop_prompt_contains_all_steps(self):
        result = load_prompt("sop")
        for step in ["READ", "THINK", "CODE", "REVIEW", "TEST", "DELIVER"]:
            assert step in result, f"SOP prompt missing step: {step}"

    def test_fallback_on_missing_prompt(self):
        result = load_prompt("nonexistent_prompt_xyz")
        assert "not found" in result

    def test_sop_fallback_on_missing_file(self, tmp_path, monkeypatch):
        """If sop.md is missing, should return fallback string."""
        monkeypatch.setattr("aurex.prompts._PROMPTS_DIR", str(tmp_path))
        result = load_prompt("sop")
        assert result == _FALLBACK_SOP
        assert "autonomous CLI Agent" in result

    def test_non_sop_fallback_message(self, tmp_path, monkeypatch):
        monkeypatch.setattr("aurex.prompts._PROMPTS_DIR", str(tmp_path))
        result = load_prompt("custom")
        assert "not found" in result

    def test_loads_custom_prompt_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr("aurex.prompts._PROMPTS_DIR", str(tmp_path))
        custom = tmp_path / "test.md"
        custom.write_text("Custom prompt content here")
        result = load_prompt("test")
        assert result == "Custom prompt content here"
