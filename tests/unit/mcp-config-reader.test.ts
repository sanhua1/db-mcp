/**
 * MCP Host Config Reader Unit Tests
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMcpProfilesConfig, resolveMcpProfilesConfig } from '../../src/utils/mcp-config-reader.js';

async function createTempConfigFile(content: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-config-reader-'));
  const path = join(dir, 'claude.json');
  await writeFile(path, content, 'utf8');
  return { dir, path };
}

describe('MCP Host Config Reader', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('should read profiles and default profile from host mcp config', async () => {
    const { dir, path } = await createTempConfigFile(JSON.stringify({
      mcpServers: {
        'db-mcp': {
          command: 'npx',
          args: ['universal-db-mcp'],
          profiles: {
            'profile-dev': {
              type: 'sqlite',
              filePath: ':memory:',
            },
            'profile-prod': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
          defaultProfile: 'profile-dev',
        },
      },
    }));
    tempDirs.push(dir);

    const config = await readMcpProfilesConfig(path, 'db-mcp');

    expect(config.defaultProfile).toBe('profile-dev');
    expect(Object.keys(config.profiles)).toEqual(['profile-dev', 'profile-prod']);
    expect(config.profiles['profile-prod']).toMatchObject({
      type: 'sqlite',
      filePath: ':memory:',
    });
  });

  it('should throw when target server key does not exist', async () => {
    const { dir, path } = await createTempConfigFile(JSON.stringify({
      mcpServers: {
        'other-server': {
          profiles: {},
        },
      },
    }));
    tempDirs.push(dir);

    await expect(readMcpProfilesConfig(path, 'db-mcp')).rejects.toThrow('mcpServers.db-mcp');
  });

  it('should throw when profiles field is missing', async () => {
    const { dir, path } = await createTempConfigFile(JSON.stringify({
      mcpServers: {
        'db-mcp': {
          command: 'npx',
          args: ['universal-db-mcp'],
        },
      },
    }));
    tempDirs.push(dir);

    await expect(readMcpProfilesConfig(path, 'db-mcp')).rejects.toThrow('profiles');
  });

  it('should throw when default profile points to an unknown profile', async () => {
    const { dir, path } = await createTempConfigFile(JSON.stringify({
      mcpServers: {
        'db-mcp': {
          profiles: {
            'profile-dev': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
          defaultProfile: 'profile-prod',
        },
      },
    }));
    tempDirs.push(dir);

    await expect(readMcpProfilesConfig(path, 'db-mcp')).rejects.toThrow('defaultProfile');
  });

  it('should preserve original file content', async () => {
    const originalContent = JSON.stringify({
      mcpServers: {
        'db-mcp': {
          profiles: {
            'profile-dev': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
      },
    });
    const { dir, path } = await createTempConfigFile(originalContent);
    tempDirs.push(dir);

    await readMcpProfilesConfig(path, 'db-mcp');

    const currentContent = await readFile(path, 'utf8');
    expect(currentContent).toBe(originalContent);
  });

  it('should auto-discover the nearest .mcp.json', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mcp-config-reader-root-'));
    const nestedDir = join(rootDir, 'apps', 'demo');
    const nestedChildDir = join(nestedDir, 'worker');
    tempDirs.push(rootDir);

    await mkdir(nestedChildDir, { recursive: true });

    await writeFile(join(rootDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'root-server': {
          profiles: {
            'root-profile': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
      },
    }), 'utf8');

    await writeFile(join(nestedDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'db-mcp': {
          profiles: {
            'nearest-profile': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
      },
    }), 'utf8');

    await writeFile(join(nestedChildDir, 'placeholder.txt'), 'x', 'utf8');

    const config = await resolveMcpProfilesConfig({
      cwd: nestedChildDir,
      homeDir: rootDir,
    });

    expect(config?.configKey).toBe('db-mcp');
    expect(config?.configPath).toBe(join(nestedDir, '.mcp.json'));
    expect(Object.keys(config?.profiles || {})).toEqual(['nearest-profile']);
  });

  it('should fall back to home .claude.json when project .mcp.json is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mcp-config-reader-home-'));
    tempDirs.push(rootDir);

    await writeFile(join(rootDir, '.claude.json'), JSON.stringify({
      mcpServers: {
        'db-mcp': {
          profiles: {
            'home-profile': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
      },
    }), 'utf8');

    const config = await resolveMcpProfilesConfig({
      cwd: join(rootDir, 'project'),
      homeDir: rootDir,
    });

    expect(config?.configPath).toBe(join(rootDir, '.claude.json'));
    expect(Object.keys(config?.profiles || {})).toEqual(['home-profile']);
  });

  it('should read profiles from env when present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mcp-config-reader-env-'));
    tempDirs.push(rootDir);

    const config = await resolveMcpProfilesConfig({
      cwd: rootDir,
      homeDir: rootDir,
      env: {
        DB_MCP_PROFILES: JSON.stringify({
          'env-profile': {
            type: 'sqlite',
            filePath: ':memory:',
          },
        }),
        DB_MCP_DEFAULT_PROFILE: 'env-profile',
      },
    });

    expect(config?.configKey).toBe('db-mcp');
    expect(config?.configPath).toBe('env:DB_MCP_PROFILES');
    expect(config?.defaultProfile).toBe('env-profile');
    expect(Object.keys(config?.profiles || {})).toEqual(['env-profile']);
  });

  it('should prefer explicit config path over env profiles', async () => {
    const { dir, path } = await createTempConfigFile(JSON.stringify({
      mcpServers: {
        'db-mcp': {
          profiles: {
            'file-profile': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
      },
    }));
    tempDirs.push(dir);

    const config = await resolveMcpProfilesConfig({
      configPath: path,
      configKey: 'db-mcp',
      env: {
        DB_MCP_PROFILES: JSON.stringify({
          'env-profile': {
            type: 'sqlite',
            filePath: ':memory:',
          },
        }),
      },
    });

    expect(config?.configPath).toBe(path);
    expect(Object.keys(config?.profiles || {})).toEqual(['file-profile']);
  });

  it('should throw when env profiles json is invalid', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mcp-config-reader-env-invalid-'));
    tempDirs.push(rootDir);

    await expect(resolveMcpProfilesConfig({
      cwd: rootDir,
      homeDir: rootDir,
      env: {
        DB_MCP_PROFILES: '{invalid-json',
      },
    })).rejects.toThrow('DB_MCP_PROFILES');
  });

  it('should throw when auto-discovery finds multiple profile servers without a clear key', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mcp-config-reader-ambiguous-'));
    tempDirs.push(rootDir);

    await writeFile(join(rootDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'server-a': {
          profiles: {
            'profile-a': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
        'server-b': {
          profiles: {
            'profile-b': {
              type: 'sqlite',
              filePath: ':memory:',
            },
          },
        },
      },
    }), 'utf8');

    await expect(resolveMcpProfilesConfig({
      cwd: rootDir,
      homeDir: rootDir,
    })).rejects.toThrow('多个包含 profiles');
  });
});
