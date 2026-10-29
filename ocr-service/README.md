# 本地 OCR 服务（开源方案接入）

本目录提供一个**零框架依赖**的本地 OCR HTTP 服务，把开源 OCR 引擎包装成
**PaddleOCR Serving v2 兼容**接口，供后端 `server/` 的 OCR 适配器调用。

> 目的：把「拍照识别」的置信度从提示词猜测的 **0.32** 提升到实测 **0.97~0.99**，
> 同时让**图片不出本机**（校园/家庭私有化部署友好）。

---

## 1. 快速开始

```bash
cd ocr-service

# 1) 安装依赖（本机若已有 rapidocr-onnxruntime 可跳过）
pip install -r requirements.txt

# 2) 启动（默认 0.0.0.0:8868）
python3 ocr_service.py

# 3) 健康检查
curl http://127.0.0.1:8868/health
# → {"ok": true, "engine": "rapidocr", "error": null, "maxBytes": 12582912}
```

环境变量：`OCR_HOST`、`OCR_PORT`、`OCR_MAX_BYTES`。

---

## 2. 接入系统

1. 打开网页左侧 **⚙️ 模型设置** 页面；
2. 打开「本地 OCR 服务」开关，地址填 `http://127.0.0.1:8868`（局域网其它机器填 `http://<内网IP>:8868`）；
3. 保存，回到「📷 拍照录入」即可。识别链路卡片会显示引擎为 `本地 OCR`。

后端配置优先级：**网页设置 > .env > 本地启发式引擎**。

---

## 3. 接口约定

### `GET /health`

```json
{ "ok": true, "engine": "rapidocr", "error": null, "maxBytes": 12582912 }
```

### `POST /predict`（PaddleOCR Serving v2 兼容）

请求：

```json
{ "images": ["<base64，可带或不带 data: 前缀>"] }
```

响应：

```json
{
  "result": {
    "ocrResults": [
      { "prunedResult": { "rec_texts": ["题干第一行", "题干第二行"], "rec_scores": [0.986, 0.993] } }
    ],
    "elapse": 0.42
  }
}
```

多个 `images` 会返回同序的多个 `ocrResults`。

### `POST /ocr`（便捷接口，返回整段文本 + 平均置信度）

请求：`{ "image": "<base64>" }`
响应：`{ "text": "3.小明有24颗糖…\n答：C", "confidence": 0.988 }`

---

## 4. 识别流水线与实测数据

### 4.1 三层流水线

```
① 快速路径（2 个候选，约 0.8s/张）
     a) 保守：原图 + 引擎默认检测参数   -> 清晰图最稳
     b) 增强：CLAHE + 放宽检测阈值     -> 手机拍的题差别很大
   谁打分高用谁；分数够高就直接返回。
② 兜底搜索：4 个预处理变体 × 3 个外扩比例（最多 12 次识别）
   —— 图糊/光线差时用，按「平均分 × 行数覆盖 × 字数覆盖」选最好的。
③ server 级大模型兜底（可选，需要额外 190MB 模型）
   —— 移动版实在认不动时才请大模型上（一次约 5~7s）。
```

**打分公式**（`ocr_service.py::_rank`）：

```
rank = 平均置信度 × (0.5 + 0.5×行数覆盖) × (0.25 + 0.75×字数覆盖) × 变体加成
```

* 行数/字数太少要罚分：有的变体会「自信地」只认出 1 行、平均分还不低，内容却全丢了。
* `original` 变体有加成：清晰图不该被过度处理弄坏。
* `server_*` 候选要**明显更好**才顶替移动版（`OCR_SERVER_SWITCH_RATIO`），
  否则正常照片会被大模型读错（实测 real 档会从 0.85% 掉到 4.50%）。

### 4.2 四档基准（`scripts/ocr-bench/`，5 个样例/档，固定随机种子可复现）

