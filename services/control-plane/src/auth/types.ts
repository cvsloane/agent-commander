export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  role: UserRole;
}
