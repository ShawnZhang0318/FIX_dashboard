# F.I.X. 团队接入版 Demo 操作指南

## 已完成的范围

本版本基于 injuredkitten/MAIE6000C1 starter，新增 `frontend/`。保留原 Python 服务与 Compose 配置。已完成分析触发、异步状态展示、结果查询、公共 API 层、URL 刷新恢复；另提供库存和异常审核的基础联调页面，供 Zhang 后续替换/整合。

**当前是模拟接口 Demo。** 六个商品、商品名称、分类、库存、预测数值均为人工示例，不是原始 CSV 数据。没有训练模型、运行真实 Worker 或写入 PostgreSQL。所有运行与审核保存在当前浏览器。顶部始终显示这个限制。

## 第一步 启动

在仓库根目录打开终端：

```powershell
python -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

也可以在 PowerShell 运行 `frontend/start-demo.ps1`。如系统策略禁止脚本执行，直接使用上面的 Python 命令，不必修改系统执行策略。保持终端运行，然后打开 http://127.0.0.1:5173 。不需要 Docker、npm install 或后端服务。不要直接双击 index.html。

## 第二步 运行成功场景

1. 打开 Daily analysis，门店 S001，日期 2022-06-30。
2. 选择 Successful analysis，点击 Run Daily Analysis。
3. 观察 queued → processing → completed，约 6 秒。没有虚构百分比。
4. 查看 6 条结果、265 个建议补货单位、3 个异常。其中 3 个商品是正常结果。
5. 展开 Result traceability 查看解释、输入来源、模型和策略标识。
6. 刷新浏览器：URL 中保留 run ID，同一浏览器仍可恢复本次运行。

## 第三步 审核与持久化演示

1. 点击 P0001 的 Inspect，直接进入该 run 的对应 case。
2. 选择 Modify，填写审核人，数量改为 120，填写原因。
3. 保存后刷新，确认数量和状态仍存在。
4. 打开 Inventory，确认库存没有因审核增加。
5. 已处理 case 不再显示可重复提交的表单。异常列表可以筛选 pending review 或已审核状态。
6. P0006 是 anomaly-only 示例，可以 Resolve 并填写说明。

## 第四步 演示失败与空结果

- 选择 AI failure 场景：任务失败，保留一条明确标注的部分结果，该 case 不允许审核。
- 选择 No eligible products：任务成功完成但结果为零，页面明确区分“无商品”和“服务失败”。
- 想清理记录时点击侧边栏 Reset demo data，确认后只删除本应用的模拟记录。

## 文件分工

| 文件 | 用途 |
| --- | --- |
| `index.html`、`styles.css` | 页面外壳、导航和响应式样式，供两人协作 |
| `app.js` | Zhou 的分析、状态及结果页面；页面路由与公共上下文 |
| `pages/review-pages.js` | Zhang 独立接手的库存、异常列表、详情、审核模块 |
| `api.js`、`live-api.js`、`http-client.js` | 统一数据源、真实接口适配与 HTTP 请求 |
| `mock-api.js` | 可替换的模拟接口，时间状态及浏览器持久化 |
| `runtime-config.js` | 每个环境的 mock/live 模式、接口地址和轮询配置 |
| `tests/*.test.js` | 模拟工作流和 HTTP 适配边界检查 |
| `../docs/frontend-api-contract.md` | 交给后端/PJ/Cao/Zhang 的接口约定 |

## 下一步与队友对接

先确认接口约定，再让后端实现 retail 路由。现在 starter 只有通用 `/cases` 和 `/jobs`，不能直接把配置改成 live 就得到零售功能。真实接口完成后，配置 `mode: 'live'`、`apiBaseUrl`，后端允许前端来源的 CORS，并按同一流程联调。

本地验证命令：`node --test frontend/tests/*.test.js`。项目原有 Python 集成测试仍依赖其原本的服务环境，前端模拟测试不能代替它们。不要在课程展示中把浏览器存储说成数据库持久化，也不要把模拟响应说成真实 AI 推理。

团队接入顺序、模型 / 数据交接及文件归属详见 [团队交接说明](../docs/team-integration-ZH.md)。
