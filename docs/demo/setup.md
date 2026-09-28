# Demo setup

Remote: `git@github.com:dohkimOnAmz/ts-sample-order.git`

## 1. Labels, issues, dependency and branch protection (GitHub CLI)

```bash
R=dohkimOnAmz/ts-sample-order
gh label create agent-ok --color 428BCA -R $R --description "Agent may pick this up"
gh label create blocked --color BFD4F2 -R $R --description "Waiting on another issue; unblock workflow adds agent-ok"

# A. list-orders (bug), B. create-order quantity (bug), C. list-shipments pagination (blocked by A)
A=$(gh issue create -R $R -l agent-ok,bug -t "주문 목록 API가 느리고 일부 주문이 목록에서 빠짐" \
  --body "$(sed '1,2d' docs/demo/issues/01-list-orders-scan.md)" | grep -o '[0-9]*$')
gh issue create -R $R -l agent-ok,bug -t "주문 생성 API가 소수 수량을 받아서 합계 금액이 소수로 저장됨" \
  --body "$(sed '1,2d' docs/demo/issues/03-create-order-quantity.md)"
C=$(gh issue create -R $R -l blocked,enhancement -t "배송 목록 API에 pagination 추가" \
  --body "$(sed '1,2d' docs/demo/issues/02-list-shipments-pagination.md | sed "s/{{LIST_ORDERS_ISSUE}}/$A/")" | grep -o '[0-9]*$')

# C is blocked by A (GitHub issue dependencies). .github/workflows/unblock.yml adds agent-ok to C when A closes.
gh api -X POST repos/$R/issues/$C/dependencies/blocked_by -F issue_id=$(gh api repos/$R/issues/$A --jq .id)

# main: CI `verify` must pass before merge. Repo auto-merge stays off, so a human merges.
gh api -X PUT repos/$R/branches/main/protection --input - <<'JSON'
{"required_status_checks": {"strict": false, "contexts": ["verify"]},
 "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null}
JSON
```

## 2. Reviewer agent

`.kiro/agents/order-reviewer.json` is the read-only reviewer (no write tool; shell auto-approves only
test and git read commands). Copy it to `~/.kiro/agents/order-reviewer.json` so Kiro Crew can spawn it
by name. Add `~/Data/Code` to `subagent_cwd_allowed_roots` in `~/.kiro/crew/config.json`.

## 3. Issue Radar crews

Issue Radar -> this repository -> create two crews (for example `crew-a`, `crew-b`):

- Labels: `agent-ok`
- Max open items: 1 (one issue per crew, so the two crews show as two lanes)
- Auto-merge: off. The repo does not allow auto-merge either, so a human merges.
- Agent: `kirocrew`

The crews read `AGENTS.md` for the working rules (test first, `order-reviewer`, review rule to steering,
`blocked` issues, worktree location).

## Fallback

`docs/demo/loop.md` describes the same run driven by a cron poller and one orchestrator chat instead of
Issue Radar.
