export const itemAppPath = (number: number, projectId?: number): string => {
  const base = `/items/${number}`;
  return projectId && projectId > 0 ? `${base}?project=${projectId}` : base;
};

export const itemDetailUrl = (origin: string, number: number, projectId?: number): string =>
  `${origin.replace(/\/$/, '')}${itemAppPath(number, projectId)}`;

export const copyText = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // After await, user activation is often gone — do not pretend execCommand works.
      return false;
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
};
