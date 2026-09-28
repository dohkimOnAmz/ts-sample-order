# ts-sample-order

Sample order API used for the Kiro Crew agentic development demo.
API Gateway HTTP API + Lambda (Node.js 22, TypeScript) + DynamoDB, deployed with CDK.

| Route | Handler |
|---|---|
| `POST /orders` | `src/handlers/create-order.ts` |
| `GET /orders/{orderId}` | `src/handlers/get-order.ts` |
| `POST /orders/{orderId}/cancel` | `src/handlers/cancel-order.ts` |
| `GET /customers/{customerId}/orders` | `src/handlers/list-orders.ts` |
| `GET /customers/{customerId}/shipments` | `src/handlers/list-shipments.ts` |

## Develop

```bash
npm ci
npm run verify   # typecheck + tests + cdk synth
```

`scripts/with-tmp.js` runs Jest and the CDK with a fallback `TMPDIR` (`./.tmp`) when the
system temp directory cannot be resolved, which happens inside some agent sandboxes.

## Deploy (optional)

```bash
npx cdk deploy
```

The API has no authorizer. It is a demo stack; add IAM or JWT auth before storing real data.

## Demo material

`docs/demo/` holds the issue texts and setup notes for the recorded demo.
