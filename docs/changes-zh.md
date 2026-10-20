# Project F.I.X. 整合版改动说明（中文）

## 2026-10-21：main 更新版

本次把已经完成本地验证的 Dashboard、后端执行日志、W04 接口传输和真实模型联调代码整合到 `main`。保留队友已合并的 AI v1 模型及原有 React 页面。以下是当前版本；后半部分的 2026-10-14 记录仅用于说明最初的模拟版整合。

### 当前版本能做什么

| 更新部分 | 已实现的内容 |
| --- | --- |
| 后端日志页面 | 默认读取 API、worker、AI 实际执行日志；支持 Run/Job/Case/Request/Trace、级别、服务、时间和关键词筛选，查看完整消息、上下文、错误堆栈，分页和完整 NDJSON 导出。浏览器诊断单独保留。 |
| 公共 API 传输 | 统一请求、超时、取消、错误和关联编号；校验请求白名单与响应字段、门店、任务归属、状态、数量、模型版本和快照来源，写入失败不自动重复提交。 |
| 每日快照 | 新增上传与查询接口及页面入口，保留原始观测字段和源文件哈希；100 行以内整批提交，重复记录回滚，历史回填不倒退当前库存。 |
| 异步分析 | 创建 queued Run 与 pending Job 后立即返回 202；独立 worker 领取任务、调用模型并保存结果；页面查询真实状态与处理数量。 |
| 真实模型 | 接入 `ai-model-v1` 的 `s001-global-q-v1` LightGBM 模型，保留制品哈希校验；使用连续 29 天历史生成特征，不使用未来数据或 CSV 的 Demand Forecast 作为模型输入。 |
| 独立本地数据库 | SQLite 保存观测、库存、冻结输入、任务、预测、异常、审核和日志，服务重启后仍可读取。未实现正式 PostgreSQL 部署。 |
| 人工审核 | 按补货、异常、组合案例校验动作与原因，数据库保护重复审核；失败任务的部分结果可查看但不可审核。审核只保存决定，不改库存、不自动采购。 |
| 模式与日期 | 本机页面使用本地真实 API；github.io 保留明确标记的 mock 模式。真实模型默认分析日为 `2023-11-15`，拒绝早于 `2023-09-01` 的历史回测。 |
| Windows 与启动 | 固定模型及数据文件字节，避免 Git 换行转换破坏哈希；新增统一启动、停止和真实流程验收脚本。 |

### 新增与主要修改的文件

| 位置 | 用途 |
| --- | --- |
| `local_backend/` | 本地公共 API、SQLite 存储、独立 worker、真实 AI 日志包装、日志查询/导出、CSV 导入客户端和后端测试 |
| `integration/worker_ai.py` | worker 到私有模型的请求封装、身份/版本校验和关联日志编号 |
| `frontend/requests.js`、`contracts.js`、`http-client.js`、`live-api.js` | 请求准备、传输、响应与结果一致性校验 |
| `frontend/backend-logs.js`、`activity-log.js`、`api-gateway.js` | 后端日志合同、浏览器诊断和公共调用入口 |
| `src/pages/BackendLogsPage.jsx`、`LogsPage.jsx` | 服务端执行日志与浏览器诊断页面 |
| `src/components/SnapshotTransferPanel.jsx` | 每日快照提交和按商品/日期查询 |
| `src/pages/AnalysisPage.jsx`、`ExceptionsPage.jsx`、`InventoryPage.jsx` | 任务及 Job、结果追溯、组合异常审核、快照传输接入 |
| `src/main.jsx`、`bootstrap.jsx`、`public/runtime-config.js` | 先加载配置再创建 API，区分本机 live 与静态托管 mock |
| `scripts/start-local-demo.ps1`、`stop-local-demo.ps1` | 本机服务启动与停止，保留数据库和应用日志 |
| `scripts/verify-local-demo.mjs` | 使用实际前端 API 封装验证真实预测、审核、日志分页和完整导出 |
| `.gitattributes`、`.gitignore` | 保持受哈希校验文件的原始字节，排除本地数据库、日志、环境与构建产物 |

### 验证与当前边界

2026-10-20 已验证：38 项 Python 检查、32 项前端测试、生产构建；导入 S001 的 14,620 条原始观测，真实分析完成 20/20 商品；审核回读与重启持久化成功，库存未改变；175 条 Run/Job 关联日志分页及导出数量一致。

2026-10-21 合并最新 main 后重新验证：38 项 Python 测试、32 项前端测试全部通过，生产构建成功。

P0001 / 2023-11-15 的实际模型输出为 P50 `424.03519375145015`、P90 `648.0340855078196`，截止日库存 82，建议数量 567。模型版本、策略版本、输入引用和快照编号均保留。

