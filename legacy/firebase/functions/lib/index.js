"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  assignDelivery: () => assignDelivery,
  cancelOrder: () => cancelOrder,
  completeDelivery: () => completeDelivery,
  createDeliveries: () => createDeliveries,
  createStaffUser: () => createStaffUser,
  geocodeAddress: () => geocodeAddress,
  markStaleDriversOffline: () => markStaleDriversOffline,
  onChatMessageCreated: () => onChatMessageCreated,
  onDeliveryWritten: () => onDeliveryWritten,
  onDeviceWritten: () => onDeviceWritten,
  onDriverLocationWritten: () => onDriverLocationWritten,
  onNotificationCreated: () => onNotificationCreated,
  onReviewWritten: () => onReviewWritten,
  optimizeRoute: () => optimizeRoute,
  placeOrder: () => placeOrder,
  registerCustomer: () => registerCustomer,
  registerDriver: () => registerDriver,
  requestPhoneOtp: () => requestPhoneOtp,
  sendTestNotification: () => sendTestNotification,
  setDriverStatus: () => setDriverStatus,
  updateDeliveryStatus: () => updateDeliveryStatus,
  verifyPhoneOtp: () => verifyPhoneOtp
});
module.exports = __toCommonJS(index_exports);
var import_v2 = require("firebase-functions/v2");

// ../../packages/shared/src/constants.ts
var APP_NAME = "InstaSupply";
var COLLECTIONS = {
  users: "users",
  devices: "devices",
  driverLocations: "driverLocations",
  deliveries: "deliveries",
  events: "events",
  private: "private",
  routes: "routes",
  notifications: "notifications",
  threads: "threads",
  messages: "messages",
  tracking: "tracking",
  otpChallenges: "otpChallenges",
  devOutbox: "devOutbox",
  counters: "counters",
  categories: "categories",
  products: "products",
  reviews: "reviews",
  orders: "orders",
  addresses: "addresses",
  favorites: "favorites",
  cards: "cards"
};
var PRIVATE_META_DOC = "meta";
var DEFAULT_FUNCTIONS_REGION = "us-central1";
var LOCATION_STALE_MS = 2 * 60 * 1e3;
var DEFAULT_SERVICE_SECONDS = 3 * 60;
var ORDER_ID_PREFIX = "IS";
var MAX_DELIVERIES_PER_IMPORT = 200;
var PRIORITY_META = {
  normal: { label: "Normal", weight: 1 },
  high: { label: "High", weight: 2 },
  urgent: { label: "Urgent", weight: 4 }
};
var PRIORITIES = Object.keys(PRIORITY_META);
var VEHICLE_META = {
  bike: { label: "Bicycle", speedKmh: 14 },
  scooter: { label: "Scooter", speedKmh: 24 },
  car: { label: "Car", speedKmh: 26 },
  van: { label: "Van", speedKmh: 24 },
  truck: { label: "Truck", speedKmh: 20 }
};
var VEHICLE_TYPES = Object.keys(VEHICLE_META);
var FAILURE_REASONS = [
  { id: "customer_unavailable", label: "Customer not available" },
  { id: "wrong_address", label: "Wrong or incomplete address" },
  { id: "refused", label: "Customer refused the delivery" },
  { id: "access_issue", label: "Could not access the location" },
  { id: "damaged", label: "Package damaged" },
  { id: "vehicle_issue", label: "Vehicle problem" },
  { id: "other", label: "Other" }
];
var DECLINE_REASONS = [
  { id: "too_far", label: "Too far from my area" },
  { id: "overloaded", label: "I already have too many stops" },
  { id: "vehicle_issue", label: "Vehicle problem" },
  { id: "shift_ending", label: "My shift is ending" },
  { id: "other", label: "Other" }
];
function failureReasonLabel(id) {
  return FAILURE_REASONS.find((reason) => reason.id === id)?.label ?? "Other";
}
function declineReasonLabel(id) {
  return DECLINE_REASONS.find((reason) => reason.id === id)?.label ?? "Other";
}

// ../../packages/shared/src/status.ts
var DELIVERY_STATUSES = [
  "unassigned",
  "assigned",
  "accepted",
  "picked_up",
  "in_transit",
  "arrived",
  "delivered",
  "failed",
  "cancelled"
];
var ACTIVE_STATUSES = [
  "assigned",
  "accepted",
  "picked_up",
  "in_transit",
  "arrived"
];
var OPEN_STATUSES = ["unassigned", ...ACTIVE_STATUSES];
var TERMINAL_STATUSES = ["delivered", "failed", "cancelled"];
var LIVE_TRACKING_STATUSES = ["in_transit", "arrived"];
var STATUS_META = {
  unassigned: {
    label: "Unassigned",
    description: "Waiting for a driver",
    tone: "warning",
    customerLabel: "Order received"
  },
  assigned: {
    label: "Assigned",
    description: "Waiting for the driver to accept",
    tone: "info",
    customerLabel: "Driver assigned"
  },
  accepted: {
    label: "Accepted",
    description: "Driver accepted the delivery",
    tone: "info",
    customerLabel: "Driver assigned"
  },
  picked_up: {
    label: "Picked up",
    description: "Package is with the driver",
    tone: "brand",
    customerLabel: "Package picked up"
  },
  in_transit: {
    label: "On the way",
    description: "Driver is heading to the customer",
    tone: "brand",
    customerLabel: "On the way"
  },
  arrived: {
    label: "Arrived",
    description: "Driver is at the drop-off location",
    tone: "brand",
    customerLabel: "Driver has arrived"
  },
  delivered: {
    label: "Delivered",
    description: "Delivered to the customer",
    tone: "success",
    customerLabel: "Delivered"
  },
  failed: {
    label: "Failed",
    description: "Delivery attempt failed",
    tone: "danger",
    customerLabel: "Delivery attempt failed"
  },
  cancelled: {
    label: "Cancelled",
    description: "Cancelled by dispatch",
    tone: "neutral",
    customerLabel: "Cancelled"
  }
};
var PROGRESS_STEPS = [
  "assigned",
  "picked_up",
  "in_transit",
  "arrived",
  "delivered"
];
var DRIVER_TRANSITIONS = {
  // "unassigned" from "assigned" means the driver declined the job.
  assigned: ["accepted", "unassigned"],
  accepted: ["picked_up", "in_transit", "failed"],
  picked_up: ["in_transit", "failed"],
  // "picked_up" from "in_transit" parks the trip when the driver switches to another stop.
  in_transit: ["arrived", "delivered", "failed", "picked_up"],
  arrived: ["delivered", "failed", "in_transit"]
};
var STAFF_TRANSITIONS = {
  unassigned: ["assigned", "cancelled"],
  assigned: ["unassigned", "assigned", "delivered", "failed", "cancelled"],
  accepted: ["unassigned", "assigned", "delivered", "failed", "cancelled"],
  picked_up: ["unassigned", "assigned", "delivered", "failed", "cancelled"],
  in_transit: ["unassigned", "assigned", "delivered", "failed", "cancelled"],
  arrived: ["unassigned", "assigned", "delivered", "failed", "cancelled"],
  failed: ["unassigned", "assigned", "cancelled"]
};
function allowedTransitions(from, actor) {
  const table = actor === "driver" ? DRIVER_TRANSITIONS : STAFF_TRANSITIONS;
  return table[from] ?? [];
}
function canTransition(from, to, actor) {
  return allowedTransitions(from, actor).includes(to);
}
function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status);
}
function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}
function statusLabel(status) {
  return STATUS_META[status]?.label ?? status;
}
var STATUS_TIMESTAMP_FIELD = {
  assigned: "assignedAt",
  accepted: "acceptedAt",
  picked_up: "pickedUpAt",
  in_transit: "startedAt",
  arrived: "arrivedAt",
  delivered: "deliveredAt",
  failed: "failedAt",
  cancelled: "cancelledAt"
};

// ../../packages/shared/src/geo.ts
var EARTH_RADIUS_M = 6371e3;
var ROAD_DISTANCE_FACTOR = 1.35;
var DEFAULT_CITY_SPEED_KMH = 24;
var toRadians = (degrees) => degrees * Math.PI / 180;
function isValidLatLng(point) {
  if (!point || typeof point !== "object") return false;
  const { lat, lng } = point;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
function haversineMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
function estimateRoadMeters(straightLineMeters) {
  return straightLineMeters * ROAD_DISTANCE_FACTOR;
}
function estimateDriveSeconds(roadMeters, speedKmh = DEFAULT_CITY_SPEED_KMH) {
  const metersPerSecond = speedKmh * 1e3 / 3600;
  return roadMeters / metersPerSecond;
}
function boundsOf(points) {
  if (points.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  return { south, west, north, east };
}
function centerOf(points) {
  const bounds = boundsOf(points);
  if (!bounds) return null;
  return { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
}

// ../../packages/shared/src/route-optimizer.ts
var PRIORITY_FACTOR = 0.5;
var LATE_FACTOR = 5;
var EPSILON = 1e-6;
function buildEstimateMatrix(points, speedKmh = DEFAULT_CITY_SPEED_KMH) {
  const seconds = [];
  const meters = [];
  for (let i = 0; i < points.length; i += 1) {
    const secondsRow = [];
    const metersRow = [];
    for (let j = 0; j < points.length; j += 1) {
      const road = i === j ? 0 : estimateRoadMeters(haversineMeters(points[i], points[j]));
      metersRow.push(road);
      secondsRow.push(estimateDriveSeconds(road, speedKmh));
    }
    seconds.push(secondsRow);
    meters.push(metersRow);
  }
  return { seconds, meters };
}
function fillMatrixGaps(matrix, points, speedKmh = DEFAULT_CITY_SPEED_KMH) {
  const estimate = buildEstimateMatrix(points, speedKmh);
  const pick = (value, fallback) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    seconds: estimate.seconds.map(
      (row, i) => row.map((fallback, j) => i === j ? 0 : pick(matrix.seconds[i]?.[j], fallback))
    ),
    meters: estimate.meters.map(
      (row, i) => row.map((fallback, j) => i === j ? 0 : pick(matrix.meters[i]?.[j], fallback))
    )
  };
}
function optimizeStops(stops, matrix, options = {}) {
  const size = stops.length + 1;
  if (matrix.seconds.length !== size || matrix.meters.length !== size) {
    throw new Error(`Matrix must be ${size}x${size} (origin + ${stops.length} stops).`);
  }
  if (stops.length === 0) {
    return { legs: [], totalSeconds: 0, totalMeters: 0, finishOffsetSeconds: 0, cost: 0 };
  }
  const startTime = options.startTime ?? Date.now();
  const defaultService = options.defaultServiceSeconds ?? DEFAULT_SERVICE_SECONDS;
  const timeBudgetMs = options.timeBudgetMs ?? 250;
  const lockedIndex = options.lockedFirstId ? stops.findIndex((stop) => stop.id === options.lockedFirstId) : -1;
  const weightOf = (matrixIndex) => PRIORITY_META[stops[matrixIndex - 1]?.priority ?? "normal"].weight;
  const cost = (order2) => {
    let clock = 0;
    let travel = 0;
    let penalty = 0;
    let previous = 0;
    for (const current of order2) {
      const stop = stops[current - 1];
      const leg = matrix.seconds[previous][current];
      clock += leg;
      travel += leg;
      if (stop.windowStart != null) {
        const earliest = (stop.windowStart - startTime) / 1e3;
        if (clock < earliest) clock = earliest;
      }
      penalty += (weightOf(current) - 1) * clock * PRIORITY_FACTOR;
      if (stop.windowEnd != null) {
        const late = clock - (stop.windowEnd - startTime) / 1e3;
        if (late > 0) penalty += late * LATE_FACTOR;
      }
      clock += stop.serviceSeconds ?? defaultService;
      previous = current;
    }
    return travel + penalty;
  };
  let order = nearestNeighbourOrder(stops.length, matrix, weightOf, lockedIndex);
  const lockStart = lockedIndex >= 0 ? 1 : 0;
  order = improve(order, lockStart, cost, timeBudgetMs);
  return materialize(order, stops, matrix, startTime, defaultService, cost(order));
}
function nearestNeighbourOrder(count, matrix, weightOf, lockedIndex) {
  const remaining = /* @__PURE__ */ new Set();
  for (let index = 1; index <= count; index += 1) remaining.add(index);
  const order = [];
  let current = 0;
  if (lockedIndex >= 0) {
    current = lockedIndex + 1;
    order.push(current);
    remaining.delete(current);
  }
  while (remaining.size > 0) {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const score = matrix.seconds[current][candidate] / weightOf(candidate);
      if (score < bestScore - EPSILON || Math.abs(score - bestScore) <= EPSILON && candidate < bestIndex) {
        bestScore = score;
        bestIndex = candidate;
      }
    }
    order.push(bestIndex);
    remaining.delete(bestIndex);
    current = bestIndex;
  }
  return order;
}
function improve(initial, lockStart, cost, timeBudgetMs) {
  const deadline = Date.now() + timeBudgetMs;
  let order = initial;
  let best = cost(order);
  const length = order.length;
  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    for (let i = lockStart; i < length - 1 && !improved; i += 1) {
      for (let j = i + 1; j < length && !improved; j += 1) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const candidateCost = cost(candidate);
        if (candidateCost < best - EPSILON) {
          order = candidate;
          best = candidateCost;
          improved = true;
        }
      }
    }
    for (let i = lockStart; i < length && !improved; i += 1) {
      for (let j = lockStart; j < length && !improved; j += 1) {
        if (i === j) continue;
        const candidate = order.slice();
        const [moved] = candidate.splice(i, 1);
        candidate.splice(j, 0, moved);
        const candidateCost = cost(candidate);
        if (candidateCost < best - EPSILON) {
          order = candidate;
          best = candidateCost;
          improved = true;
        }
      }
    }
  }
  return order;
}
function materialize(order, stops, matrix, startTime, defaultService, finalCost) {
  const legs = [];
  let clock = 0;
  let totalSeconds = 0;
  let totalMeters = 0;
  let previous = 0;
  for (const current of order) {
    const stop = stops[current - 1];
    const legSeconds = matrix.seconds[previous][current];
    const legMeters = matrix.meters[previous][current];
    clock += legSeconds;
    if (stop.windowStart != null) {
      const earliest = (stop.windowStart - startTime) / 1e3;
      if (clock < earliest) clock = earliest;
    }
    const lateSeconds = stop.windowEnd != null ? Math.max(0, clock - (stop.windowEnd - startTime) / 1e3) : 0;
    legs.push({
      id: stop.id,
      stopIndex: current - 1,
      legSeconds,
      legMeters,
      arrivalOffsetSeconds: clock,
      lateSeconds
    });
    totalSeconds += legSeconds;
    totalMeters += legMeters;
    clock += stop.serviceSeconds ?? defaultService;
    previous = current;
  }
  return { legs, totalSeconds, totalMeters, finishOffsetSeconds: clock, cost: finalCost };
}

