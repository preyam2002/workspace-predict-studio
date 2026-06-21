import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export type Env = Record<string, string | undefined>;

export function parseEnvContent(content: string): Env {
  const env: Env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function loadLocalEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const fileEnv = ['.env', '.env.local'].reduce<Env>((acc, path) => {
    if (existsSync(path)) Object.assign(acc, parseEnvContent(readFileSync(path, 'utf8')));
    return acc;
  }, {});
  return { ...fileEnv, ...base };
}

export function withWritableSuiConfig(env: NodeJS.ProcessEnv = loadLocalEnv()): NodeJS.ProcessEnv {
  if (env.SUI_CLIENT_CONFIG) return env;
  const source = join(homedir(), '.sui', 'sui_config');
  if (!existsSync(source)) return env;
  const suiHome = mkdtempSync(join(tmpdir(), 'predict-studio-sui-home-'));
  const destParent = join(suiHome, '.sui');
  const dest = join(destParent, 'sui_config');
  mkdirSync(destParent, { recursive: true });
  cpSync(source, dest, { recursive: true });
  return { ...env, SUI_CLIENT_CONFIG: join(dest, 'client.yaml') };
}

export function applyScriptEnv(): NodeJS.ProcessEnv {
  const env = withWritableSuiConfig(loadLocalEnv());
  Object.assign(process.env, env);
  return process.env;
}
