export const FILE_HINT_PARAM = 'file';

export function readSessionIdFromHref(href: string): string | null {
  return new URL(href).searchParams.get(FILE_HINT_PARAM);
}

export function nextHrefForSession(
  href: string,
  sessionId: string | null,
): string {
  const url = new URL(href);
  if (sessionId) {
    url.searchParams.set(FILE_HINT_PARAM, sessionId);
  } else {
    url.searchParams.delete(FILE_HINT_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
