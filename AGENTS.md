# AGENTS.md

Kiro reads `.kiro/steering/`. Other coding agents, and Kiro sessions that do not start inside this
repository (for example a Kiro Crew Issue Radar crew), must read this file and every
`.kiro/steering/*.md` before changing code. The rules are the same.

## Code rules

- Verify before every commit: `npm run verify` (typecheck, Jest tests, CDK synth).
- Mock DynamoDB with `aws-sdk-client-mock`; tests never call real AWS.
- No `Scan` in API handlers. Design a key or GSI so each access pattern is a `Query`.
- List endpoints paginate: `limit` (default 20, max 100) and `nextToken`.
- One issue per pull request. Conventional Commits; the PR body carries `Fixes #<issue>` on its own line.

## How an agent works an issue here

1. Write the new test first and run `npm test` to see it fail, then implement.
2. Before opening the PR, get a review from the read-only reviewer agent `order-reviewer`
   (Kiro Crew: `spawn_run(agent="order-reviewer", cwd=<worktree>, task="Review this worktree's change against issue #<n>.")`).
   Fix every finding, whatever its severity, and run the reviewer once more. At most 2 review rounds;
   list the findings and what you changed for each in the PR body.
3. When a human review comment states a rule that applies beyond this PR, add that rule as one line to
   the matching `.kiro/steering/*.md` file in the same PR, so the next issue follows it.
4. Crews take only issues labeled `agent-ok`. An issue that GitHub shows as "blocked by" another open
   issue has no `agent-ok` yet; do not start it. The `unblock` workflow adds `agent-ok` when its last
   blocker closes.

## Demo host note

On the demo host, create worktrees under `~/Data/Code/` (for example
`~/Data/Code/ts-sample-order-<crew>-<issue>`). Kiro Crew only lets a subagent such as `order-reviewer`
run inside its allowed roots, and `~/Data/Code` is the one configured there.

Details: `.kiro/steering/project.md`, `.kiro/steering/dynamodb.md`.
