import type { OrderItem, OrderStatus, ShippingAddress } from '../model';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidId(value: string | undefined): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

const ORDER_STATUSES: readonly string[] = ['PENDING', 'PAID', 'SHIPPED', 'CANCELLED'];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && ORDER_STATUSES.includes(value);
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
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return undefined;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) return undefined;
    items.push({ sku, quantity: quantity as number, unitPrice });
  }
  return items;
}

const ADDRESS_FIELDS = ['recipient', 'line1', 'city', 'postalCode'] as const;
const ADDRESS_FIELD_MAX = 200;

export type AddressResult = { address: ShippingAddress } | { error: string };

// Each field must be a non-blank string (trimmed, at most ADDRESS_FIELD_MAX chars).
// Unknown fields are dropped.
export function parseAddress(value: unknown): AddressResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'body must be an object' };
  }
  const raw = value as Record<string, unknown>;
  const address = {} as ShippingAddress;
  for (const field of ADDRESS_FIELDS) {
    const v = raw[field];
    const trimmed = typeof v === 'string' ? v.trim() : '';
    if (trimmed.length === 0 || trimmed.length > ADDRESS_FIELD_MAX) {
      return { error: `${field} is invalid` };
    }
    address[field] = trimmed;
  }
  return { address };
}
