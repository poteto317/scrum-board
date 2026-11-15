/** Matches backend `kanban.NormalizePublicOrigin` (trim + strip all trailing slashes). */
export function normalizePublicOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Configured public origin when set; otherwise the current page origin (may be empty in non-browser tests). */
export function effectivePublicOrigin(configured: string, locationOrigin = ''): string {
  return configured || locationOrigin;
}