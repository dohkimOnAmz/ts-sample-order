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
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 1000) return undefined;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) return undefined;
    items.push({ sku, quantity: quantity as number, unitPrice });
  }
  return items;
}
