# EAE-X Desktop (Electron host)

## What it is

A small Electron app that opens the MAF portal in **hybridshell** mode, served by the local MAF Sandbox
gateway. The portal loads the EAE-X micro-frontend in its single `portal-frame` region. The app then
navigates it to the **logical devices** page of a desktop EAE project. Every page and API call goes
through the gateway at `https://localhost:5800`, which is the only origin the EAE-X API accepts (CORS).

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
EAE-X MFE  (route /baseshell/eae-dca/path/<project>/projects/<guid>/devices)
   │  calls
   ▼
https://localhost:5800/eae-x-api/...       EAE-X API behind the Sandbox gateway (YARP)
```

How it works: the app loads the portal **root**. After the page loads, it posts a hybridshell `navigate`
message with the devices route and the payload `{"baseRoute":"/baseshell/eae-dca"}`. It resends the message
every 500 ms until the portal has routed, for up to 30 s.

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

Use another project or project ID:

```powershell
npm start -- --project="C:\path\to\Project" --project-id=<guid>
```

Open DevTools on startup:

```powershell
npm run start:debug
```

| CLI argument | Environment variable | Default |
|---|---|---|
| `--project=` | `EAE_PROJECT_PATH` | `%USERPROFILE%\Documents\Schneider Electric\EcoStruxureAutomationExpertProjects\sandbox-francesco` |
| `--project-id=` | `EAE_PROJECT_ID` | `3f2b8c1e-7a4d-4e9b-9c55-1d2a6b7e8f90` (any GUID works in Desktop mode) |
| `--gateway=` | `EAE_GATEWAY_URL` | `https://localhost:5800` |

CLI arguments take precedence over environment variables. The project path must be an absolute Windows
folder path (`C:\...\MyProject`), without a file extension.

```powershell
$env:EAE_PROJECT_PATH = "C:\path\to\Project"
$env:EAE_PROJECT_ID = "<guid>"
npm start
```

Use **Ctrl+R** (File > Reload) to reload the portal root and navigate again.

## Expected result

The window "EAE-X Desktop" shows the EAE-X devices page. For the default project it lists **`EcoRT_0`**
(`Soft_dPAC`).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Preflight: gateway unreachable | Sandbox not running. |
| Extension point empty or `eae-dca` missing | EAE-X `.arp` lacks the subscription. Redeploy EAE-X. |
| `/baseshell/` 404 | Baseshell app not installed. |
| 404 on `.../ExtensionManager.Service/participationModels` in the console, blank page | Portal built without the PoC fallback. |
| Blank MFE area | `baseRoute` / URL mismatch, or the navigate message was lost. Check the `[renderer]` logs. Press Ctrl+R. |
| 400 `INVALID_PROJECT_CONTEXT_IDENTIFIER` | Bad project path. |
| 403/405 or CORS errors | Page not loaded from `https://localhost:5800`. |
| `npm install` fails downloading Electron on the corporate network | Set `ELECTRON_MIRROR` or proxy (`HTTPS_PROXY`), or download it manually. |

Logs:

- Sandbox: `%APPDATA%\Schneider Electric\sandbox\logs\SE.IA.MAF.Orchestrator\`
- EAE-X API: `%APPDATA%\Schneider Electric\MAF\Logs\SE.IA.EAE-X\`
- This app: stdout of `npm start`, with `[config]`, `[preflight]`, `[navigation]` and `[renderer]` prefixes.

## Future option

**Variant C:** a custom single-spa root-config in which Electron mounts the EAE-X MFE directly, without
the hybridshell portal. Not implemented.
