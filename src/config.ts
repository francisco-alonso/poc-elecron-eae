import { homedir } from 'node:os';
import { win32 } from 'node:path';

export interface AppConfig {
  gatewayUrl: string;
  projectPath: string;
  projectId: string;
  devtools: boolean;
}

const DEFAULT_GATEWAY_URL = 'https://localhost:5800';
const DEFAULT_PROJECT_ID = '3f2b8c1e-7a4d-4e9b-9c55-1d2a6b7e8f90';
// Default EAE projects location of the current Windows user.
const DEFAULT_PROJECT_PATH = win32.join(
  homedir(),
  'Documents',
  'Schneider Electric',
  'EcoStruxureAutomationExpertProjects',
  'sandbox-francesco',
);

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:\\/;

function readArg(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function validateProjectPath(projectPath: string): void {
  if (!WINDOWS_ABSOLUTE_PATH.test(projectPath)) {
    throw new Error(`Project path must be an absolute Windows path (e.g. C:\\...\\MyProject): "${projectPath}"`);
  }
  if (win32.extname(projectPath) !== '') {
    throw new Error(`Project path must be a folder, without a file extension: "${projectPath}"`);
  }
}

export function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv): AppConfig {
  const gatewayUrl = (readArg(argv, 'gateway') ?? env.EAE_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
  const projectPath = readArg(argv, 'project') ?? env.EAE_PROJECT_PATH ?? DEFAULT_PROJECT_PATH;
  const projectId = readArg(argv, 'project-id') ?? env.EAE_PROJECT_ID ?? DEFAULT_PROJECT_ID;

  validateProjectPath(projectPath);

  return { gatewayUrl, projectPath, projectId, devtools: argv.includes('--devtools') };
}
