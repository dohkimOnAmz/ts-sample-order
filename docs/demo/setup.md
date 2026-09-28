# Demo setup

Remote: `git@github.com:dohkimOnAmz/ts-sample-order.git`

## 1. Label, issues, dependency and branch protection (GitHub CLI)

The only workflow label is `agent-ok` ("an agent may pick this up"). A human adds it to hand an issue to
the crews; the `unblock` workflow adds it to an issue whose blockers have all closed.

```bash
R=dohkimOnAmz/ts-sample-order
gh label create agent-ok --color 428BCA -R $R --description "Agent may pick this up"

# A. list-orders, B. create-order quantity, C. list-shipments pagination (blocked by A, so no agent-ok yet)
A=$(gh issue create -R $R -l bug -t "주문 목록 API가 느리고 일부 주문이 목록에서 빠짐" \
  --body "$(sed '1,2d' docs/demo/issues/01-list-orders-scan.md)" | grep -o '[0-9]*$')
B=$(gh issue create -R $R -l bug -t "주문 생성 API가 소수 수량을 받아서 합계 금액이 소수로 저장됨" \
  --body "$(sed '1,2d' docs/demo/issues/03-create-order-quantity.md)" | grep -o '[0-9]*$')
C=$(gh issue create -R $R -l enhancement -t "배송 목록 API에 pagination 추가" \
  --body "$(sed '1,2d' docs/demo/issues/02-list-shipments-pagination.md | sed "s/{{LIST_ORDERS_ISSUE}}/$A/")" | grep -o '[0-9]*$')

# C is blocked by A (GitHub issue dependencies). .github/workflows/unblock.yml adds agent-ok to C when A closes.
gh api -X POST repos/$R/issues/$C/dependencies/blocked_by -F issue_id=$(gh api repos/$R/issues/$A --jq .id)

# main: CI `verify` must pass before merge. Repo auto-merge stays off, so a human merges.
gh api -X PUT repos/$R/branches/main/protection --input - <<'JSON'
{"required_status_checks": {"strict": false, "contexts": ["verify"]},
 "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null}
JSON

# Recording starts here: the human hands A and B to the crews.
gh issue edit $A -R $R --add-label agent-ok
gh issue edit $B -R $R --add-label agent-ok
```

## 2. Reviewer agent

`.kiro/agents/order-reviewer.json` is the read-only reviewer (no write tool; shell auto-approves only
test and git read commands). Copy it to `~/.kiro/agents/order-reviewer.json` so Kiro Crew can spawn it
by name. Add `~/Data/Code` to `subagent_cwd_allowed_roots` in `~/.kiro/crew/config.json`.

## 3. Issue Radar crews

Issue Radar -> this repository -> New Crew, twice. The two crews are identical apart from their names
(`mario`, `luigi`); both work `agent-ok` issues and pick them at random, so no human assigns an issue to a specific crew.

| Field | Value |
|---|---|
| Labels it owns | `agent-ok` |
| Worktree root | `~/Data/Code` |
| Agent / Model | `kirocrew` / one model for both crews |
| Additional prompt | 작업 규칙은 repo의 AGENTS.md를 따릅니다. |
| Auto-resolve merge conflicts | on |
| Arm auto-merge when green | off |
| Run unattended | on |
| Open work items | 1 |

## Fallback

`docs/demo/loop.md` describes the same run driven by a cron poller and one orchestrator chat instead of
Issue Radar. It also needs `in-progress` and `needs-human` labels, which this setup does not create.
