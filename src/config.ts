export interface AppConfig {
  gatewayUrl: string;
  /** Portal route opened at startup, relative to /baseshell (e.g. /eae-dca/projects). */
  route: string;
  /** Payload string given to the micro-frontend; undefined uses the default of the route. */
  payload: string | undefined;
  devtools: boolean;
}

const DEFAULT_GATEWAY_URL = 'https://localhost:5800';
// Until the home micro-frontend exists, start on the EAE-X projects page.
const DEFAULT_ROUTE = '/eae-dca/projects';

function readArg(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (!/^\/?[^/\s]+/.test(trimmed)) {
    throw new Error(`Route must name an app route, such as /eae-dca/projects: "${route}"`);
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function validatePayload(payload: string): string {
  try {
    JSON.parse(payload);
  } catch {
    throw new Error(`Payload must be a JSON string, such as {"baseRoute":"/baseshell/eae-dca"}: ${payload}`);
  }
  return payload;
}

export function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv): AppConfig {
  const gatewayUrl = (readArg(argv, 'gateway') ?? env.EAE_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
  const route = normalizeRoute(readArg(argv, 'route') ?? env.EAE_ROUTE ?? DEFAULT_ROUTE);
  const payload = readArg(argv, 'payload') ?? env.EAE_PAYLOAD;

  return {
    gatewayUrl,
    route,
    payload: payload === undefined ? undefined : validatePayload(payload),
    devtools: argv.includes('--devtools'),
  };
}
