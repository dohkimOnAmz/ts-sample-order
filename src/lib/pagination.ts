// Pagination helpers for list endpoints (.kiro/steering/dynamodb.md):
// `limit` defaults to 20, must be an integer from 1 to 100; `nextToken` carries
// DynamoDB's LastEvaluatedKey so the next request resumes where this one stopped.

import { createHmac, timingSafeEqual } from 'node:crypto';

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

// A nextToken is `<payload>.<signature>`: payload is the base64url JSON key and
// signature is HMAC-SHA256(secret, payload) in base64url. The signature stops a
// caller from editing the key to read somewhere the server did not send them.
function signPayload(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function encodeNextToken(key: PageKey, secret: string): string {
  if (secret.length === 0) {
    throw new Error('pagination secret is empty');
  }
  const payload = Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
  return `${payload}.${signPayload(payload, secret).toString('base64url')}`;
}

// Returns undefined for a token with a missing or wrong signature, and for anything
// whose payload is not a base64url JSON object of string values.
export function decodeNextToken(token: string, secret: string): PageKey | undefined {
  if (secret.length === 0 || token.length === 0 || token.length > 2048) {
    return undefined;
  }
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return undefined;
  }
  const [payload, signature] = parts;
  const expected = signPayload(payload, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
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
