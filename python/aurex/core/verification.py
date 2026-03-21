"""
Verification Pipeline — Self-healing execution loop.

After the agent modifies files, this pipeline:
1. Creates a snapshot of affected files (for rollback)
2. Runs verification stages (typecheck, lint, test) via Node-side verifier
3. If verification fails, injects real errors into context for the agent to fix
4. After max retries, restores the snapshot and reports failure

Reference: Phase 3.1 — Self-Healing Execution Loop
"""

import os
import shutil
import logging
import time
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable, Awaitable

logger = logging.getLogger(__name__)


@dataclass
class StageResult:
    stage: str
    passed: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    duration_ms: int = 0


@dataclass
class VerificationResult:
    passed: bool
    stages: List[StageResult] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    @property
    def error_summary(self) -> str:
        """Human-readable summary of all errors across stages."""
        lines = []
        for stage in self.stages:
            if not stage.passed:
                lines.append(f"[{stage.stage}] FAILED:")
                for err in stage.errors[:10]:  # cap per stage
                    lines.append(f"  - {err[:500]}")
        return "\n".join(lines)


@dataclass
class Snapshot:
    """Stores original file contents for rollback."""
    files: Dict[str, bytes] = field(default_factory=dict)
    timestamp: float = 0.0

    @property
    def file_count(self) -> int:
        return len(self.files)


class VerificationPipeline:
    """Coordinates verify → fix → retry loop after agent file modifications."""

    def __init__(
        self,
        call_client: Callable[..., Awaitable[Dict[str, Any]]],
        max_retries: int = 3,
        backup_dir: Optional[str] = None,
    ):
        self.call_client = call_client
        self.max_retries = max_retries
        self.backup_dir = backup_dir or os.path.join(os.getcwd(), ".aurex", "backups")

    async def verify(self, stages: Optional[List[str]] = None) -> VerificationResult:
        """Run verification pipeline via Node-side verifier (test-runner.ts)."""
        try:
            result = await self.call_client("run_verification", {
                "stages": stages or ["test", "lint", "typecheck"],
            })
        except Exception as e:
            logger.error(f"Verification RPC failed: {e}")
            return VerificationResult(
                passed=False,
                errors=[f"Verification RPC failed: {str(e)}"],
            )

        stage_results = []
        all_errors = []

        for stage_data in result.get("stages", []):
            sr = StageResult(
                stage=stage_data.get("stage", "unknown"),
                passed=stage_data.get("passed", False),
                errors=stage_data.get("errors", []),
                warnings=stage_data.get("warnings", []),
                duration_ms=stage_data.get("durationMs", 0),
            )
            stage_results.append(sr)
            if not sr.passed:
                all_errors.extend(sr.errors)

        return VerificationResult(
            passed=all(s.passed for s in stage_results),
            stages=stage_results,
            errors=all_errors,
        )

    def create_snapshot(self, file_paths: List[str]) -> Snapshot:
        """Read and store current contents of files for potential rollback."""
        snapshot = Snapshot(timestamp=time.time())
        for fpath in file_paths:
            abs_path = os.path.abspath(fpath)
            try:
                with open(abs_path, "rb") as f:
                    snapshot.files[abs_path] = f.read()
            except FileNotFoundError:
                # File was newly created — mark for deletion on restore
                snapshot.files[abs_path] = b""
            except Exception as e:
                logger.warning(f"Failed to snapshot {abs_path}: {e}")
        return snapshot

    def restore_snapshot(self, snapshot: Snapshot) -> List[str]:
        """Restore files to their snapshotted state. Returns list of restored paths."""
        restored = []
        for abs_path, content in snapshot.files.items():
            try:
                if len(content) == 0:
                    # File didn't exist before — remove it
                    if os.path.exists(abs_path):
                        os.remove(abs_path)
                else:
                    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                    with open(abs_path, "wb") as f:
                        f.write(content)
                restored.append(abs_path)
            except Exception as e:
                logger.error(f"Failed to restore {abs_path}: {e}")
        return restored

    def save_backup_to_disk(self, snapshot: Snapshot, label: str = "auto") -> str:
        """Persist snapshot to .aurex/backups/ for crash recovery."""
        backup_path = os.path.join(self.backup_dir, f"{label}-{int(snapshot.timestamp)}")
        os.makedirs(backup_path, exist_ok=True)

        manifest = {}
        for abs_path, content in snapshot.files.items():
            safe_name = abs_path.replace("/", "__").replace("\\", "__")
            file_backup = os.path.join(backup_path, safe_name)
            with open(file_backup, "wb") as f:
                f.write(content)
            manifest[abs_path] = safe_name

        import json
        with open(os.path.join(backup_path, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=2)

        return backup_path

    def build_error_injection_prompt(self, result: VerificationResult, attempt: int) -> str:
        """Build a prompt that tells the agent exactly what failed so it can fix it."""
        lines = [
            f"## Verification Failed (attempt {attempt}/{self.max_retries})",
            "",
            "The following verification errors were found after your code changes.",
            "You MUST fix these errors. Read the error messages carefully and use edit_file to fix them.",
            "",
        ]

        for stage in result.stages:
            if not stage.passed:
                lines.append(f"### {stage.stage.upper()} — FAILED")
                for err in stage.errors[:15]:
                    lines.append(f"```")
                    lines.append(err[:1000])
                    lines.append(f"```")
                lines.append("")

        lines.append("Fix ALL errors above, then I will re-verify.")
        return "\n".join(lines)

    def extract_modified_files(self, tool_calls: List[Dict[str, Any]]) -> List[str]:
        """Extract file paths from tool calls that modified files."""
        modified = set()
        write_tools = {"write_file", "edit_file", "patch_file"}
        for tc in tool_calls:
            name = tc.get("name", "")
            if name in write_tools:
                args = tc.get("args", tc.get("arguments", {}))
                if isinstance(args, str):
                    import json
                    try:
                        args = json.loads(args)
                    except Exception:
                        continue
                path = args.get("path", "")
                if path:
                    modified.add(path)
        return list(modified)
