# Demo setup

Remote: `git@github.com:dohkimOnAmz/ts-sample-order.git`

## 1. Labels, issues and branch protection (GitHub CLI)

```bash
R=dohkimOnAmz/ts-sample-order
gh label create agent-ok --color 428BCA -R $R --description "Agent may pick this up"
gh label create in-progress --color F0AD4E -R $R
gh label create needs-human --color D9534F -R $R --description "Agent handed this back"

# A. list-orders (bug), B. create-order quantity (bug), C. list-shipments pagination (depends on A)
A=$(gh issue create -R $R -l agent-ok,bug -t "주문 목록 API가 느리고 일부 주문이 목록에서 빠짐" \
  --body "$(sed '1,2d' docs/demo/issues/01-list-orders-scan.md)" | grep -o '[0-9]*$')
gh issue create -R $R -l agent-ok,bug -t "주문 생성 API가 소수 수량을 받아서 합계 금액이 소수로 저장됨" \
  --body "$(sed '1,2d' docs/demo/issues/03-create-order-quantity.md)"
gh issue create -R $R -l agent-ok,enhancement -t "배송 목록 API에 pagination 추가" \
  --body "$(sed '1,2d' docs/demo/issues/02-list-shipments-pagination.md | sed "s/{{LIST_ORDERS_ISSUE}}/$A/")"

# main: CI `verify` must pass and the branch must be up to date before merge
gh api -X PUT repos/$R/branches/main/protection --input - <<'JSON'
{"required_status_checks": {"strict": true, "contexts": ["verify"]},
 "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null}
JSON
```

## 2. Reviewer agent

`.kiro/agents/order-reviewer.json` is the read-only reviewer (no write tool; shell auto-approves only
test and git read commands). Copy it to `~/.kiro/agents/order-reviewer.json` so Kiro Crew can spawn it
by name.

## 3. Loop

- Poller: `~/.kiro/crew/crons/ts_sample_order_loop.py` (script cron, no model call). It reads the repo once a
  minute and wakes the orchestrator session only when an issue, CI result, review comment, or merge state changed.
- Orchestrator: a Kiro Crew dashboard chat with this repository as its project. Start it with:

  > `docs/demo/loop.md`를 읽고 그 규칙대로 이 repo의 agent loop를 시작해.

The rules, events and limits are in `docs/demo/loop.md`.
