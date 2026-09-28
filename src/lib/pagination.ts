// Shared pagination for list endpoints (see .kiro/steering/dynamodb.md):
// `limit` defaults to 20 and must be an integer in 1..100; `nextToken` is an
// opaque cursor wrapping DynamoDB's LastEvaluatedKey.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type PageKey = Record<string, string | number>;

// Returns the limit, or undefined when the query string value is invalid.
// Never clamps: an out-of-range value is rejected, not adjusted.
export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!/^[0-9]{1,3}$/.test(value)) return undefined;
  const limit = Number(value);
  return limit >= 1 && limit <= MAX_LIMIT ? limit : undefined;
}

export function encodeNextToken(key: PageKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

// Returns the decoded key, or undefined when the token is malformed.
// A valid token is a flat object of string/number values whose keys are
// exactly `keyNames` (the table's or index's key attributes).
export function decodeNextToken(token: string, keyNames: readonly string[]): PageKey | undefined {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(token)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length !== keyNames.length) return undefined;
  for (const [name, value] of entries) {
    if (!keyNames.includes(name)) return undefined;
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  }
  return parsed as PageKey;
}
