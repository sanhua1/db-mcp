/**
 * MCP Host Config Reader Unit Tests
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMcpProfilesConfig } from '../../src/utils/mcp-config-reader.js';

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
});
