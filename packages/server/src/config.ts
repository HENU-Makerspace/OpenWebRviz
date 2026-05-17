import * as fs from 'node:fs';
import * as path from 'node:path';

export type YamlPrimitive = string | number | boolean;
export type YamlSection = Record<string, YamlPrimitive>;
export type YamlConfig = Record<string, YamlSection>;

export interface RobotConfigLoadResult {
  config: YamlConfig;
  configPath: string | null;
  profile: string;
}

// Simple YAML config parser for the flat section-based config files used here.
export function parseYamlConfig(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const config: YamlConfig = {};
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
      const lower = raw.toLowerCase();
      if (lower === 'true') {
        config[currentSection][key] = true;
        continue;
      }
      if (lower === 'false') {
        config[currentSection][key] = false;
        continue;
      }

      const num = Number(raw);
      config[currentSection][key] = Number.isNaN(num) || raw.includes('.') ? raw : num;
    }
  }

  return config;
}

function stringifyYamlPrimitive(value: YamlPrimitive) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return JSON.stringify(value);
}

export function stringifyYamlConfig(config: YamlConfig) {
  const lines: string[] = [];

  for (const [section, values] of Object.entries(config)) {
    lines.push(`${section}:`);

    for (const [key, value] of Object.entries(values)) {
      lines.push(`  ${key}: ${stringifyYamlPrimitive(value)}`);
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function saveYamlConfig(filePath: string, config: YamlConfig) {
  fs.writeFileSync(filePath, stringifyYamlConfig(config), 'utf-8');
}

export function mergeYamlConfig(baseConfig: YamlConfig, patch: Partial<Record<string, Partial<YamlSection>>>) {
  const merged: YamlConfig = {};
  const sectionNames = new Set([...Object.keys(baseConfig), ...Object.keys(patch)]);

  for (const sectionName of sectionNames) {
    const baseSection = baseConfig[sectionName] || {};
    const patchSection = patch[sectionName] || {};
    const mergedSection: YamlSection = { ...baseSection };

    for (const [key, value] of Object.entries(patchSection)) {
      if (value !== undefined) {
        mergedSection[key] = value;
      }
    }

    merged[sectionName] = mergedSection;
  }

  return merged;
}

function resolveOverridePath() {
  const override = process.env.ROBOT_CONFIG_PATH?.trim();
  if (!override) return null;
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
}

export function resolveRobotConfigPath(configDir: string, profile = process.env.ROBOT_CONFIG_PROFILE || 'cloud') {
  const overridePath = resolveOverridePath();
  const normalizedProfile = profile.trim() || 'cloud';

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

export function loadRobotConfig(configDir: string, profile = process.env.ROBOT_CONFIG_PROFILE || 'cloud'): RobotConfigLoadResult {
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
