# Agent loop 규칙

> 예비 방법입니다. 기본 데모는 Issue Radar crew 2개로 돌립니다(`docs/demo/setup.md` 3번). 이 문서는 crew 대신 cron poller와 orchestrator 채팅 하나로 같은 흐름을 돌릴 때 씁니다. 이 경우 #3의 blocked-by 관계와 `unblock` workflow 대신 계획 단계가 순서를 정합니다.

이 문서는 orchestrator 세션(Kiro Crew 대시보드 채팅 하나)이 따르는 규칙입니다. 구현과 리뷰는 subagent가 하고, orchestrator는 이슈 사이의 순서와 PR 이벤트 처리만 맡습니다.

## 한 화면 요약

| 항목 | 내용 |
|---|---|
| 시작 조건 | poller(모델을 호출하지 않는 script cron, 1분마다)가 `agent-ok` 이슈를 찾으면 이 세션을 깨웁니다 |
| 계획 | 이슈끼리 의존 관계를 보고, 관계없는 이슈는 동시에(최대 2개), 다른 이슈의 결과가 필요한 이슈는 그 PR이 merge된 뒤 시작합니다 |
| 검증 | 실패하는 테스트 먼저 → `npm run verify` → `order-reviewer` APPROVE → GitHub CI `verify` |
| PR 종료 조건 | CI 통과, 미해결 리뷰 스레드 0개, main 최신 상태(REVIEW_READY). merge는 사람이 합니다 |
| 전체 종료 조건 | 열린 `agent-ok` 이슈와 열린 agent PR이 없으면 ALL_DONE. poller는 스스로 삭제됩니다 |
| 한도 | reviewer 2회, CI 수정 3회, 이슈 작업 시작부터 PR까지 40분. 넘으면 `needs-human`으로 넘기고 멈춥니다 |
| 사람이 하는 일 | `agent-ok` 라벨, PR 리뷰 코멘트, merge |

poller가 보내는 이벤트: `NEW_ISSUES`, `CI_FAILURE`, `REVIEW_COMMENT`, `BEHIND`, `REVIEW_READY`, `MERGED`, `ALL_DONE`. 상태가 바뀌지 않은 확인은 이 세션에 아무것도 보내지 않습니다.

## 공통 규칙

- repo: `dohkimOnAmz/ts-sample-order`. `gh`에는 항상 `-R dohkimOnAmz/ts-sample-order`를 붙입니다.
- agent가 GitHub에 쓰는 모든 코멘트와 PR 본문은 마지막 줄을 `<!-- kiro-crew -->`로 끝냅니다. poller는 이 표시로 사람 코멘트와 agent 코멘트를 구분합니다.
- main에 push하지 않고, merge하지 않고, force push하지 않습니다.
- 이슈별 단계, 의존 관계, worktree, 구현 subagent의 conversation id, reviewer 횟수, CI 수정 횟수, 작업 시작 시각은 ledger 파일 `~/.kiro/crew/crons/state/dohkimOnAmz__ts-sample-order.ledger.json`에 기록합니다. 상태가 바뀔 때마다 갱신하고, 이 세션의 기억보다 이 파일을 먼저 믿습니다.
- poller 메시지 하나에 이벤트가 여러 개면 모두 처리합니다. 할 일이 없으면 한 줄로 끝냅니다.

## 0. 시작 (한 번)

1. `cron_add(name="ts-sample-order loop", script="~/.kiro/crew/crons/ts_sample_order_loop.py:run", message="dohkimOnAmz/ts-sample-order", every=60, timeout=60, strict_schedule=true)`
2. 돌려받은 job id로 `cron_trigger`를 호출해 첫 확인을 바로 실행합니다.
3. 턴을 끝냅니다. 이후에는 poller 메시지와 subagent completion event로만 움직입니다.

## 1. NEW_ISSUES: 계획

1. 새 이슈 본문을 모두 읽습니다(`gh issue view <n>`).
2. 순서를 정합니다. 어떤 이슈가 다른 이슈에서 만들 코드나 형식을 그대로 써야 하면, 그 이슈의 PR이 merge된 뒤에 시작합니다. 나머지는 동시에 시작합니다.
3. 이슈마다 계획 코멘트를 남깁니다. 바로 시작하는 이슈에는 "작업 시작"과 `in-progress` 라벨, 기다리는 이슈에는 "#<n> merge 후 시작"과 그 이유를 적습니다.
4. 계획을 ledger에 기록하고, 바로 시작하는 이슈마다 2번을 진행합니다.

## 2. 이슈 하나의 loop

준비는 orchestrator가 직접 합니다.

```bash
cd ~/Data/Code/ts-sample-order && git fetch origin
git worktree add ../ts-sample-order-issue-<n> -b agent/<n>-<slug> origin/main
cd ../ts-sample-order-issue-<n> && npm ci --prefer-offline --no-audit --no-fund
```

