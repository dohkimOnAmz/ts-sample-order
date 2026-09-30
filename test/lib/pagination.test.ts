import { createHmac } from 'node:crypto';
import { decodeNextToken, encodeNextToken, parseLimit } from '../../src/lib/pagination';

const SECRET = 'test-secret-0123456789';
const KEY = { orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-01T00:00:00.000Z' };

// Builds a token the way encodeNextToken does, for any payload.
const sign = (payload: string, secret = SECRET) =>
  `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;

describe('parseLimit', () => {
  it('defaults to 20 when absent', () => {
    expect(parseLimit(undefined)).toEqual({ limit: 20 });
  });

  it.each([
    ['1', 1],
    ['100', 100],
  ])('accepts %p', (raw, limit) => {
    expect(parseLimit(raw)).toEqual({ limit });
  });

  it.each(['0', '101', '-1', '1.5', '1e2', ' 5', 'abc', ''])('rejects %p', (raw) => {
    expect(parseLimit(raw)).toEqual({ error: 'limit must be an integer from 1 to 100' });
  });
});

describe('nextToken', () => {
  it('round-trips a key', () => {
    expect(decodeNextToken(encodeNextToken(KEY, SECRET), SECRET)).toEqual(KEY);
  });

  it('is signed: payload and HMAC-SHA256 signature separated by a dot', () => {
    const [payload, sig] = encodeNextToken(KEY, SECRET).split('.');
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual(KEY);
    expect(sig).toBe(createHmac('sha256', SECRET).update(payload).digest('base64url'));
  });

  it('rejects a token signed with a different secret', () => {
    expect(decodeNextToken(encodeNextToken(KEY, 'other-secret'), SECRET)).toBeUndefined();
  });

  it('rejects a token whose payload was changed after signing', () => {
    const [, sig] = encodeNextToken(KEY, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ ...KEY, customerId: 'cust-2' })).toString('base64url');
    expect(decodeNextToken(`${forged}.${sig}`, SECRET)).toBeUndefined();
  });

  it('rejects an unsigned token (the old base64url-only format)', () => {
    const unsigned = Buffer.from(JSON.stringify(KEY)).toString('base64url');
    expect(decodeNextToken(unsigned, SECRET)).toBeUndefined();
  });

  it.each(['', 'not-a-token', 'a.b.c', '.', 'abc.'])('returns undefined for %p', (token) => {
    expect(decodeNextToken(token, SECRET)).toBeUndefined();
  });

  it.each([
    ['an array', '[1,2]'],
    ['a string', '"x"'],
    ['a non-string value', JSON.stringify({ orderId: 1 })],
    ['an empty object', '{}'],
  ])('returns undefined for a correctly signed %s', (_label, json) => {
    expect(decodeNextToken(sign(Buffer.from(json).toString('base64url')), SECRET)).toBeUndefined();
  });

  it('refuses to sign or verify with an empty secret', () => {
    expect(() => encodeNextToken(KEY, '')).toThrow();
    expect(decodeNextToken(sign(Buffer.from(JSON.stringify(KEY)).toString('base64url'), ''), '')).toBeUndefined();
  });
});
