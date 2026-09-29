// Pagination helpers for list endpoints (.kiro/steering/dynamodb.md):
// `limit` defaults to 20, must be an integer from 1 to 100; `nextToken` carries
// DynamoDB's LastEvaluatedKey so the next request resumes where this one stopped.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type LimitResult = { limit: number } | { error: string };

const LIMIT_PATTERN = /^[1-9][0-9]{0,2}$/;

export function parseLimit(raw: string | undefined): LimitResult {
  if (raw === undefined) {
    return { limit: DEFAULT_LIMIT };
  }
  const limit = LIMIT_PATTERN.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be an integer from 1 to ${MAX_LIMIT}` };
  }
  return { limit };
}

export type PageKey = Record<string, string>;

export function encodeNextToken(key: PageKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

// Returns undefined for anything that is not a base64url JSON object of string values.
export function decodeNextToken(token: string): PageKey | undefined {
  if (token.length === 0 || token.length > 2048) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.some(([, v]) => typeof v !== 'string')) {
    return undefined;
  }
  return parsed as PageKey;
}
