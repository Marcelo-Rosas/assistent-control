/**
 * Extrai objetos JSON embutidos no payload de hidratação do Next.js
 * (mesma técnica usada em TotalPass/Wellhub/GuruPass scrapers).
 */

export function unescapeJsString(escapedBody: string): string {
  try {
    return JSON.parse(`"${escapedBody}"`) as string;
  } catch {
    return escapedBody.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export function extractBalanced(
  html: string,
  key: string,
  openChar: '{' | '[' = '{',
  closeChar: '}' | ']' = '}',
): string | null {
  const marker = `\\"${key}\\":${openChar}`;
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let i = start + marker.length - 1;
  let depth = 0;
  let inString = false;
  let j = i;
  const n = html.length;

  while (j < n) {
    if (html[j] === '\\' && j + 1 < n && html[j + 1] === '"') {
      inString = !inString;
      j += 2;
      continue;
    }
    const c = html[j];
    if (!inString) {
      if (c === openChar) depth += 1;
      else if (c === closeChar) {
        depth -= 1;
        if (depth === 0) return html.slice(i + 1, j);
      }
    }
    j += 1;
  }
  return null;
}

export function extractBalancedJson<T = unknown>(
  html: string,
  key: string,
  openChar: '{' | '[' = '{',
  closeChar: '}' | ']' = '}',
): T | null {
  const raw = extractBalanced(html, key, openChar, closeChar);
  if (raw == null) return null;
  try {
    const unescaped = unescapeJsString(raw);
    return JSON.parse(`${openChar}${unescaped}${closeChar}`) as T;
  } catch {
    return null;
  }
}