// ../../packages/shared/src/polyline.ts
function decodePolyline(encoded, precision = 5) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = () => {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      if (index >= encoded.length) throw new Error("Malformed polyline.");
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}
function simplifyPath(points, maxPoints = 500) {
  if (points.length <= maxPoints) return points.slice();
  const step = (points.length - 1) / (maxPoints - 1);
  const result = [];
  for (let index = 0; index < maxPoints; index += 1) {
    result.push(points[Math.round(index * step)]);
  }
  return result;
}

// ../../packages/shared/src/format.ts
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
}
function formatCurrency(amount, currency = "INR") {
  if (amount == null || !Number.isFinite(amount)) return "\u2014";
  try {
    return new Intl.NumberFormat(void 0, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
function firstName(name) {
  return (name ?? "").trim().split(/\s+/)[0] || "Customer";
}

// ../../packages/shared/src/validation.ts
var DEFAULT_COUNTRY_CODE = "+91";
var E164 = /^\+[1-9]\d{7,14}$/;
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normalizePhone(input, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
  if (!input) return null;
  let value = input.trim().replace(/[\s().-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (!value.startsWith("+")) {
    const national = value.replace(/^0+/, "");
    value = `${defaultCountryCode}${national}`;
  }
  return E164.test(value) ? value : null;
}
function isValidEmail(value) {
  return !!value && EMAIL.test(value.trim());
}
function isPriority(value) {
  return typeof value === "string" && PRIORITIES.includes(value);
}
function isVehicleType(value) {
  return typeof value === "string" && VEHICLE_TYPES.includes(value);
}
function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}
var toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
var toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "yes", "1", "y"].includes(value.trim().toLowerCase());
  return false;
};
function validateDeliveryInput(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const errors = {};
  const customerName = cleanText(input.customerName, 120);
  if (!customerName) errors.customerName = "Customer name is required.";
  const address = cleanText(input.address, 300);
  if (!address) errors.address = "Address is required.";
  let customerPhone = null;
  if (typeof input.customerPhone === "string" && input.customerPhone.trim()) {
    customerPhone = normalizePhone(input.customerPhone);
    if (!customerPhone) errors.customerPhone = "Enter a valid phone number.";
  }
  let customerEmail = null;
  if (typeof input.customerEmail === "string" && input.customerEmail.trim()) {
    customerEmail = input.customerEmail.trim().toLowerCase();
    if (!isValidEmail(customerEmail)) errors.customerEmail = "Enter a valid email address.";
  }
  let location = null;
  if (input.location != null) {
    const candidate = input.location;
    const point = { lat: toNumber(candidate.lat), lng: toNumber(candidate.lng) };
    if (isValidLatLng(point)) location = point;
    else errors.location = "Location coordinates are invalid.";
  }
  const packageCount = toNumber(input.packageCount) ?? 1;
  if (!Number.isInteger(packageCount) || packageCount < 1 || packageCount > 99) {
    errors.packageCount = "Packages must be a whole number between 1 and 99.";
  }
  const priorityRaw = typeof input.priority === "string" ? input.priority.trim().toLowerCase() : "";
  const priority = isPriority(priorityRaw) ? priorityRaw : "normal";
  if (priorityRaw && !isPriority(priorityRaw)) errors.priority = "Priority must be normal, high or urgent.";
  let codAmount = null;
  if (input.codAmount != null && input.codAmount !== "") {
    codAmount = toNumber(input.codAmount);
    if (codAmount == null || codAmount < 0 || codAmount > 1e7) {
      errors.codAmount = "Cash on delivery must be a positive amount.";
    }
  }
  const windowStart = toNumber(input.windowStart);
  const windowEnd = toNumber(input.windowEnd);
  if (windowStart != null && windowEnd != null && windowEnd <= windowStart) {
    errors.windowEnd = "The delivery window must end after it starts.";
  }
  const driverId = typeof input.driverId === "string" && input.driverId.trim() ? input.driverId.trim() : null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      customerName,
      customerPhone,
      customerEmail,
      address,
      location,
      addressNotes: cleanText(input.addressNotes, 300),
      notes: cleanText(input.notes, 500),
      packageCount,
      priority,
      codAmount: codAmount && codAmount > 0 ? Math.round(codAmount * 100) / 100 : null,
      requireCode: toBoolean(input.requireCode),
      driverId,
      windowStart,
      windowEnd
    }
  };
}
function randomToken(length, random) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = random(length * 2);
  let output = "";
  for (let index = 0; index < bytes.length && output.length < length; index += 1) {
    const byte = bytes[index];
    if (byte < Math.floor(256 / alphabet.length) * alphabet.length) {
      output += alphabet[byte % alphabet.length];
    }
  }
  if (output.length < length) return output + randomToken(length - output.length, random);
  return output;
}

// ../../packages/shared/src/commerce.ts
var CURRENCY = "INR";
var MAX_CART_LINES = 50;
var MAX_QUANTITY_PER_LINE = 20;
var ORDER_PROGRESS = [
  "placed",
  "confirmed",
  "packed",
  "out_for_delivery",
  "delivered"
];
function orderStatusForDelivery(status) {
  switch (status) {
    case "unassigned":
      return "placed";
    case "assigned":
    case "accepted":
      return "confirmed";
    case "picked_up":
      return "packed";
    case "in_transit":
    case "arrived":
      return "out_for_delivery";
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}
function canCustomerCancel(status) {
  return status === "placed" || status === "confirmed";
}
var FREE_DELIVERY_THRESHOLD = 499;
var DELIVERY_FEE = 30;
var PROMOS = {
  FIRST20: {
    code: "FIRST20",
    label: "20% off your first order (up to \u20B9100)",
    percent: 20,
    maxDiscount: 100,
    minSubtotal: 199,
    firstOrderOnly: true
  },
  FRESH10: {
    code: "FRESH10",
    label: "10% off orders above \u20B9799 (up to \u20B9150)",
    percent: 10,
    maxDiscount: 150,
    minSubtotal: 799,
    firstOrderOnly: false
  }
};
function findPromo(code) {
  if (!code) return null;
  return PROMOS[code.trim().toUpperCase()] ?? null;
}
var roundMoney = (value) => Math.round(value * 100) / 100;
function priceCart(lines, options = {}) {
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const deliveryFee = subtotal === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  let promo = null;
  let promoError = null;
  let discount = 0;
  if (options.promoCode) {
    const candidate = findPromo(options.promoCode);
    if (!candidate) promoError = "That code is not valid.";
    else if (candidate.firstOrderOnly && options.isFirstOrder === false) promoError = `${candidate.code} is for your first order only.`;
    else if (subtotal < candidate.minSubtotal) promoError = `Add items worth \u20B9${candidate.minSubtotal} to use ${candidate.code}.`;
    else {
      promo = candidate;
      discount = roundMoney(Math.min(candidate.maxDiscount, subtotal * candidate.percent / 100));
    }
  }
  return {
    itemCount,
    subtotal,
    deliveryFee,
    discount,
    total: roundMoney(Math.max(0, subtotal + deliveryFee - discount)),
    promoError,
    promo,
    amountToFreeDelivery: subtotal === 0 ? FREE_DELIVERY_THRESHOLD : roundMoney(Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal))
  };
}
function formatAddress(address) {
  return [address.line1, address.line2, address.city, address.zip].filter(Boolean).join(", ");
}

// src/config/runtime.ts
var import_params = require("firebase-functions/params");
var read = (name, fallback = "") => process.env[name]?.trim() || fallback;
var isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
var region = read("FUNCTIONS_REGION", DEFAULT_FUNCTIONS_REGION);
var managedSecrets = read("MANAGED_SECRETS").split(",").map((name) => name.trim()).filter(Boolean).map((name) => (0, import_params.defineSecret)(name));
var parseTestNumbers = (raw) => {
  const map = /* @__PURE__ */ new Map();
  for (const entry of raw.split(",")) {
    const [phone, code] = entry.split(":").map((part) => part.trim());
    const normalized = normalizePhone(phone);
    if (normalized && code && /^\d{6}$/.test(code)) map.set(normalized, code);
  }
  return map;
};
var settings = {
  get googleMapsApiKey() {
    return read("GOOGLE_MAPS_API_KEY");
  },
  get routingProvider() {
    const value = read("ROUTING_PROVIDER", "auto");
    return ["auto", "google", "osrm", "estimate"].includes(value) ? value : "auto";
  },
  get osrmUrl() {
    return read("OSRM_URL", "https://router.project-osrm.org").replace(/\/$/, "");
  },
  get geocoder() {
    const value = read("GEOCODER", "auto");
    return ["auto", "google", "nominatim", "none"].includes(value) ? value : "auto";
  },
  get twilio() {
    const accountSid = read("TWILIO_ACCOUNT_SID");
    const authToken = read("TWILIO_AUTH_TOKEN");
    const from = read("TWILIO_FROM");
    return accountSid && authToken && from ? { accountSid, authToken, from } : null;
  },
  get otpPepper() {
    const pepper = read("OTP_PEPPER");
    if (pepper) return pepper;
    if (isEmulator) return "local-emulator-pepper";
    throw new Error("OTP_PEPPER is not configured.");
  },
  get otpTestNumbers() {
    return parseTestNumbers(read("OTP_TEST_NUMBERS"));
  },
  get trackingBaseUrl() {
    return read("TRACKING_BASE_URL", "http://localhost:5173").replace(/\/$/, "");
  },
  get expoAccessToken() {
    return read("EXPO_ACCESS_TOKEN");
  },
  /**
   * Card payments. "test" simulates a successful charge (emulator default; never moves money).
   * "disabled" (production default) only allows cash on delivery until a real payment gateway is
   * integrated - see docs/DEPLOYMENT.md.
   */
  get paymentsMode() {
    const value = read("PAYMENTS_MODE", isEmulator ? "test" : "disabled");
    return value === "test" ? "test" : "disabled";
  }
};
var enforceAppCheck = read("ENFORCE_APP_CHECK") === "true";
var minInstances = Number(read("MIN_INSTANCES", "0")) || 0;

// src/lib/admin.ts
var import_app = require("firebase-admin/app");
var import_auth = require("firebase-admin/auth");
var import_firestore = require("firebase-admin/firestore");
var import_messaging = require("firebase-admin/messaging");
var app = (0, import_app.getApps)()[0] ?? (0, import_app.initializeApp)();
var db = (0, import_firestore.getFirestore)(app);
db.settings({ ignoreUndefinedProperties: true });
var auth = (0, import_auth.getAuth)(app);
var messaging = () => (0, import_messaging.getMessaging)(app);
var serverTimestamp = () => import_firestore.FieldValue.serverTimestamp();

// src/lib/errors.ts
var import_https = require("firebase-functions/v2/https");
function fail(code, message, details) {
  throw new import_https.HttpsError(code, message, details);
}
function invalidArgument(message, details) {
  fail("invalid-argument", message, details);
}
function notFound(message) {
  fail("not-found", message);
}
function permissionDenied(message = "You don't have permission to do that.") {
  fail("permission-denied", message);
}
function failedPrecondition(message) {
  fail("failed-precondition", message);
}
function errorCode(error4) {
  if (error4 && typeof error4 === "object" && "code" in error4) {
    const { code } = error4;
    return typeof code === "string" ? code : "";
  }
  return "";
}

// src/lib/functions.ts
var logger = __toESM(require("firebase-functions/logger"));
var import_https2 = require("firebase-functions/v2/https");
var baseOptions = {
  region,
  secrets: managedSecrets,
  maxInstances: 20,
  memory: "256MiB",
  timeoutSeconds: 60
};
var callableOptions = {
  ...baseOptions,
  enforceAppCheck,
  minInstances
};
function callable(name, handler, options = {}) {
  return (0, import_https2.onCall)({ ...callableOptions, ...options }, async (request) => {
    try {
      return await handler(request);
    } catch (error4) {
      if (error4 instanceof import_https2.HttpsError) throw error4;
      logger.error(`${name} failed`, {
        uid: request.auth?.uid,
        error: error4 instanceof Error ? { message: error4.message, stack: error4.stack } : error4
      });
      throw new import_https2.HttpsError("internal", "Something went wrong on our side. Please try again.");
    }
  });
}
async function settleAll(label, tasks) {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      const reason = result.reason;
      logger.error(`${label}: side effect failed`, {
        error: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason
      });
    }
  }
}

// src/lib/guards.ts
function requireAuth(request) {
  if (!request.auth) fail("unauthenticated", "Please sign in to continue.");
  const { uid, token } = request.auth;
  const role = ["admin", "dispatcher", "driver", "customer"].find((value) => value === token.role) ?? null;
  const isStaff = role === "admin" || role === "dispatcher";
  return {
    uid,
    role,
    name: typeof token.name === "string" ? token.name : null,
    isStaff,
    isAdmin: role === "admin",
    isActive: token.active === true
  };
}
function requireStaff(request) {
  const actor = requireAuth(request);
  if (!actor.isStaff || !actor.isActive) permissionDenied("This action is only available to dispatch staff.");
  return actor;
}
function requireAdmin(request) {
  const actor = requireAuth(request);
  if (!actor.isAdmin || !actor.isActive) permissionDenied("Only administrators can do this.");
  return actor;
}
function requireCustomer(request) {
  const actor = requireAuth(request);
  if (actor.role !== "customer" || !actor.isActive) {
    return fail("permission-denied", "Sign in with a shopping account to do this.");
  }
  return actor;
}
function requireOperator(request) {
  const actor = requireAuth(request);
  if (actor.isStaff && actor.isActive) return actor;
  if (actor.role === "driver" && actor.isActive) return actor;
  if (actor.role === "driver") {
    return fail("permission-denied", "Your driver account is waiting for approval.");
  }
  return permissionDenied();
}
function requireString(value, field, maxLength = 200) {
  if (typeof value !== "string" || !value.trim()) {
    fail("invalid-argument", `${field} is required.`);
  }
  return value.trim().slice(0, maxLength);
}

