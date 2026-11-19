/**
 * CSV export of the orders a dispatcher is looking at. Money columns stay plain numbers so they
 * sum in a spreadsheet; text that could be read as a formula is escaped.
 */
import { ORDER_STATUS_META, formatAddress, toMillis } from '@instasupply/shared';
import Papa from 'papaparse';

import type { OrderRecord } from '@/lib/data';

import { paymentMethodLabel, paymentStatusMeta } from './order-format';

const COLUMNS = [
  'Order',
  'Placed at',
  'Status',
  'Customer',
  'Phone',
  'City',
  'Address',
  'Items',
  'Products',
  'Subtotal',
  'Delivery fee',
  'Discount',
  'Promo code',
  'Total',
  'Payment method',
  'Payment status',
  'Payment reference',
  'Order ID',
  'Delivery ID',
];

const pad = (value: number) => String(value).padStart(2, '0');

/** Local "2026-11-19" or "2026-11-19 14:05": unambiguous and sortable in any spreadsheet. */
export function localStamp(millis: number, withTime = false): string {
  const date = new Date(millis);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

export function ordersToCsv(orders: readonly OrderRecord[]): string {
  const rows = orders.map((order) => {
    const placedAt = toMillis(order.createdAt);
    return [
      order.number,
      placedAt != null ? localStamp(placedAt, true) : '',
      ORDER_STATUS_META[order.status].label,
      order.customerName,
      order.address.phone,
      order.address.city,
      formatAddress(order.address),
      order.itemCount,
      order.items.map((item) => `${item.quantity} × ${item.name}`).join('; '),
      order.subtotal,
      order.deliveryFee,
      order.discount,
      order.promoCode ?? '',
      order.total,
      paymentMethodLabel(order),
      paymentStatusMeta(order).label,
      order.paymentRef ?? '',
      order.id,
      order.deliveryId,
    ];
  });
  return Papa.unparse({ fields: COLUMNS, data: rows }, { escapeFormulae: true });
}

/** Save the orders as a CSV file (with a BOM so Excel reads ₹ and names correctly). */
export function downloadOrdersCsv(orders: readonly OrderRecord[], fileName: string) {
  const blob = new Blob(['﻿', ordersToCsv(orders)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
