---
inclusion: always
---

# ts-sample-order

주문 API 샘플 서비스입니다. API Gateway HTTP API, Lambda(Node.js 22, TypeScript), DynamoDB, CDK로 구성됩니다.

## 명령

- 설치: `npm ci`
- 타입 검사: `npm run typecheck`
- 테스트: `npm test`
- CDK synth: `npm run synth`
- 전체 검증: `npm run verify`. 커밋 전에 반드시 통과시킵니다.

## 코드 구조

- `src/handlers/`: route마다 Lambda handler 하나
- `src/lib/`: 공용 코드. 응답은 `src/lib/http.ts`의 `json`, `badRequest`, `notFound`, `serverError`만 씁니다.
- `infra/`: CDK stack. 테이블, 함수, route를 바꾸면 `test/infra/`도 함께 고칩니다.
- `test/`: Jest 테스트. `src/`와 같은 경로 구조를 따릅니다.

## 규칙

- 테스트는 `aws-sdk-client-mock`으로 DynamoDB를 mock합니다. 테스트에서 실제 AWS를 호출하지 않습니다.
- 버그 수정과 새 기능에는 테스트를 함께 추가합니다. 새 테스트를 먼저 쓰고, `npm test`로 실패하는 것을 확인한 뒤 구현합니다.
- 리뷰 지적은 severity와 상관없이 모두 반영합니다. 반영하지 않을 지적은 이유를 PR 코멘트로 남깁니다.
- 사람 리뷰 지적이 이번 PR 밖의 코드에도 적용되는 규칙이면, 그 규칙을 알맞은 steering 파일에 한 줄로 추가하고 같은 PR에 넣습니다.
- 커밋 메시지는 Conventional Commits(`feat:`, `fix:`, `test:`, `chore:`)를 따릅니다. PR 본문에는 한 줄로 `Fixes #<이슈 번호>`를 적습니다.
- 한 PR에는 이슈 하나만 담습니다.

## 개발 loop (대시보드 채팅에서 기능을 만들 때)

- main에서 바로 고치지 않고 `feature/<짧은 이름>` branch를 만들어 작업합니다.
- 턴이 끝날 때마다 `scripts/dev-loop-hook.py`(Stop hook)가 다음 단계를 정합니다. 검증, `order-reviewer` 리뷰, PR, 대기 순서입니다. hook이 `[개발 loop]`로 시작하는 메시지를 보내면 그 지시대로 이어서 진행합니다.
- PR을 연 뒤 `monitor_watch`로 깨어나면 CI 실패나 리뷰 코멘트를 반영하고 push한 뒤, 리뷰 스레드에 무엇을 고쳤는지 답하고 resolve합니다.
- merge는 사람이 합니다.

Issue Radar crew는 이 절을 따르지 않습니다. crew는 앱 정책상 `order-reviewer`를 부를 수 없고 PR 이후 단계는 crew 규칙대로 합니다. 리뷰를 못 했다는 사실은 PR 본문에 적습니다.
