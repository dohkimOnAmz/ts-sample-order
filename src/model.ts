export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'CANCELLED';

export interface OrderItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalAmount: number;
  createdAt: string; // ISO-8601
  cancelledAt?: string; // ISO-8601, present once the order is cancelled
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
