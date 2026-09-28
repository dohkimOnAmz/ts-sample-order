import type { OrderItem } from '../model';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidId(value: string | undefined): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function parseItems(value: unknown): OrderItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return undefined;
  }
  const items: OrderItem[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const { sku, quantity, unitPrice } = raw as Record<string, unknown>;
    if (typeof sku !== 'string' || !isValidId(sku)) return undefined;
    // quantity must be a whole number from 1 to 1000; a fractional value makes totalAmount fractional.
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return undefined;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) return undefined;
    items.push({ sku, quantity, unitPrice });
  }
  return items;
}