// src/lib/users.ts
var userRef = (uid) => db.collection(COLLECTIONS.users).doc(uid);
async function getUserProfile(uid) {
  const snapshot = await userRef(uid).get();
  return snapshot.exists ? { uid, ...snapshot.data() } : null;
}
var STAFF_CACHE_MS = 6e4;
var staffCache = null;
async function getActiveStaffIds(options = {}) {
  if (!staffCache || Date.now() - staffCache.at > STAFF_CACHE_MS) {
    const snapshot = await db.collection(COLLECTIONS.users).where("role", "in", ["admin", "dispatcher"]).where("status", "==", "active").get();
    const admins = [];
    const all = [];
    for (const doc of snapshot.docs) {
      all.push(doc.id);
      if (doc.get("role") === "admin") admins.push(doc.id);
    }
    staffCache = { at: Date.now(), admins, all };
  }
  return options.adminsOnly ? staffCache.admins : staffCache.all;
}
function vehicleLabel(profile) {
  const vehicle = profile?.vehicle;
  if (!vehicle) return null;
  const parts = [vehicle.model, vehicle.plate].filter(Boolean);
  return parts.length ? parts.join(" \xB7 ") : null;
}

// src/modules/notifications/notify.ts
var notificationsCol = () => db.collection(COLLECTIONS.notifications);
function toDocument(userId, input) {
  return {
    userId,
    type: input.type,
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 500),
    data: input.data ?? {},
    read: false,
    createdAt: serverTimestamp(),
    push: {
      status: input.silent ? "skipped" : "pending",
      successCount: 0,
      failureCount: 0
    }
  };
}
var isAlreadyExists = (error4) => {
  const code = errorCode(error4) || String(error4?.code ?? "");
  return code === "6" || code === "already-exists" || code.endsWith("ALREADY_EXISTS");
};
async function notifyUser(userId, input) {
  if (!userId) return;
  if (!input.key) {
    await notificationsCol().add(toDocument(userId, input));
    return;
  }
  try {
    await notificationsCol().doc(`${input.key}_${userId}`).create(toDocument(userId, input));
  } catch (error4) {
    if (!isAlreadyExists(error4)) throw error4;
  }
}
async function notifyUsers(userIds, input) {
  const unique = [...new Set(userIds)].filter(Boolean);
  await Promise.all(unique.map((userId) => notifyUser(userId, input)));
}
async function notifyStaff(input, options = {}) {
  const staffIds = await getActiveStaffIds({ adminsOnly: options.adminsOnly });
  await notifyUsers(
    staffIds.filter((id) => id !== options.exclude),
    input
  );
}

// src/modules/auth/register-driver.ts
var registerDriver = callable(
  "registerDriver",
  async (request) => {
    const actor = requireAuth(request);
    if (actor.isStaff) failedPrecondition("Staff accounts cannot register as drivers.");
    const displayName = cleanText(request.data?.displayName, 80);
    if (!displayName) invalidArgument("Enter your full name.");
    if (!isVehicleType(request.data?.vehicleType)) invalidArgument("Choose your vehicle type.");
    const plate = cleanText(request.data?.vehiclePlate, 20)?.toUpperCase();
    if (!plate) invalidArgument("Enter your vehicle registration number.");
    const vehicle = {
      type: request.data.vehicleType,
      plate,
      model: cleanText(request.data?.vehicleModel, 60)
    };
    const record = await auth.getUser(actor.uid);
    const ref = userRef(actor.uid);
    const { status, created } = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists) {
        const current = snapshot.data();
        tx.update(ref, { displayName, vehicle, updatedAt: serverTimestamp() });
        return { status: current.status, created: false };
      }
      tx.set(ref, {
        uid: actor.uid,
        role: "driver",
        status: "pending",
        displayName,
        email: record.email ?? null,
        phoneNumber: record.phoneNumber ?? null,
        phoneVerified: !!record.phoneNumber,
        vehicle,
        photoURL: record.photoURL ?? null,
        preferences: { chatPush: true, deliveryPush: true },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return { status: "pending", created: true };
    });
    await auth.updateUser(actor.uid, { displayName });
    if (created) {
      const claims = { role: "driver", active: false };
      await auth.setCustomUserClaims(actor.uid, { ...record.customClaims ?? {}, ...claims });
      await notifyStaff(
        {
          type: "driver_signup",
          title: "New driver waiting for approval",
          body: `${displayName} signed up (${vehicle.plate}). Review and approve them in Drivers.`,
          data: { driverId: actor.uid },
          key: `signup-${actor.uid}`
        },
        { adminsOnly: true }
      );
    }
    return { status };
  }
);

// src/modules/auth/phone-otp.ts
var import_node_crypto = require("node:crypto");

// src/modules/sms/sms.ts
var logger2 = __toESM(require("firebase-functions/logger"));
var OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
async function sendSms(message) {
  const twilio = settings.twilio;
  if (twilio) {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ To: message.to, From: twilio.from, Body: message.body }),
        signal: AbortSignal.timeout(1e4)
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      logger2.error("Twilio rejected SMS", { status: response.status, detail: detail.slice(0, 500) });
      throw new Error(`SMS provider error (${response.status}).`);
    }
    return "sent";
  }
  if (!isEmulator && message.purpose === "otp") {
    failedPrecondition("SMS verification is not configured yet. Please contact support.");
  }
  await db.collection(COLLECTIONS.devOutbox).add({
    channel: "sms",
    to: message.to,
    body: message.body,
    purpose: message.purpose,
    createdAt: serverTimestamp(),
    // TTL policy on this field cleans up old entries automatically.
    expiresAt: import_firestore.Timestamp.fromMillis(Date.now() + OUTBOX_RETENTION_MS)
  });
  logger2.info("SMS written to dev outbox", { to: message.to, purpose: message.purpose });
  return "outbox";
}

// src/modules/auth/phone-otp.ts
var CODE_TTL_SECONDS = 5 * 60;
var RESEND_COOLDOWN_SECONDS = 30;
var MAX_ATTEMPTS = 5;
var MAX_SENDS_PER_HOUR = 5;
var challengeRef = (uid) => db.collection(COLLECTIONS.otpChallenges).doc(uid);
var hashCode = (uid, phoneNumber, code) => (0, import_node_crypto.createHmac)("sha256", settings.otpPepper).update(`${uid}:${phoneNumber}:${code}`).digest("hex");
async function assertNumberAvailable(uid, phoneNumber) {
  try {
    const owner = await auth.getUserByPhoneNumber(phoneNumber);
    if (owner.uid !== uid) fail("already-exists", "This mobile number is already linked to another account.");
  } catch (error4) {
    if (errorCode(error4) !== "auth/user-not-found") throw error4;
  }
}
var requestPhoneOtp = callable(
  "requestPhoneOtp",
  async (request) => {
    const actor = requireAuth(request);
    const phoneNumber = normalizePhone(request.data?.phoneNumber);
    if (!phoneNumber) invalidArgument("Enter a valid mobile number, including the country code.");
    const profile = await userRef(actor.uid).get();
    if (!profile.exists) failedPrecondition("Finish creating your profile first.");
    await assertNumberAvailable(actor.uid, phoneNumber);
    const testCode = settings.otpTestNumbers.get(phoneNumber);
    const code = testCode ?? String((0, import_node_crypto.randomInt)(0, 1e6)).padStart(6, "0");
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(challengeRef(actor.uid));
      const current = snapshot.exists ? snapshot.data() : null;
      if (current) {
        const sinceLast = (now - current.lastSentAt.toMillis()) / 1e3;
        if (sinceLast < RESEND_COOLDOWN_SECONDS) {
          fail(
            "resource-exhausted",
            `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast)} seconds before requesting another code.`
          );
        }
      }
      let sendCount = 1;
      let windowStartedAt = import_firestore.Timestamp.fromMillis(now);
      if (current && now - current.windowStartedAt.toMillis() < 60 * 60 * 1e3) {
        sendCount = current.sendCount + 1;
        windowStartedAt = current.windowStartedAt;
      }
      if (sendCount > MAX_SENDS_PER_HOUR) {
        fail("resource-exhausted", "Too many codes requested. Please try again in an hour.");
      }
      tx.set(challengeRef(actor.uid), {
        phoneNumber,
        codeHash: hashCode(actor.uid, phoneNumber, code),
        attempts: 0,
        expiresAt: import_firestore.Timestamp.fromMillis(now + CODE_TTL_SECONDS * 1e3),
        lastSentAt: import_firestore.Timestamp.fromMillis(now),
        windowStartedAt,
        sendCount
      });
    });
    if (!testCode) {
      await sendSms({
        to: phoneNumber,
        purpose: "otp",
        body: `${code} is your ${APP_NAME} verification code. It expires in 5 minutes. Never share it.`
      });
    }
    return {
      phoneNumber,
      expiresInSeconds: CODE_TTL_SECONDS,
      resendInSeconds: RESEND_COOLDOWN_SECONDS,
      ...isEmulator ? { devCode: code } : {}
    };
  }
);
var verifyPhoneOtp = callable(
  "verifyPhoneOtp",
  async (request) => {
    const actor = requireAuth(request);
    const code = String(request.data?.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) invalidArgument("Enter the 6-digit code.");
    const result = await db.runTransaction(async (tx) => {
      const ref = challengeRef(actor.uid);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return { outcome: "missing" };
      const challenge = snapshot.data();
      if (challenge.expiresAt.toMillis() < Date.now()) return { outcome: "expired" };
      if (challenge.attempts >= MAX_ATTEMPTS) return { outcome: "locked" };
      const expected = Buffer.from(challenge.codeHash, "hex");
      const actual = Buffer.from(hashCode(actor.uid, challenge.phoneNumber, code), "hex");
      if (expected.length !== actual.length || !(0, import_node_crypto.timingSafeEqual)(expected, actual)) {
        tx.update(ref, { attempts: challenge.attempts + 1 });
        return { outcome: "wrong", remaining: MAX_ATTEMPTS - challenge.attempts - 1 };
      }
      tx.delete(ref);
      return { outcome: "ok", phoneNumber: challenge.phoneNumber };
    });
    switch (result.outcome) {
      case "missing":
        return failedPrecondition("Request a verification code first.");
      case "expired":
        return fail("deadline-exceeded", "This code has expired. Request a new one.");
      case "locked":
        return fail("resource-exhausted", "Too many incorrect attempts. Request a new code.");
      case "wrong":
        return invalidArgument(
          result.remaining > 0 ? `That code is incorrect. ${result.remaining} attempt${result.remaining === 1 ? "" : "s"} left.` : "That code is incorrect. Request a new code."
        );
      case "ok":
        break;
    }
    try {
      await auth.updateUser(actor.uid, { phoneNumber: result.phoneNumber });
    } catch (error4) {
      if (errorCode(error4) === "auth/phone-number-already-exists") {
        fail("already-exists", "This mobile number is already linked to another account.");
      }
      throw error4;
    }
    await userRef(actor.uid).update({
      phoneNumber: result.phoneNumber,
      phoneVerified: true,
      updatedAt: serverTimestamp()
    });
    return { phoneNumber: result.phoneNumber };
  }
);

// src/modules/auth/driver-status.ts
var setDriverStatus = callable(
  "setDriverStatus",
  async (request) => {
    const actor = requireAdmin(request);
    const uid = requireString(request.data?.uid, "Driver");
    const status = request.data?.status;
    if (status !== "active" && status !== "suspended") invalidArgument("Status must be active or suspended.");
    const reason = cleanText(request.data?.reason, 300);
    const snapshot = await userRef(uid).get();
    if (!snapshot.exists) notFound("Driver not found.");
    const profile = snapshot.data();
    if (profile.role !== "driver")
      failedPrecondition("Only driver accounts can be approved or suspended here.");
    if (profile.status === status) return { ok: true };
    const record = await auth.getUser(uid);
    const claims = { role: "driver", active: status === "active" };
    await auth.setCustomUserClaims(uid, { ...record.customClaims ?? {}, ...claims });
    await auth.updateUser(uid, { disabled: status === "suspended" });
    await userRef(uid).update({
      status,
      updatedAt: serverTimestamp(),
      ...status === "active" ? { approvedBy: actor.uid, approvedAt: serverTimestamp(), suspendedReason: null } : { suspendedReason: reason }
    });
    if (status === "suspended") {
      await auth.revokeRefreshTokens(uid);
      await db.collection(COLLECTIONS.driverLocations).doc(uid).set({ online: false }, { merge: true });
    } else {
      await notifyUser(uid, {
        type: "account_approved",
        title: "You're approved!",
        body: "Your driver account is active. Go online to start receiving deliveries."
      });
    }
    return { ok: true };
  }
);

// src/lib/ids.ts
var import_node_crypto2 = require("node:crypto");
var newTrackingToken = () => randomToken(24, (size) => (0, import_node_crypto2.randomBytes)(size));
var newHandoffCode = () => String((0, import_node_crypto2.randomInt)(0, 1e4)).padStart(4, "0");
var newTemporaryPassword = () => `${randomToken(20, (size) => (0, import_node_crypto2.randomBytes)(size))}!9a`;
var FIRST_ORDER_NUMBER = 10001;
var counterRef = () => db.collection(COLLECTIONS.counters).doc("deliveries");
async function peekOrderIdInTx(tx) {
  const snapshot = await tx.get(counterRef());
  const next = snapshot.get("next") ?? FIRST_ORDER_NUMBER;
  return {
    orderId: `${ORDER_ID_PREFIX}-${next}`,
    stage: () => tx.set(counterRef(), { next: next + 1 }, { merge: true })
  };
}
async function reserveOrderIds(count) {
  if (count <= 0) return [];
  const ref = counterRef();
  const start = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const next = snapshot.get("next") ?? FIRST_ORDER_NUMBER;
    tx.set(ref, { next: next + count }, { merge: true });
    return next;
  });
  return Array.from({ length: count }, (_, index) => `${ORDER_ID_PREFIX}-${start + index}`);
}

