---
inclusion: fileMatch
fileMatchPattern: "**/*.ts"
---

# DynamoDB 규칙

- API handler에서 Scan을 쓰지 않습니다. 접근 패턴마다 Query가 가능한 key나 GSI를 설계합니다.
- 테이블 key: Orders(pk `orderId`), Shipments(pk `customerId`, sk `createdAt`).
- GSI를 추가하면 `infra/lib/order-stack.ts`와 `test/infra/order-stack.test.ts`를 함께 고칩니다. GSI 이름은 `by<Attribute>` 형식으로 짓습니다(예: `byCustomer`).
- 목록 API는 pagination을 지원합니다. query string `limit`은 기본 20, 최대 100이고, 다음 페이지가 있으면 응답에 `nextToken`을 넣습니다. 요청에 `nextToken`이 오면 그 위치부터 이어서 읽습니다.
- `limit`이 정수가 아니거나 1~100을 벗어나면 400으로 거절합니다. 값을 임의로 줄이거나 늘리지 않습니다.
- 목록 API의 `nextToken`은 HMAC으로 서명합니다. 서명이 없거나 올바르지 않은 `nextToken`은 400으로 거절합니다.
- 리소스의 상태를 바꾸는 handler는 변경 시각을 `<field>UpdatedAt`(예: `statusUpdatedAt`) ISO-8601 문자열로 같은 write에 저장하고 200 응답에 포함합니다.
- Query 결과는 1MB 단위로 잘립니다. `LastEvaluatedKey`가 있으면 다음 페이지가 있다는 뜻입니다.
