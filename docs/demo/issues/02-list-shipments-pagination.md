<!-- title: 배송 목록 API에 pagination 추가 -->
<!-- labels: agent-ok, enhancement -->

## 현상

- `GET /customers/{customerId}/shipments`는 한 번에 전부 돌려줍니다. 배송이 많은 고객은 응답이 커지고, Query 결과가 1MB를 넘으면 뒤쪽 배송이 잘립니다.

## 기대 동작

- `limit`(기본 20, 최대 100)과 `nextToken`으로 페이지를 나눠 돌려줍니다.
- 최신순은 그대로 유지합니다.

## 정해진 것

- 이 변경은 maintainer가 승인했습니다. AGENTS.md의 pagination 규칙을 배송 목록에도 적용하는 것입니다.
- 주문 목록 API(#{{LIST_ORDERS_ISSUE}})에서 만드는 pagination 구현과 `nextToken` 형식을 그대로 씁니다. 배송 목록용으로 따로 만들지 않습니다.
- 응답의 `shipments` 필드는 그대로 두고 `nextToken`만 추가하므로, 기존 클라이언트는 그대로 동작합니다.

## 완료 조건

- list-shipments에 pagination 추가
- 첫 페이지, 다음 페이지, 마지막 페이지, 잘못된 입력에 대한 테스트
- `npm run verify` 통과