// src/modules/auth/staff.ts
var createStaffUser = callable(
  "createStaffUser",
  async (request) => {
    requireAdmin(request);
    const email = typeof request.data?.email === "string" ? request.data.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) invalidArgument("Enter a valid email address.");
    const displayName = cleanText(request.data?.displayName, 80);
    if (!displayName) invalidArgument("Enter a name.");
    const role = request.data?.role;
    if (role !== "admin" && role !== "dispatcher") invalidArgument("Role must be admin or dispatcher.");
    let uid;
    try {
      const user = await auth.createUser({ email, displayName, password: newTemporaryPassword() });
      uid = user.uid;
    } catch (error4) {
      if (errorCode(error4) === "auth/email-already-exists") {
        fail("already-exists", "Someone with this email already has an account.");
      }
      throw error4;
    }
    const claims = { role, active: true };
    await auth.setCustomUserClaims(uid, claims);
    await userRef(uid).set({
      uid,
      role,
      status: "active",
      displayName,
      email,
      phoneNumber: null,
      phoneVerified: false,
      preferences: { chatPush: true, deliveryPush: true },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const passwordSetupLink = await auth.generatePasswordResetLink(email);
    return { uid, passwordSetupLink };
  }
);

// src/modules/geocoding/geocoder.ts
var logger3 = __toESM(require("firebase-functions/logger"));
var USER_AGENT = "InstaSupply-Dispatch/1.0 (delivery address lookup)";
async function geocodeWithGoogle(query, near) {
  const params = new URLSearchParams({ address: query, key: settings.googleMapsApiKey });
  if (near) {
    params.set("bounds", `${near.lat - 0.5},${near.lng - 0.5}|${near.lat + 0.5},${near.lng + 0.5}`);
  }
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal: AbortSignal.timeout(8e3)
  });
  const payload = await response.json();
  if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
    throw new Error(`Google geocoding failed: ${payload.status}`);
  }
  return (payload.results ?? []).slice(0, 5).map((result) => ({
    label: result.formatted_address,
    location: { lat: result.geometry.location.lat, lng: result.geometry.location.lng }
  }));
}
var lastNominatimCall = 0;
async function geocodeWithNominatim(query, near) {
  const wait = lastNominatimCall + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimCall = Date.now();
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", addressdetails: "0" });
  if (near) {
    params.set("viewbox", `${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}`);
  }
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) throw new Error(`Nominatim failed with ${response.status}`);
  const payload = await response.json();
  return payload.map((item) => ({
    label: item.display_name,
    location: { lat: Number(item.lat), lng: Number(item.lon) }
  }));
}
async function geocode(query, near = null) {
  const mode = settings.geocoder;
  if (mode === "none") return [];
  const useGoogle2 = mode === "google" || mode === "auto" && !!settings.googleMapsApiKey;
  try {
    return useGoogle2 ? await geocodeWithGoogle(query, near) : await geocodeWithNominatim(query, near);
  } catch (error4) {
    logger3.warn("Geocoding failed", { query, error: error4 instanceof Error ? error4.message : error4 });
    return [];
  }
}
async function geocodeFirst(query, near = null) {
  const [first] = await geocode(query, near);
  return first?.location ?? null;
}
var geocodeAddress = callable(
  "geocodeAddress",
  async (request) => {
    requireStaff(request);
    const query = typeof request.data?.query === "string" ? request.data.query.trim() : "";
    if (query.length < 3) invalidArgument("Type at least 3 characters to search.");
    const near = isValidLatLng(request.data?.near) ? request.data.near : null;
    const results = await geocode(query.slice(0, 300), near);
    return { results };
  }
);

// src/modules/deliveries/repository.ts
function isCompleteDelivery(delivery) {
  return !!delivery && typeof delivery.orderId === "string" && typeof delivery.customer?.name === "string" && typeof delivery.address === "string" && isValidLatLng(delivery.location);
}
var deliveriesCol = () => db.collection(COLLECTIONS.deliveries);
var deliveryRef = (id) => deliveriesCol().doc(id);
var privateMetaRef = (id) => deliveryRef(id).collection(COLLECTIONS.private).doc(PRIVATE_META_DOC);
var eventsCol = (id) => deliveryRef(id).collection(COLLECTIONS.events);
var trackingRef = (token) => db.collection(COLLECTIONS.tracking).doc(token);
async function getDeliveryInTx(tx, id) {
  const snapshot = await tx.get(deliveryRef(id));
  if (!snapshot.exists) notFound("This delivery no longer exists.");
  return { id, ...snapshot.data() };
}
async function getPrivateMeta(id) {
  const snapshot = await privateMetaRef(id).get();
  return snapshot.exists ? snapshot.data() : null;
}
var SYSTEM_ACTOR = { id: null, name: "InstaSupply", role: "system" };
function eventActor(actor, fallbackName) {
  return { id: actor.uid, name: actor.name ?? fallbackName ?? null, role: actor.role ?? "system" };
}
function writeEvent(writer, delivery, actor, input) {
  const ref = eventsCol(delivery.id).doc();
  const data = {
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    driverId: delivery.driverId ?? null,
    type: input.type,
    status: input.status ?? null,
    fromStatus: input.fromStatus ?? null,
    message: input.message,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    location: input.location ?? null,
    at: serverTimestamp()
  };
  writer.set(ref, data);
}

// src/modules/deliveries/delivery-writer.ts
function stageNewDelivery(writer, delivery) {
  const { input, location, orderId, driver, actor } = delivery;
  const ref = deliveriesCol().doc();
  const trackingToken = newTrackingToken();
  const status = driver ? "assigned" : "unassigned";
  const set = (target, data) => writer.set(target, data);
  set(ref, {
    orderId,
    customer: { name: input.customerName, phone: input.customerPhone, email: input.customerEmail },
    address: input.address,
    location,
    addressNotes: input.addressNotes,
    notes: input.notes,
    packageCount: input.packageCount,
    priority: input.priority,
    codAmount: input.codAmount,
    requireCode: input.requireCode,
    windowStart: input.windowStart ? import_firestore.Timestamp.fromMillis(input.windowStart) : null,
    windowEnd: input.windowEnd ? import_firestore.Timestamp.fromMillis(input.windowEnd) : null,
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? null,
    status,
    attempts: 0,
    proof: null,
    failure: null,
    sourceOrderId: delivery.sourceOrderId ?? null,
    customerId: delivery.customerId ?? null,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    assignedAt: driver ? serverTimestamp() : null
  });
  set(privateMetaRef(ref.id), { trackingToken, handoffCode: newHandoffCode(), codeAttempts: 0 });
  set(trackingRef(trackingToken), { deliveryId: ref.id, orderId, status, updatedAt: serverTimestamp() });
  const summary = { id: ref.id, orderId, driverId: driver?.id ?? null };
  writeEvent(writer, summary, actor, {
    type: "created",
    status: "unassigned",
    message: delivery.sourceOrderId ? "Order placed by the customer" : "Delivery created"
  });
  if (driver) {
    writeEvent(writer, summary, actor, {
      type: "assigned",
      status: "assigned",
      fromStatus: "unassigned",
      message: `Assigned to ${driver.name}`
    });
  }
  return { id: ref.id, trackingToken };
}

// src/modules/deliveries/create-deliveries.ts
var DELIVERIES_PER_BATCH = 80;
var firstError = (errors) => Object.values(errors).find(Boolean) ?? "Invalid delivery.";
var createDeliveries = callable(
  "createDeliveries",
  async (request) => {
    const actor = requireStaff(request);
    const items = request.data?.deliveries;
    if (!Array.isArray(items) || items.length === 0) invalidArgument("Add at least one delivery.");
    if (items.length > MAX_DELIVERIES_PER_IMPORT) {
      invalidArgument(`You can import up to ${MAX_DELIVERIES_PER_IMPORT} deliveries at a time.`);
    }
    const errors = [];
    const valid = [];
    let lastLocation = null;
    for (const [index, raw] of items.entries()) {
      const result = validateDeliveryInput(raw);
      if (!result.ok) {
        errors.push({ index, message: firstError(result.errors) });
        continue;
      }
      const location = result.value.location ?? await geocodeFirst(result.value.address, lastLocation);
      if (!location) {
        errors.push({ index, message: "We couldn't find this address. Drop a pin on the map instead." });
        continue;
      }
      lastLocation = location;
      valid.push({ index, input: result.value, location });
    }
    const driverIds = [...new Set(valid.map((item) => item.input.driverId).filter(Boolean))];
    const drivers = /* @__PURE__ */ new Map();
    const driverSnaps = await Promise.all(
      driverIds.map((id) => db.collection(COLLECTIONS.users).doc(id).get())
    );
    for (const snapshot of driverSnaps) {
      const profile = snapshot.data();
      if (profile?.role === "driver" && profile.status === "active") drivers.set(snapshot.id, profile);
    }
    const ready = valid.filter((item) => {
      if (item.input.driverId && !drivers.has(item.input.driverId)) {
        errors.push({ index: item.index, message: "The selected driver is not available." });
        return false;
      }
      return true;
    });
    if (ready.length === 0) return { created: [], errors };
    const orderIds = await reserveOrderIds(ready.length);
    const created = [];
    const actorRef = { ...eventActor(actor), id: actor.uid };
    for (let start = 0; start < ready.length; start += DELIVERIES_PER_BATCH) {
      const batch = db.batch();
      for (const [offset, item] of ready.slice(start, start + DELIVERIES_PER_BATCH).entries()) {
        const orderId = orderIds[start + offset];
        const profile = item.input.driverId ? drivers.get(item.input.driverId) : null;
        const { id, trackingToken } = stageNewDelivery(batch, {
          input: item.input,
          location: item.location,
          orderId,
          driver: profile ? { id: item.input.driverId, name: profile.displayName } : null,
          actor: actorRef
        });
        created.push({ index: item.index, id, orderId, trackingToken });
      }
      await batch.commit();
    }
    return { created, errors: errors.sort((a, b) => a.index - b.index) };
  },
  { timeoutSeconds: 300 }
);

// src/modules/deliveries/assign-delivery.ts
var REASSIGNABLE = /* @__PURE__ */ new Set([
  "unassigned",
  "assigned",
  "accepted",
  "picked_up",
  "in_transit",
  "arrived",
  "failed"
]);
var assignDelivery = callable(
  "assignDelivery",
  async (request) => {
    const actor = requireStaff(request);
    const deliveryId = requireString(request.data?.deliveryId, "Delivery");
    const driverId = typeof request.data?.driverId === "string" && request.data.driverId ? request.data.driverId : null;
    const note = cleanText(request.data?.note, 300);
    await db.runTransaction(async (tx) => {
      const delivery = await getDeliveryInTx(tx, deliveryId);
      const driverSnap = driverId ? await tx.get(db.collection(COLLECTIONS.users).doc(driverId)) : null;
      if (!REASSIGNABLE.has(delivery.status)) {
        failedPrecondition(`A ${statusLabel(delivery.status).toLowerCase()} delivery can't be reassigned.`);
      }
      let driverName = null;
      if (driverId) {
        const driver = driverSnap?.data();
        if (driver?.role !== "driver" || driver.status !== "active") {
          failedPrecondition("That driver is not approved or has been suspended.");
        }
        driverName = driver.displayName;
      }
      if (driverId === delivery.driverId && delivery.status !== "failed") return;
      const isRetry = delivery.status === "failed";
      tx.update(deliveryRef(deliveryId), {
        driverId,
        driverName,
        status: driverId ? "assigned" : "unassigned",
        assignedAt: driverId ? serverTimestamp() : null,
        // A reassignment starts the driver-side flow again.
        acceptedAt: null,
        pickedUpAt: null,
        startedAt: null,
        arrivedAt: null,
        failure: isRetry ? null : delivery.failure,
        failedAt: isRetry ? null : delivery.failedAt ?? null,
        attempts: isRetry ? import_firestore.FieldValue.increment(1) : delivery.attempts,
        updatedBy: actor.uid,
        updatedAt: serverTimestamp()
      });
      const previous = delivery.driverName ? ` (was ${delivery.driverName})` : "";
      writeEvent(tx, { ...delivery, driverId }, eventActor(actor), {
        type: driverId ? "assigned" : "unassigned",
        status: driverId ? "assigned" : "unassigned",
        fromStatus: delivery.status,
        message: driverId ? `${isRetry ? "Retry assigned" : "Assigned"} to ${driverName}${previous}${note ? ` \u2014 ${note}` : ""}` : `Unassigned${previous}${note ? ` \u2014 ${note}` : ""}`
      });
    });
    return { ok: true };
  }
);

