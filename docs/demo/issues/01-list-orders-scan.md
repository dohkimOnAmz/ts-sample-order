<!-- title: 주문 목록 API가 느리고 일부 주문이 목록에서 빠짐 -->
<!-- labels: bug (role label is assigned by a human) -->

## 현상

- `GET /customers/{customerId}/orders`가 주문이 쌓일수록 느려지고 있습니다.
- 고객 문의: 최근에 주문한 건이 주문 목록에 보이지 않는다고 합니다(주문 상세 `GET /orders/{orderId}`에는 있음).

## 확인한 것

- `src/handlers/list-orders.ts`가 Orders 테이블 전체를 `Scan`하고 `FilterExpression`으로 고객을 거릅니다.
- Scan은 요청마다 테이블을 처음부터 읽고, 한 번에 1MB까지만 읽습니다. 그래서 테이블이 커질수록 느리고, 1MB 뒤에 있는 주문은 결과에 없습니다.

## 기대 동작

- 고객의 주문을 최신순으로 돌려줍니다.
- 목록은 pagination을 지원합니다(`limit`, `nextToken`).

## 정해진 것

- 이 수정은 maintainer가 승인했습니다. 목록 API는 AGENTS.md의 pagination 규칙(`limit`, `nextToken`)을 따릅니다.
- 응답의 `orders` 필드는 그대로 두고 `nextToken`만 추가하므로, 기존 클라이언트는 그대로 동작합니다.

## 완료 조건

- list-orders에서 Scan을 없애고 Query로 바꿉니다.
- 필요한 GSI를 CDK stack에 추가하고 infra 테스트를 고칩니다.
- handler 테스트를 새 동작에 맞게 고치고, 다음 페이지가 있는 경우를 테스트합니다.
- `npm run verify` 통과
