"""Tests for destructive tool checkpoints (Finding 4)."""

import os
import pytest
from aurex.core.verification import VerificationPipeline, Snapshot


class TestCheckpointSnapshot:
    def test_snapshot_captures_file_content(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("original content")

        pipeline = VerificationPipeline(call_client=None)
        snapshot = pipeline.create_snapshot([str(f)])

        assert str(f) in snapshot.files
        assert snapshot.files[str(f)] == b"original content"

    def test_restore_snapshot_reverts_changes(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("original content")

        pipeline = VerificationPipeline(call_client=None)
        snapshot = pipeline.create_snapshot([str(f)])

        # Modify the file
        f.write_text("modified content")
        assert f.read_text() == "modified content"

        # Restore
        restored = pipeline.restore_snapshot(snapshot)
        assert len(restored) == 1
        assert f.read_text() == "original content"

    def test_snapshot_new_file_deletes_on_restore(self, tmp_path):
        f = tmp_path / "new_file.txt"
        # File does not exist yet

        pipeline = VerificationPipeline(call_client=None)
        snapshot = pipeline.create_snapshot([str(f)])

        # File was "created" after snapshot
        f.write_text("new content")
        assert f.exists()

        # Restore should delete it (it didn't exist before)
        pipeline.restore_snapshot(snapshot)
        assert not f.exists()

    def test_snapshot_multiple_files(self, tmp_path):
        f1 = tmp_path / "a.txt"
        f2 = tmp_path / "b.txt"
        f1.write_text("content a")
        f2.write_text("content b")

        pipeline = VerificationPipeline(call_client=None)
        snapshot = pipeline.create_snapshot([str(f1), str(f2)])

        f1.write_text("changed a")
        f2.write_text("changed b")

        pipeline.restore_snapshot(snapshot)
        assert f1.read_text() == "content a"
        assert f2.read_text() == "content b"

    def test_checkpoint_stack_rollback(self, tmp_path):
        """Simulate the checkpoint stack behavior from agent_loop."""
        f = tmp_path / "code.py"
        f.write_text("def hello(): pass")

        pipeline = VerificationPipeline(call_client=None)

        # First checkpoint
        snap1 = pipeline.create_snapshot([str(f)])
        f.write_text("def hello(): return 1")

        # Second checkpoint
        snap2 = pipeline.create_snapshot([str(f)])
        f.write_text("def hello(): return BROKEN")

        # Roll back to snap2
        pipeline.restore_snapshot(snap2)
        assert f.read_text() == "def hello(): return 1"

        # Roll back to snap1
        pipeline.restore_snapshot(snap1)
        assert f.read_text() == "def hello(): pass"
