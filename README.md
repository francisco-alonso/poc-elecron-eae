# EAE-X Desktop (Electron host)

## What it is

A small Electron app that opens the MAF portal in **hybridshell** mode, served by the local MAF Sandbox
gateway. The portal loads the EAE-X micro-frontend in its single `portal-frame` region. The app then
navigates it to a start route, by default the EAE-X **projects** page. From there, clicking a project card
opens its device list (DnD). Every page and API call goes through the gateway at `https://localhost:5800`,
which is the only origin the EAE-X API accepts (CORS).

The app knows nothing about EAE-X: it opens the portal at a route. Regions and the apps shown are the
portal's business (hybridshell extension points), so a new front-end needs no change here.

```
Electron (BrowserWindow)
   │  loads
   ▼
https://localhost:5800/baseshell/          hybridshell portal (se.ia.baseshell)
   │  resolves the MFE
   ▼
https://localhost:5800/mfe/eae-x:mfes:eae-x
   │  mounts
   ▼
EAE-X MFE  (/baseshell/eae-dca/projects  →  /baseshell/eae-dca/path/<project>/projects/<id>/devices)
   │  calls
   ▼
https://localhost:5800/eae-x-api/...       EAE-X API behind the Sandbox gateway (YARP)
```

How it works: the app loads the portal **root**. After the page loads, it posts a hybridshell `navigate`
message with the start route and its payload. By default the payload is `{"baseRoute":"/baseshell/<app>"}`,
where `<app>` is the first segment of the route (`eae-dca`). It resends the message every 500 ms until the
portal has routed, for up to 30 s.

## Prerequisites

Check each item in a browser.

| Prerequisite | How to check |
|---|---|
| Node 22+ and npm | `node -v`, `npm -v` |
| Sandbox running (`SE.IA.MAF.Configurator.exe -sandbox -desktop`) | <https://localhost:5800/baseshell/> responds (accept the self-signed certificate) |
| Extension point contains `eae-dca` | <https://localhost:5800/extensionPoints/hybridshell-app-navigation> lists a participation whose `model` has `"routeInitial":"eae-dca"` |
| Baseshell portal loads | <https://localhost:5800/baseshell/> |
| EAE-X MFE is registered | <https://localhost:5800/mfe/eae-x:mfes:eae-x> returns JSON |

The Sandbox needs:

- The **EAE-X micro app** deployed in **Desktop** mode, with the `hybridshell-app-navigation` subscription in its `.arp`.
- The **`se.ia.baseshell`** app, built from maf-portal with the PoC fallback described below.
- The EAE-X API with the **projects folder** configured: set `DesktopProjects:RootPath` in the EAE-X API
  `appsettings.Desktop.json` to the folder that contains your projects, for example
  `%USERPROFILE%\Documents\Schneider Electric\EcoStruxureAutomationExpertProjects`. Every sub-folder with a
  `.sol` file is listed as a project. Check it with <https://localhost:5800/eae-x-api/api/v1/projects>.

## Known PoC patch (outside this repo)

- Sandbox `3.0.1-alpha.25` has no `extensionPointApp:services:SE.IA.MAF.ExtensionManager.Service`, so the
  portal's call to it returns 404.
- maf-portal `localExtensionPointManager.service.ts` was patched locally to fall back to
  `GET /extensionPoints/{name}`.
- The baseshell app uses port **7201**, because 7200 is taken by eamportal's `baseShell`.

## Install & run

```powershell
npm install
npm start
```

Open another start route, or give an explicit payload:

```powershell
npm start -- --route=/eae-dca/projects
npm start -- --route=/eae-dca/projects --payload="{\"baseRoute\":\"/baseshell/eae-dca\"}"
```

Open DevTools on startup:

```powershell
npm run start:debug
```

| CLI argument | Environment variable | Default |
|---|---|---|
| `--route=` | `EAE_ROUTE` | `/eae-dca/projects` (will become the home micro-frontend once it exists) |
| `--payload=` | `EAE_PAYLOAD` | `{"baseRoute":"/baseshell/<first route segment>"}` |
| `--gateway=` | `EAE_GATEWAY_URL` | `https://localhost:5800` |

CLI arguments take precedence over environment variables.

```powershell
$env:EAE_ROUTE = "/eae-dca/projects"
npm start
```

Menu:

- **File > New Window** (Ctrl+N) opens another window on the start route. A portal link opened in a new
  window by a micro-frontend also gets its own window; other links open in the system browser.
- **File > Reload** (Ctrl+R) reloads the portal root and navigates back to the current page.

## Expected result

The window "EAE-X Desktop" shows one card per project of the projects folder. Clicking a card opens its
device list; for the `sandbox-francesco` test project it lists **`EcoRT_0`** (`Soft_dPAC`). No project path
or ID has to be typed: both come from the projects API.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Preflight: gateway unreachable | Sandbox not running. |
| Extension point empty or `eae-dca` missing | EAE-X `.arp` lacks the subscription. Redeploy EAE-X. |
| Projects page: "The projects folder is not configured or does not exist" | Set `DesktopProjects:RootPath` in the EAE-X API `appsettings.Desktop.json` and restart the API. |
| Projects page: no project found | No sub-folder of the projects folder contains a `.sol` file. |
| `/baseshell/` 404 | Baseshell app not installed. |
| 404 on `.../ExtensionManager.Service/participationModels` in the console, blank page | Portal built without the PoC fallback. |
| Blank MFE area | `baseRoute` / URL mismatch, or the navigate message was lost. Check the `[renderer]` logs. Press Ctrl+R. |
| 400 `INVALID_PROJECT_CONTEXT_IDENTIFIER` | Bad project path in the device route. Open the project from the projects page. |
| 403/405 or CORS errors | Page not loaded from `https://localhost:5800`. |
| `npm install` fails downloading Electron on the corporate network | Set `ELECTRON_MIRROR` or proxy (`HTTPS_PROXY`), or download it manually. |

Logs:

- Sandbox: `%APPDATA%\Schneider Electric\sandbox\logs\SE.IA.MAF.Orchestrator\`
- EAE-X API: `%APPDATA%\Schneider Electric\MAF\Logs\SE.IA.EAE-X\`
- This app: stdout of `npm start`, with `[config]`, `[preflight]`, `[navigation]` and `[renderer]` prefixes.

## Future option

- **Home micro-frontend:** a separate micro app in the Sandbox (`routeInitial: "home"`) that shows cards
  registered by other apps through an extension point. Electron would then start with `--route=/home`.
- **More regions:** extend the baseshell layout in maf-portal. Electron stays a plain container.
