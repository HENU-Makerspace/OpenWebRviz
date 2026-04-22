import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RobotConfigLoadResult {
  config: Record<string, any>;
  configPath: string | null;
  profile: string;
}

// Simple YAML config parser for the flat section-based config files used here.
export function parseYamlConfig(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const config: Record<string, any> = {};
  const lines = content.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.endsWith(':') && !trimmed.includes('"') && !trimmed.includes("'")) {
      currentSection = trimmed.replace(':', '').trim();
      config[currentSection] = {};
      continue;
    }

    const match = trimmed.match(/^(\w+):\s*(.+)$/);
    if (match && currentSection) {
      const key = match[1];
      const raw = match[2].trim().replace(/^["']|["']$/g, '');
      const num = Number(raw);
      config[currentSection][key] = Number.isNaN(num) || raw.includes('.') ? raw : num;
    }
  }

  return config;
}

function resolveOverridePath() {
  const override = process.env.ROBOT_CONFIG_PATH?.trim();
  if (!override) return null;
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
}

export function resolveRobotConfigPath(configDir: string, profile = process.env.ROBOT_CONFIG_PROFILE || 'local') {
  const overridePath = resolveOverridePath();
  const normalizedProfile = profile.trim() || 'local';

  const candidates = [
    overridePath,
    path.join(configDir, `robot_config.${normalizedProfile}.yaml`),
    path.join(configDir, 'robot_config.yaml'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return {
    profile: normalizedProfile,
    configPath: candidates.find((candidate) => fs.existsSync(candidate)) || null,
  };
}

export function loadRobotConfig(configDir: string, profile = process.env.ROBOT_CONFIG_PROFILE || 'local'): RobotConfigLoadResult {
  const { profile: resolvedProfile, configPath } = resolveRobotConfigPath(configDir, profile);

  if (!configPath) {
    console.warn(`[Config] No robot config found in ${configDir}, profile=${resolvedProfile}`);
    return {
      config: {},
      configPath: null,
      profile: resolvedProfile,
    };
  }

  try {
    return {
      config: parseYamlConfig(configPath),
      configPath,
      profile: resolvedProfile,
    };
  } catch (error) {
    console.error(`[Config] Failed to parse robot config ${configPath}:`, error);
    return {
      config: {},
      configPath,
      profile: resolvedProfile,
    };
  }
}
