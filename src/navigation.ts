import type { WebContents } from 'electron';

const ROUTE_INITIAL = 'eae-dca';
const TARGET_PATH_PREFIX = `/baseshell/${ROUTE_INITIAL}/`;
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 30_000;

export function buildRoute(projectPath: string, projectId: string): string {
  return `/${ROUTE_INITIAL}/path/${encodeURIComponent(projectPath)}/projects/${projectId}/devices`;
}

// EAE-X uses JSON.parse(payload).baseRoute as its React Router basename.
// It must match the real URL, otherwise the MFE renders an empty view.
export function buildPayload(): string {
  return JSON.stringify({ baseRoute: `/baseshell/${ROUTE_INITIAL}` });
}

function buildNavigateScript(route: string, payload: string): string {
  const message = JSON.stringify({ type: 'navigate', route, payload });
  // JSON.stringify twice: the outer call produces a safely escaped JS string literal.
  return `window.postMessage(${JSON.stringify(message)}, '*'); undefined;`;
}

/**
 * Posts the hybridshell navigate message until the portal has routed into the MFE.
 *
 * The page must be the portal root (/baseshell/), not the deep URL: navigating to the
 * current URL is ignored by the router, so the MFE would stay mounted with payload '{}'.
 * The portal registers its message listener only after Angular bootstraps, and earlier
 * messages are lost, hence the retry loop. window._initialNavigation is not used because
 * the portal reassigns it, which is impossible for a contextBridge-exposed value.
 */
export function runNavigationLoop(webContents: WebContents, projectPath: string, projectId: string): () => void {
  const script = buildNavigateScript(buildRoute(projectPath, projectId), buildPayload());
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
      console.error(`[navigation] Portal did not route to ${TARGET_PATH_PREFIX} within ${TIMEOUT_MS / 1000}s`);
      stop();
      return;
    }
    try {
      const pathname = (await webContents.executeJavaScript('location.pathname')) as string;
      if (pathname.startsWith(TARGET_PATH_PREFIX)) {
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
