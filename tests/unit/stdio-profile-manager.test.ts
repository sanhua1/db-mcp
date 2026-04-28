/**
 * Stdio Profile Manager Unit Tests
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { DbConfig } from '../../src/types/adapter.js';
import { StdioProfileManager } from '../../src/core/stdio-profile-manager.js';

function createSqliteProfile(filePath: string): DbConfig {
  return {
    type: 'sqlite',
    filePath,
    allowWrite: true,
    permissionMode: 'full',
  };
}

describe('Stdio Profile Manager', () => {
  let manager: StdioProfileManager | null = null;

  afterEach(async () => {
    if (manager) {
      await manager.disconnectCurrent();
      manager = null;
    }
  });

  it('should stay disconnected when no default profile is provided', async () => {
    manager = new StdioProfileManager();
    manager.setProfiles({
      'profile-dev': createSqliteProfile(':memory:'),
      'profile-prod': createSqliteProfile(':memory:'),
    });

    const status = manager.getStatus();

    expect(status.connected).toBe(false);
    expect(status.currentProfileName).toBeNull();
    expect(status.availableProfiles).toEqual(['profile-dev', 'profile-prod']);
  });

  it('should connect to a named profile and expose current status', async () => {
    manager = new StdioProfileManager();
    manager.setProfiles({
      'profile-dev': createSqliteProfile(':memory:'),
      'profile-prod': createSqliteProfile(':memory:'),
    });

    await manager.switchProfile('profile-prod');

    const status = manager.getStatus();

    expect(status.connected).toBe(true);
    expect(status.currentProfileName).toBe('profile-prod');
    expect(status.config?.type).toBe('sqlite');
  });

  it('should clear current profile after direct connect', async () => {
    manager = new StdioProfileManager();
    manager.setProfiles({
      'profile-dev': createSqliteProfile(':memory:'),
    });

    await manager.switchProfile('profile-dev');
    await manager.connectDirect(createSqliteProfile(':memory:'));

    const status = manager.getStatus();

    expect(status.connected).toBe(true);
    expect(status.currentProfileName).toBeNull();
  });

  it('should disconnect and clear all active state', async () => {
    manager = new StdioProfileManager();
    manager.setProfiles({
      'profile-dev': createSqliteProfile(':memory:'),
    });

    await manager.switchProfile('profile-dev');
    await manager.disconnectCurrent();

    const status = manager.getStatus();

    expect(status.connected).toBe(false);
    expect(status.currentProfileName).toBeNull();
    expect(status.config).toBeNull();
  });

  it('should reject unknown profile names', async () => {
    manager = new StdioProfileManager();
    manager.setProfiles({
      'profile-dev': createSqliteProfile(':memory:'),
    });

    await expect(manager.switchProfile('missing-profile')).rejects.toThrow('missing-profile');
  });
});
