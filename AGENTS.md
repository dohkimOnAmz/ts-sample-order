# AGENTS.md

Kiro reads `.kiro/steering/`. Other coding agents should read this file; the rules are the same.

- Verify before every commit: `npm run verify` (typecheck, Jest tests, CDK synth).
- Mock DynamoDB with `aws-sdk-client-mock`; tests never call real AWS.
- No `Scan` in API handlers. Design a key or GSI so each access pattern is a `Query`.
- List endpoints paginate: `limit` (default 20, max 100) and `nextToken`.
- One issue per pull request. Conventional Commits; the PR body carries `Fixes #<issue>` on its own line.

Details: `.kiro/steering/project.md`, `.kiro/steering/dynamodb.md`.
