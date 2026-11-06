# F.I.X. AI 模块交接

## 功能与调用链

本更新在已有的 `s001-global-q-v1` 上增加日结预测入口、Daily 异常诊断和 Monthly 全量扫描。AI 是仓库内的私有 FastAPI 服务，由 worker 通过 HTTP 调用，无需第三方 AI API key。当前范围是门店 S001 的 P0001–P0020。

| 功能 | 实现与状态 |
| --- | --- |
| Daily 预测 | Dashboard 手动提交任务。API 冻结日结快照和输入引用。worker 对符合原有 Daily 选品规则的 SKU 调用 `/analyze`，使用截至日结日 t 的 29 天连续销量预测 t+1 至 t+L 累计销量。L 来自商品目录。模型输出 P50/P90，结果页展示 P90 和补货件数。 |
| 日结原始历史接口 | `/forecast/closed-day` 直接接受单个 SKU 的 29 天历史，并返回预测起止日期。调用方需独立提供预期关账日。当前 Dashboard 的 worker 仍通过 `/analyze` 预测。 |
| Daily 诊断 | worker 独立扫描全部 20 个 SKU，检查当天异常高销量和持续零库存。未入选预测的 SKU 也参与诊断，其告警显示在诊断区。已有预测结果的 SKU 可沿用补货和异常审核链路。 |
| Monthly 诊断 | 手动提交独立任务。扫描全部 SKU，对比最近 28 个已关账日与前 28 日，检查持续偏高、持续偏低和长周期缺货。当前 Monthly 任务只保存诊断，结果包含窗口和可比周数。 |
| 持久化和展示 | API 保存 Run/Job，worker 保存预测和诊断。Daily 和 Monthly 的诊断按异常 SKU 展示。数据不足、库存受限单独汇总。日志可用 Run/Job ID 查到 `diagnostics.requested` 和 `diagnostics.committed`。 |

补货建议为 `ceil(max(0, P90 − 截止日库存))`，审核只保存人工决策。真实到货由后续库存快照体现。当前补货公式缺少在途数量和到货日，因而可能在多个日结重复建议补货。历史 Run 可按 ID 回读。按日期查询历史、实时日结数据来源和自动调度仍需后续接入。

## AI 目录文件说明

| 文件或目录 | 用途 |
| --- | --- |
| `__init__.py` | Python 包入口。 |
| `schemas.py` | Pydantic 私有接口合同。定义 SKU、日结历史、特征、预测和诊断请求。 |
| `features.py` | 从连续 29 日历史生成滞后和滚动特征，按冻结的 schema 编码。 |
| `predictor.py` | 核验模型包哈希，加载两份 LightGBM 权重，执行分位数预测和 P90 校准。 |
| `diagnostics.py` | 版本为 `s001-diagnostics-v1` 的 Daily 和 Monthly 统计规则，以及缺失和库存受限处理。 |
| `service.py` | 私有 FastAPI 入口、健康检查、预测和诊断路由。 |
| `requirements.txt` | 模型与服务依赖。 |
| `requirements-dev.txt` | 本地测试和联调依赖。 |
| `requirements-railway.txt` | Railway 服务镜像使用的依赖清单。 |
| `artifacts/s001-global-q-v1/` | 已跟踪的运行时模型包，含 P50/P90 权重、校准、manifest、特征 schema、商品目录和哈希清单。 |
| `reports/s001-global-q-v1/` | 原 v1 评估指标与特征重要性。 |
| `examples/` | 原 `/analyze` 请求和响应样例。 |
| `notebooks/model_v1.ipynb` | 原模型训练记录。 |
| `notebooks/train_s001_colab.ipynb` | 可上传 Colab 的候选模型训练与导出入口，包含依赖检查、时间切分、训练、校准、评估和 ZIP 导出。 |
| `scripts/prepare_data.py` | 按冻结规则重建 v1 清洗数据。 |
| `scripts/replay_diagnostics.py` | 从历史 CSV 离线回放 Daily 或 Monthly 规则，输出每日状态计数和异常 SKU。 |
| `tests/test_data.py`、`tests/test_features.py`、`tests/test_inference.py` | 数据、特征、制品校验和推理合同测试。 |
| `tests/test_daily_monthly.py` | 日结日期校验、Daily 缺货和 Monthly 趋势回归测试。 |
| `integration_tests/test_real_model.py` | 单独加载真实 v1 模型验证已知预测。 |
| `runs/` | 本地 Colab 导出和逐条预测，供实验检查。该目录应从本次提交中排除。 |

## 私有接口

本地 AI 地址为 `http://127.0.0.1:8001`。启动后访问 `/docs` 查看请求 schema。

