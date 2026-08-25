import fs from 'node:fs';

import { HarnessError } from '../errors';
import type { HarnessPaths } from '../paths';
import { parseYamlWith } from '../yaml';
import { configSchema, type AdapterConfig, type HarnessConfig } from './schema';

const BUILTIN_ADAPTERS: Record<string, AdapterConfig> = {
  claude: { bin: 'claude', defaultModel: 'sonnet', args: [] },
  codex: { bin: 'codex', defaultModel: 'gpt-5-codex', args: [] },
};

/**
 * Read `.harness/harness.config.yaml`, falling back to defaults when it is
 * absent -- a project that has only agents and rules still runs.
 */
export function loadConfig(paths: HarnessPaths): HarnessConfig {
  let text = '';
  try {
    text = fs.readFileSync(paths.config, 'utf8');
  } catch {
    // Defaults it is.
  }

  const config = parseYamlWith(text, configSchema, paths.config, 'CONFIG_INVALID');

  // Declaring one custom adapter must not delete the built-in two.
  config.adapters = { ...BUILTIN_ADAPTERS, ...config.adapters };

  if (!(config.adapter in config.adapters)) {
    throw new HarnessError(
      'CONFIG_INVALID',
      `default adapter "${config.adapter}" is not configured`,
      `configured adapters: ${Object.keys(config.adapters).join(', ')}`,
    );
  }

  return config;
}

export function adapterConfig(config: HarnessConfig, name: string): AdapterConfig {
  const adapter = config.adapters[name];
  if (adapter === undefined) {
    throw new HarnessError(
      'CONFIG_INVALID',
      `no adapter "${name}"`,
      `configured adapters: ${Object.keys(config.adapters).join(', ')}`,
    );
  }
  return adapter;
}