本版采用模型已有的冻结模拟交货期；异常检测由 worker 的显式规则完成，AI v1 本身尚无异常模型。正式 PostgreSQL/Alembic、服务器部署、登录权限、失效领取恢复和日志保留策略仍需团队后端完成。

**GitHub Pages 只托管网页。上传 main 会按现有工作流发布网页，但不会替用户启动 Python、SQLite 或模型服务。** 本机真实 Demo 使用 `http://127.0.0.1:5174/FIX_dashboard/#/analysis`。本地数据库、已保存审核、执行日志和虚拟环境不上传到仓库，其他同学须按说明启动并导入数据。

详细文档：[本地启动与团队交接](local-integration-zh.md) · [W04 数据流核对](data-flow-audit-zh.md) · [公共接口合同](frontend-api-contract.md) · [后端日志合同](backend-logs-contract.md)。

## 历史记录：2026-10-14 模拟版整合

更新日期：2026-10-14  
上传分支：`feature/merged-demo-zh`  
对比基准：张艺桐的 React 初始版本，提交 `5a598a0`。

## 1. 本次整合的目标与范围

保留张艺桐的 React + Vite 项目、整体布局和中英文框架，将 Zhou Guanxu 的分析流程与公共 API 层接入同一套页面。

整合后的主流程：

**库存 → 发起每日分析 → 查看任务状态 → 查看预测结果 → 查看异常详情 → 保存人工审核 → 刷新恢复。**

当前为模拟接口 Demo：六个人工示例商品，数据与预测值不是原始 CSV 记录或真实模型输出；任务与审核保存在当前浏览器的 localStorage 中。真实后端、数据库、worker 和模型尚未接入。

## 2. 功能改动对照

| 部分 | 原 React 版本 | 整合后 |
| --- | --- | --- |
| 库存页面 | 空表格及占位统计 | 显示商品数量、库存总量、分类、快照日期和示例供货周期；支持搜索与刷新 |
| 分析入口 | 日期与运行按钮禁用 | 支持 S001、日期和模拟场景；提交后跳转到对应任务 |
| 任务状态 | 等待 API 接入 | 自动查询 queued、processing、completed、failed；当前页面创建中和运行中禁用重复提交按钮 |
| 预测结果 | 无结果展示 | 展示正常商品与异常商品、库存、预测周期、需求预测、安全库存和建议补货量 |
| 预测模式 | 无对应展示 | 支持 quantile 的 P50/P90，以及 point_buffer 的点预测与缓冲量；当前 mock 使用 quantile |
| 结果追溯 | 无对应展示 | 展示解释、模型版本、策略版本和输入数据来源 |
| 异常列表 | 空列表、筛选禁用 | 按所属分析任务与审核状态筛选；可返回全部案例 |
| 异常详情 | 占位内容 | 通过 case ID 读取准确案例，展示建议与依据，并链接回所属任务 |
| 审核表单 | 禁用 | 补货案例支持 approve / modify / reject；纯异常波动支持 resolve |
| 审核校验 | 尚未实现 | 审核人必填；修改、拒绝、解决需原因；修改数量为非负整数；失败任务和已处理案例不可再次审核 |
| 刷新恢复 | 仅页面框架 | 任务及案例通过路由 ID 恢复；模拟审核结果刷新后仍保留 |
| 语言与布局 | 已有中英文整体框架 | 保留原框架，增加新功能翻译、状态样式、加载与错误提示；切换页面回到顶部 |

审核只保存决策，不会创建采购订单或增加库存。模拟数据不提供跨浏览器同步或数据库级并发保障。

## 3. 主要文件改动

| 文件 | 改动内容 |
| --- | --- |
| `src/pages/InventoryPage.jsx` | 接入库存接口；统计、搜索、刷新和空结果展示 |
| `src/pages/AnalysisPage.jsx` | 创建分析、任务状态轮询、结果与追溯展示、异常跳转 |
| `src/pages/ExceptionsPage.jsx` | 列表筛选、案例详情、审核表单、保存后重新读取记录 |
| `src/workflow.js`（新增） | 共用 API / 配置入口、数字显示及路由链接构造 |
| `src/useResource.js`（新增） | 共用异步读取、加载、错误和重试；忽略切页后的旧响应 |
| `src/components/WorkflowUI.jsx`（新增） | 共用状态标签、统计卡片及请求反馈 |
| `src/components/AppLayout.jsx` | 模拟 / 真实模式标识、数据来源提示、切页滚动复位 |
| `src/i18n.jsx`、`src/workflow-translations.js`（新增） | 接入新功能的中文翻译；API 返回的解释与技术错误保留原文 |
| `src/styles.css` | 增加表单、状态、结果、提示和布局样式 |
| `public/runtime-config.js`（新增） | React 运行模式、API 地址配置，部署后仍可作为公开配置读取 |
| `index.html` | 在应用运行前加载公开配置 |
| `frontend/api.js`、`live-api.js`、`http-client.js`、`mock-api.js` | 从 Zhou 的 Demo 引入，供所有 React 页面共用；处理数据源、HTTP 请求和模拟业务 |
| `frontend/tests/` | 引入已有 mock 工作流与 HTTP 适配器测试，共 9 项 |
| `README.md`、`docs/` | 补充运行方法、接口合同、团队交接与整合验收说明 |

