#!/usr/bin/env python3
"""Kiro Crew Stop hook: the development loop for ts-sample-order.

Registered once on the dashboard Hooks tab (event Stop, empty matcher, timeout 300):

    /usr/bin/python3 <repo>/scripts/dev-loop-hook.py

Every time a chat turn ends, Kiro Crew runs this script with the hook event on
stdin. It stays silent unless the main checkout is on a `feature/*` branch with
changes. Then it decides whether the work is done, and when it is not, it prints
{"decision": "block", "reason": ...}: Kiro Crew injects the reason and the agent
takes another turn without anyone typing.

The loop, in order:
  1. verify   `npm run verify` must pass for the current code (re-run on every change)
  2. review   after the first pass, ask for an `order-reviewer` review; after the
              review's fixes pass verify, ask for one more review (max 2 rounds)
  3. PR       push the branch, open a PR, arm monitor_watch
  4. sync     later fixes must be committed and pushed to the PR
Limit: after MAX_CONTINUATIONS hook-driven turns in a row it stops asking and
records `limit` in the event log, so a stuck loop ends with a human.

Scope: only dashboard chat sessions (not crews, crons or subagents), and only
the first session that works on the branch (the owner). State and the event log
live in <repo>/.tmp/dev-loop/ (git-ignored); delete that folder to reset.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GH_REPO = "dohkimOnAmz/ts-sample-order"
STATE_DIR = REPO / ".tmp" / "dev-loop"
MAX_CONTINUATIONS = 8
VERIFY_TIMEOUT = 240
PREFIX = "[개발 loop]"


# ── shell helpers ────────────────────────────────────────────────────────────


def _env() -> dict:
    env = dict(os.environ)
    home = Path.home()
    extra = [home / ".local/share/mise/installs/node/24/bin", Path("/opt/homebrew/bin"), Path("/usr/local/bin")]
    env["PATH"] = os.pathsep.join([str(p) for p in extra if p.is_dir()] + [env.get("PATH", "/usr/bin:/bin")])
    return env


def _run(args: list, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=timeout, env=_env(), check=False)


def _git(*args: str) -> str:
    return _run(["git", *args]).stdout.strip()


# ── state ────────────────────────────────────────────────────────────────────


def _load_state() -> dict:
    path = STATE_DIR / "state.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except ValueError:
            pass
    return {}


def _save_state(state: dict) -> None:
    (STATE_DIR / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _log(kind: str, **fields) -> None:
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "kind": kind, **fields}
    with (STATE_DIR / "events.jsonl").open("a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _block(state: dict, kind: str, reason: str, **fields) -> None:
    _log(kind, **fields)
    _save_state(state)
    print(json.dumps({"decision": "block", "reason": f"{PREFIX} {reason}"}, ensure_ascii=False))


# ── repository facts ─────────────────────────────────────────────────────────


def _has_changes() -> bool:
    ahead = _git("rev-list", "--count", "origin/main..HEAD")
    return (ahead.isdigit() and int(ahead) > 0) or bool(_git("status", "--porcelain"))


def _fingerprint() -> str:
    h = hashlib.sha256()
    h.update(_git("rev-parse", "HEAD").encode())
    h.update(_run(["git", "diff", "HEAD"]).stdout.encode())
    for name in _git("ls-files", "--others", "--exclude-standard").splitlines():
        h.update(name.encode())
        try:
            h.update((REPO / name).read_bytes())
        except OSError:
            pass
    return h.hexdigest()[:16]


def _verify() -> tuple[bool, str]:
    try:
        out = _run(["npm", "run", "verify"], timeout=VERIFY_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False, f"`npm run verify`가 {VERIFY_TIMEOUT}초 안에 끝나지 않았습니다."
    if out.returncode == 0:
        return True, ""
    lines = (out.stdout + "\n" + out.stderr).splitlines()
    keep = [
        l for l in lines
        if re.search(r"error TS|●|FAIL |Expected|Received|Tests:|Error:|expect\(", l)
    ]
    summary = "\n".join((keep or lines)[-40:])
    return False, summary[-3000:]


def _open_pr(branch: str) -> dict | None:
    out = _run(["gh", "pr", "list", "-R", GH_REPO, "--head", branch, "--state", "open",
                "--json", "number,url,headRefOid"])
    try:
        prs = json.loads(out.stdout or "[]")
    except ValueError:
        return None
    return prs[0] if prs else None


# ── the loop ─────────────────────────────────────────────────────────────────


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    if event.get("hook_event_name") != "Stop" or event.get("subagent_id"):
        return
    session = str(event.get("parent_session_key") or "")
    if not re.match(r"dashboard[:_]", session) or "crew-" in session:
        return  # crews, crons and other channels run their own loops

    branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    if not branch.startswith("feature/"):
        return

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_DIR / "lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = _load_state()
        if state.get("branch") != branch:
            state = {"branch": branch, "owner": "", "verified_fp": "", "fails": 0,
                     "review_rounds": 0, "review_fp": "", "pr": None}
        if state["owner"] and state["owner"] != session:
            return
        if not _has_changes():
            return
        state["owner"] = session

        depth = int(event.get("hook_continuation_count") or 0)
        if depth >= MAX_CONTINUATIONS:
            _log("limit", depth=depth)
            _save_state(state)
            return  # let the turn end; a human takes it from here

        # 1. verify the current code
        fp = _fingerprint()
        if fp != state["verified_fp"]:
            ok, summary = _verify()
            if not ok:
                state["fails"] += 1
                return _block(
                    state, "verify_failed",
                    f"`npm run verify`가 실패했습니다 ({state['fails']}번째). 아래 실패를 고치고 턴을 끝내면 다시 검증합니다.\n\n{summary}",
                    fp=fp, fails=state["fails"],
                )
            state["verified_fp"] = fp
            _log("verify_passed", fp=fp)

        # 2. review before the PR (max 2 rounds)
        if not state["pr"]:
            if state["review_rounds"] == 0:
                state["review_rounds"], state["review_fp"] = 1, fp
                return _block(
                    state, "review_requested", "verify가 통과했습니다. PR을 열기 전에 읽기 전용 reviewer에게 리뷰를 받으세요: "
                    f"`spawn_sub_agents(agents=[{{\"agent_or_mode\": \"order-reviewer\", \"prompt\": \"이 repo의 변경을 리뷰해\"}}], cwd=\"{REPO}\")`. "
                    "지적은 severity와 상관없이 모두 반영한 뒤 턴을 끝내세요.",
                    round=1,
                )
            if state["review_rounds"] == 1 and fp != state["review_fp"]:
                state["review_rounds"], state["review_fp"] = 2, fp
                return _block(
                    state, "review_requested", "리뷰 반영 후 verify가 통과했습니다. `order-reviewer`로 한 번 더 확인하고, "
                    "남은 지적을 반영한 뒤 턴을 끝내세요. 리뷰는 이번이 마지막입니다.",
                    round=2,
                )

        # 3. PR, and 4. keep it in sync
        dirty = bool(_git("status", "--porcelain"))
        pr = _open_pr(branch)
        if not pr:
            return _block(
                state, "pr_requested", "verify와 리뷰가 끝났습니다. 커밋하고 branch를 push한 뒤 PR을 여세요"
                "(본문: 무엇을 바꿨는지, 테스트, 리뷰 기록, 이슈가 있으면 `Fixes #<번호>`). 그다음 "
                "`monitor_watch(kind=\"github_pull_request\", target=<PR URL>, objective=\"review_ready\")`로 CI와 리뷰를 기다리세요.",
            )
        if state["pr"] != pr["number"]:
            state["pr"] = pr["number"]
            _log("pr_opened", pr=pr["number"])
        if dirty:
            return _block(state, "commit_requested", f"PR #{pr['number']}에 들어가지 않은 변경이 있습니다. 커밋하고 push하세요.")
        if pr.get("headRefOid") != _git("rev-parse", "HEAD"):
            return _block(state, "push_requested", f"검증을 통과한 커밋이 아직 PR #{pr['number']}에 없습니다. push하세요.")
        _log("in_sync", pr=pr["number"])
        _save_state(state)


if __name__ == "__main__":
    main()
