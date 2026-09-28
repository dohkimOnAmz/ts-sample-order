# Demo setup

Remote: `git@github.com:dohkimOnAmz/ts-sample-order.git`

## 1. Labels and issues (GitHub CLI)

```bash
gh label create agent-ok --color 428BCA -R dohkimOnAmz/ts-sample-order
gh label create in-progress --color F0AD4E -R dohkimOnAmz/ts-sample-order

# issue #1 now; issue #2 only after #1 is merged, so the second run starts from the fixed code
gh issue create -R dohkimOnAmz/ts-sample-order -l agent-ok,bug \
  -t "주문 목록 API가 느리고 일부 주문이 목록에서 빠짐" \
  --body "$(sed '1,2d' docs/demo/issues/01-list-orders-scan.md)"
gh issue create -R dohkimOnAmz/ts-sample-order -l agent-ok,enhancement \
  -t "배송 목록 API에 pagination 추가" \
  --body "$(sed '1,2d' docs/demo/issues/02-list-shipments-pagination.md)"
```

## 2. Reviewer agent

`.kiro/agents/order-reviewer.json` is the read-only reviewer (no write tool; shell auto-approves only
test and git read commands). Copy it to `~/.kiro/agents/order-reviewer.json` so Kiro Crew can spawn it
by name.

## 3. Trigger

Primary: Kiro Crew **Issue Radar** app with a crew on this repository. The crew picks `agent-ok`
issues, posts a claim comment, and records its progress in the crew ledger.

Fallback: a Kiro Crew cron job (every 10 minutes) with this message:

> ts-sample-order(github.com/dohkimOnAmz/ts-sample-order)에서 `agent-ok` 라벨이 있고 `in-progress` 라벨이 없는 열린 이슈를 확인해.
> 없으면 아무것도 하지 말고 끝내.
> 있으면 번호가 가장 작은 이슈 하나를 골라: 이슈에 작업 시작 코멘트를 남기고 `in-progress` 라벨을 붙이고,
> spec(requirements, design, tasks)을 쓴 다음 멈추고 나에게 승인을 기다려. 승인 전에는 코드를 고치지 마.
> 승인되면 worktree에서 구현하고 `npm run verify`를 통과시켜.
> 그다음 `order-reviewer` subagent로 리뷰를 받고, 지적은 severity와 상관없이 반영한 뒤 reviewer를 한 번 더 돌려 확인해(최대 2회).
> 그다음 branch를 push하고 PR을 열어.
> PR은 monitor_watch(review_ready)로 지켜보고, 리뷰 코멘트가 오면 반영해서 다시 push해.
> 사람 리뷰 지적 중 다음 작업에도 적용될 규칙은 이 repo 전용 lesson으로 저장해.

For recording, fire it immediately with a manual trigger instead of waiting 10 minutes.