구현은 이슈마다 `spawn_run` 한 번씩 합니다(worktree가 달라서 한 번에 묶을 수 없습니다). 인자: `keep=true`, `cwd=<worktree>`, `include_memory=false`, `solo_reason="parent_parallel"`, `solo_details="orchestrator는 이슈 graph와 다른 이슈를 계속 관리하고, subagent는 이 worktree 하나만 맡는다. 결과는 커밋과 보고, verify 통과 후 커밋하면 끝"`. task:

> ts-sample-order 이슈 #<n>을 고쳐. 이슈 본문은 `gh issue view <n> -R dohkimOnAmz/ts-sample-order`로 읽어. 작업 폴더는 지금 폴더(branch `agent/<n>-<slug>`)뿐이고 다른 폴더는 건드리지 마. steering 규칙대로 새 테스트를 먼저 쓰고 `npm test`로 실패하는 것을 확인한 뒤 구현하고, `npm run verify`를 통과시켜. Conventional Commits로 커밋하고 push는 하지 마. 끝나면 바꾼 파일, 처음에 실패했던 테스트 이름, verify 결과를 보고해.

리뷰는 구현 completion event가 오면 시작합니다. `spawn_run(agent="order-reviewer", cwd=<worktree>, include_memory=false, include_lessons=false, task="이 worktree의 변경을 이슈 #<n> 기준으로 리뷰해.")`

- 지적이 하나라도 있으면(APPROVE여도) `spawn_continue(conversation=<구현 id>, task="reviewer 지적: <원문>. 모두 반영하고 verify 후 커밋해.")`로 고치게 하고, 다시 리뷰합니다. reviewer는 이슈당 최대 2회입니다.
- 두 번째 리뷰에도 지적이 남으면 PR 본문의 "남은 지적"에 적고 PR을 엽니다.

PR은 orchestrator가 엽니다.

```bash
git -C ../ts-sample-order-issue-<n> push -u origin agent/<n>-<slug>
gh pr create -R dohkimOnAmz/ts-sample-order --base main --head agent/<n>-<slug> --title "<Conventional Commits 제목>" --body-file <본문 파일>
```

PR 본문: 무엇을 바꿨는지 3줄 이내, 테스트, loop 기록(reviewer 횟수와 반영한 지적), `Fixes #<n>` 한 줄, 마지막 줄 `<!-- kiro-crew -->`.

## 3. PR 이벤트

- `CI_FAILURE`: `gh run view <run> --log-failed`로 실패 로그를 읽고 `spawn_continue`로 구현 subagent에게 넘깁니다. 고친 커밋을 push합니다. CI 수정은 PR당 3회까지입니다.
- `REVIEW_COMMENT`: 코멘트 원문을 `spawn_continue`로 넘깁니다. task에 "반영하고, 이 PR 밖에도 적용되는 규칙이면 steering에 한 줄 추가해. verify 후 커밋해."를 넣습니다. push한 뒤 스레드에 답글(무엇을 고쳤는지, 커밋 sha, 표시)을 달고 스레드를 resolve합니다. 스레드가 아닌 PR 코멘트에는 `gh pr comment`로 답합니다.

  ```bash
  gh api graphql -f query='mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{id}}}' -F t=<thread> -F b=<답글>
  gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -F t=<thread>
  ```

- `BEHIND`: main이 바뀌어서 branch 보호 규칙이 최신화를 요구하는 상태입니다. orchestrator가 직접 처리합니다: worktree에서 `git fetch origin && git merge --no-edit origin/main && npm run verify` 후 push합니다. 충돌이 나면 `spawn_continue`로 구현 subagent에게 넘깁니다.
- `REVIEW_READY`: `send_notification(title="PR #<pr> merge 준비됨", priority="default")`로 사람에게 알립니다.
- `MERGED`: 이슈가 닫혔는지 확인하고, worktree를 지우고(`git worktree remove`), 구현 conversation을 `spawn_release`합니다. 이 PR을 기다리던 이슈가 있으면 `in-progress` 라벨을 붙이고 2번을 시작합니다.
- `ALL_DONE`: 4번 타임라인을 만듭니다.

## 한도를 넘었을 때

이슈에 상황 코멘트(어디서 멈췄는지, 무엇을 시도했는지, 표시 포함)를 남기고, `in-progress`를 떼고 `needs-human`을 붙이고, 그 이슈는 더 진행하지 않습니다.

## 4. ALL_DONE: 타임라인

`~/.kiro/crew/crons/state/dohkimOnAmz__ts-sample-order.events.jsonl`, ledger 파일, `gh pr list --state merged --json number,title,createdAt,mergedAt`을 합쳐서 mcwidget 타임라인 하나를 만듭니다.

- 이슈마다: 시작, PR 생성, reviewer 지적과 수정, CI 실패와 수정, 사람 리뷰 반영, main 반영, merge 시각
- poller: 확인한 횟수와 이 세션을 깨운 횟수
- 사람이 한 일: 라벨, 리뷰 코멘트, merge

## 다시 돌릴 때

상태 파일 세 개(`~/.kiro/crew/crons/state/dohkimOnAmz__ts-sample-order.*`: poller 상태, 이벤트 로그, ledger)를 지우고, 새 이슈에 `agent-ok`를 붙인 뒤 0번부터 시작합니다.
