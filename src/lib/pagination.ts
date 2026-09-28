import { createHmac, timingSafeEqual } from 'node:crypto';

// Shared pagination for list endpoints (see .kiro/steering/dynamodb.md):
// `limit` defaults to 20 and must be an integer in 1..100; `nextToken` is an
// opaque cursor wrapping DynamoDB's LastEvaluatedKey, signed with HMAC-SHA256
// so a client cannot forge or edit the start key.
//
// Token format: base64url(JSON key) + "." + base64url(HMAC-SHA256(secret, payload))

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

function sign(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

export function encodeNextToken(key: PageKey, secret: string): string {
  const payload = Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

// Returns the decoded key, or undefined when the token is malformed or its
// signature does not match. A valid key is a flat object of string/number
// values whose keys are exactly `keyNames` (the table's or index's key attributes).
export function decodeNextToken(
  token: string,
  keyNames: readonly string[],
  secret: string,
): PageKey | undefined {
  const match = /^([A-Za-z0-9_-]{1,2048})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return undefined;
  const [, payload, signature] = match;

  const expected = sign(payload, secret);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
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
