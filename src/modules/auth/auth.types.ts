export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  createdAt: Date;
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
}

export interface AuthResponse {
  user: SafeUser;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  token: string;
}
