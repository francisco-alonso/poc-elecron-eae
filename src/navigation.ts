import type { WebContents } from 'electron';

export const PORTAL_BASE = '/baseshell';
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 30_000;

export interface NavigationTarget {
  /** Route relative to the portal base href, e.g. /eae-dca/projects. */
  route: string;
  payload: string;
}

/** First segment of the route: the routeInitial the portal matches against its app participations. */
export function routeInitialOf(route: string): string {
  return route.split('/').find((segment) => segment !== '') ?? '';
}

/**
 * Default payload: micro-frontends such as EAE-X use JSON.parse(payload).baseRoute as their router
 * basename. It must match the real URL, otherwise the micro-frontend renders an empty view.
 */
export function defaultPayload(route: string): string {
  return JSON.stringify({ baseRoute: `${PORTAL_BASE}/${routeInitialOf(route)}` });
}

export function toNavigationTarget(route: string, payload?: string): NavigationTarget {
  return { route, payload: payload ?? defaultPayload(route) };
}

function hasRoutedTo(pathname: string, route: string): boolean {
  const appBase = `${PORTAL_BASE}/${routeInitialOf(route)}`;
  return pathname === appBase || pathname.startsWith(`${appBase}/`);
}

function buildNavigateScript({ route, payload }: NavigationTarget): string {
  const message = JSON.stringify({ type: 'navigate', route, payload });
  // JSON.stringify twice: the outer call produces a safely escaped JS string literal.
  return `window.postMessage(${JSON.stringify(message)}, '*'); undefined;`;
}

/**
 * Posts the hybridshell navigate message until the portal has routed into the target app.
 *
 * The page must be the portal root (/baseshell/), not the deep URL: navigating to the
 * current URL is ignored by the router, so the micro-frontend would stay mounted with payload '{}'.
 * The portal registers its message listener only after Angular bootstraps, and earlier
 * messages are lost, hence the retry loop. window._initialNavigation is not used because
 * the portal reassigns it, which is impossible for a contextBridge-exposed value.
 */
export function runNavigationLoop(webContents: WebContents, target: NavigationTarget): () => void {
  const script = buildNavigateScript(target);
  const startedAt = Date.now();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const stop = (): void => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped || webContents.isDestroyed()) {
      return;
    }
    if (Date.now() - startedAt >= TIMEOUT_MS) {
      console.error(`[navigation] Portal did not route to ${target.route} within ${TIMEOUT_MS / 1000}s`);
      stop();
      return;
    }
    try {
      const pathname = (await webContents.executeJavaScript('location.pathname')) as string;
      if (hasRoutedTo(pathname, target.route)) {
        console.log(`[navigation] Portal routed to ${pathname}`);
        stop();
        return;
      }
      await webContents.executeJavaScript(script);
    } catch (error) {
      console.error('[navigation] Script execution failed:', error);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }
  };

  void tick();
  return stop;
}
