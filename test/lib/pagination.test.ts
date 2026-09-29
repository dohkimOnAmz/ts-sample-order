import { decodeNextToken, encodeNextToken, parseLimit } from '../../src/lib/pagination';

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
    const key = { orderId: 'ord-1', customerId: 'cust-1', createdAt: '2026-09-01T00:00:00.000Z' };
    expect(decodeNextToken(encodeNextToken(key))).toEqual(key);
  });

  it.each(['', 'not-a-token', Buffer.from('[1,2]').toString('base64url'), Buffer.from('"x"').toString('base64url')])(
    'returns undefined for %p',
    (token) => {
      expect(decodeNextToken(token)).toBeUndefined();
    },
  );

  it('returns undefined when a key value is not a string', () => {
    const token = Buffer.from(JSON.stringify({ orderId: 1 })).toString('base64url');
    expect(decodeNextToken(token)).toBeUndefined();
  });
});
