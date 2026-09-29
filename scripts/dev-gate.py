#!/usr/bin/env python3
"""Development loop gate for ts-sample-order, run as hooks of the `order-dev` agent.

`.kiro/agents/order-dev.json` wires it up, so it only runs in chats that use that agent:

    preToolUse  (matcher execute_bash)                    dev-gate.py pre
    postToolUse (matcher @kirocrew-core/spawn_sub_agents)  dev-gate.py post

pre   Before a shell command that commits, pushes or opens a PR:
        - on main: refuse, work on a feature/* branch
        - `npm run verify` must pass for the current code (cached per code state)
        - `gh pr create` also needs an `order-reviewer` review of the current code
          with verdict APPROVE, or 2 review rounds already done
      A refusal exits 2; kiro-cli hands stderr to the model, which fixes the code
      and tries again. That retry is the loop.
post  After a blocking `order-reviewer` run, records the reviewed code state and
      the verdict, so the review evidence comes from the tool call, not from the
      agent's own claim.

Limit: after MAX_FAILS verify failures in a row the gate tells the agent to stop
and hand over to a human. State and the event log live in <checkout>/.tmp/dev-loop/
(git-ignored); delete that folder to reset.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MAX_FAILS = 5
MAX_REVIEW_ROUNDS = 2
VERIFY_TIMEOUT = 240
PREFIX = "[개발 loop gate]"
REVIEWER = "order-reviewer"

# A git/gh invocation inside a shell command line: `git ... commit`, `git ... push`, `gh pr create`.
_SEG = r"(?:^|[;&|(]\s*|\s)"
RE_COMMIT = re.compile(_SEG + r"git\s+(?:-\S+\s+(?:\S+\s+)?)*commit\b")
RE_PUSH = re.compile(_SEG + r"git\s+(?:-\S+\s+(?:\S+\s+)?)*push\b")
RE_PR = re.compile(_SEG + r"gh\s+pr\s+create\b")


# ── helpers ──────────────────────────────────────────────────────────────────


def _env() -> dict:
    env = dict(os.environ)
    home = Path.home()
    extra = [home / ".local/share/mise/installs/node/24/bin", Path("/opt/homebrew/bin"), Path("/usr/local/bin")]
    env["PATH"] = os.pathsep.join([str(p) for p in extra if p.is_dir()] + [env.get("PATH", "/usr/bin:/bin")])
    return env


def _run(args: list, cwd: Path, timeout: int = 30, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                          env=env or _env(), check=False)


def _toplevel(path: str) -> Path | None:
    if not path or not Path(path).is_dir():
        return None
    out = _run(["git", "rev-parse", "--show-toplevel"], Path(path))
    top = Path(out.stdout.strip()) if out.returncode == 0 else None
    # Only this repository (or one of its worktrees): it carries this script.
    return top if top and (top / "scripts" / "dev-gate.py").exists() else None


def _tree(repo: Path) -> str:
    """Content hash of the working tree (tracked + untracked, .gitignore respected).

    Stable across commits: the same code gives the same hash before and after `git commit`.
    """
    with tempfile.TemporaryDirectory() as tmp:
        env = _env()
        env["GIT_INDEX_FILE"] = str(Path(tmp) / "index")
        _run(["git", "read-tree", "HEAD"], repo, env=env)
        _run(["git", "add", "-A"], repo, env=env, timeout=60)
        return _run(["git", "write-tree"], repo, env=env).stdout.strip()


def _verify(repo: Path) -> tuple[bool, str]:
    try:
        out = _run(["npm", "run", "verify"], repo, timeout=VERIFY_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False, f"`npm run verify`가 {VERIFY_TIMEOUT}초 안에 끝나지 않았습니다."
    if out.returncode == 0:
        return True, ""
    lines = (out.stdout + "\n" + out.stderr).splitlines()
    keep = [l for l in lines if re.search(r"error TS|●|FAIL |Expected|Received|Tests:|Error:|expect\(", l)]
    return False, "\n".join((keep or lines)[-40:])[-3000:]


class Store:
    def __init__(self, repo: Path):
        self.dir = repo / ".tmp" / "dev-loop"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = open(self.dir / "lock", "w")
        fcntl.flock(self._lock, fcntl.LOCK_EX)
        path = self.dir / "state.json"
        try:
            self.state = json.loads(path.read_text()) if path.exists() else {}
        except ValueError:
            self.state = {}

    def branch_state(self, branch: str) -> dict:
        if self.state.get("branch") != branch:
            self.state = {"branch": branch, "verified_tree": "", "fails": 0, "reviews": []}
        return self.state

    def save(self) -> None:
        (self.dir / "state.json").write_text(json.dumps(self.state, ensure_ascii=False, indent=2))

    def log(self, kind: str, **fields) -> None:
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "kind": kind, **fields}
        with (self.dir / "events.jsonl").open("a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _refuse(store: Store, kind: str, message: str, **fields) -> None:
    store.log(kind, **fields)
    store.save()
    print(f"{PREFIX} {message}", file=sys.stderr)
    sys.exit(2)


# ── pre: before commit / push / PR ───────────────────────────────────────────


def pre(event: dict) -> None:
    tool_input = event.get("tool_input") or {}
    command = str(tool_input.get("command") or "")
    actions = [name for name, rx in (("commit", RE_COMMIT), ("push", RE_PUSH), ("pr", RE_PR)) if rx.search(command)]
    if not actions:
        return
    repo = _toplevel(str(tool_input.get("working_dir") or event.get("cwd") or ""))
    if not repo:
        return

    branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo).stdout.strip()
    store = Store(repo)
    state = store.branch_state(branch)
    what = "+".join(actions)

    if branch in ("main", "master"):
        _refuse(store, "main_refused", f"`{branch}`에서는 커밋, push, PR을 하지 않습니다. "
                "`git switch -c feature/<짧은 이름>`으로 branch를 만든 뒤 다시 실행하세요.", action=what)

    # 1. verify the code that is about to be committed / pushed / proposed
    tree = _tree(repo)
    if tree != state["verified_tree"]:
        if state["fails"] >= MAX_FAILS:
            _refuse(store, "limit", f"`npm run verify`가 {MAX_FAILS}번 연속 실패했습니다. 더 고치지 말고 멈추세요. "
                    "지금까지 시도한 것과 남은 실패를 사용자에게 보고하고 턴을 끝내세요.", action=what, tree=tree)
        ok, summary = _verify(repo)
        if not ok:
            state["fails"] += 1
            _refuse(store, "verify_failed", f"`{what}` 전에 `npm run verify`를 돌렸는데 실패했습니다 "
                    f"({state['fails']}/{MAX_FAILS}). 아래 실패를 고친 뒤 같은 명령을 다시 실행하세요.\n\n{summary}",
                    action=what, tree=tree, fails=state["fails"])
        state["verified_tree"], state["fails"] = tree, 0
        store.log("verify_passed", action=what, tree=tree)

    # 2. review before the PR
    if "pr" in actions:
        reviews = state["reviews"]
        last = reviews[-1] if reviews else None
        if last and last["tree"] == tree and last["verdict"] == "APPROVE":
            store.log("pr_allowed", rounds=len(reviews), tree=tree)
        elif len(reviews) >= MAX_REVIEW_ROUNDS:
            store.log("pr_allowed_review_cap", rounds=len(reviews), tree=tree)
        else:
            n = len(reviews) + 1
            if not last:
                why = "PR을 열기 전에 읽기 전용 reviewer의 리뷰가 필요합니다."
            elif last["tree"] != tree:
                why = "리뷰 이후 코드가 바뀌었습니다. 바뀐 코드로 리뷰를 한 번 더 받으세요."
            else:
                why = f"지난 리뷰 결과가 {last['verdict']}입니다. 지적을 모두 반영하고 리뷰를 다시 받으세요."
            _refuse(store, "review_required",
                    f"{why} ({n}/{MAX_REVIEW_ROUNDS}회차) 이 턴에서 "
                    f"`spawn_sub_agents(agents=[{{\"agent_or_mode\": \"{REVIEWER}\", \"prompt\": \"이 branch의 변경을 리뷰해\"}}], "
                    f"cwd=\"{repo}\")`를 호출하세요(spawn_run 말고 spawn_sub_agents). 지적은 severity와 상관없이 모두 "
                    "반영하고, 코드를 고쳤으면 커밋한 뒤 `gh pr create`를 다시 실행하세요.",
                    round=n, tree=tree)

    store.log("allowed", action=what, branch=branch)
    store.save()


# ── post: after an order-reviewer run ────────────────────────────────────────


def post(event: dict) -> None:
    tool_input = event.get("tool_input") or {}
    agents = tool_input.get("agents") or []
    if not any(isinstance(a, dict) and a.get("agent_or_mode") == REVIEWER for a in agents):
        return
    repo = _toplevel(str(tool_input.get("cwd") or event.get("cwd") or ""))
    if not repo:
        return
    text = json.dumps(event.get("tool_response"), ensure_ascii=False)
    m = re.search(r"REQUEST_CHANGES|APPROVE", text)
    verdict = m.group(0) if m else "UNKNOWN"

    branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo).stdout.strip()
    store = Store(repo)
    state = store.branch_state(branch)
    tree = _tree(repo)
    state["reviews"].append({"tree": tree, "verdict": verdict, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    store.log("review_recorded", round=len(state["reviews"]), verdict=verdict, tree=tree)
    store.save()


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "pre":
        pre(event)
    elif mode == "post":
        post(event)


if __name__ == "__main__":
    main()