`frontend/` 中的独立 HTML 页面留作参考。团队整合版入口是 React 的 `src/` 页面，不需要运行两套界面，也不要分别维护两份业务状态。

## 4. 路由统一

| 用途 | 原独立 Demo | 整合后的 React 路由 |
| --- | --- | --- |
| 库存 | `?view=inventory` | `/#/inventory` |
| 分析入口 | `?view=analysis` | `/#/analysis` |
| 任务状态与结果 | `?view=analysis&run=任务ID` | `/#/analysis/任务ID` |
| 异常队列 | `?view=exceptions` | `/#/exceptions` |
| 当前任务的异常 | `?view=exceptions&run=任务ID` | `/#/exceptions?run_id=任务ID` |
| 按审核状态筛选 | `?view=exceptions&status=pending_review` | `/#/exceptions?status=pending_review` |
| 异常详情与审核 | `?view=exceptions&case=案例ID&run=任务ID` | `/#/exceptions/案例ID` |

`run_id` 和 `status` 可以组合使用。详情页从案例返回的 `analysis_run_id` 获取所属任务，不通过商品名或列表位置猜测。上述地址展示的是路由部分；部署到 GitHub Pages 后，前面还包含 `/FIX_dashboard/` 项目路径。

前端路由统一不改变后端接口名称；零售 API 仍按 [接口合同](frontend-api-contract.md) 实现。

## 5. 两位同学如何继续协作

| 负责人 | 重点维护内容 |
| --- | --- |
| Zhou Guanxu | 分析创建、状态与结果页面；公共 API；整体流程联调 |
| Zhang Yitong | 库存、异常列表、异常详情、审核表单与整体布局 |
| 两人共同协调 | 共享组件、语言文件、路由与运行配置，避免各自建立不同数据源 |

Zhou 是联调协调人，不代表独自承担全部后端。数据库、模型与 worker 的交接和负责人确认见 [团队接入说明](team-integration-ZH.md)。

## 6. 启动与演示

在仓库根目录运行（Node.js 20.19 或更新版本）：

```bash
npm ci
npm run dev
```

打开终端显示的地址，并进入 `/FIX_dashboard/`。实际端口以终端输出为准。

建议按以下顺序演示：

1. 库存页面确认 S001 的 6 个示例商品。
2. 分析日期选择 `2022-06-30`，运行“成功分析”。
3. 约 6 秒后显示 6 条结果、265 个建议补货单位和 3 个异常。
4. 打开 P0001 对应案例，选择修改，填入 120、审核人及原因。
5. 保存并刷新，确认审核数量 120 和 modified 状态仍存在；原系统建议仍为 130。
6. 返回该任务异常队列，按已修改或待审核筛选。
7. 运行失败场景：应保留部分结果并禁止审核。
8. 运行空结果场景：应显示成功完成、零条结果。

GitHub Pages 与本机的域名 / 端口不同，浏览器存储不共享。发布后应重新创建演示任务；本机链接中的任务 ID 不会自动在队友电脑上存在。

## 7. 配置、验证与尚未完成的部分

React 版本配置位于 `public/runtime-config.js`；打包后为 `dist/runtime-config.js`。独立参考 Demo 使用 `frontend/runtime-config.js`。配置中不得放置密码或模型密钥。

当前整合代码的既有验证记录（2026-10-14）：

- React 生产构建通过。
- 9 项 mock / HTTP 适配测试通过。
- 浏览器验证通过：成功分析、刷新恢复、结果到对应案例、审核保存与刷新、任务与状态筛选、中英文切换、失败任务禁止审核、成功空结果。
- 检查了窄屏与桌面布局，浏览器检查期间没有控制台错误。

可复查命令：

```bash
node --test frontend/tests/*.test.js
npm run build
```

尚未完成：真实 CSV 入库、数据库持久化、真实后台任务、模型训练与推理、鉴权、服务端并发审核和全链路真实 API 验收。前端验证不能代替这些工作。

## 8. 本次上传范围

本分支包含完整 React 整合项目、共用 API 与模拟接口、测试及中文改动说明。本次只上传新分支，不合入 `main`，不重开之前关闭的 PR，也不自动发布线上网站。

相关说明：

- [React 整合与验收](react-integration.md)
- [团队接入与交接](team-integration-ZH.md)
- [前后端接口合同](frontend-api-contract.md)

## AI 使用说明

OpenAI Codex 协助代码整合、模拟接口、测试及文档撰写。模拟预测未被当作真实 AI 推理或模型训练结果。
