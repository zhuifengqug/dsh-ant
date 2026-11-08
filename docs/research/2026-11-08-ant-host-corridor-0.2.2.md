# DSH Host 走廊：0.2.1-rc.5 → 0.2.2-rc.1

记录 2026-11-08 把玄驹的依赖走廊对齐到桌面端已装的 DSH Host 0.2.2-rc.1 所做的事与证据。

## 结论

代码一行没改。插件消费的 API 面在 0.2.2-rc.1 上完全没有变化，需要动的只有依赖声明：旧的 `@deepseek-ai/cordis ~4.0.5` 取值范围（>=4.0.5 <4.1.0）**根本不包含 Host 自带的 4.1.0**，这条 peer 在 0.2.2 桌面上从一开始就是不满意的。

## 两侧身份

| 项 | 旧 | 新 |
|---|---|---|
| Host | `@deepseek-ai/dsh-desktop-runtime` 0.2.1-rc.5 系 | `@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.1`（`resources/app.asar/dsh`） |
| cordis | `@deepseek-ai/cordis@4.0.5`，peer `~4.0.5` | `@deepseek-ai/cordis@4.1.0`，peer `^4.1.0` |
| dsh-tools / dsh-commands / dsh-api-session-controller | 0.2.1-rc.5 | 0.2.2-rc.1（peer 与 devDep 同步） |
| dsh-typert-protocol (dependency) | 0.2.1-rc.5 | 0.2.2-rc.1 |
| schemastery | `~3.18.5`（自装 3.18.5） | `~3.19.0`（Host 自带 3.19.0） |
| zod | 4.4.3 | 4.4.3（两侧一致，未动） |

## 实测的导出面差异

用动态 `import()` 分别加载两侧的包，比对模块导出键集合。

- `@deepseek-ai/cordis` 4.0.5 → 4.1.0：导出键**完全相同**（0 增 0 删）。
- `@deepseek-ai/dsh-commands`：完全相同。
- `@deepseek-ai/dsh-typert-protocol` / `dsh-typert-registry`：完全相同；`./remote-info` 子路径导出映射不变。
- `@deepseek-ai/dsh-api-session-controller`：只删了 `buildModelCatalog`（本仓未使用）；`resolveAgent` / `prompt` / `selectModel` / `cancel` / `create` 全部仍在。
- `@deepseek-ai/dsh-tools`：新增 8 个（`ToolActivationError`、`ToolsService`、`ToolBatchExecutionError`、`ToolExecutorUnavailableError`、`projectToolSchema`、`isJsonSchemaRecord`、`isPlainJsonArray`、`isPlainJsonRecord`），移除 7 个（`CodeRunFailedError`、`TOOL_RUNTIME_SCHEDULER`、`defineContentToolFixture`、`jsonSchemaToPy`、`jsonSchemaToTs`、`renderToolsSdk`、`renderToolsSdkPy`）。被移除的七个本仓全仓检索**零引用**。
- `defineTool` 的源码两侧逐行一致；`tools.register(definition, options = {})` 只是多了可选的第二参数（激活条件），单参数调用契约不变。

## 未变的客户端契约

- 模块壳仍是 `window.__ModuleLoader__.load({ id, factory(require) })`（Host 内 96 个自带面同形）。
- `main` 槽：`renderSlot("main", {}, { entryKey })`；`sidebar.panellist` 仍是 glyph 渲染器，入参 `{ size, active }` + `{ only: id }`。
- `settings.section` 列表槽仍由 6 个自带包使用（`dsh-client-ui-settings-account/general/models/plugins`、`dsh-client-ui-agent-preset`、`dsh-cordis-client-runner`）。
- `TYPERT` / `TYPERT_REMOTE` + `createTypertRemoteInfo` 的消费方式不变。

## 验证

- `node --test --test-concurrency=1` 全 17 个测试文件：**83 tests / 83 pass / 0 fail**。
- 入口冒烟（新走廊下）：`import('./index.js')` 导出 `{AntService, Config, TYPERT, apply, inject, name, ANT_TOOL_PARAMETERS, ANT_TOOL_OUTPUT}`；`inject = ["commands","tools","sessionController"]`；`TYPERT.invocations` 5 条；remote 5 个方法。
- `npm run check:syntax` 通过（11 个文件 `node --check`）。

## 未验证 / 残留

- **没有做真实 Web 渲染验证**：运行中的 Host(`127.0.0.1` 的 `dsh web`)对未带 token 的请求一律 401，本机也没有可用的 browser provider，所以五个槽位的实际挂载需要用户重开 Host 后硬刷新确认。
- 桌面 profile 里本插件是 `link:` 安装，重启 Host 才会重新读 `package.json` 的新 peer 声明。

## 回滚

```
git checkout -- package.json pnpm-lock.yaml && pnpm install
```
