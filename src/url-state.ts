export const FILE_HINT_PARAM = 'file';
export const VIEW_PARAM = 'view';

export type AppViewMode = 'list' | 'patchbay' | 'nodes';

const APP_VIEW_MODES = new Set<AppViewMode>(['list', 'patchbay', 'nodes']);

export function readSessionIdFromHref(href: string): string | null {
  return new URL(href).searchParams.get(FILE_HINT_PARAM);
}

export function readViewModeFromHref(href: string): AppViewMode {
  const raw = new URL(href).searchParams.get(VIEW_PARAM);
  return APP_VIEW_MODES.has(raw as AppViewMode) ? (raw as AppViewMode) : 'list';
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

export function nextHrefForViewMode(href: string, viewMode: AppViewMode): string {
  const url = new URL(href);
  if (viewMode === 'list') {
    url.searchParams.delete(VIEW_PARAM);
  } else {
    url.searchParams.set(VIEW_PARAM, viewMode);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
