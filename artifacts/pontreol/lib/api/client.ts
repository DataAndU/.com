export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Client errors (auth, permission, validation, not found) will not succeed on retry. */
export function isClientError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `/api${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const detail = typeof errorData?.detail === "string" ? errorData.detail : null;
    throw new ApiError(detail || `API Error: ${response.status}`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export type User = {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  role: "buyer" | "provider" | null;
  isAdmin: boolean;
  verificationStatus: "notStarted" | "pending" | "verified" | "rejected";
  rating: number;
  reviewCount: number;
  contactEmailVisible: boolean;
  contactPhoneVisible: boolean;
  phone: string | null;
  createdAt: string;
};

export type ProviderSummary = {
  id: string;
  displayName: string;
  avatarUrl: string;
  verificationStatus: string;
  rating: number;
  reviewCount: number;
  contactEmail: string | null;
  contactPhone: string | null;
};

export type Media = {
  id: string;
  objectPath: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "ready";
};

export type Listing = {
  id: string;
  providerId: string;
  provider?: ProviderSummary;
  category: "services" | "spaces" | "equipment" | "delivery" | "travel";
  title: string;
  description: string;
  price: number;
  pricingMode: "fixed" | "negotiable";
  currency: "INR";
  locationLabel: string;
  latitude: number;
  longitude: number;
  status: "active" | "paused";
  attributes: Record<string, any>;
  photos: Media[];
  distanceKm?: number;
  viewCount: number;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Booking = {
  id: string;
  listingId: string;
  buyerId: string;
  providerId: string;
  category: string;
  status: string;
  details: Record<string, any>;
  quotedPrice: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  listingId: string;
  buyerId: string;
  providerId: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  createdAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type Plan = {
  id: string;
  name: string;
  role: "buyer" | "provider";
  cycle: "monthly" | "yearly";
  amountPaise: number;
  currency: "INR";
  active: boolean;
};

export type Subscription = {
  id: string;
  planId: string;
  planName: string;
  amountPaise: number;
  currency: string;
  cycle: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  razorpaySubscriptionId: string | null;
  scheduledChange?: { planId: string; planName: string } | null;
};

export type Payment = {
  id: string;
  subscriptionId: string;
  amountPaise: number;
  currency: string;
  status: string;
  createdAt: string;
};

export type Discount = {
  id: string;
  code: string;
  kind: "percentage" | "flat";
  value: number;
  planIds: string[];
  startsAt: string;
  endsAt: string;
  maxUses: number;
  uses: number;
  active: boolean;
};