// src/modules/deliveries/update-status.ts
var MAX_CODE_ATTEMPTS = 5;
function describe(to, context) {
  const suffix = context.note ? ` \u2014 ${context.note}` : "";
  switch (to) {
    case "accepted":
      return "Driver accepted the delivery";
    case "picked_up":
      return "Package picked up";
    case "in_transit":
      return "Driver is on the way";
    case "arrived":
      return "Driver arrived at the drop-off";
    case "unassigned":
      return context.isDecline ? `Declined by driver: ${declineReasonLabel(context.reason)}${suffix}` : `Unassigned by dispatch${suffix}`;
    case "failed":
      return `Delivery failed: ${failureReasonLabel(context.reason)}${suffix}`;
    case "cancelled":
      return `Cancelled by dispatch${suffix}`;
    case "delivered":
      return `Marked as delivered by dispatch${suffix}`;
    default:
      return `Status changed to ${statusLabel(to)}${suffix}`;
  }
}
function assertOwnership(actor, delivery) {
  if (!actor.isStaff && delivery.driverId !== actor.uid) {
    permissionDenied("This delivery is not assigned to you.");
  }
}
var updateDeliveryStatus = callable(
  "updateDeliveryStatus",
  async (request) => {
    const actor = requireOperator(request);
    const deliveryId = requireString(request.data?.deliveryId, "Delivery");
    const to = request.data?.status;
    if (!to || !DELIVERY_STATUSES.includes(to)) invalidArgument("Unknown status.");
    if (to === "assigned") invalidArgument("Use assignDelivery to assign a driver.");
    const note = cleanText(request.data?.note, 500);
    const location = isValidLatLng(request.data?.location) ? request.data.location : null;
    const failureReason = request.data?.failureReason ?? null;
    const declineReason = request.data?.declineReason ?? null;
    if (to === "failed" && !FAILURE_REASONS.some((reason) => reason.id === failureReason)) {
      invalidArgument("Choose why the delivery failed.");
    }
    return db.runTransaction(async (tx) => {
      const delivery = await getDeliveryInTx(tx, deliveryId);
      assertOwnership(actor, delivery);
      const kind = actor.isStaff ? "staff" : "driver";
      if (delivery.status === to) return { status: to };
      if (!canTransition(delivery.status, to, kind)) {
        failedPrecondition(
          `A delivery can't go from "${statusLabel(delivery.status)}" to "${statusLabel(to)}".`
        );
      }
      if (kind === "driver" && to === "delivered") {
        failedPrecondition("Complete the delivery with proof of delivery.");
      }
      const isDecline = kind === "driver" && delivery.status === "assigned" && to === "unassigned";
      if (isDecline && !DECLINE_REASONS.some((reason) => reason.id === declineReason)) {
        invalidArgument("Choose why you are declining.");
      }
      const parked = kind === "driver" && to === "in_transit" ? (await tx.get(
        deliveriesCol().where("driverId", "==", actor.uid).where("status", "in", ["in_transit", "arrived"])
      )).docs.filter((doc) => doc.id !== deliveryId) : [];
      const update = {
        status: to,
        updatedBy: actor.uid,
        updatedAt: serverTimestamp()
      };
      const timestampField = STATUS_TIMESTAMP_FIELD[to];
      if (timestampField) update[timestampField] = serverTimestamp();
      if (to === "failed") update.failure = { reason: failureReason, note };
      if (to === "unassigned") {
        Object.assign(update, {
          driverId: null,
          driverName: null,
          assignedAt: null,
          acceptedAt: null,
          pickedUpAt: null,
          startedAt: null,
          arrivedAt: null
        });
        if (isDecline) update.declinedBy = import_firestore.FieldValue.arrayUnion(actor.uid);
      }
      if (to === "delivered") {
        update.proof = {
          recipientName: null,
          photoPath: null,
          codeVerified: false,
          codCollected: null,
          note: note ?? "Marked as delivered by dispatch",
          location: null
        };
      }
      tx.update(deliveryRef(deliveryId), update);
      for (const doc of parked) {
        tx.update(doc.ref, { status: "picked_up", updatedBy: actor.uid, updatedAt: serverTimestamp() });
        writeEvent(
          tx,
          { id: doc.id, orderId: doc.get("orderId"), driverId: actor.uid },
          SYSTEM_ACTOR,
          {
            type: "status",
            status: "picked_up",
            fromStatus: doc.get("status"),
            message: "Trip paused \u2014 the driver started another stop"
          }
        );
      }
      writeEvent(tx, delivery, eventActor(actor, delivery.driverName), {
        type: "status",
        status: to,
        fromStatus: delivery.status,
        message: describe(to, { actor, isDecline, note, reason: isDecline ? declineReason : failureReason }),
        location
      });
      return { status: to };
    });
  }
);
var completeDelivery = callable(
  "completeDelivery",
  async (request) => {
    const actor = requireOperator(request);
    const deliveryId = requireString(request.data?.deliveryId, "Delivery");
    const recipientName = cleanText(request.data?.recipientName, 80);
    const code = typeof request.data?.handoffCode === "string" ? request.data.handoffCode.replace(/\D/g, "") : "";
    const note = cleanText(request.data?.note, 500);
    const location = isValidLatLng(request.data?.location) ? request.data.location : null;
    const rawPhoto = request.data?.photoPath;
    const photoPath = typeof rawPhoto === "string" && rawPhoto.startsWith(`proofs/${deliveryId}/`) && !rawPhoto.includes("..") ? rawPhoto : null;
    if (rawPhoto && !photoPath) invalidArgument("The proof photo is invalid. Please retake it.");
    const rawCod = request.data?.codCollected;
    const codCollected = typeof rawCod === "number" && Number.isFinite(rawCod) && rawCod >= 0 ? Math.round(rawCod * 100) / 100 : null;
    const outcome = await db.runTransaction(async (tx) => {
      const delivery = await getDeliveryInTx(tx, deliveryId);
      const metaRef = privateMetaRef(deliveryId);
      const meta = await tx.get(metaRef);
      assertOwnership(actor, delivery);
      const kind = actor.isStaff ? "staff" : "driver";
      if (delivery.status === "delivered") return { ok: true };
      if (!canTransition(delivery.status, "delivered", kind)) {
        failedPrecondition(`This delivery can't be completed while it is "${statusLabel(delivery.status)}".`);
      }
      if (kind === "driver" && !recipientName && !photoPath) {
        invalidArgument("Add the recipient's name or a photo as proof of delivery.");
      }
      if (kind === "driver" && delivery.codAmount && codCollected == null) {
        invalidArgument(`Confirm the cash collected (${formatCurrency(delivery.codAmount)}).`);
      }
      let codeVerified = false;
      if (delivery.requireCode && kind === "driver") {
        const attempts = meta.get("codeAttempts") ?? 0;
        if (attempts >= MAX_CODE_ATTEMPTS) return { error: "locked" };
        if (!code || code !== meta.get("handoffCode")) {
          tx.update(metaRef, { codeAttempts: attempts + 1 });
          return { error: "wrong_code", remaining: MAX_CODE_ATTEMPTS - attempts - 1 };
        }
        codeVerified = true;
        tx.update(metaRef, { codeAttempts: 0 });
      }
      tx.update(deliveryRef(deliveryId), {
        status: "delivered",
        deliveredAt: serverTimestamp(),
        proof: { recipientName, photoPath, codeVerified, codCollected, note, location },
        updatedBy: actor.uid,
        updatedAt: serverTimestamp()
      });
      const details = [
        recipientName ? `to ${recipientName}` : null,
        codeVerified ? "code verified" : null,
        codCollected != null ? `${formatCurrency(codCollected)} collected` : null
      ].filter(Boolean);
      writeEvent(tx, delivery, eventActor(actor, delivery.driverName), {
        type: "status",
        status: "delivered",
        fromStatus: delivery.status,
        message: `Delivered${details.length ? ` (${details.join(", ")})` : ""}`,
        location
      });
      return { ok: true };
    });
    if ("error" in outcome) {
      if (outcome.error === "locked") {
        fail("resource-exhausted", "Too many incorrect codes. Ask dispatch to complete this delivery.");
      }
      invalidArgument(
        `That hand-off code is incorrect. ${outcome.remaining} attempt${outcome.remaining === 1 ? "" : "s"} left.`
      );
    }
    return { ok: true };
  }
);

// src/modules/deliveries/on-delivery-written.ts
var logger6 = __toESM(require("firebase-functions/logger"));
var import_firestore2 = require("firebase-functions/v2/firestore");

// src/modules/commerce/order-sync.ts
var rank = (status) => ORDER_PROGRESS.indexOf(status);
function messageFor(delivery, previous, order, next, changed) {
  const driver = firstName(delivery.driverName ?? "Your driver");
  if (delivery.status === "arrived" && previous?.status !== "arrived") {
    return {
      type: "order_update",
      title: `${driver} has arrived`,
      body: `Your delivery partner is at your door with ${order.number}. Keep your hand-off code ready.`
    };
  }
  if (!changed) return null;
  switch (next) {
    case "confirmed":
      return {
        type: "order_update",
        title: "Order confirmed",
        body: `${driver} will deliver your order ${order.number}.`
      };
    case "packed":
      return {
        type: "order_update",
        title: "Order packed",
        body: `${order.number} is packed and with ${driver}.`
      };
    case "out_for_delivery":
      return {
        type: "order_update",
        title: "Out for delivery",
        body: `${driver} is on the way with ${order.number}. Tap to track live.`
      };
    case "delivered":
      return {
        type: "order_delivered",
        title: "Delivered!",
        body: `Enjoy your groceries. Tap to rate the items in ${order.number}.`
      };
    case "failed":
      return {
        type: "order_update",
        title: "Delivery attempt failed",
        body: `We couldn't deliver ${order.number}. We'll contact you to reschedule.`
      };
    case "cancelled":
      return {
        type: "order_cancelled",
        title: "Order cancelled",
        body: `${order.number} was cancelled by the store.${order.paymentStatus === "paid" ? " Your refund is on its way." : ""}`
      };
    default:
      return null;
  }
}
async function syncOrderFromDelivery(eventId, before, after) {
  if (!after.sourceOrderId) return;
  if (before && before.status === after.status) return;
  const orderRef = db.collection(COLLECTIONS.orders).doc(after.sourceOrderId);
  const target = orderStatusForDelivery(after.status);
  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orderRef);
    if (!snapshot.exists) return null;
    const order = { id: snapshot.id, ...snapshot.data() };
    const restock = after.status === "cancelled" && order.status !== "cancelled" && order.items.length > 0;
    const productSnaps = restock ? await tx.getAll(...order.items.map((item) => db.collection(COLLECTIONS.products).doc(item.productId))) : [];
    let next = target;
    if (rank(next) >= 0 && rank(order.status) > rank(next) && order.status !== "failed") next = order.status;
    if (order.status === "cancelled") next = "cancelled";
    const update = {};
    const changed = next !== order.status;
    if (changed) {
      update.status = next;
      update[`statusAt.${next}`] = serverTimestamp();
    }
    if (after.status === "delivered" && order.paymentMethod === "cod" && order.paymentStatus === "cod_pending") {
      update.paymentStatus = "collected";
    }
    if (after.status === "cancelled") {
      if (order.paymentStatus === "paid") update.paymentStatus = "refund_pending";
      if (!order.cancelReason) update.cancelReason = "Cancelled by the store";
    }
    if (Object.keys(update).length > 0) {
      update.updatedAt = serverTimestamp();
      tx.update(orderRef, update);
    }
    productSnaps.forEach((product, index) => {
      if (product.exists)
        tx.update(product.ref, { stock: import_firestore.FieldValue.increment(order.items[index].quantity) });
    });
    return { order, next, changed };
  });
  if (!outcome) return;
  if (after.updatedBy && after.updatedBy === after.customerId) return;
  const message = messageFor(after, before, outcome.order, outcome.next, outcome.changed);
  if (!message) return;
  await notifyUser(outcome.order.customerId, {
    ...message,
    data: { customerOrderId: outcome.order.id, number: outcome.order.number },
    key: `${eventId}-order`
  });
}

// src/modules/routing/planner.ts
var import_node_crypto3 = require("node:crypto");
var logger5 = __toESM(require("firebase-functions/logger"));