| 档位 | 含义 | 原版 RapidOCR | 本流水线（移动版 15MB） | +server 大模型（+190MB） |
|---|---|---|---|---|
| clean | 扫描件 | 1.90% / 20-20 | **1.90% / 20-20** | 1.90% / 20-20 |
| phone | 仿真手机照 | 0.15% / 20-20 | **0.15% / 20-20** | 0.15% / 20-20 |
| **real** | **真实手机分辨率** | 4.50% / 18-20 | **0.85% / 20-20** | 0.85% / 20-20 |
| hard | 远距离小字（≈14 像素/字） | 74.53% / 3-20 | **50.69% / 5-20** | 48.65% / **8-20** |

> 「字符错误率 / 关键词命中」。real 档是**用户日常拍照**的代表；hard 档字高只有 ~14px，
> 已经接近中文的信息极限（放大/锐化/换模型都救不回来），所以产品上要引导用户「拍近一点」。

### 4.3 hard 档逐样例：移动版 vs server 大模型

| 样例 | 移动版 CER / 关键词 | server 版 CER / 关键词 | 结论 |
|---|---|---|---|
| math | 51.6% / 2-4 | **43.8%** / 2-4 | 救回来了 |
| chinese | **46.0%** / 2-5 | 52.4% / 2-5 | 没救回来（略差） |
| english | 46.9% / 0-3 | 48.5% / **2-3** | 关键词救回 2 个 |
| physics | 65.9% / 0-4 | **56.8%** / 0-4 | 救回来 |
| math_word | 43.0% / 1-4 | **41.9%** / **2-4** | 都好一些 |
| **合计** | 50.69% / 5-20 | **48.65%** / **8-20** | 关键词 +60% |

**real 档两边完全一样**（0.85% / 20-20）——降级逻辑不会在正常照片上帮倒忙。

### 4.4 引擎选型对比（为什么最后选了「移动版 + 可选大模型」）

| 方案 | 模型体积 | 单张耗时 | real 档 | hard 档 | NAS 友好度 |
|---|---|---|---|---|---|
| RapidOCR 移动版（v4 det + v4 rec） | **15 MB** | 0.4~3.6s | **0.85%** | 50.69% | ✅ 最好 |
| + CLAHE/锐化/放宽检测阈值（当前流水线） | 15 MB | 0.8~11s | 0.85% | 50.69% | ✅ |
| + server 级 det（v4 server） + server 级 rec（v5） | +190 MB | +5~7s | 0.85% | **48.65%**（关键词 8-20） | ⚠️ 镜像/内存都要加 |
| 官方 PaddleOCR Serving（paddleocr 包） | 200MB+ | 10s+ | 未实测 | 未实测 | ❌ 依赖重 |
| 手写体识别 | — | — | **无样本，未做** | — | — |

**结论**：

* 日常拍照（real 档）**移动版就够了**，加 server 大模型没有任何提升；
* 远距离小字（hard 档）server 大模型能把关键词命中率从 5/20 提到 8/20，
  代价是 +190MB 模型 +5~7s 延迟；
* 换更大的引擎（PaddleOCR 官方包）在本机 CPU 上没有优势、部署成本反而最高，**不采用**；
* **两阶段识别（裁框放大后再识别）实测没有收益**：RapidOCR 内部本来就是
  「检测 → 透视裁剪 → 逐行识别」两段式，再手工放大 2~3 倍，real 档 0.85%→0.79~1.02%，
  hard 档反而从 52% 掉到 54~67%（把细笔画放大了也补不回来），所以**不做**。

---

## 5. 可选：启用 server 级大模型兜底

大模型**不随仓库分发**（190MB，`ocr-service/models/` 已 gitignore）。

```bash
# 1) 下载模型（走 hf-mirror 镜像，pip 直连 pypi 不通时也能用）
python3 ocr-service/fetch_models.py --out ocr-service/models

# 2) 用环境变量启动侧车
OCR_SERVER_DET=ocr-service/models/ch_PP-OCRv4_det_server.onnx \
OCR_SERVER_REC=ocr-service/models/PP-OCRv5_server_rec.onnx \
OCR_SERVER_KEYS=ocr-service/models/rec_keys_v5.txt \
python3 ocr-service/ocr_service.py
```

没配这三个变量时，服务行为和纯移动版完全一样（只是慢图少了 2~5 个百分点的提升）。

---

