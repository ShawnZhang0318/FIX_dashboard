# F.I.X. AI model handoff

完整的文件索引、接口与拟提交清单见 [AI 模块交接](HANDOFF.md)。

## 日结预测与异常诊断

AI 服务提供三个私有入口，原有 `POST /analyze` 仍可供现有 worker 调用。
下表中的业务日期以门店日结为准，由调用方提供。

| 入口 | 输入 | 输出 |
| --- | --- | --- |
| `POST /forecast/closed-day` | 单个 SKU 的 `store_id`、`product_id`、`as_of_date`、`expected_closed_date`、`input_reference`、固定 `lead_time_days` 和恰好 29 天的 `history` | 现有分位数预测，加上 `forecast_start`、`forecast_end` 和 UTC `generated_at`。截止日期和预期日结日期不一致，或历史有缺口时返回 422。 |
| `POST /diagnostics/daily` | `store_id`、`as_of_date`、`input_reference`、按 SKU 键组织的 `products` 历史 | S001 全部 20 个 SKU 的当日异常高销量及持续零库存结果。未提供的 SKU 标记为数据不足。 |
| `POST /diagnostics/monthly` | 与 Daily 相同，每个 SKU 最多 56 天 | 全量 SKU 的持续高销量、持续低销量及长周期库存异常。比较 `t−27…t` 与 `t−55…t−28`。 |

每条观测包含 `date`、`units_sold`、`inventory_level`。调用方应按业务日提供冻结快照，
用 `input_reference` 标识快照。日结预测应使用业务时钟算出的 `expected_closed_date`，
而非从现有最新记录推断它。连续零库存是每日快照信号，库存时点仍依赖数据源定义。
日结后的预测从次日开始。历史页面读取已保存的 Run、结果、案例和审核，再用 Run ID 查日志。
没有历史 Run 时显示无记录。旧日期实验通过独立离线流程执行。

初版规则 `s001-diagnostics-v1` 的阈值是待回放验证的默认值：

- Daily 高销量阈值为 `max(5, 前28日平均销量 × 2)`，持续零库存阈值为 3 天。
- Monthly 销量比较使用两个窗口内对应且均有正库存的观测。每对周至少要有 4 个可比日，
  至少 3 对周和合并窗口同向偏离 25%，同时至少偏离 1 件/日才触发。
- Monthly 库存异常在最近 28 日达到 7 个零库存日或 3 段零库存时触发，
  并返回前后窗口的零库存比例、最长连续天数和段数。

Dashboard 的 Live API 模式可以提交 Daily 和 Monthly。worker 在同一个 Run 中保存全量诊断，
`GET /analysis-runs/{id}/results` 返回 `diagnostics`。Daily 保留预测和补货审核；
未入选预测的 SKU 告警仍显示在诊断表。Monthly 保存全量诊断，不创建预测或补货审核案例。
公共 API 的历史查询分流和滚动模拟日结数据仍是独立的联调工作。

本地启动和导入步骤见[本地联调说明](../docs/local-integration-zh.md)。在 Analysis 页面选择
`2023-11-15`，分别运行 Daily 和 Monthly。Daily 应有 20 条诊断和 20 条预测，
Monthly 应有 20 条诊断，对照窗口为 `2023-09-21…2023-10-18`，
近期窗口为 `2023-10-19…2023-11-15`。

从仓库根目录可用现有 CSV 回放规则并输出按日的状态计数和异常 SKU，例如
`python -m ai.scripts.replay_diagnostics --mode monthly --from 2023-11-15 --to 2023-11-16`。
回放结果只输出到终端。

## 在 Colab 训练和导出

在 Google Colab 打开 [train_s001_colab.ipynb](notebooks/train_s001_colab.ipynb)。
先运行 **Dependency setup**。如果安装了依赖，选择 **Runtime → Restart session**，
然后执行 **Run all**。依赖导入检查通过后，按提示上传 `data/raw/retail_store_inventory_data.csv`。
如果重启前已创建训练目录，请在配置单元为本次训练设置新的 `MODEL_VERSION`。
当前 LightGBM 方案使用 Colab CPU。Notebook 生成新版本的模型包、P90 校准、manifest、
SHA-256 清单和评估报告，并下载 ZIP。默认时间切分沿用原始数据，换数据时需先核对切分日期。
每次候选发布使用独立的 `MODEL_VERSION`。部署前解压并在目标环境验证对应模型包。
候选模型可通过 `FIX_MODEL_DIR` 选择，并用独立的 `uvicorn ai.service:app` 做加载及接口验收。
当前 Dashboard 联调的 AI 包装器、API 和 worker 使用冻结的 v1 包，替换线上模型需要协调三者的配置和版本。
异常诊断规则在 AI 代码中单独版本化。