// src/modules/routing/providers.ts
var logger4 = __toESM(require("firebase-functions/logger"));
var GOOGLE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
var GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
var REQUEST_TIMEOUT_MS = 8e3;
var GOOGLE_OPTIMAL_MAX_ELEMENTS = 100;
var GOOGLE_MAX_ELEMENTS = 625;
var GOOGLE_MAX_INTERMEDIATES = 25;
var OSRM_MAX_POINTS = 100;
var toWaypoint = (point) => ({
  location: { latLng: { latitude: point.lat, longitude: point.lng } }
});
var parseSeconds = (value) => value ? Number.parseFloat(value.replace("s", "")) : Number.NaN;
function useGoogle() {
  const mode = settings.routingProvider;
  return (mode === "auto" || mode === "google") && !!settings.googleMapsApiKey;
}
async function googleMatrix(points) {
  const elements = points.length * points.length;
  const response = await fetch(GOOGLE_MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": settings.googleMapsApiKey,
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition"
    },
    body: JSON.stringify({
      origins: points.map((point) => ({ waypoint: toWaypoint(point) })),
      destinations: points.map((point) => ({ waypoint: toWaypoint(point) })),
      travelMode: "DRIVE",
      routingPreference: elements <= GOOGLE_OPTIMAL_MAX_ELEMENTS ? "TRAFFIC_AWARE_OPTIMAL" : "TRAFFIC_AWARE"
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Routes matrix ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const text = await response.text();
  let rows;
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rows = text.split("\n").map((line) => line.trim().replace(/^[[,]|[\],]$/g, "")).filter(Boolean).map((line) => JSON.parse(line));
  }
  const size = points.length;
  const seconds = Array.from({ length: size }, () => Array(size).fill(Number.NaN));
  const meters = Array.from({ length: size }, () => Array(size).fill(Number.NaN));
  for (const row of rows) {
    const origin = row.originIndex ?? 0;
    const destination = row.destinationIndex ?? 0;
    if (row.condition && row.condition !== "ROUTE_EXISTS") continue;
    seconds[origin][destination] = parseSeconds(row.duration);
    meters[origin][destination] = row.distanceMeters ?? 0;
  }
  return { seconds, meters };
}
async function osrmMatrix(points) {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const response = await fetch(
    `${settings.osrmUrl}/table/v1/driving/${coordinates}?annotations=duration,distance`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`OSRM table ${response.status}`);
  const payload = await response.json();
  if (payload.code !== "Ok" || !payload.durations || !payload.distances) {
    throw new Error(`OSRM table returned ${payload.code}`);
  }
  return {
    seconds: payload.durations.map((row) => row.map((value) => value ?? Number.NaN)),
    meters: payload.distances.map((row) => row.map((value) => value ?? Number.NaN))
  };
}
async function getTravelMatrix(points, speedKmh) {
  const elements = points.length * points.length;
  try {
    if (useGoogle() && elements <= GOOGLE_MAX_ELEMENTS) {
      return { matrix: fillMatrixGaps(await googleMatrix(points), points, speedKmh), provider: "google" };
    }
    if (settings.routingProvider === "osrm" && points.length <= OSRM_MAX_POINTS) {
      return { matrix: fillMatrixGaps(await osrmMatrix(points), points, speedKmh), provider: "osrm" };
    }
  } catch (error4) {
    logger4.warn("Travel matrix provider failed; using estimates", {
      error: error4 instanceof Error ? error4.message : error4
    });
  }
  return { matrix: buildEstimateMatrix(points, speedKmh), provider: "estimate" };
}
async function getRoutePolyline(points, provider) {
  if (points.length < 2) return null;
  try {
    if (provider === "google" && points.length - 2 <= GOOGLE_MAX_INTERMEDIATES) {
      const response = await fetch(GOOGLE_ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": settings.googleMapsApiKey,
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline"
        },
        body: JSON.stringify({
          origin: toWaypoint(points[0]),
          destination: toWaypoint(points[points.length - 1]),
          intermediates: points.slice(1, -1).map(toWaypoint),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE"
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`Routes ${response.status}`);
      const payload = await response.json();
      const encoded = payload.routes?.[0]?.polyline?.encodedPolyline;
      return encoded ? decodePolyline(encoded) : null;
    }
    if (provider === "osrm") {
      const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
      const response = await fetch(
        `${settings.osrmUrl}/route/v1/driving/${coordinates}?overview=full&geometries=polyline`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      );
      if (!response.ok) throw new Error(`OSRM route ${response.status}`);
      const payload = await response.json();
      const geometry = payload.routes?.[0]?.geometry;
      return geometry ? decodePolyline(geometry) : null;
    }
  } catch (error4) {
    logger4.warn("Route geometry provider failed", { error: error4 instanceof Error ? error4.message : error4 });
  }
  return null;
}
async function getLiveDriveSeconds(from, to) {
  if (!useGoogle()) return null;
  try {
    const response = await fetch(GOOGLE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.googleMapsApiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
      },
      body: JSON.stringify({
        origin: toWaypoint(from),
        destination: toWaypoint(to),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE"
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const route = payload.routes?.[0];
    const seconds = parseSeconds(route?.duration);
    return Number.isFinite(seconds) ? { seconds, meters: route?.distanceMeters ?? 0 } : null;
  } catch {
    return null;
  }
}

// src/modules/routing/planner.ts
var LEASE_MS = 6e4;
var routeRef = (driverId) => db.collection(COLLECTIONS.routes).doc(driverId);
var round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
function planSignature(deliveries, origin) {
  const stops = deliveries.map((delivery) => [
    delivery.id,
    delivery.status,
    round(delivery.location.lat, 5),
    round(delivery.location.lng, 5),
    delivery.priority,
    toMillis(delivery.windowStart),
    toMillis(delivery.windowEnd)
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const roundedOrigin = origin ? [round(origin.lat, 3), round(origin.lng, 3)] : null;
  return (0, import_node_crypto3.createHash)("sha1").update(JSON.stringify({ stops, roundedOrigin })).digest("hex");
}
function summarize(plan) {
  return {
    stops: plan?.stops?.length ?? 0,
    totalSeconds: plan?.totalSeconds ?? 0,
    totalMeters: plan?.totalMeters ?? 0,
    provider: plan?.provider ?? "estimate"
  };
}
async function planRoute(driverId, options = {}) {
  const [deliveriesSnap, locationSnap, profileSnap] = await Promise.all([
    deliveriesCol().where("driverId", "==", driverId).where("status", "in", ACTIVE_STATUSES).get(),
    db.collection(COLLECTIONS.driverLocations).doc(driverId).get(),
    db.collection(COLLECTIONS.users).doc(driverId).get()
  ]);
  const deliveries = deliveriesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter(isCompleteDelivery);
  const live = locationSnap.exists ? locationSnap.data() : null;
  const origin = options.origin ?? (live ? { lat: live.lat, lng: live.lng } : null);
  const ref = routeRef(driverId);
  const signature = planSignature(deliveries, origin);
  if (!options.force) {
    const skip = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const lease = snapshot.get("lease");
      if (lease?.signature === signature && Date.now() - lease.at.toMillis() < LEASE_MS) return true;
      tx.set(ref, { lease: { signature, at: import_firestore.Timestamp.now() } }, { merge: true });
      return false;
    });
    if (skip) return summarize((await ref.get()).data());
  }
  if (deliveries.length === 0) {
    await ref.set({
      driverId,
      origin,
      stops: [],
      totalSeconds: 0,
      totalMeters: 0,
      polyline: [],
      provider: "estimate",
      computedAt: serverTimestamp(),
      lease: { signature, at: import_firestore.Timestamp.now() }
    });
    return summarize(void 0);
  }
  const profile = profileSnap.exists ? profileSnap.data() : null;
  const speedKmh = profile?.vehicle ? VEHICLE_META[profile.vehicle.type]?.speedKmh : void 0;
  const start = origin ?? centerOf(deliveries.map((delivery) => delivery.location));
  const points = [start, ...deliveries.map((delivery) => delivery.location)];
  const { matrix, provider } = await getTravelMatrix(points, speedKmh);
  const locked = deliveries.find(
    (delivery) => delivery.status === "in_transit" || delivery.status === "arrived"
  );
  const optimized = optimizeStops(
    deliveries.map((delivery) => ({
      id: delivery.id,
      location: delivery.location,
      priority: delivery.priority,
      windowStart: toMillis(delivery.windowStart),
      windowEnd: toMillis(delivery.windowEnd)
    })),
    matrix,
    { lockedFirstId: locked?.id ?? null }
  );
  const ordered = optimized.legs.map((leg) => ({ leg, delivery: deliveries[leg.stopIndex] }));
  const stops = ordered.map(({ leg, delivery }) => ({
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    customerName: delivery.customer.name,
    address: delivery.address,
    location: delivery.location,
    status: delivery.status,
    priority: delivery.priority,
    legSeconds: Math.round(leg.legSeconds),
    legMeters: Math.round(leg.legMeters),
    arrivalOffsetSeconds: Math.round(leg.arrivalOffsetSeconds)
  }));
  const path = [start, ...stops.map((stop) => stop.location)];
  const geometry = await getRoutePolyline(path, provider) ?? path;
  await ref.set({
    driverId,
    origin,
    stops,
    totalSeconds: Math.round(optimized.totalSeconds),
    totalMeters: Math.round(optimized.totalMeters),
    polyline: simplifyPath(geometry, 600),
    provider,
    computedAt: serverTimestamp(),
    lease: { signature, at: import_firestore.Timestamp.now() }
  });
  logger5.info("Route planned", { driverId, stops: stops.length, provider });
  return {
    stops: stops.length,
    totalSeconds: Math.round(optimized.totalSeconds),
    totalMeters: Math.round(optimized.totalMeters),
    provider
  };
}
async function planRouteSafely(driverId) {
  try {
    await planRoute(driverId);
  } catch (error4) {
    logger5.error("Route planning failed", {
      driverId,
      error: error4 instanceof Error ? { message: error4.message, stack: error4.stack } : error4
    });
  }
}

// src/modules/tracking/tracking-service.ts
var LIVE_ETA_REFRESH_MS = 6e4;
function timelineOf(delivery) {
  const steps = ["unassigned", ...PROGRESS_STEPS, "failed", "cancelled"];
  const timeline = [
    { status: "unassigned", at: delivery.createdAt }
  ];
  for (const status of steps) {
    const field = STATUS_TIMESTAMP_FIELD[status];
    const at = field ? delivery[field] : null;
    if (at) timeline.push({ status, at });
  }
  return timeline.sort((a, b) => (toMillis(a.at) ?? 0) - (toMillis(b.at) ?? 0));
}
function estimateEta(from, to, profile) {
  const meters = estimateRoadMeters(haversineMeters(from, to));
  const speed = profile?.vehicle ? VEHICLE_META[profile.vehicle.type]?.speedKmh : void 0;
  return { seconds: Math.round(estimateDriveSeconds(meters, speed)), meters: Math.round(meters) };
}
async function syncTracking(delivery, context = {}) {
  const meta = await getPrivateMeta(delivery.id);
  if (!meta) return;
  const ref = trackingRef(meta.trackingToken);
  const driverId = delivery.driverId;
  const [profile, location, route, existing] = await Promise.all([
    context.profile !== void 0 || !driverId ? context.profile ?? null : db.collection(COLLECTIONS.users).doc(driverId).get().then((s) => s.exists ? s.data() : null),
    context.location !== void 0 || !driverId ? context.location ?? null : db.collection(COLLECTIONS.driverLocations).doc(driverId).get().then((s) => s.exists ? s.data() : null),
    context.route !== void 0 || !driverId ? context.route ?? null : db.collection(COLLECTIONS.routes).doc(driverId).get().then((s) => s.exists ? s.data() : null),
    ref.get()
  ]);
  const live = LIVE_TRACKING_STATUSES.includes(delivery.status) && !!location;
  const stopIndex = route?.stops?.findIndex((stop) => stop.deliveryId === delivery.id) ?? -1;
  let etaSeconds = null;
  let distanceMeters = null;
  let etaComputedAt = existing.get("etaComputedAt");
  if (live && location) {
    const previousEta = existing.get("etaSeconds");
    const fresh = etaComputedAt && Date.now() - etaComputedAt.toMillis() < LIVE_ETA_REFRESH_MS;
    const google = fresh ? null : await getLiveDriveSeconds(location, delivery.location);
    if (google) {
      etaSeconds = Math.round(google.seconds);
      distanceMeters = Math.round(google.meters);
      etaComputedAt = import_firestore.Timestamp.now();
    } else {
      const estimate = estimateEta(location, delivery.location, profile);
      etaSeconds = fresh && typeof previousEta === "number" ? previousEta : estimate.seconds;
      distanceMeters = estimate.meters;
    }
    if (delivery.status === "arrived") etaSeconds = 0;
  } else if (stopIndex >= 0 && route?.stops) {
    const elapsed = (Date.now() - (toMillis(route.computedAt) ?? Date.now())) / 1e3;
    etaSeconds = Math.max(0, Math.round(route.stops[stopIndex].arrivalOffsetSeconds - elapsed));
  }
  await ref.set({
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    status: delivery.status,
    customerFirstName: firstName(delivery.customer.name),
    address: delivery.address,
    destination: delivery.location,
    driver: driverId ? {
      firstName: firstName(profile?.displayName ?? delivery.driverName),
      vehicle: vehicleLabel(profile),
      location: live && location ? { lat: location.lat, lng: location.lng } : null,
      heading: live && location ? location.heading : null,
      updatedAt: live && location ? location.updatedAt : null
    } : null,
    etaSeconds,
    distanceMeters,
    etaComputedAt: etaComputedAt ?? null,
    stopsBefore: stopIndex >= 0 ? stopIndex : null,
    handoffCode: delivery.requireCode ? meta.handoffCode : null,
    timeline: timelineOf(delivery),
    updatedAt: serverTimestamp()
  });
}
async function syncTrackingForDriver(driverId, location) {
  const snapshot = await deliveriesCol().where("driverId", "==", driverId).where("status", "in", LIVE_TRACKING_STATUSES).get();
  if (snapshot.empty) return;
  const [profileSnap, routeSnap] = await Promise.all([
    db.collection(COLLECTIONS.users).doc(driverId).get(),
    db.collection(COLLECTIONS.routes).doc(driverId).get()
  ]);
  const profile = profileSnap.exists ? profileSnap.data() : null;
  const route = routeSnap.exists ? routeSnap.data() : null;
  const deliveries = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter(isCompleteDelivery);
  await Promise.all(deliveries.map((delivery) => syncTracking(delivery, { profile, location, route })));
}
async function deleteTrackingForDelivery(deliveryId) {
  const snapshot = await db.collection(COLLECTIONS.tracking).where("deliveryId", "==", deliveryId).get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
}

// src/modules/deliveries/on-delivery-written.ts
var shortAddress = (address) => address.split(",").slice(0, 2).join(",").trim();
function didPlanningInputsChange(before, after) {
  if (!before) return true;
  return before.location.lat !== after.location.lat || before.location.lng !== after.location.lng || before.priority !== after.priority || toMillis(before.windowStart) !== toMillis(after.windowStart) || toMillis(before.windowEnd) !== toMillis(after.windowEnd);
}
function didPublicFieldsChange(before, after) {
  if (!before) return true;
  return before.status !== after.status || before.driverId !== after.driverId || before.address !== after.address || before.location.lat !== after.location.lat || before.location.lng !== after.location.lng || before.requireCode !== after.requireCode || before.customer.name !== after.customer.name;
}
async function notifyChange(eventId, before, after) {
  const data = { deliveryId: after.id, orderId: after.orderId };
  const summary = `${after.orderId} \xB7 ${after.customer.name} \xB7 ${shortAddress(after.address)}`;
  const actorId = after.updatedBy;
  const driverChanged = (before?.driverId ?? null) !== after.driverId;
  const jobs = [];
  const key = (suffix) => `${eventId}-${suffix}`;
  if (driverChanged) {
    if (after.driverId) {
      jobs.push(
        notifyUser(after.driverId, {
          type: "delivery_assigned",
          title: after.priority === "urgent" ? "Urgent delivery assigned" : "New delivery assigned",
          body: summary,
          data,
          key: key("assigned")
        })
      );
    }
    if (before?.driverId) {
      const declinedByDriver = actorId === before.driverId;
      if (declinedByDriver) {
        jobs.push(
          notifyStaff({
            type: "delivery_declined",
            title: `${before.driverName ?? "A driver"} declined ${after.orderId}`,
            body: "The delivery is back in the unassigned queue.",
            data,
            key: key("declined")
          })
        );
      } else if (!isTerminalStatus(after.status)) {
        jobs.push(
          notifyUser(before.driverId, {
            type: "delivery_unassigned",
            title: "Delivery removed from your route",
            body: `${after.orderId} for ${after.customer.name} was reassigned by dispatch.`,
            data,
            key: key("unassigned")
          })
        );
      }
    }
  }
  if (before && before.status !== after.status && !driverChanged) {
    const byDriver = !!after.driverId && actorId === after.driverId;
    if (after.status === "cancelled" && after.driverId) {
      jobs.push(
        notifyUser(after.driverId, {
          type: "delivery_cancelled",
          title: "Delivery cancelled",
          body: `${after.orderId} for ${after.customer.name} was cancelled. You don't need to deliver it.`,
          data,
          key: key("cancelled")
        })
      );
    } else if (after.status === "failed" && byDriver) {
      jobs.push(
        notifyStaff({
          type: "delivery_failed",
          title: `${after.orderId} could not be delivered`,
          body: `${after.driverName ?? "Driver"}: ${failureReasonLabel(after.failure?.reason)}`,
          data,
          key: key("failed")
        })
      );
    } else if (after.status === "delivered" && byDriver) {
      jobs.push(
        notifyStaff({
          type: "delivery_delivered",
          title: `${after.orderId} delivered`,
          body: `${after.driverName ?? "The driver"} completed the delivery to ${after.customer.name}.`,
          data,
          silent: true,
          key: key("delivered")
        })
      );
    } else if (!byDriver && after.driverId && isTerminalStatus(after.status)) {
      jobs.push(
        notifyUser(after.driverId, {
          type: "delivery_updated",
          title: `${after.orderId} was updated by dispatch`,
          body: `The delivery is now marked as ${after.status}.`,
          data,
          key: key("status")
        })
      );
    }
  }
  const detailsEditedByStaff = before && !driverChanged && after.driverId && isActiveStatus(after.status) && actorId !== after.driverId && (before.address !== after.address || before.addressNotes !== after.addressNotes || before.notes !== after.notes || before.customer.phone !== after.customer.phone);
  if (detailsEditedByStaff) {
    jobs.push(
      notifyUser(after.driverId, {
        type: "delivery_updated",
        title: `${after.orderId} details changed`,
        body: "Dispatch updated this delivery. Check the latest address and notes.",
        data,
        key: key("edited")
      })
    );
  }
  await Promise.all(jobs);
}
async function sendTrackingLinkOnce(delivery) {
  const phone = delivery.customer.phone;
  if (!phone) return;
  const metaRef = privateMetaRef(delivery.id);
  const token = await db.runTransaction(async (tx) => {
    const meta = await tx.get(metaRef);
    if (!meta.exists || meta.get("trackingLinkSentAt")) return null;
    tx.update(metaRef, { trackingLinkSentAt: serverTimestamp() });
    return meta.get("trackingToken");
  });
  if (!token) return;
  const link = `${settings.trackingBaseUrl}/track/${token}`;
  const channel = await sendSms({
    to: phone,
    purpose: "tracking_link",
    body: `${APP_NAME}: Hi ${firstName(delivery.customer.name)}, your order ${delivery.orderId} is on the way with ${firstName(delivery.driverName)}. Track it live: ${link}`
  });
  const batch = db.batch();
  writeEvent(batch, delivery, SYSTEM_ACTOR, {
    type: "customer_notified",
    message: channel === "sent" ? "Tracking link sent to the customer by SMS" : "Tracking link queued in the dev outbox"
  });
  await batch.commit();
}
var onDeliveryWritten = (0, import_firestore2.onDocumentWritten)(
  { ...baseOptions, document: `${COLLECTIONS.deliveries}/{deliveryId}` },
  async (event) => {
    const deliveryId = event.params.deliveryId;
    const read2 = (snapshot) => snapshot?.exists ? { id: deliveryId, ...snapshot.data() } : null;
    const previous = read2(event.data?.before);
    const after = read2(event.data?.after);
    if (!after) {
      await settleAll("onDeliveryDeleted", [
        deleteTrackingForDelivery(deliveryId),
        ...previous?.driverId ? [planRouteSafely(previous.driverId)] : []
      ]);
      return;
    }
    if (!isCompleteDelivery(after)) {
      logger6.warn("Skipping side effects for an incomplete delivery document", { deliveryId });
      return;
    }
    const before = isCompleteDelivery(previous) ? previous : null;
    const driverChanged = (before?.driverId ?? null) !== after.driverId;
    const statusChanged = before?.status !== after.status;
    const affectedDrivers = /* @__PURE__ */ new Set();
    if (driverChanged) {
      if (before?.driverId) affectedDrivers.add(before.driverId);
      if (after.driverId) affectedDrivers.add(after.driverId);
    } else if (after.driverId && (statusChanged || didPlanningInputsChange(before, after))) {
      affectedDrivers.add(after.driverId);
    }
    await Promise.all([...affectedDrivers].map(planRouteSafely));
    const tasks = [
      notifyChange(event.id, before, after),
      syncOrderFromDelivery(event.id, before, after)
    ];
    if (didPublicFieldsChange(before, after) || affectedDrivers.size > 0) tasks.push(syncTracking(after));
    if (statusChanged && after.status === "in_transit") tasks.push(sendTrackingLinkOnce(after));
    await settleAll("onDeliveryWritten", tasks);
  }
);

// src/modules/routing/optimize-route.ts
var DRIVER_COOLDOWN_MS = 15e3;
var optimizeRoute = callable(
  "optimizeRoute",
  async (request) => {
    const actor = requireOperator(request);
    const driverId = actor.isStaff ? requireString(request.data?.driverId, "Driver") : actor.uid;
    const origin = isValidLatLng(request.data?.origin) ? request.data.origin : null;
    if (!actor.isStaff) {
      const current = (await routeRef(driverId).get()).data();
      const computedAt = toMillis(current?.computedAt);
      if (current && computedAt && Date.now() - computedAt < DRIVER_COOLDOWN_MS) {
        return {
          stops: current.stops?.length ?? 0,
          totalSeconds: current.totalSeconds ?? 0,
          totalMeters: current.totalMeters ?? 0,
          provider: current.provider ?? "estimate"
        };
      }
    }
    return planRoute(driverId, { origin, force: true });
  }
);

// src/modules/tracking/triggers.ts
var import_firestore3 = require("firebase-functions/v2/firestore");
var MIN_MOVE_METERS = 15;
var MIN_INTERVAL_MS = 2e4;
var onDriverLocationWritten = (0, import_firestore3.onDocumentWritten)(
  { ...baseOptions, document: `${COLLECTIONS.driverLocations}/{driverId}` },
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;
    const before = event.data?.before.data();
    if (before && before.online === after.online) {
      const moved = haversineMeters(before, after);
      const elapsed = (toMillis(after.updatedAt) ?? 0) - (toMillis(before.updatedAt) ?? 0);
      if (moved < MIN_MOVE_METERS && elapsed < MIN_INTERVAL_MS) return;
    }
    await syncTrackingForDriver(event.params.driverId, after);
  }
);

// src/modules/notifications/triggers.ts
var logger8 = __toESM(require("firebase-functions/logger"));
var import_firestore4 = require("firebase-functions/v2/firestore");

// src/modules/notifications/push.ts
var logger7 = __toESM(require("firebase-functions/logger"));
var EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
function channelFor(type) {
  if (type.startsWith("order_")) return "orders";
  if (type === "delivery_assigned" || type === "delivery_cancelled" || type === "delivery_unassigned") {
    return "assignments";
  }
  if (type === "chat_message") return "chat";
  return "updates";
}
async function sendPushToUser(userId, notification) {
  const snapshot = await db.collection(COLLECTIONS.users).doc(userId).collection(COLLECTIONS.devices).get();
  const devices = snapshot.docs.map((doc) => ({
    ...doc.data(),
    ref: doc.ref
  }));
  if (devices.length === 0) return { status: "no_devices", successCount: 0, failureCount: 0 };
  const data = {
    ...notification.data,
    notificationId: notification.id,
    type: notification.type,
    // Lets the app ignore a tap on a push that was meant for another account on the same phone.
    userId
  };
  const [fcm, expo] = await Promise.all([
    sendFcm(
      devices.filter((device) => device.provider === "fcm"),
      notification,
      data
    ),
    sendExpo(
      devices.filter((device) => device.provider === "expo"),
      notification,
      data
    )
  ]);
  const successCount = fcm.success + expo.success;
  const failureCount = fcm.failure + expo.failure;
  const stale = [...fcm.stale, ...expo.stale];
  if (stale.length > 0) {
    const batch = db.batch();
    stale.forEach((device) => batch.delete(device.ref));
    await batch.commit();
    logger7.info("Removed invalid push tokens", { userId, count: stale.length });
  }
  const status = successCount > 0 && failureCount === 0 ? "sent" : successCount > 0 ? "partial" : fcm.skipped && expo.attempted === 0 ? "skipped" : "failed";
  return { status, successCount, failureCount };
}
async function sendFcm(devices, notification, data) {
  const result = { success: 0, failure: 0, stale: [], skipped: false };
  if (devices.length === 0) return result;
  if (isEmulator) {
    logger7.info("Emulator: skipping FCM delivery", { devices: devices.length, title: notification.title });
    result.skipped = true;
    return result;
  }
  const channelId = channelFor(notification.type);
  const response = await messaging().sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    notification: { title: notification.title, body: notification.body },
    data,
    android: {
      priority: "high",
      notification: { channelId, sound: "default", tag: data.deliveryId ?? data.threadId }
    },
    apns: { payload: { aps: { sound: "default", threadId: data.threadId ?? channelId } } },
    webpush: { fcmOptions: { link: data.link ?? "/" } }
  });
  response.responses.forEach((item, index) => {
    if (item.success) {
      result.success += 1;
      return;
    }
    result.failure += 1;
    const code = item.error?.code ?? "";
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument") {
      result.stale.push(devices[index]);
    }
  });
  return result;
}
async function sendExpo(devices, notification, data) {
  const result = { success: 0, failure: 0, stale: [], attempted: devices.length };
  if (devices.length === 0) return result;
  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json"
  };
  if (settings.expoAccessToken) headers.Authorization = `Bearer ${settings.expoAccessToken}`;
  for (let start = 0; start < devices.length; start += 100) {
    const chunk = devices.slice(start, start + 100);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(
          chunk.map((device) => ({
            to: device.token,
            title: notification.title,
            body: notification.body,
            data,
            sound: "default",
            priority: "high",
            channelId: channelFor(notification.type)
          }))
        ),
        signal: AbortSignal.timeout(1e4)
      });
      const payload = await response.json();
      const tickets = payload.data ?? [];
      chunk.forEach((device, index) => {
        const ticket = tickets[index];
        if (ticket?.status === "ok") {
          result.success += 1;
        } else {
          result.failure += 1;
          if (ticket?.details?.error === "DeviceNotRegistered") result.stale.push(device);
        }
      });
    } catch (error4) {
      result.failure += chunk.length;
      logger7.warn("Expo push request failed", { error: error4 instanceof Error ? error4.message : error4 });
    }
  }
  return result;
}