## 6. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OCR_HOST` / `OCR_PORT` | `0.0.0.0` / `8868` | 监听地址 |
| `OCR_MAX_BYTES` | `12582912` | 单图最大字节（12MB） |
| `OCR_PREPROCESS` | `1` | 关掉就等于「原版 RapidOCR」 |
| `OCR_VARIANTS` | `original,sharp,clahe,clahe_soft` | 预处理变体；`binary` 二值化**实测会吃掉细笔画**（CER 100%），默认不开 |
| `OCR_DET_UNCLIP` | `2.5` | 检测框外扩比例 |
| `OCR_DET_THRESH` / `OCR_DET_BOX_THRESH` | `0.15` / `0.2` | 兜底搜索用的宽松检测阈值 |
| `OCR_UNCLIP_VALUES` | `2.0,2.5,3.0` | 兜底搜索试的外扩比例 |
| `OCR_FAST_STRONG_VARIANT` / `OCR_UNCLIP_STRONG` | `clahe` / `2.5` | 快速路径里的「增强候选」 |
| `OCR_DET_LIMIT` | `736` | 检测模型输入短边；调小省内存（480 → 峰值 ~820MB） |
| `OCR_ORT_THREADS` | `2` | ONNX 线程数；`-1` 会用满所有核（NAS 上抢 CPU） |
| `OCR_MIN_SHORT` | `0` | 侧车自己放大图片的下限；**默认 0**（引擎自己放大效果更好） |
| `OCR_MAX_LONG` | `2000` | 长边超过就等比缩小 |
| `OCR_SERVER_DET` / `OCR_SERVER_REC` / `OCR_SERVER_KEYS` | 空 | 配了就启用大模型兜底 |
| `OCR_SERVER_TRIGGER_SCORE` / `OCR_SERVER_TRIGGER_ROWS` | `0.95` / `3` | 移动版低于这个分/行数才请大模型 |
| `OCR_SERVER_SWITCH_RATIO` | `0.88` | 大模型要比移动版好这么多才顶替（<1 = 更激进而非更保守） |
| `OCR_SERVER_MAX_VARIANTS` | `2` | 大模型最多试几个预处理变体 |

---

## 7. 运维要点

* **健康检查不会被长请求阻塞**：`/health` 只读缓存状态，不碰引擎锁，
  返回里带 `status`（`loading`/`ready`/`failed`）和 `busy`（正在处理的请求数）。
  容器编排的 HEALTHCHECK 不会因为有人正在识别而把容器判成 unhealthy。
* **内存**：单张识别峰值常驻约 **1.2GB**（检测模型 2400×736 输入的中间张量）。
  内存吃紧的机器可以用 `OCR_DET_LIMIT=480`（峰值 ~820MB，hard 档准确率基本不变）。
* **超时**：后端调 OCR 的超时由后端 `OCR_TIMEOUT_MS` 控制（默认 60 秒），
  侧车本身不会主动断开。

---


| 顺序 | 引擎 | 许可 | 特点 |
|---|---|---|---|
| 1 | **RapidOCR**（onnxruntime 版） | Apache-2.0 | PaddleOCR 模型转 ONNX，**纯 CPU 可跑**、体积小、中文效果好 —— **本项目默认推荐** |
| 2 | **PaddleOCR** 官方 | Apache-2.0 | 版面 / 表格 / 公式能力最强，依赖较重 |
| 3 | **CnOCR** | Apache-2.0 | 轻量备选 |

服务启动时惰性探测，探测到哪个用哪个；都没有时 `/health` 返回 503 并给出安装指引。

---

## 8. 引擎优先级与备选引擎

### 8.1 引擎优先级

想要更强的版面/公式识别，可以直接用官方服务，接口天然兼容：

```bash
paddleocr --host 0.0.0.0 --port 8868 --use_angle_cls true --lang ch
```

此时把 `ocr-service` 关掉即可，系统照常调用。

---

## 9. 隐私

* 识别全程在本机完成，**图片不会离开设备**，只有识别出的文本会交给后端用于结构化。
* 若同时启用了云端视觉模型，则图片会发往该模型供应商 —— 请根据未成年人数据合规要求谨慎开启，
  并优先使用**本地 Ollama 视觉模型**（如 `qwen2.5-vl:7b`）实现完全离线。
