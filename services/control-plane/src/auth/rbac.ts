import type { AuthUser, UserRole } from './types.js';

const roleOrder: UserRole[] = ['viewer', 'operator', 'admin'];

export function hasRole(user: AuthUser, required: UserRole): boolean {
  return roleOrder.indexOf(user.role) >= roleOrder.indexOf(required);
}