// src/modules/notifications/triggers.ts
function pushAllowed(notification, profile) {
  const preferences = profile?.preferences ?? {};
  if (notification.type === "chat_message") return preferences.chatPush !== false;
  if (notification.type.startsWith("order_")) return preferences.orderPush !== false;
  if (profile?.role !== "driver" && notification.type.startsWith("delivery_")) {
    return preferences.deliveryPush !== false;
  }
  return true;
}
var onNotificationCreated = (0, import_firestore4.onDocumentCreated)(
  { ...baseOptions, document: `${COLLECTIONS.notifications}/{notificationId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const notification = { id: snapshot.id, ...snapshot.data() };
    if (notification.push?.status !== "pending") return;
    const profile = await getUserProfile(notification.userId);
    if (!pushAllowed(notification, profile)) {
      await snapshot.ref.update({ "push.status": "skipped" });
      return;
    }
    const outcome = await sendPushToUser(notification.userId, notification);
    await snapshot.ref.update({
      "push.status": outcome.status,
      "push.successCount": outcome.successCount,
      "push.failureCount": outcome.failureCount,
      "push.sentAt": serverTimestamp()
    });
    logger8.info("Notification delivered", {
      notificationId: notification.id,
      userId: notification.userId,
      type: notification.type,
      ...outcome
    });
  }
);
var sendTestNotification = callable(
  "sendTestNotification",
  async (request) => {
    const actor = requireAuth(request);
    const devices = await db.collection(COLLECTIONS.users).doc(actor.uid).collection(COLLECTIONS.devices).count().get();
    await notifyUser(actor.uid, {
      type: "test",
      title: "Test notification",
      body: "Push notifications are working on this device."
    });
    return { devices: devices.data().count };
  }
);

// src/modules/notifications/device-tokens.ts
var logger9 = __toESM(require("firebase-functions/logger"));
var import_firestore5 = require("firebase-functions/v2/firestore");
function accountOf(ref) {
  const user = ref.parent.parent;
  return user?.parent.id === COLLECTIONS.users ? user.id : null;
}
var onDeviceWritten = (0, import_firestore5.onDocumentWritten)(
  { ...baseOptions, document: `${COLLECTIONS.users}/{uid}/${COLLECTIONS.devices}/{deviceId}` },
  async (event) => {
    const after = event.data?.after;
    const token = after?.get("token");
    if (typeof token !== "string" || !token) return;
    if (event.data?.before.get("token") === token) return;
    const holders = await db.collectionGroup(COLLECTIONS.devices).where("token", "==", token).get();
    let owner = event.params.uid;
    let latest = after?.updateTime?.valueOf() ?? "";
    for (const doc of holders.docs) {
      const account = accountOf(doc.ref);
      if (account && doc.updateTime.valueOf() > latest) {
        owner = account;
        latest = doc.updateTime.valueOf();
      }
    }
    const stale = holders.docs.filter((doc) => {
      const account = accountOf(doc.ref);
      return account !== null && account !== owner;
    });
    if (stale.length === 0) return;
    const batch = db.batch();
    stale.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    logger9.info("Removed a push token from its previous accounts", { userId: owner, count: stale.length });
  }
);

// src/modules/chat/on-message-created.ts
var import_firestore6 = require("firebase-functions/v2/firestore");
var onChatMessageCreated = (0, import_firestore6.onDocumentCreated)(
  { ...baseOptions, document: `${COLLECTIONS.threads}/{driverId}/${COLLECTIONS.messages}/{messageId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const { driverId, messageId } = event.params;
    const message = snapshot.data();
    const driver = await getUserProfile(driverId);
    const driverName = driver?.displayName ?? "Driver";
    const fromDriver = message.senderRole === "driver";
    await db.collection(COLLECTIONS.threads).doc(driverId).set(
      {
        driverId,
        driverName,
        lastMessage: {
          text: message.text.slice(0, 140),
          senderId: message.senderId,
          senderRole: message.senderRole,
          at: message.createdAt ?? serverTimestamp()
        },
        [fromDriver ? "unreadByStaff" : "unreadByDriver"]: import_firestore.FieldValue.increment(1),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    const notification = {
      type: "chat_message",
      body: message.text.slice(0, 200),
      data: { threadId: driverId, ...message.deliveryId ? { deliveryId: message.deliveryId } : {} },
      key: `chat-${messageId}`
    };
    if (fromDriver) {
      await notifyStaff({ ...notification, title: driverName });
    } else {
      await notifyUser(driverId, { ...notification, title: `Dispatch \xB7 ${message.senderName}` });
    }
  }
);

// src/modules/commerce/register-customer.ts
var OTHER_ACCOUNT = "This email belongs to a staff or driver account. Use another email for shopping.";
var isOtherRole = (role) => role != null && role !== "customer";
var registerCustomer = callable(
  "registerCustomer",
  async (request) => {
    const actor = requireAuth(request);
    if (isOtherRole(actor.role)) failedPrecondition(OTHER_ACCOUNT);
    const displayName = cleanText(request.data?.displayName, 80);
    if (!displayName) invalidArgument("Enter your name.");
    const record = await auth.getUser(actor.uid);
    const claims = record.customClaims ?? {};
    if (isOtherRole(claims.role)) failedPrecondition(OTHER_ACCOUNT);
    const ref = userRef(actor.uid);
    const status = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        tx.set(ref, {
          uid: actor.uid,
          role: "customer",
          status: "active",
          displayName,
          email: record.email ?? null,
          phoneNumber: record.phoneNumber ?? null,
          phoneVerified: !!record.phoneNumber,
          photoURL: record.photoURL ?? null,
          preferences: { orderPush: true, promoPush: true, chatPush: true },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        return "active";
      }
      const profile = snapshot.data();
      if (profile.role !== "customer") failedPrecondition(OTHER_ACCOUNT);
      if (profile.displayName !== displayName) {
        tx.update(ref, { displayName, updatedAt: serverTimestamp() });
      }
      return profile.status;
    });
    if (status === "active" && (claims.role !== "customer" || claims.active !== true)) {
      const customer = { role: "customer", active: true };
      await auth.setCustomUserClaims(actor.uid, { ...claims, ...customer });
    }
    if (record.displayName !== displayName) await auth.updateUser(actor.uid, { displayName });
    return { status };
  }
);

// src/modules/commerce/place-order.ts
var logger10 = __toESM(require("firebase-functions/logger"));
function normalizeLines(raw) {
  if (!Array.isArray(raw) || raw.length === 0) invalidArgument("Your cart is empty.");
  const merged = /* @__PURE__ */ new Map();
  for (const line of raw) {
    const productId = typeof line?.productId === "string" ? line.productId.trim() : "";
    const quantity = Number(line?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1) invalidArgument("Your cart has an invalid item.");
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  if (merged.size > MAX_CART_LINES) invalidArgument(`You can order up to ${MAX_CART_LINES} different products at once.`);
  for (const quantity of merged.values()) {
    if (quantity > MAX_QUANTITY_PER_LINE) invalidArgument(`You can order up to ${MAX_QUANTITY_PER_LINE} of each product.`);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}
function parsePaymentMethod(value) {
  if (value === "cod" || value === "card") return value;
  return invalidArgument("Choose a payment method.");
}
var placeOrder = callable("placeOrder", async (request) => {
  const actor = requireCustomer(request);
  const uid = actor.uid;
  const lines = normalizeLines(request.data?.items);
  const addressId = requireString(request.data?.addressId, "Delivery address");
  const paymentMethod = parsePaymentMethod(request.data?.paymentMethod);
  const notes = cleanText(request.data?.notes, 300);
  const promoCode = typeof request.data?.promoCode === "string" && request.data.promoCode.trim() ? request.data.promoCode.trim().toUpperCase() : null;
  if (paymentMethod === "card" && settings.paymentsMode !== "test") {
    failedPrecondition("Card payments are not available yet. Please choose cash on delivery.");
  }
  const addressRef = userRef(uid).collection(COLLECTIONS.addresses).doc(addressId);
  const addressSnap = await addressRef.get();
  if (!addressSnap.exists) notFound("That address no longer exists. Choose another one.");
  const savedAddress = addressSnap.data();
  let location = savedAddress.location;
  if (!location) {
    location = await geocodeFirst(formatAddress(savedAddress));
    if (!location) failedPrecondition("We couldn't locate this address. Edit it and drop a pin on the map.");
    await addressRef.update({ location });
  }
  const productRefs = lines.map((line) => db.collection(COLLECTIONS.products).doc(line.productId));
  const cardId = typeof request.data?.cardId === "string" ? request.data.cardId : null;
  const placed = await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(userRef(uid));
    const productSnaps = await tx.getAll(...productRefs);
    const cardSnap = paymentMethod === "card" && cardId ? await tx.get(userRef(uid).collection(COLLECTIONS.cards).doc(cardId)) : null;
    const previousOrders = await tx.get(db.collection(COLLECTIONS.orders).where("customerId", "==", uid).limit(20));
    const counter = await peekOrderIdInTx(tx);
    const profile = profileSnap.data();
    if (!profile || profile.role !== "customer") failedPrecondition("Finish setting up your account first.");
    if (!profile.phoneVerified) failedPrecondition("Verify your mobile number before placing an order.");
    const items = lines.map((line, index) => {
      const snapshot = productSnaps[index];
      const product = snapshot.data();
      if (!snapshot.exists || !product || !product.active) {
        return failedPrecondition("An item in your cart is no longer available. Please review your cart.");
      }
      if (product.stock < line.quantity) {
        return failedPrecondition(
          product.stock > 0 ? `Only ${product.stock} \xD7 ${product.name} left. Please update your cart.` : `${product.name} just sold out. Please remove it from your cart.`
        );
      }
      return {
        productId: snapshot.id,
        name: product.name,
        unit: product.unit,
        price: product.price,
        quantity: line.quantity,
        imageKey: product.imageKey ?? null,
        imageUrl: product.imageUrl ?? null,
        lineTotal: Math.round(product.price * line.quantity * 100) / 100
      };
    });
    const isFirstOrder = previousOrders.docs.every((doc) => doc.get("status") === "cancelled");
    const priced = priceCart(items, { promoCode, isFirstOrder });
    if (promoCode && priced.promoError) invalidArgument(priced.promoError);
    let card = null;
    if (paymentMethod === "card") {
      const saved = cardSnap?.exists ? cardSnap.data() : null;
      if (!saved) invalidArgument("Choose a saved card or add a new one.");
      card = { brand: saved.brand, last4: saved.last4 };
    }
    counter.stage();
    const orderRef = db.collection(COLLECTIONS.orders).doc();
    lines.forEach((line, index) => {
      tx.update(productRefs[index], { stock: import_firestore.FieldValue.increment(-line.quantity), updatedAt: serverTimestamp() });
    });
    const addressFields = {
      label: savedAddress.label,
      name: savedAddress.name,
      phone: savedAddress.phone,
      line1: savedAddress.line1,
      line2: savedAddress.line2 ?? null,
      landmark: savedAddress.landmark ?? null,
      city: savedAddress.city,
      zip: savedAddress.zip,
      location
    };
    const delivery = stageNewDelivery(tx, {
      input: {
        customerName: savedAddress.name,
        customerPhone: savedAddress.phone,
        customerEmail: profile.email,
        address: formatAddress(savedAddress),
        location,
        addressNotes: savedAddress.landmark ? `Landmark: ${savedAddress.landmark}` : null,
        notes,
        packageCount: Math.max(1, Math.ceil(priced.itemCount / 8)),
        priority: "normal",
        codAmount: paymentMethod === "cod" ? priced.total : null,
        requireCode: true,
        driverId: null,
        windowStart: null,
        windowEnd: null
      },
      location,
      orderId: counter.orderId,
      driver: null,
      actor: { id: uid, name: profile.displayName, role: "customer" },
      sourceOrderId: orderRef.id,
      customerId: uid
    });
    tx.set(orderRef, {
      number: counter.orderId,
      customerId: uid,
      customerName: profile.displayName,
      items,
      itemCount: priced.itemCount,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      discount: priced.discount,
      total: priced.total,
      currency: CURRENCY,
      promoCode: priced.promo?.code ?? null,
      paymentMethod,
      // Test mode: the card "charge" always succeeds and no money moves.
      paymentStatus: paymentMethod === "card" ? "paid" : "cod_pending",
      paymentRef: paymentMethod === "card" ? `test_${orderRef.id}` : null,
      card,
      address: addressFields,
      notes,
      status: "placed",
      statusAt: { placed: serverTimestamp() },
      deliveryId: delivery.id,
      trackingToken: delivery.trackingToken,
      cancelReason: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return {
      orderId: orderRef.id,
      number: counter.orderId,
      total: priced.total,
      itemCount: priced.itemCount,
      trackingToken: delivery.trackingToken,
      deliveryId: delivery.id,
      city: savedAddress.city
    };
  });
  logger10.info("Order placed", { uid, orderId: placed.orderId, total: placed.total, paymentMethod });
  await settleAll("placeOrder", [
    notifyUser(uid, {
      type: "order_placed",
      title: "Order placed",
      body: `${placed.number} \xB7 ${formatCurrency(placed.total)}. We'll let you know as soon as a driver is assigned.`,
      data: { customerOrderId: placed.orderId, number: placed.number },
      key: `order-placed-${placed.orderId}`
    }),
    notifyStaff({
      type: "order_placed",
      title: `New order ${placed.number}`,
      body: `${placed.itemCount} items \xB7 ${formatCurrency(placed.total)} \xB7 ${placed.city}. Assign a driver.`,
      data: { deliveryId: placed.deliveryId, orderId: placed.number, customerOrderId: placed.orderId },
      key: `order-placed-staff-${placed.orderId}`
    })
  ]);
  return {
    orderId: placed.orderId,
    number: placed.number,
    total: placed.total,
    trackingToken: placed.trackingToken
  };
});

// src/modules/commerce/cancel-order.ts
var CANCELLABLE_DELIVERY = /* @__PURE__ */ new Set(["unassigned", "assigned", "accepted"]);
var cancelOrder = callable("cancelOrder", async (request) => {
  const actor = requireCustomer(request);
  const orderId = requireString(request.data?.orderId, "Order");
  const reason = cleanText(request.data?.reason, 200);
  const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.data();
    if (!order || order.customerId !== actor.uid) notFound("Order not found.");
    if (order.status === "cancelled") return;
    const delivery = await getDeliveryInTx(tx, order.deliveryId);
    const productSnaps = await tx.getAll(
      ...order.items.map((item) => db.collection(COLLECTIONS.products).doc(item.productId))
    );
    if (!canCustomerCancel(order.status) || !CANCELLABLE_DELIVERY.has(delivery.status)) {
      failedPrecondition("Your order has already left the store and can no longer be cancelled.");
    }
    tx.update(orderRef, {
      status: "cancelled",
      "statusAt.cancelled": serverTimestamp(),
      cancelReason: reason ?? "Cancelled by you",
      paymentStatus: order.paymentStatus === "paid" ? "refund_pending" : order.paymentStatus,
      updatedAt: serverTimestamp()
    });
    tx.update(deliveryRef(delivery.id), {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp()
    });
    order.items.forEach((item, index) => {
      if (productSnaps[index]?.exists) {
        tx.update(productSnaps[index].ref, { stock: import_firestore.FieldValue.increment(item.quantity) });
      }
    });
    writeEvent(tx, delivery, { id: actor.uid, name: order.customerName, role: "customer" }, {
      type: "status",
      status: "cancelled",
      fromStatus: delivery.status,
      message: `Cancelled by the customer${reason ? ` \u2014 ${reason}` : ""}`
    });
  });
  return { ok: true };
});

// src/modules/commerce/reviews.ts
var import_firestore7 = require("firebase-admin/firestore");
var logger11 = __toESM(require("firebase-functions/logger"));
var import_firestore8 = require("firebase-functions/v2/firestore");
var onReviewWritten = (0, import_firestore8.onDocumentWritten)(
  { ...baseOptions, document: `${COLLECTIONS.products}/{productId}/${COLLECTIONS.reviews}/{userId}` },
  async (event) => {
    const productRef = db.collection(COLLECTIONS.products).doc(event.params.productId);
    const summary = await productRef.collection(COLLECTIONS.reviews).aggregate({ count: import_firestore7.AggregateField.count(), average: import_firestore7.AggregateField.average("rating") }).get();
    const { count, average } = summary.data();
    try {
      await productRef.update({
        rating: average ? Math.round(average * 10) / 10 : 0,
        ratingCount: count
      });
    } catch (error4) {
      logger11.warn("Could not update product rating", {
        productId: event.params.productId,
        error: error4 instanceof Error ? error4.message : error4
      });
    }
  }
);

// src/modules/maintenance/scheduled.ts
var logger12 = __toESM(require("firebase-functions/logger"));
var import_scheduler = require("firebase-functions/v2/scheduler");
var OFFLINE_AFTER_MS = 10 * 60 * 1e3;
var markStaleDriversOffline = (0, import_scheduler.onSchedule)(
  { region, secrets: managedSecrets, schedule: "every 5 minutes", timeoutSeconds: 120, retryCount: 0 },
  async () => {
    const cutoff = import_firestore.Timestamp.fromMillis(Date.now() - OFFLINE_AFTER_MS);
    const stale = await db.collection(COLLECTIONS.driverLocations).where("online", "==", true).where("updatedAt", "<", cutoff).limit(400).get();
    if (stale.empty) return;
    const batch = db.batch();
    stale.docs.forEach((doc) => batch.update(doc.ref, { online: false }));
    await batch.commit();
    logger12.info("Marked stale drivers offline", { count: stale.size });
  }
);

// src/index.ts
(0, import_v2.setGlobalOptions)({ region, maxInstances: 20 });
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assignDelivery,
  cancelOrder,
  completeDelivery,
  createDeliveries,
  createStaffUser,
  geocodeAddress,
  markStaleDriversOffline,
  onChatMessageCreated,
  onDeliveryWritten,
  onDeviceWritten,
  onDriverLocationWritten,
  onNotificationCreated,
  onReviewWritten,
  optimizeRoute,
  placeOrder,
  registerCustomer,
  registerDriver,
  requestPhoneOtp,
  sendTestNotification,
  setDriverStatus,
  updateDeliveryStatus,
  verifyPhoneOtp
});
//# sourceMappingURL=index.js.map
