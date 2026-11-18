export type Config = { baseUrl: string; authHeader: string | null };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.SCRUM_BOARD_BASE_URL?.trim() || 'http://127.0.0.1:4200';
  const baseUrl = raw.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('invalid_base_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('invalid_base_url');
  }
  const user = env.SCRUM_BOARD_AUTH_USER;
  const pass = env.SCRUM_BOARD_AUTH_PASSWORD;
  const authHeader =
    user !== undefined && user !== '' && pass !== undefined && pass !== ''
      ? `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
      : null;
  return { baseUrl, authHeader };
}
