import { app, BrowserWindow, Menu, net, session, shell } from 'electron';
import { join } from 'node:path';
import { type AppConfig, loadConfig } from './config';
import { runNavigationLoop } from './navigation';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ERROR_PAGE = join(__dirname, '..', 'static', 'error.html');

interface CheckFailure {
  check: string;
  detail: string;
  hint: string;
}

function trustLocalGatewayCertificate(): void {
  // The Sandbox gateway uses a self-signed certificate. Trust it for localhost only;
  // -3 keeps Chromium's default verification for every other host.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(LOCAL_HOSTS.has(request.hostname) ? 0 : -3);
  });
}

function hasEaeDcaParticipation(body: unknown): boolean {
  if (!Array.isArray(body)) {
    return false;
  }
  return body.some((participation: { model?: unknown }) => {
    try {
      const model = typeof participation.model === 'string' ? JSON.parse(participation.model) : participation.model;
      return (model as { routeInitial?: unknown } | undefined)?.routeInitial === 'eae-dca';
    } catch {
      return false;
    }
  });
}

async function preflight(gatewayUrl: string): Promise<CheckFailure | undefined> {
  const extensionPointUrl = `${gatewayUrl}/extensionPoints/hybridshell-app-navigation`;
  const baseshellUrl = `${gatewayUrl}/baseshell/`;

  try {
    const extensionPoint = await net.fetch(extensionPointUrl);
    if (extensionPoint.status !== 200 || !hasEaeDcaParticipation(await extensionPoint.json().catch(() => undefined))) {
      return {
        check: `GET ${extensionPointUrl}`,
        detail: `HTTP ${extensionPoint.status}, or no participation with routeInitial "eae-dca".`,
        hint: 'Extension point empty or eae-dca missing: the EAE-X .arp lacks the hybridshell-app-navigation subscription. Redeploy EAE-X.',
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

function buildMenu(window: BrowserWindow, portalUrl: string): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        // Replaces the default reload role: a plain reload would keep the deep URL
        // (see navigation.ts). did-finish-load restarts the navigation loop.
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => void window.loadURL(portalUrl) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }] },
  ]);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'EAE-X Desktop',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('console-message', (event) => {
    console.log(`[renderer] [${event.level}] ${event.message}`);
  });

  return window;
}

async function start(config: AppConfig): Promise<void> {
  trustLocalGatewayCertificate();
  const window = createWindow();
  if (config.devtools) {
    window.webContents.openDevTools();
  }

  const failure = await preflight(config.gatewayUrl);
  if (failure) {
    showError(window, failure);
    return;
  }

  const portalUrl = `${config.gatewayUrl}/baseshell/`;
  Menu.setApplicationMenu(buildMenu(window, portalUrl));

  let stopNavigation: (() => void) | undefined;
  window.webContents.on('did-finish-load', () => {
    stopNavigation?.();
    stopNavigation = runNavigationLoop(window.webContents, config.projectPath, config.projectId);
  });

  // Always load the portal root, never the deep URL (see navigation.ts).
  await window.loadURL(portalUrl);
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
      hint: '400 INVALID_PROJECT_CONTEXT_IDENTIFIER / bad project path: pass --project="C:\\path\\to\\Project" or set EAE_PROJECT_PATH.',
    });
    return;
  }

  console.log(`[config] gateway=${config.gatewayUrl} project=${config.projectPath} projectId=${config.projectId}`);
  await start(config);
});