2026-10-21 更新：本目录保留 AI v1 的交付与独立运行说明。真实模型回归和本地完整联调已完成；启动带关联日志的整体 Demo 请用[本地联调说明](../docs/local-integration-zh.md)，不要同时另起占用同一端口的 AI 服务。

本目录提供 S001 的累计销量预测模块，独立于 React 前端。使用现有
`s001-global-q-v1` 两份 LightGBM 模型及 P90 校准，不重新训练。

## 当前交付

- `artifacts/s001-global-q-v1/`：Drive 原始六个模型产物及新增 SHA-256 清单。
- `features.py`：从单商品历史生成截止日特征，保留训练时编码与列顺序。
- `predictor.py`：加载模型、校准、返回版本化预测。
- `schemas.py`、`service.py`：私有 worker 接口及 FastAPI 服务。
- `examples/`：原始请求与已有 Notebook 结果整理的响应。响应不是此次执行结果。
- `reports/`：原始评估报告、特征重要性；`notebooks/`：原始训练记录。
- `tests/`：使用合成历史和服务替身的测试，不加载 joblib、不执行训练模型预测。
- `scripts/prepare_data.py`：从原始 CSV 和冻结 catalog 重建清洗表；不训练、不入库。

## 环境与运行

从 FIX_dashboard 根目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r ai/requirements-dev.txt
.venv/Scripts/python -m uvicorn ai.service:app --host 127.0.0.1 --port 8001
```

模型 manifest 记录 Python **3.13.16**、LightGBM 4.6.0、scikit-learn 1.6.1、
pandas 2.2.3、NumPy 2.1.3。starter 限定 Python 3.11，不能将其环境兼容性视为已验证。
joblib/scipy 是新增建议固定版本，原 Notebook 未记录它们；服务依赖沿用 starter。
requirements 不是已经完成模型验收的完整锁文件；正式运行前仍须在目标环境验证模型加载。

`FIX_MODEL_DIR` 可指定可信的完整模型目录；默认相对于 Python 模块定位，不依赖工作目录。
启动时校验文件并加载模型，失败则不启动。不要从不可信来源加载 joblib。
校验清单用于检测意外变化，不是签名认证。

私有服务提供 `GET /health/live`、`GET /health/ready`、`POST /analyze`。
不启动数据库、worker 或前端，不提供 `/analysis-runs`，不包含鉴权；应置于私有网络。
GitHub Pages 不会运行此 Python 服务。前端仍通过公共后端访问结果。

Python 调用形式：

```python
from ai.features import build_request
from ai.predictor import Predictor

# history 为 worker 从数据库读取的单个 store/product 历史。
request = build_request(history, store_id="S001", product_id="P0001",
                        as_of_date="2023-11-15", lead_time_days=3,
                        input_reference="snapshot-version/store/product/date")
predictor = Predictor()  # 进程启动时创建一次并复用
result = predictor.predict(request).model_dump(mode="json")
```

支持 P0001–P0020，每个商品只支持 catalog 中固定周期。预测目标为 t+1 至 t+L
累计已售数量，不等同于未受库存约束的潜在需求。日末已入库当天销量后才能调用。
历史必须涵盖 t-28 至 t 共 29 个日期，缺失日期/销量不填零；真实零销量是有效观测。
预测接口负责分位数预测。独立诊断接口执行 Daily 和 Monthly 规则，worker 负责补货策略和结果持久化。

## 不运行模型的检查

```powershell
python -m pytest ai/tests -q
```

这些测试不是预测复现，也不验证 joblib 在当前 Python 环境中的兼容性。
此测试命令只运行单元测试和替身接口检查。

## 真实模型测试（单独运行）

真实模型测试另放在 `ai/integration_tests/test_real_model.py`，不会被上述 `ai/tests`
命令执行。它使用写死的 S001/P0001/2023-11-15 请求加载真实模型，检查返回字段、
身份/版本、有限非负预测值、P90 ≥ P50，以及与 Notebook 基准结果一致；打印 JSON 和耗时。
不需要前端、数据库或启动 HTTP 服务。运行命令：

```powershell
python -m pytest ai/integration_tests/test_real_model.py -v -s
```

## 数据清洗命令

```powershell
python -m ai.scripts.prepare_data --output-dir data/rebuilt-v1
```

脚本核验原始 CSV 哈希，使用已冻结 catalog，拒绝覆盖目标清洗文件。
它只重建清洗数据；完整训练、标签、切分过程保留在 Notebook 中。
`data/metadata/v1/import_manifest.json` 保存 13 个导入文件的来源 ID、字节数和校验值。

详见 [模型合同](../docs/model-contract.md)、[数据交接](../docs/model-data-handoff.md)、
[交付计划与状态](../docs/ai-handoff-plan.md)。
