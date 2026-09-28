# Demo setup

Remote: `git@github.com:dohkimOnAmz/ts-sample-order.git`

## 1. Labels, issues, dependency and branch protection (GitHub CLI)

```bash
R=dohkimOnAmz/ts-sample-order
gh label create "role:performance" --color 0E8A16 -R $R --description "성능 담당 crew zippy가 맡습니다 (조회 성능, pagination)"
gh label create "role:bugfix" --color B60205 -R $R --description "버그 담당 crew bugsy가 맡습니다 (입력 검증 같은 기능 버그)"
gh label create blocked --color BFD4F2 -R $R --description "다른 이슈를 기다리는 중. 막던 이슈가 닫히면 그 이슈의 role 라벨을 이어받음"

# A. list-orders, B. create-order quantity, C. list-shipments pagination (blocked by A).
# No role label yet: assigning a role is the human step at the start of the recording.
A=$(gh issue create -R $R -l bug -t "주문 목록 API가 느리고 일부 주문이 목록에서 빠짐" \
  --body "$(sed '1,2d' docs/demo/issues/01-list-orders-scan.md)" | grep -o '[0-9]*$')
gh issue create -R $R -l bug -t "주문 생성 API가 소수 수량을 받아서 합계 금액이 소수로 저장됨" \
  --body "$(sed '1,2d' docs/demo/issues/03-create-order-quantity.md)"
C=$(gh issue create -R $R -l blocked,enhancement -t "배송 목록 API에 pagination 추가" \
  --body "$(sed '1,2d' docs/demo/issues/02-list-shipments-pagination.md | sed "s/{{LIST_ORDERS_ISSUE}}/$A/")" | grep -o '[0-9]*$')

# C is blocked by A (GitHub issue dependencies). When A closes, .github/workflows/unblock.yml
# removes `blocked` from C and copies A's role label to it.
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

Issue Radar -> this repository -> New Crew, twice:

| Field | zippy | bugsy |
|---|---|---|
| Name | `zippy` | `bugsy` |
| Labels it owns | `role:performance` | `role:bugfix` |
| Worktree root | `~/Data/Code/crews` | `~/Data/Code/crews` |
| Agent / Model | `kirocrew` / Auto | `kirocrew` / Auto |
| Additional prompt | 성능 담당입니다. DynamoDB 접근 패턴과 목록 API pagination을 맡습니다. 작업 규칙은 repo의 AGENTS.md를 따릅니다. | 버그 담당입니다. 입력 검증과 응답 오류 같은 기능 버그를 맡습니다. 작업 규칙은 repo의 AGENTS.md를 따릅니다. |
| Auto-resolve merge conflicts | on | on |
| Arm auto-merge when green | off | off |
| Run unattended | on | on |
| Open work items | 1 | 1 |

The crews read `AGENTS.md` for the working rules (test first, `order-reviewer`, review rule to steering,
`blocked` issues, worktree location).

## Fallback

`docs/demo/loop.md` describes the same run driven by a cron poller and one orchestrator chat instead of
Issue Radar. It still uses an `agent-ok` label.
