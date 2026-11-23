"""Best-effort command sandbox: fixed workspace, allowlisted executables,
no shell, hard timeout, capped output.

Honest scope: this is a guard rail, not a security boundary. Commands run as
the current user with the app's own privileges, and an allowlisted interpreter
(python, node) can still do anything that user can. The README says the same
thing out loud - keep it that way.
"""
from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

# All commands run here; created on demand. Inside backend/data/ (git-ignored)
# so workspace files never end up in the repo.
WORKSPACE = Path(__file__).resolve().parent / "data" / "workspace"

# Real executables only (.exe) - deliberately no npm/cmd/powershell, which are
# .cmd wrappers whose argument re-parsing we cannot control.
ALLOWED_COMMANDS = ("python", "py", "node", "git")

RUN_TIMEOUT = 30  # seconds; the child is killed when it expires
MAX_ARGS = 50
MAX_ARG_CHARS = 2_000
MAX_OUTPUT_CHARS = 50_000  # per stream, beyond this the output is truncated


class SandboxError(ValueError):
    """Rejected before anything ran; the message is shown to the user."""


def _normalize(command: str) -> str:
    name = (command or "").strip().lower()
    if name.endswith(".exe"):
        name = name[:-4]
    return name


def validate(command: str, args: list | None) -> tuple[str, list[str]]:
    """Allowlist check + argument hygiene. Raises SandboxError on rejection."""
    name = _normalize(command)
    if name not in ALLOWED_COMMANDS:
        raise SandboxError(
            f"'{(command or '').strip()}' is not allowed here. "
            f"Allowed commands: {', '.join(ALLOWED_COMMANDS)}."
        )
    if shutil.which(name) is None:
        raise SandboxError(f"'{name}' is not installed on this machine.")
    out: list[str] = []
    for arg in args or []:
        if not isinstance(arg, str):
            raise SandboxError("Arguments must be text.")
        if len(arg) > MAX_ARG_CHARS:
            raise SandboxError("An argument is too long.")
        if "\x00" in arg:
            raise SandboxError("Arguments may not contain null bytes.")
        # Workspace confinement: relative paths may not climb out. Absolute
        # paths are left alone only because the README already states this is
        # best-effort - but '..' is the classic accident, so it is blocked.
        if any(part == ".." for part in arg.replace("\\", "/").split("/")):
            raise SandboxError("Arguments may not contain '..'.")
        out.append(arg)
    if len(out) > MAX_ARGS:
        raise SandboxError(f"Too many arguments (max {MAX_ARGS}).")
    return name, out


def format_cmdline(name: str, args: list[str]) -> str:
    """Human-readable command line for the approval card (display only)."""
    parts = [name] + [f'"{a}"' if (" " in a or "\t" in a) else a for a in args]
    return " ".join(parts)


def run(command: str, args: list | None) -> dict:
    """Execute an allowlisted command inside the workspace and capture it."""
    name, argv = validate(command, args)
    exe = shutil.which(name)
    WORKSPACE.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()
    try:
        proc = subprocess.run(
            [exe, *argv],
            cwd=str(WORKSPACE),
            capture_output=True,
            timeout=RUN_TIMEOUT,
            shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "cmdline": format_cmdline(name, argv),
            "cwd": str(WORKSPACE),
            "error": f"Timed out after {RUN_TIMEOUT}s and was killed.",
        }
    except OSError as exc:
        return {
            "ok": False,
            "cmdline": format_cmdline(name, argv),
            "cwd": str(WORKSPACE),
            "error": f"Could not start '{name}': {exc}",
        }

    duration_ms = int((time.monotonic() - started) * 1000)
    stdout = proc.stdout.decode("utf-8", errors="replace")
    stderr = proc.stderr.decode("utf-8", errors="replace")
    truncated = False
    if len(stdout) > MAX_OUTPUT_CHARS:
        stdout = stdout[:MAX_OUTPUT_CHARS] + "\n… output truncated"
        truncated = True
    if len(stderr) > MAX_OUTPUT_CHARS:
        stderr = stderr[:MAX_OUTPUT_CHARS] + "\n… output truncated"
        truncated = True
    return {
        "ok": True,
        "cmdline": format_cmdline(name, argv),
        "cwd": str(WORKSPACE),
        "exit_code": proc.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "duration_ms": duration_ms,
        "truncated": truncated,
    }
