export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AuthUser {
  id: string;
  sub: string;
  email?: string;
  name?: string;
  role: UserRole;
  auth_type: 'jwt' | 'service';
  service_name?: string;
}
