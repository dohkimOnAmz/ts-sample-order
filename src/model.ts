export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'CANCELLED';

export interface OrderItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface ShippingAddress {
  recipient: string;
  line1: string;
  city: string;
  postalCode: string;
}

export interface Order {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalAmount: number;
  shippingAddress?: ShippingAddress;
  createdAt: string; // ISO-8601
  statusUpdatedAt?: string; // ISO-8601, set when the status is changed
}

export type ShipmentStatus = 'READY' | 'IN_TRANSIT' | 'DELIVERED';

export interface Shipment {
  customerId: string;
  shipmentId: string;
  orderId: string;
  carrier: string;
  status: ShipmentStatus;
  createdAt: string; // ISO-8601
}
