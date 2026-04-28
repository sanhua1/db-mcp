# Stdio Profile Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `universal-db-mcp` 的 `stdio` 模式支持单 server 多命名数据库 profile，并在会话里通过 `switch_profile` 切换。

**Architecture:** 在 `stdio` 入口新增宿主配置读取能力，用 `--config-path + --config-key` 回读宿主 MCP 配置，再把 profile 注册表交给一个新的 stdio profile 管理器。MCP 协议层只负责暴露 `list_profiles`、`switch_profile` 和现有工具，真实连接切换都收敛到管理器里。

**Tech Stack:** TypeScript, Commander, Vitest, MCP SDK

---

### Task 1: 宿主配置读取

**Files:**
- Create: `src/utils/mcp-config-reader.ts`
- Create: `tests/unit/mcp-config-reader.test.ts`

- [ ] **Step 1: 写失败测试，覆盖有效配置读取**
- [ ] **Step 2: 运行定向测试，确认失败**
- [ ] **Step 3: 实现 `readMcpProfilesConfig(configPath, configKey)`**
- [ ] **Step 4: 运行定向测试，确认通过**
- [ ] **Step 5: 补失败测试，覆盖缺失 `profiles` / 缺失 key / 非法 JSON**
- [ ] **Step 6: 实现错误分支**
- [ ] **Step 7: 再跑定向测试**

### Task 2: Stdio Profile 管理器

**Files:**
- Create: `src/core/stdio-profile-manager.ts`
- Create: `tests/unit/stdio-profile-manager.test.ts`
- Modify: `src/types/adapter.ts`

- [ ] **Step 1: 写失败测试，覆盖初始化未连接状态**
- [ ] **Step 2: 写失败测试，覆盖 `switchProfile`、手工连接、断开**
- [ ] **Step 3: 运行定向测试，确认失败**
- [ ] **Step 4: 实现 profile 注册表、当前 profile 状态和单活动连接管理**
- [ ] **Step 5: 跑定向测试，确认通过**
- [ ] **Step 6: 补充状态查询测试**
- [ ] **Step 7: 补齐状态返回实现**

### Task 3: MCP 工具与入口参数

**Files:**
- Modify: `src/mcp/mcp-index.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `tests/integration/mcp-mode.test.ts`

- [ ] **Step 1: 写失败测试，覆盖新参数初始化和 profile 工具存在**
- [ ] **Step 2: 运行定向测试，确认失败**
- [ ] **Step 3: 在 CLI 增加 `--config-path`、`--config-key`**
- [ ] **Step 4: 在 MCP server 增加 `list_profiles`、`switch_profile`**
- [ ] **Step 5: 扩展 `get_connection_status` 返回 profile 信息**
- [ ] **Step 6: 跑定向测试，确认通过**

### Task 4: 文档更新

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/getting-started/configuration.md`

- [ ] **Step 1: 补充单 server 多 profile 的 stdio 配置示例**
- [ ] **Step 2: 补充 `switch_profile` / `list_profiles` 用法**
- [ ] **Step 3: 标明 `defaultProfile` 可选**
- [ ] **Step 4: 自查示例和新 CLI 参数一致**

### Task 5: 回归验证

**Files:**
- Modify: `tests/unit/config-loader.test.ts`（仅当类型变更影响现有测试时）

- [ ] **Step 1: 运行新增单元测试**
- [ ] **Step 2: 运行 `npm run test:unit`**
- [ ] **Step 3: 运行 `npm run test:integration`**
- [ ] **Step 4: 修复回归问题**
- [ ] **Step 5: 再跑完整相关测试**
