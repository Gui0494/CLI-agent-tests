"""
Tests for VerificationPipeline — snapshot, restore, error injection.
"""

import os
import tempfile
import pytest
from unittest.mock import AsyncMock

from aurex.core.verification import VerificationPipeline, VerificationResult, StageResult, Snapshot


@pytest.fixture
def tmp_workspace(tmp_path):
    """Create a temp workspace with some files."""
    f1 = tmp_path / "src" / "index.ts"
    f1.parent.mkdir(parents=True)
    f1.write_text("const x = 1;\n")

    f2 = tmp_path / "src" / "utils.ts"
    f2.write_text("export function add(a: number, b: number) { return a + b; }\n")

    return tmp_path


@pytest.fixture
def mock_call_client():
    return AsyncMock()


class TestSnapshot:
    def test_create_snapshot(self, tmp_workspace, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        files = [
            str(tmp_workspace / "src" / "index.ts"),
            str(tmp_workspace / "src" / "utils.ts"),
        ]
        snapshot = pipeline.create_snapshot(files)
        assert snapshot.file_count == 2
        assert snapshot.timestamp > 0

    def test_snapshot_nonexistent_file(self, tmp_workspace, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        files = [str(tmp_workspace / "does_not_exist.ts")]
        snapshot = pipeline.create_snapshot(files)
        # Non-existent files are stored as empty bytes (for deletion on restore)
        assert snapshot.file_count == 1
        assert snapshot.files[os.path.abspath(str(tmp_workspace / "does_not_exist.ts"))] == b""

    def test_restore_snapshot(self, tmp_workspace, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        index_path = str(tmp_workspace / "src" / "index.ts")
        files = [index_path]

        # Snapshot original
        snapshot = pipeline.create_snapshot(files)

        # Modify the file
        with open(index_path, "w") as f:
            f.write("CORRUPTED CONTENT")

        # Restore
        restored = pipeline.restore_snapshot(snapshot)
        assert len(restored) == 1

        # Verify restored content
        with open(index_path) as f:
            assert f.read() == "const x = 1;\n"

    def test_restore_deletes_new_file(self, tmp_workspace, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        new_path = str(tmp_workspace / "src" / "new_file.ts")

        # Snapshot before file exists
        snapshot = pipeline.create_snapshot([new_path])

        # Create the file
        with open(new_path, "w") as f:
            f.write("should be deleted")

        # Restore should delete it
        pipeline.restore_snapshot(snapshot)
        assert not os.path.exists(new_path)


class TestVerify:
    @pytest.mark.asyncio
    async def test_verify_success(self, mock_call_client):
        mock_call_client.return_value = {
            "stages": [
                {"stage": "test", "passed": True, "errors": [], "warnings": [], "durationMs": 100},
                {"stage": "lint", "passed": True, "errors": [], "warnings": [], "durationMs": 50},
            ]
        }
        pipeline = VerificationPipeline(call_client=mock_call_client)
        result = await pipeline.verify()
        assert result.passed is True
        assert len(result.stages) == 2

    @pytest.mark.asyncio
    async def test_verify_failure(self, mock_call_client):
        mock_call_client.return_value = {
            "stages": [
                {"stage": "typecheck", "passed": False, "errors": ["TS2322: Type 'string' is not assignable to type 'number'"], "warnings": [], "durationMs": 200},
            ]
        }
        pipeline = VerificationPipeline(call_client=mock_call_client)
        result = await pipeline.verify()
        assert result.passed is False
        assert len(result.errors) == 1
        assert "TS2322" in result.errors[0]

    @pytest.mark.asyncio
    async def test_verify_rpc_error(self, mock_call_client):
        mock_call_client.side_effect = Exception("Connection lost")
        pipeline = VerificationPipeline(call_client=mock_call_client)
        result = await pipeline.verify()
        assert result.passed is False
        assert "Connection lost" in result.errors[0]


class TestErrorInjection:
    def test_build_error_prompt(self, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        result = VerificationResult(
            passed=False,
            stages=[
                StageResult(stage="typecheck", passed=False, errors=["TS2322: Type error at line 5"]),
                StageResult(stage="lint", passed=True, errors=[]),
            ],
            errors=["TS2322: Type error at line 5"],
        )
        prompt = pipeline.build_error_injection_prompt(result, attempt=1)
        assert "attempt 1/3" in prompt
        assert "TYPECHECK" in prompt
        assert "TS2322" in prompt
        assert "Fix ALL errors" in prompt


class TestExtractModifiedFiles:
    def test_extract_from_tool_calls(self, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        tool_calls = [
            {"name": "read_file", "args": {"path": "foo.ts"}},
            {"name": "write_file", "args": {"path": "bar.ts"}},
            {"name": "edit_file", "args": {"path": "baz.ts"}},
            {"name": "exec_command", "args": {"cmd": "npm test"}},
        ]
        files = pipeline.extract_modified_files(tool_calls)
        assert set(files) == {"bar.ts", "baz.ts"}

    def test_extract_empty(self, mock_call_client):
        pipeline = VerificationPipeline(call_client=mock_call_client)
        assert pipeline.extract_modified_files([]) == []


class TestBackupToDisk:
    def test_save_and_manifest(self, tmp_workspace, mock_call_client):
        pipeline = VerificationPipeline(
            call_client=mock_call_client,
            backup_dir=str(tmp_workspace / "backups"),
        )
        files = [str(tmp_workspace / "src" / "index.ts")]
        snapshot = pipeline.create_snapshot(files)
        backup_path = pipeline.save_backup_to_disk(snapshot, "test")

        assert os.path.exists(backup_path)
        assert os.path.exists(os.path.join(backup_path, "manifest.json"))
