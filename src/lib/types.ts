export type Role = 'public' | 'staff' | 'pickup' | 'admin' | 'owner';

export type StockLevel = 0 | 1 | 2 | 3;

export type PublicStatusItem = {
  id: string;
  displayName: string;
  category: string;
  price: number;
  statusLevel: StockLevel;
  statusText: string;
  isSoldOut: boolean;
  allergyText: string;
  description: string;
  note: string;
};

export type PublicStatusResponse = {
  shopName: string;
  updatedAt: string;
  items: PublicStatusItem[];
  isPublicEnabled: boolean;
};

export type SessionPayload = {
  role: 'staff' | 'pickup' | 'admin' | 'owner';
  username: string;
  registerId?: 1 | 2 | 3 | 4;
  stationId?: 1 | 2 | 3 | 4;
  exp: number;
};

export type ProductRecord = {
  id: string;
  name: string;
  displayName: string;
  category: string;
  price: number;
  initialStock: number;
  currentStock: number;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  allergyText: string;
  description: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};
