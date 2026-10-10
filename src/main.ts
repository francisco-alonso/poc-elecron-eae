import { app, BrowserWindow, Menu, net, session, shell } from 'electron';
import { join } from 'node:path';
import { type AppConfig, loadConfig } from './config';
import { type NavigationTarget, PORTAL_BASE, routeInitialOf, runNavigationLoop, toNavigationTarget } from './navigation';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ERROR_PAGE = join(__dirname, '..', 'static', 'error.html');

interface CheckFailure {
  check: string;
  detail: string;
  hint: string;
}

interface AppWindow {
  window: BrowserWindow;
  target: NavigationTarget;
  stopNavigation?: () => void;
}

const appWindows = new Map<number, AppWindow>();

function trustLocalGatewayCertificate(): void {
  // The Sandbox gateway uses a self-signed certificate. Trust it for localhost only;
  // -3 keeps Chromium's default verification for every other host.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(LOCAL_HOSTS.has(request.hostname) ? 0 : -3);
  });
}

function hasParticipation(body: unknown, routeInitial: string): boolean {
  if (!Array.isArray(body)) {
    return false;
  }
  return body.some((participation: { model?: unknown }) => {
    try {
      const model = typeof participation.model === 'string' ? JSON.parse(participation.model) : participation.model;
      return (model as { routeInitial?: unknown } | undefined)?.routeInitial === routeInitial;
    } catch {
      return false;
    }
  });
}

async function preflight(gatewayUrl: string, routeInitial: string): Promise<CheckFailure | undefined> {
  const extensionPointUrl = `${gatewayUrl}/extensionPoints/hybridshell-app-navigation`;
  const baseshellUrl = `${gatewayUrl}${PORTAL_BASE}/`;

  try {
    const extensionPoint = await net.fetch(extensionPointUrl);
    const body: unknown = await extensionPoint.json().catch(() => undefined);
    if (extensionPoint.status !== 200 || !hasParticipation(body, routeInitial)) {
      return {
        check: `GET ${extensionPointUrl}`,
        detail: `HTTP ${extensionPoint.status}, or no participation with routeInitial "${routeInitial}".`,
        hint: `Extension point empty or "${routeInitial}" missing: the app's .arp lacks the hybridshell-app-navigation subscription. Redeploy the app.`,
      };
    }

    const baseshell = await net.fetch(baseshellUrl);
    if (baseshell.status !== 200) {
      return {
        check: `GET ${baseshellUrl}`,
        detail: `HTTP ${baseshell.status}`,
        hint: '/baseshell/ 404: the baseshell app (se.ia.baseshell) is not installed in the Sandbox.',
      };
    }
  } catch (error) {
    return {
      check: `GET ${extensionPointUrl}`,
      detail: `Gateway unreachable: ${String(error)}`,
      hint: 'Sandbox not running. Start it with SE.IA.MAF.Configurator.exe -sandbox -desktop.',
    };
  }

  return undefined;
}

function showError(window: BrowserWindow, failure: CheckFailure): void {
  console.error(`[preflight] ${failure.check} failed: ${failure.detail}`);
  void window.loadFile(ERROR_PAGE, { query: { check: failure.check, detail: failure.detail, hint: failure.hint } });
}

function createWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'EAE-X Desktop',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
}

/** Route of a portal URL, or undefined when the URL is outside the portal of this gateway. */
function portalRouteOf(url: string, gatewayUrl: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.origin !== new URL(gatewayUrl).origin || !parsed.pathname.startsWith(`${PORTAL_BASE}/`)) {
    return undefined;
  }
  const route = parsed.pathname.slice(PORTAL_BASE.length);
  return routeInitialOf(route) === '' ? undefined : `${route}${parsed.search}`;
}

function openAppWindow(config: AppConfig, target: NavigationTarget): void {
  const window = createWindow();
  const id = window.webContents.id;
  const entry: AppWindow = { window, target };
  appWindows.set(id, entry);
  const portalUrl = `${config.gatewayUrl}${PORTAL_BASE}/`;

  // A portal link opened in a new window (e.g. "open in new window") gets its own app window;
  // other http(s) links open in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const route = portalRouteOf(url, config.gatewayUrl);
    if (route) {
      openAppWindow(config, toNavigationTarget(route));
    } else if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('console-message', (event) => {
    console.log(`[renderer ${id}] [${event.level}] ${event.message}`);
  });

  window.webContents.on('did-finish-load', () => {
    entry.stopNavigation?.();
    entry.stopNavigation = runNavigationLoop(window.webContents, entry.target);
  });

  window.on('closed', () => {
    entry.stopNavigation?.();
    appWindows.delete(id);
  });

  if (config.devtools) {
    window.webContents.openDevTools();
  }

  // Always load the portal root, never the deep URL (see navigation.ts).
  void window.loadURL(portalUrl);
}

/**
 * Replaces the default reload role: a plain reload would keep the deep URL (see navigation.ts).
 * The window reloads the portal root and navigates back to the page it was showing.
 */
async function reloadAppWindow(config: AppConfig, entry: AppWindow): Promise<void> {
  const { webContents } = entry.window;
  const current = (await webContents.executeJavaScript('location.href').catch(() => undefined)) as string | undefined;
  const route = current ? portalRouteOf(current, config.gatewayUrl) : undefined;
  if (route) {
    entry.target = toNavigationTarget(route, config.payload);
  }
  await entry.window.loadURL(`${config.gatewayUrl}${PORTAL_BASE}/`);
}

function buildMenu(config: AppConfig, startTarget: NavigationTarget): Menu {
  const focusedAppWindow = (): AppWindow | undefined => {
    const focused = BrowserWindow.getFocusedWindow();
    return focused ? appWindows.get(focused.webContents.id) : undefined;
  };

  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => openAppWindow(config, startTarget) },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const entry = focusedAppWindow();
            if (entry) {
              void reloadAppWindow(config, entry);
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }] },
  ]);
}

async function start(config: AppConfig): Promise<void> {
  trustLocalGatewayCertificate();
  const startTarget = toNavigationTarget(config.route, config.payload);

  const failure = await preflight(config.gatewayUrl, routeInitialOf(config.route));
  if (failure) {
    showError(createWindow(), failure);
    return;
  }

  Menu.setApplicationMenu(buildMenu(config, startTarget));
  openAppWindow(config, startTarget);
}

app.on('window-all-closed', () => app.quit());

void app.whenReady().then(async () => {
  let config: AppConfig;
  try {
    config = loadConfig(process.argv, process.env);
  } catch (error) {
    showError(createWindow(), {
      check: 'Configuration',
      detail: error instanceof Error ? error.message : String(error),
      hint: 'Fix the --route / --payload arguments (or EAE_ROUTE / EAE_PAYLOAD), then restart.',
    });
    return;
  }

  console.log(`[config] gateway=${config.gatewayUrl} route=${config.route} payload=${config.payload ?? '(default)'}`);
  await start(config);
});
