/**
 * MCP Mode Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { DatabaseMCPServer } from '../../src/mcp/mcp-server';
import type { DbConfig } from '../../src/types/adapter';

describe('MCP Mode Integration Tests', () => {
  describe('DatabaseMCPServer', () => {
    it('should create MCP server instance', () => {
      const config: DbConfig = {
        type: 'sqlite',
        filePath: ':memory:',
        allowWrite: false
      };

      const server = new DatabaseMCPServer(config);
      expect(server).toBeDefined();
    });

    it('should stay disconnected when profiles are configured without default profile', () => {
      const server = new DatabaseMCPServer();

      server.setProfiles({
        'profile-dev': {
          type: 'sqlite',
          filePath: ':memory:',
          allowWrite: true,
          permissionMode: 'full',
        },
        'profile-prod': {
          type: 'sqlite',
          filePath: ':memory:',
          allowWrite: true,
          permissionMode: 'full',
        },
      });

      expect(server.getConnectionStatusSnapshot()).toMatchObject({
        connected: false,
        currentProfileName: null,
        availableProfiles: ['profile-dev', 'profile-prod'],
      });
    });

    it('should switch active connection through named profile api', async () => {
      const server = new DatabaseMCPServer();

      server.setProfiles({
        'profile-dev': {
          type: 'sqlite',
          filePath: ':memory:',
          allowWrite: true,
          permissionMode: 'full',
        },
      });

      await server.switchProfile('profile-dev');

      expect(server.getConnectionStatusSnapshot()).toMatchObject({
        connected: true,
        currentProfileName: 'profile-dev',
      });

      await server.stop();
    });
  });
});