| 方法和路径 | 请求与响应 |
| --- | --- |
| `GET /health/live`、`GET /health/ready` | 进程存活和预测模型加载状态。 |
| `POST /analyze` | 传 `store_id`、`product_id`、`as_of_date`、`lead_time_days`、`feature_schema_version`、`input_reference`、`features`。返回 P50/P90、交货期、模型和特征版本。可直接使用 [现有请求样例](examples/example_analyze_request.json)。 |
| `POST /forecast/closed-day` | 传 `store_id`、`product_id`、`as_of_date`、`expected_closed_date`、`lead_time_days`、`input_reference`、`history`。每条历史含 `date`、`units_sold`、`inventory_level`。两个日结日期必须一致，且历史必须覆盖 t−28 至 t。响应另含 `forecast_start`、`forecast_end`、UTC `generated_at`。 |
| `POST /diagnostics/daily` | 使用下面的诊断请求结构，读取 t−28 至 t 的历史。返回 `high_sales` 和 `persistent_zero_stock`。 |
| `POST /diagnostics/monthly` | 请求结构相同，每个 SKU 提供最多 56 天。返回 `persistent_high_sales`、`persistent_low_sales`、`long_stockout` 和比较窗口。 |

诊断请求示例。以下最小请求可检查缺数据行为，完整联调应提供对应窗口的快照。

```json
{
  "store_id": "S001",
  "as_of_date": "2023-11-15",
  "input_reference": "handoff-example",
  "products": {
    "P0001": [{"date": "2023-11-15", "units_sold": 55, "inventory_level": 82}]
  }
}
```

诊断响应回显身份、日期、输入引用、`mode` 和 `policy_version`。每个 SKU 的每项发现包含 `status`、`reason` 和适用的观测值。状态为 `normal`、`anomaly`、`insufficient_data` 或 `inventory_limited`。缺失 SKU 会得到数据不足结果。重复日期、未来观测和非法数量会返回 422。

### 规则阈值

- Daily 销量超过 `max(5, 过去 28 天日均销量 × 2)` 才触发。连续至少 3 天零库存触发缺货告警。
- Monthly 销量比较 t−27 至 t 和 t−55 至 t−28。匹配两期相同星期且均有正库存的观测，每对周至少 4 个可比日。至少 3 对周和合并窗口同向偏离 25%，且日均差至少 1 件。
- Monthly 近期达到 7 个零库存日或 3 段零库存即触发，并返回两期缺货统计。这些是首版规则阈值，调整时更新规则版本。

## 本地调用和验证

在仓库根目录用 PowerShell。首次需要安装锁定的前端依赖和 AI 开发依赖，已有环境可以直接启动。

```powershell
npm ci
py -3.12 -m venv .venv-model
.\.venv-model\Scripts\python.exe -m pip install -r ai/requirements-dev.txt
$env:VITE_BASE_PATH = '/FIX_dashboard/'
.\scripts\start-local-demo.ps1
Invoke-RestMethod http://127.0.0.1:8001/health/ready
Invoke-RestMethod http://127.0.0.1:8000/health/ready
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
```

启动脚本也支持已有 `.venv`。如果它选择该环境，导入和测试时使用 `.venv\Scripts\python.exe`。
打开 [Dashboard 首页](http://127.0.0.1:5174/FIX_dashboard/)，进入 Analysis，用 `2023-11-15` 分别运行 Daily 和 Monthly。
历史 CSV 的 Daily 演示可用区间是 2023-09-01 至 2024-01-01，Monthly 完整覆盖区间是 2022-02-25 至 2024-01-01。

公共 API 等价调用如下。创建返回 202，随后轮询 Run，终态后获取结果。Monthly 使用相同请求，将 `run_type` 改为 `monthly`。

```powershell
$api = 'http://127.0.0.1:8000'
$body = @{store_id='S001'; run_type='daily'; as_of_date='2023-11-15'} | ConvertTo-Json
$run = Invoke-RestMethod "$api/analysis-runs" -Method Post -ContentType 'application/json' -Body $body
$id = $run.analysis_run.id
Invoke-RestMethod "$api/analysis-runs/$id"
# Run 完成后读取 results 和 diagnostics。
Invoke-RestMethod "$api/analysis-runs/$id/results" | ConvertTo-Json -Depth 12
```

离线回放与回归命令如下。

```powershell
.\.venv-model\Scripts\python.exe -m ai.scripts.replay_diagnostics --mode monthly --from 2023-11-15 --to 2023-11-16
.\.venv-model\Scripts\python.exe -m pytest ai/tests integration/tests local_backend/tests -q
node --test frontend/tests/*.test.js
npm run build
```