# Dashboard 日志与接口传输改动

本文件保留最初的日志与传输设计及历史验收记录。2026-10-21 main 更新版已加入真实后端应用日志和本地模型联调，最新状态见[更新说明](changes-zh.md)和[本地联调说明](local-integration-zh.md)。现有页面和接口路径保持兼容。

需求澄清后的当前入口：`#/logs` 为**后端执行日志**，详细合同见[后端日志接入约定](backend-logs-contract.md)。下文描述的本地记录已移至 `#/logs?source=browser`“浏览器诊断”，不再作为完整后端日志展示。真实后端地址尚未配置时，默认日志页显示未接入。

## 日志入口与生成方式

浏览器诊断路由为 `#/logs?source=browser`，错误提示的“查看此请求的日志”按 request ID 筛选本地请求诊断。任务页的“查看任务日志”现在进入后端日志视图。

| 事件 | 生成时机 |
| --- | --- |
| request.succeeded / request.failed | 公共 API 调用结束；包含耗时、请求编号、接口操作；真实 HTTP 响应才记录 HTTP 状态码 |
| analysis.created | 创建任务得到符合约定的成功响应 |
| run.observed | 查询任务时观察到状态变化；相同状态不重复记录业务事件 |
| review.saved | 审核得到符合约定的已保存案例 |
| demo.reset | 用户确认重置当前浏览器模拟任务与审核数据 |

页面支持级别、事件类型和编号搜索，导出当前筛选结果为 JSON。日志存储键为 `fix-dashboard-log-v1`，最多保留最近 300 条。刷新可恢复；存储不可用时保留在当前页面内存中并提示，不影响已成功的业务操作。日志清空和模拟数据重置为两个独立入口，均须在界面确认。

仅记录允许的诊断字段，不记录请求或响应全文、请求头、审核人姓名、审核原因和密钥。记录时间来自浏览器，不是服务端权威时间。日志可能因清理、容量上限、跨标签同时写入而缺失，不能用作生产审计账本。

Mock 模式没有 HTTP 请求和真实 worker，界面会明确标注“本地模拟”。`run.observed` 只代表前端观察到的状态，不保证记录了后台每一次状态转换。日志不会自动共享给队友或上传服务端。

## 数据传输

调用路径：React 页面 → 公共 API 与日志层 → mock 或 live 适配器 → HTTP（仅 live）→ 返回数据校验 → 页面。

- `frontend/live-api.js` 统一维护接口路径、参数编码和请求字段白名单。分析请求剔除 `scenario` 等演示字段；审核请求只发送约定的四个字段。
- `frontend/contracts.js` 检查对象、列表、嵌套结果、任务与案例归属、状态枚举、数值类型及基本范围。错配以 `CONTRACT_MISMATCH` 和字段路径返回，避免页面直接读取缺失对象导致崩溃。允许缺失或 null 的数值显示为不可用，不强制转换为 0。
- `frontend/http-client.js` 保留超时、HTTP 错误、非 JSON、网络错误和主动取消的区别。页面离开后取消未完成的读取。写入不自动重试。
- 网络中断、超时、5xx、成功 HTTP 下的非 JSON 或不合法响应，可能无法确认写入结果；错误携带 `writeUncertain`。审核必须重新读取状态，创建按钮在当前表单中停止重复提交。前端限制不能代替服务端幂等性，刷新或重新打开页面仍可能再次提交；后端需要提供任务查询和防重复机制。

每次 API 调用生成浏览器请求编号。后端准备好关联请求日志后，在 `public/runtime-config.js` 配置 `sendRequestId: true`，将通过 `X-Request-ID` 发送此编号。后端 CORS 需要允许此请求头；如果返回服务端 `X-Request-ID`，还需通过 `Access-Control-Expose-Headers` 暴露该响应头。默认关闭以兼容现有后端，关闭时浏览器编号不会发送到服务器。

## 配置加载与分工

React 入口先加载部署根路径下的 `runtime-config.js`，再加载应用。缺失或无效配置显示启动错误，不静默退回 mock。编辑源文件 `public/runtime-config.js` 后，本地生产预览需要重新构建；部署后也可按环境替换 `dist/runtime-config.js`，不得填入密钥。

- Zhou：公共 API、返回校验、请求编号、任务与日志页面，以及完整流程联调。
- Zhang：库存、异常、审核页面通过公共 API 调用；不用在页面内单独发送请求或另写日志。
- 后端 / worker：真正执行任务，持久保存任务与审核记录；用 run ID、case ID、request ID 关联服务端执行日志，负责幂等、鉴权、并发约束和数据库事务。

核心文件：`frontend/activity-log.js`、`frontend/api-gateway.js`、`frontend/contracts.js`、`frontend/http-client.js`、`src/pages/LogsPage.jsx`。

## 验证

运行 `npm test`（或 `node --test frontend/tests/*.test.js`）和 `npm run build`。自动测试覆盖状态与审核流程、接口字段及关联错误、超时与取消、日志保留与恢复、敏感正文排除、存储异常和请求关联。真实后端、CSV 数据库与模型仍需团队提供后进行联调。

2026-10-15 本地验收：16 项测试通过，生产构建通过。浏览器验证了任务创建与完成、审核保存、业务事件筛选、刷新恢复、导出 JSON、错误提示跳转到对应请求日志；检查期间控制台没有错误。导出样例包含 4 条业务事件，不含审核人姓名或审核原因。未上传或部署到 GitHub。
