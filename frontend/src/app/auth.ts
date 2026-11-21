export type UserRole = 'admin' | 'member';

export type UserPublic = {
  id: number;
  loginName: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
};

/** Same-origin relative path only; rejects protocol-relative and absolute URLs. */
export function safeReturnUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://')) return null;
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login#')) {
    return null;
  }
  return value;
}

export function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'status' in error &&
    (error as { status: number }).status === 401
  );
}
