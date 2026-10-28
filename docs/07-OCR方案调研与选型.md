# 拍照识别置信度提升：开源 OCR / 文档解析方案调研与选型报告

> 调研日期：**2026-10-26**　适用项目：**学生错题统计分析系统**（Node.js + Express 5 + node:sqlite + React）
> 场景约束：中小学生**手写作业 / 试卷拍照** → 需结构化出 `学科 / 题型 / 知识点 / 题干 / 选项 / 学生错误答案 / 正确答案`；文本含**中文 + 数学公式 + 几何图形 + 表格**；**必须私有化本地部署，数据不出校**。

---

## 0. 调研方法与可信度说明

| 项 | 说明 |
|---|---|
| 仓库元数据 | 通过 `api.github.com/repos/{owner}/{repo}` 读取 SPDX license、stars、`pushed_at`（真实维护状态） |
| 模型权重许可 | 通过 `huggingface.co` 模型卡 `license` 字段 + 仓库内 `LICENSE` / `LICENSE AGREEMENT` 原文（本机直连 HF 超时，经 `hf-mirror.com` 镜像读取同一内容） |
| 源码级事实 | 通过 GitHub `contents` 接口读取 `LICENSE`、`README.md`、以及**实际 API 返回结构**（如 CnOCR `ocr()`、PaddleOCR MCP 解析器、EasyOCR `readtext()`） |
| 官方文档 | `paddleocr.ai` / `paddlepaddle.github.io/PaddleX` / `rapidai.github.io` 文档页 |
| 论文 | arXiv 摘要页（PaddleOCR-VL `2510.14528`、DeepSeek-OCR `2510.18234`） |
| 标注规则 | 凡我**没有实际读到原文**的，一律写「**未核实**」，不做推测 |

---

## 1. 候选清单

### 1.1 PaddleOCR 系（含公式、版面）

| 方案 | 一句话定位 | 代码许可 | 权重许可 | 权重开放 | 中文 | 数学公式 | 手写 | CPU 可跑 | 性能/显存（已核实） | 部署难度 | OpenAI 兼容 API | 维护状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PaddleOCR 3.x**（PP-OCRv6 / PP-StructureV3 / PP-FormulaNet_plus） | 通用文档 AI 引擎，全家桶覆盖检测/识别/版面/表格/公式 | **Apache-2.0** | Apache-2.0 | ✅ 完全开放 | ✅ 50 语种统一模型 | ✅ PP-FormulaNet_plus | ⚠️ 印刷体强，手写需专用模型 | ✅ | PP-OCRv6 相对 v5：检测 +4.6%、识别 +5.1%；**CPU(OpenVINO) 端到端 5.2× 加速**，Apple M4(tiny) 6.1×，A100 上 0.13s；三档 tiny 1.5M / small 7.7M / medium 34.5M | 低（pip 装好即用） | ❌ 官方 API 是**云端**（AI Studio token）；本地是 PaddleX Serving（非 OpenAI 协议） | v3.7.0（2026-06-11），91.7k stars，main 最后提交 2026-09-16 |
| **PP-StructureV3** | 版面+表格+公式+印章+图表的整页结构化流水线 | Apache-2.0 | Apache-2.0 | ✅ | ✅ | ✅ | ⚠️ | ✅ | 输出 Markdown/JSON + **表格单元格坐标 / 文本坐标**（比 VLM 系列更细）；有 `text_rec_score_thresh` / `seal_rec_score_thresh` 阈值参数 | 低 | ❌（本地 `/layout-parsing` HTTP） | 同上 |
| **PP-FormulaNet_plus**（S/M/L） | 公式识别专用模型，输出 LaTeX | Apache-2.0 | **Apache-2.0**（模型卡 `license: apache-2.0`） | ✅ | ✅ 中文公式 | ✅ 专精 | ⚠️ | ✅ CPU 装 `paddlepaddle` 即可 | **M 版 En-BLEU 91.45 / Zh-BLEU 89.76 / GPU 1301.56ms**；S 版 88.71 / 53.32 / **191.69ms**；L 版 92.22 / 90.64 / 1745.25ms；同表 UniMERNet 基线 85.91 / 43.50 / 2266.96ms | 低 | ❌ | 随 PaddleOCR 3.7.0 |
| **PaddleOCR-VL**（0.9B / 1.5 / 1.6） | 0.9B 超紧凑文档 VLM（NaViT 动态分辨率视觉编码器 + ERNIE-4.5-0.3B） | Apache-2.0 | **Apache-2.0** | ✅ | ✅ 109 语种 | ✅ | ✅ **官方明示擅长手写文本/手写公式**（内测集含手写公式类目，表现最佳） | ⚠️ `transformers` 可 `DEVICE="cpu"` 跑，但极慢；生产建议 GPU | **OmniDocBench v1.6 = 96.33%（SOTA）**，v1.5 = 94.5%；Real5-OmniDocBench 五场景（扫描/形变/屏幕翻拍/光照/倾斜）全 SOTA | 中（要 vLLM 或 PaddleX） | ✅ `paddleocr genai_server --model_name PaddleOCR-VL-0.9B --backend vllm` 起 vLLM（OpenAI 协议）；`vllm serve` 亦可 | 1.6 版 2026-05-28 |
| **HPD-Parsing** | 高吞吐文档解析 VLM（分层并行解码 + P-MTP） | Apache-2.0 | 未核实 | 未核实 | ✅ | ✅ | 未核实 | 未核实 | **峰值 4,752 tokens/s** | 中 | ✅ **官方明示支持 OpenAI 兼容 serving** + 定制 vLLM runtime | 2026-07-22 |

> ⚠️ 注意：`PaddlePaddle/PaddleOCR-VL` **不是一个独立 GitHub 仓库**（GitHub API 返回 404），代码在 `PaddlePaddle/PaddleOCR` 主仓库，权重在 HF/ModelScope 的 `PaddlePaddle/PaddleOCR-VL(-1.6)`。

### 1.2 视觉大模型 / 文档解析

| 方案 | 一句话定位 | 代码许可 | 权重许可 | 中文 | 数学 | 手写 | CPU 可跑 | 性能/显存（已核实） | 难度 | OpenAI 兼容 | 维护状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **MinerU 2.5/4.x** | 文档 → Markdown/JSON 的全类型解析管线 | **MinerU 开源许可**（= Apache-2.0 **+ 3 条附加条款**，见 §2） | `MinerU2.5-Pro-2604/2605-1.2B` = **Apache-2.0**；`MinerU2.5-2509-1.2B` = **AGPL-3.0**；`MinerU-4_models_onnx` 未核实 | ✅ | ✅ | ⚠️ | ✅ **可纯 CPU** | 4.x 四档：basic=ONNX CPU，模型 ~0.8GB、**内存 2GB 起、无需加速卡**；standard/advanced=ONNX+llama.cpp，模型 ~2GB、内存 8GB 起、CPU 可跑（推荐 Vulkan）；PyTorch+vLLM 需 **8GB+ 显存** | 中 | ❌ 本地 parse server 非 OpenAI 协议（底层可选 vLLM/LMDeploy/llama.cpp） | 82.5k stars，最后提交 **2026-10-26（今天）** |
| **Marker** | 以 surya VLM 为核心的 PDF→Markdown 转换管线 | **Apache-2.0** | **修改版 AI Pubs OpenRAIL-M**（研究/个人/**营收<$5M 的初创**免费；更广商用需付费） | ✅ | ✅ | ✅ | ✅（`llama.cpp` 后端） | olmOCR-bench overall **76.0%**，born-digital **83.5%**；单流 ~0.3 pg/s，并发 ~2.9 pg/s（B200） | 中高 | ✅ 内置 surya 推理服务是 OpenAI 兼容（`SURYA_INFERENCE_URL=http://host:port/v1`）；`--use_llm` 支持 OpenAI 兼容/Ollama 后端 | 40.6k stars，2026-10-22 |
| **Docling (IBM)** | MIT 的文档解析框架，可插拔 OCR 引擎 + 可插拔 VLM | **MIT**（模型各自许可） | 逐模型看 | ✅ | ✅ | ⚠️ | ✅ | 无统一数字（框架而非单一模型） | 中 | ❌（但支持 OpenAI 兼容 LLM 后端做后处理） | 69.6k stars，**2026-10-26** |
| **olmOCR** | 线性化 PDF 为 LLM 训练数据的高分工具包 | **Apache-2.0** | Apache-2.0（`allenai/olmOCR-2-7B-1025-FP8`） | ✅ | ✅ | ✅ **README 明示支持 handwriting** | ❌ **7B VLM，需 ≥12GB 显存**（RTX 4090/L40S/A100/H100） | FP8 版；Docker 镜像 ~30GB | 中 | ✅ `vllm serve allenai/olmOCR-2-7B-1025-FP8` + CLI `--server http://host:8000/v1` | 19.8k stars，最后提交 **2026-03-25** |
| **dots.ocr / dots.mocr** | 多语言文档版面解析（1.7B→3B MoE） | **MIT** | **MIT + 附加协议**：`rednote-hilab/dots.ocr` 仓库内 `dots.ocr LICENSE AGREEMENT` | ✅ | ✅ | 未核实 | ❌ | `dots.mocr` 3.0B，**olmOCR-bench 83.9**（对照 surya 表） | 中 | ✅ `vllm serve rednote-hilab/dots.mocr` | 9.2k stars，2026-03-24 |
| **MonkeyOCR / MonkeyOCRv2** | SRR 三元组范式的轻量文档解析 | **Apache-2.0** | v1 权重**仅学术研究/非商用**，商用需另签；**MonkeyOCRv2（2026-07）已按 Apache-2.0 发布**（0.7B parser，17 语种） | ✅ | ✅ | ❌ **官方明示 v1 尚不支持"拍照文字/手写内容/繁体"** | ❌ | pro-3B 吞吐：3090 ≈0.49 pg/s、A6000 ≈0.59、H800 ≈0.89、4090 ≈0.97；1.2B 比 3B 快 ~36%、精度掉 ~1.6% | 中 | ✅ vLLM | 6.65k stars，2026-07-20 |
| **Surya (2)** | 650M VLM 统一做 OCR/版面/阅读顺序/表格 | **Apache-2.0** | **修改版 AI Pubs OpenRAIL-M**（同 Marker 限制） | ✅ 中文 **82.5%**（91 语种总体 87.2%） | ✅ | ✅（README 有手写演示） | ✅ **llama.cpp 后端跑 CPU/Apple Silicon** | olmOCR-bench **83.3**（<3B 参数里 SOTA） | 中 | ✅ llama-server / vLLM | `datalab-to/surya`（原 VikParuchuri/surya），21.5k stars，2026-10-23 |
| **DeepSeek-OCR**（及 **DeepSeek-OCR-2**） | 视觉-文本压缩式 OCR 直出 Markdown/LaTeX | **MIT** | **MIT**（模型卡 `license: mit`） | ✅ | ✅ | 未核实 | ❌（MoE，需 GPU） | config：12 层 / hidden 1280 / **64 routed experts、每 token 激活 6** / MoE intermediate 896 / 视觉 `sam_vit_b`+`deeplip_b_l` / image_size 1024 / bf16；**A100-40G 上 PDF 并发 ~2500 tokens/s** | 中高 | ✅ vLLM（上游 vLLM 已内置支持） | 24.1k stars；**DeepSeek-OCR-2 于 2026-01-27 发布**（独立仓库） |
| **Qwen2.5-VL**（3B/7B/72B） | 通用多模态大模型 | Apache-2.0 | **3B/7B = Apache-2.0；72B = other（Qwen 自有许可）** | ✅ | ✅ | ✅ | ⚠️ 4B/8B 量化可 CPU 但不实用 | `Qwen2.5-VL-7B-Instruct` HF 下载 513 万 | 中 | ✅ vLLM / SGLang / LMDeploy | `QwenLM/Qwen2.5-VL` 仓库已并入 Qwen3-VL（GitHub 302 重定向） |
| **Qwen3-VL**（2B/4B/8B/32B/30B-A3B/235B-A22B） | 新一代多模态大模型，**扩展 OCR 到 32 语种**，弱光/模糊/倾斜鲁棒性提升 | **Apache-2.0（全尺寸）** | Apache-2.0 | ✅ | ✅ | ✅ | ❌（8B 需 16GB 级） | 4B/8B Instruct+Thinking 双版本；256K 原生上下文 | 中 | ✅ vLLM（README 直接给 `vllm serve`） | 20.1k stars，2026-01-30 |

### 1.3 数学公式专用

| 方案 | 一句话定位 | 代码许可 | 权重许可 | 中文公式 | 手写公式 | CPU | 性能 | 难度 | OpenAI | 维护状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| **PP-FormulaNet_plus** | 中文公式最强（Zh-BLEU 89.76） | Apache-2.0 | Apache-2.0 | ✅✅ | ⚠️ | ✅ | 见 §1.1 | 低 | ❌ | 活跃 |
| **GOT-OCR2.0** | 通用 OCR 理论模型，输出纯文本或 LaTeX | Apache-2.0（badge；仓库根**无 LICENSE 文件**，未核实） | **HF `ucaslcl/GOT-OCR2_0` = apache-2.0**；仓库标注 Data License **CC BY-NC 4.0** | ⚠️ 底座是 Qwen（中文好） | ⚠️ | ⚠️ 有社区 CPU 版 | 0.6B；**olmOCR-bench 仅 48.3**（对照 surya 表） | 中 | ❌ | 8.2k stars，**最后提交 2025-02-10（已停滞）** |
| **UniMERNet** | 真实场景数学表达式 → LaTeX | **Apache-2.0** | Apache-2.0 | ❌ 英文为主 | ✅ HWE 类目（UniMER-Test 含 6,332 手写样本） | ⚠️ 重（Donut Swin） | 同表 UniMERNet En-BLEU 85.91 / GPU 2266.96ms | 中 | ❌ | 506 stars，2025-09-28 |
| **Texify** | 图片/PDF 数学 → Markdown+LaTeX | **GPL-3.0** | 随主仓 | ❌ | ⚠️ | ✅ | — | — | ❌ | ❌ **已废弃**：README 首行写明"功能已迁移到 surya（`surya_latex_ocr`）"；最后提交 2025-01-29 |
| **Nougat** | arXiv 科学文档整页 OCR | **MIT** | MIT | ❌ | ❌ | ⚠️ | — | 中 | ❌ | 最后提交 2025-02-21 |
| **Pix2Tex (LaTeX-OCR)** | 块级公式 → LaTeX | 未核实（社区称 GPL-3.0，**未核实**） | 未核实 | ❌ | ⚠️ | ✅ | — | 低 | ❌ | 未核实 |

### 1.4 传统 / 中文 OCR

| 方案 | 一句话定位 | 代码许可 | 权重许可 | 中文 | 手写 | **能否拿到逐字/逐行置信度** | CPU | 部署难度 | OpenAI | 维护状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| **RapidOCR (ONNXRuntime 版)** | 把 PaddleOCR 模型转 ONNX 的跨平台 OCR 库 | **Apache-2.0** | Apache-2.0（模型源自 PaddleOCR，`MODEL_LICENSES.md` 登记来源与 SHA-256） | ✅ | ⚠️ | ✅ **`scores` 逐行/逐字** | ✅ | 低 | ❌ | 8.3k stars，**最后提交 2026-10-26** |
| ↳ `rapidocr_api`（PyPI） | RapidOCR 的 FastAPI+uvicorn 本地 HTTP 服务 | Apache-2.0 | 同上 | ✅ | ⚠️ | ✅ | ✅ | 低（`pip install rapidocr_api`） | ❌ | 27 stars，2026-02-27 |
| ↳ `rapidocr-node`（npm） | **Node.js/TypeScript 版 RapidOCR**，基于 `onnxruntime-node` | Apache-2.0 | 同上 | ✅ | ⚠️ | ✅ `lines[].confidence` / `wordResults` | ✅ | 低（但需 Node ≥24） | ❌（自带 HTTP 服务模式） | **v0.3.4 / 2026-10-20；仓库 0 star，新生项目** |
| **CnOCR** | Python 中文 OCR 工具包，现已内置 RapidOCR + PP-OCRv5/v6 | **Apache-2.0** | Apache-2.0 | ✅✅ | ⚠️ | ✅ **`ocr()` 返回 `text` + `score`(0~1) + `position`(4×2 坐标)** | ✅ `pip install cnocr[ort-cpu]` | 低 | ❌ | `breezedeus/CnOCR`，3.77k stars，2026-07-05 |
| **chineseocr_lite** | 超轻量中文 OCR（dbnet+crnn），ONNX/NCNN/MNN 多端 | **GPL-2.0** ⚠️ | 随仓 | ✅ | ⚠️ | ⚠️ ONNX 输出可取（未逐一核实字段名，**未核实**） | ✅ 仅 CPU（C++ Demo）；NCNN 有 Vulkan GPU 版 | 低 | ❌ | 12.35k stars，2026-05-18 |
| **Tesseract** | 老牌 OCR 引擎 | **Apache-2.0** | Apache-2.0（含 `chi_sim`） | ✅ | ❌ 弱（**未核实官方声明，社区共识**） | ✅ **TSV 每词一行含 bbox + confidence + text；hOCR 同样含置信度** | ✅ | 低 | ❌ | 77.2k stars，2026-10-24 |
| **EasyOCR** | CRAFT + CRNN 的多语言 OCR | **Apache-2.0** | Apache-2.0（ch_sim/en） | ✅ | ⚠️ | ✅ **`readtext(detail=1)` 返回 `[{boxes, text, confident}]`**（源码已核实） | ✅ `gpu=False` | 低 | ❌ | 30.1k stars，2025-12-05 |

---

## 2. 许可证与商用风险速查（学校/国企采购必看）

| 风险等级 | 方案 | 问题 | 处置建议 |
|---|---|---|---|
| 🔴 **高** | **Marker / Surya** | 代码 Apache-2.0，但**模型权重是修改版 AI Pubs OpenRAIL-M**：仅研究、个人使用、**营收<$5M 的初创**免费；更广商用要付费 | 校内私有部署通常落在"免费"范围，但**对外提供服务/商业化前必须走 Datalab 商务**。本项目若只做校内部署，**可用但要留痕** |
| 🔴 **高** | **chineseocr_lite** | **GPL-2.0**（强传染性） | 若只是**独立进程调用、不随产品分发**，风险可控；**若把其代码嵌入 Node 产物分发，需法务评估** |
| 🔴 **高** | **MonkeyOCR v1** | 权重仅"学术研究/非商用评测"，商业部署需另签书面许可 | 直接排除 v1；**MonkeyOCRv2 已转 Apache-2.0**，可用 |
| 🟡 **中** | **MinerU** | 仓库许可 = Apache-2.0 **+ 附加条款**：①MAU>1 亿 或 月收入>2000 万美元需单独商业许可；②**基于 MinerU 向第三方提供在线服务，必须显著标注"使用了 MinerU"** | 校内私有部署（不对外提供服务）通常不触发；**一旦做成 SaaS 必须加署名** |
| 🟡 **中** | **MinerU2.5-2509-1.2B 权重** | 老版本权重在 HF 上是 **AGPL-3.0** | 改用 `MinerU2.5-Pro-2604/2605-1.2B`（**Apache-2.0**）或 `MinerU-4_models_onnx` |
| 🟡 **中** | **dots.ocr** | MIT + 附加协议；§3.2 **明确允许"闭源、企业内部本地部署"**；§7.3 若分发**修改过的权重**须标注 "Built with dots.ocr" | 校内私有部署**明确被许可**，风险低 |
| 🟢 **低** | PaddleOCR 全系 / RapidOCR / CnOCR / DeepSeek-OCR / Qwen3-VL / olmOCR / Docling / Tesseract / EasyOCR / GOT-OCR2.0 权重 | Apache-2.0 / MIT | 可放心商用 |

---

## 3. 三套可落地的融合架构

### 方案 A：两段式 ——「本地 OCR（文本+版面）→ LLM 结构化」

```
┌────────────┐  image/base64   ┌──────────────────────┐  {texts[], scores[], boxes[]}   ┌──────────────┐
│  Node 端   │ ───────────────▶ │  本地 OCR 服务        │ ───────────────────────────▶ │  LLM 端      │
│ /api/      │                  │ RapidOCR / PaddleOCR  │                              │ 结构化 +     │
│ analyze/   │ ◀────────────────────────────────────────────────── JSON 结构化结果 ◀─── │ 置信度解释   │
│ photo      │                  │ (可含 PP-StructureV3)│                              │              │
└────────────┘                  └──────────────────────┘                              └──────────────┘
```

**依赖**
- OCR：`rapidocr`（PyPI）或 `paddleocr` 3.x；服务器 `rapidocr_api` 或 `paddlex --serve --pipeline OCR`
- LLM：任意 OpenAI 兼容端点（本项目 `settings.js` 已有 10+ 供应商预设）；**私有化则用 vLLM + Qwen3-VL-8B/32B-Instruct 或纯文本 Qwen3-32B**

**启动命令**
```bash
# OCR 侧车（FastAPI，端口 9005）
pip install rapidocr_api
rapidocr_api -ip 127.0.0.1 -p 9005 -workers 2
# 调用：POST /ocr  multipart 字段 image_file

# 或 PaddleOCR 3.x（端口 8080，返回含 rec_scores）
paddlex --install serving
paddlex --serve --pipeline OCR --host 127.0.0.1 --port 8080

# 或 PaddleOCR-VL（OpenAI 协议，端口 8080）
paddleocr genai_server --model_name PaddleOCR-VL-0.9B --host 0.0.0.0 --port 8080 --backend vllm
```

**返回结构示例**（OCR 侧，本项目 `server/ocr.js` 已能解析此形状）
```json
{ "result": { "ocrResults": [ { "prunedResult": {
    "rec_texts": ["3. 下面各题的结果是（  ）", "A. 12  B. 16  C. 20  D. 24", "我的答案：B"],
    "rec_scores": [0.987, 0.913, 0.762],
    "rec_boxes": [[[31,28],[511,28],[511,55],[31,55]], ...] } } ] } }
```

**延迟与成本**
- OCR：CPU（ONNX Runtime）单张 A4 照片约 **0.3~1.5s**（**未核实官方数字，需实测**）；GPU 上更快
- LLM：纯文本 30B 量化 ≈ 2~6s（**未核实，需实测**）
- 成本：**零 API 费用**（全私有化），只有硬件成本

**隐私**：✅ 最强。图片不出校，只有文本进 LLM——若 LLM 也是本地则**完全不出校**。
**弱点**：手写体识别率受传统 OCR 天花板限制；版面信息丢失导致题干/选项/学生答案的**切分归属靠 LLM 猜**。

---

### 方案 B：一体式 ——「视觉大模型直出结构化 JSON」

```
┌────────────┐  image + 结构化 Prompt   ┌──────────────────────────────────────┐
│  Node 端   │ ───────────────────────▶ │  VLM (OpenAI 兼容)                    │
│ /api/      │                          │ PaddleOCR-VL 0.9B / Qwen3-VL-8B /    │
│ analyze/   │ ◀─────────────────────── │ DeepSeek-OCR / dots.mocr              │
│ photo      │   {stem, options[],      │ 一次调用直接输出 schema 化 JSON        │
└────────────┘    myAnswer, ...}       └──────────────────────────────────────┘
```

**依赖**：vLLM + 一个 VLM 权重；本项目 `server/modelClient.js` 已实现 OpenAI 兼容调用，**几乎零改造**（只需把 `supportsVision` 的 provider 指向本地 vLLM）。

**启动命令**
```bash
# Qwen3-VL-8B-Instruct（Apache-2.0，中文强，OCR 支持 32 语种）
vllm serve Qwen/Qwen3-VL-8B-Instruct --max-model-len 32768 --port 8000
# PaddleOCR-VL-0.9B（Apache-2.0，OmniDocBench 96.33%，手写最强）
vllm serve PaddlePaddle/PaddleOCR-VL --port 8000
# DeepSeek-OCR（MIT）
vllm serve deepseek-ai/DeepSeek-OCR --port 8000
```
调用即标准 OpenAI：`POST /v1/chat/completions`，`model` 填上述名字，`messages[].content` 传 `image_url` + 结构化指令。

**返回结构示例**
```json
{ "stem": "下面各题中，正确的结果是（  ）",
  "options": ["12","16","20","24"],
  "myAnswer": "B",
  "correctAnswer": null,
  "subject": "数学", "questionType": "选择题",
  "knowledgePoints": ["分数四则运算"],
  "difficulty": 2,
  "fieldConfidence": { "stem": 0.93, "options": 0.88, "myAnswer": 0.71, "correctAnswer": 0.0, "knowledgePoints": 0.66 } }
```

**延迟与成本**
- PaddleOCR-VL-0.9B：单页 0.9B，**未核实官方 tokens/s**；社区有 GGUF 量化版（`cstr/paddleocr-vl-0.9b-GGUF`）可跑 llama.cpp
- Qwen3-VL-8B：单图 3~10s（**未核实，需实测**）
- 成本：GPU 一次性投入（8B 量化 ≈ 8GB 显存，32B 需 24GB+）

**隐私**：✅ 图片不出校（本地 vLLM）。
**弱点**：**VLM 不会输出 token 级置信度**——只能靠模型自报 `fieldConfidence`，缺乏客观锚点，**这正是"整体置信度"最难的地方**。

---

### 方案 C（推荐）：融合 ——「OCR 给原文与置信度 + VLM 给语义结构 + 交叉校验」

```
   image
     │
     ├──────────────▶ ┌──────────────────────────────┐
     │                │ 本地 OCR 引擎（双路）           │
     │                │ ① PP-OCRv6 / RapidOCR         │
     │                │ ② PP-StructureV3 版面/公式/表格  │
     │                │ → texts[], scores[], boxes[],   │
     │                │   layout[], formula[]           │
     │                └──────────────┬───────────────────┘
     │                               │ OCR 原文 + 逐行置信度 + 几何
     │                               ▼
     │                ┌──────────────────────────────┐
     │                │ 字段切分器（Node 端，纯规则）   │
     │                │ 题号/选项字母/答题区归属       │
     │                └──────────────┬───────────────────┘
     │                               ▼
     │                ┌──────────────────────────────┐
     │                │ VLM / LLM 结构化              │
     │                │ prompt 里带 OCR 原文+置信度    │
     │                └──────────────┬───────────────────┘
     │                               ▼
     │                ┌──────────────────────────────┐
     └──────────────▶ │ 交叉校验 + 融合打分            │
                      │ OCR×VLM 文本一致性 / 选项字母  │
                      │ 闭合性 / 答案∈选项 / 公式覆盖  │
                      └──────────────┬───────────────────┘
                                     ▼
                              字段级 + 整体置信度
```

**依赖**：OCR 引擎（Python 侧车）+ 结构化模型（云端 OpenAI 兼容或本地 vLLM）。**本项目已具备全部骨架**：
- `server/ocr.js`：本地 OCR 适配器，**已能解析 `rec_texts`/`rec_scores`**（PaddleOCR Serving v2 形状）
- `server/vision.js`：`fuseConfidence()` 已实现 4 信号加权
- `server/settings.js`：`ocrBaseUrl` / `ocrEnabled` / `visionModel` / `supportsVision` 开关齐备

**启动命令**
```bash
# 1) 起本地 OCR（与现有 ocr.js 契约直接兼容）
paddlex --install serving
paddlex --serve --pipeline OCR --host 127.0.0.1 --port 8080
#    或轻量侧车：
pip install rapidocr_api && rapidocr_api -ip 127.0.0.1 -p 9005

# 2) 结构化模型（本地化时）
vllm serve Qwen/Qwen3-VL-8B-Instruct --port 8000
```

**返回结构示例**（融合后的最终产物）
```json
{
  "draft": { "subject": "数学", "questionType": "选择题",
             "knowledgePoints": ["分数四则运算"], "stem": "下面各题中，正确的结果是（  ）",
             "options": ["12","16","20","24"], "myAnswer": "B", "correctAnswer": null,
             "difficulty": 2 },
  "confidence": { "overall": 0.84, "level": "medium",
    "signals": [ {"name":"ocrToken","value":0.88,"weight":0.35},
                 {"name":"modelSelf","value":0.86,"weight":0.30},
                 {"name":"structure","value":0.90,"weight":0.20},
                 {"name":"crossCheck","value":0.78,"weight":0.15} ],
    "fieldConfidence": { "stem": 0.91, "options": 0.86, "myAnswer": 0.62 },
    "reasons": ["学生手写作答行 OCR 置信度 0.62，低于阈值 0.70，建议人工复核"] },
  "analysis": { "...": "AIAnalysis 结构，与现有 ai.js 对齐" } }
```

**延迟与成本**：OCR(0.3~1.5s) + VLM(3~10s) ≈ **4~12s 端到端**（**未核实，需实测**）。成本 = 硬件 + （若用云端 LLM）按 token 计费；全本地 = 0。

**隐私**：✅ 图片不出校。若结构化模型走云端，则**只有 OCR 后的文本出校**——仍比方案 B（整图出校）好得多，且可只把"低置信度字段"送云端复核。

---

## 4. 本项目集成点建议

### 4.1 现状盘点（已读代码确认）

| 现状 | 位置 | 结论 |
|---|---|---|
| 拍照端点已存在 | `server/routes/analyze.js:20` `POST /api/analyze/photo` | ✅ 可直接接入 |
| 本地 OCR 适配器已存在 | `server/ocr.js` `runLocalOcr()` | ✅ **已按 PaddleOCR Serving v2 契约写好**：主路径 `POST {baseUrl}/predict` body `{"images":["<base64>"]}`，次选 `POST {baseUrl}/ocr` body `{"image":"<base64>"}`；返回兼容 `rec_texts`/`rec_scores`/`texts`/`scores`/`text+confidence`/嵌套 `result`/`prunedResult` |
| 置信度融合已存在 | `server/vision.js:510` `SIGNAL_WEIGHTS`、`:623` `fuseConfidence()` | ⚠️ 有基础版，**有 5 处可改进**（见 §5） |
| 配置开关已存在 | `server/settings.js` `ocrBaseUrl` / `ocrEnabled` / `visionModel` / `supportsVision` | ✅ 无需新增配置项 |
| 供应商预设已存在 | `server/providers.js`（10+ 个 OpenAI 兼容预设） | ✅ 加一个"本地 vLLM"预设即可 |

> **结论：本项目不需要重新设计 OCR 接入层——它已经按"PaddleOCR Serving v2"设计好了。技术选型要做的是"填哪个引擎进去"。**

### 4.2 三种接入方式对比

| 维度 | ① Python 侧车 + HTTP | ② ONNX Runtime Node 原生绑定 | ③ 调用独立 OCR 服务（PaddleOCR Serving / PaddleX） |
|---|---|---|---|
| 与现有 `ocr.js` 的契合度 | ★★★★☆ 需微调（`rapidocr_api` 是 multipart `image_file`，`ocr.js` 目前发 JSON `{image}`）→ 需在 `ocr.js` 加一条 multipart 分支 | ★★★★★ 直接 `fetch` 本地 HTTP 或直接调 JS API | ★★★★★ **完全匹配**：`/predict` + `{images:[base64]}` + `result.ocrResults[].prunedResult.{rec_texts,rec_scores}` 与 `ocr.js` 注释描述逐字对应 |
| 依赖安装 | 需 Python 3.9+ 环境 + pip 包（**注意：本机 Python 是 3.9.6，CnOCR/rapidocr 要求 3.8~3.12，PaddleOCR 3.x 要求 3.8~3.12 ✅**） | `onnxruntime-node` 1.30.0 原生模块，**需 Node ≥24（本机 v25.8.2 ✅）** | 需 Docker 或 Python + `paddlex` 插件 |
| 崩溃隔离 | ✅ 独立进程 | ❌ 与 Express 同进程，ONNX 段错误会拖垮 API | ✅ 独立进程 |
| 延迟 | 一次进程内 HTTP（同机）≈ 与③相当 | **最低**，省一次序列化 | 一次 HTTP（同机 ≈ +1~3ms） |
| 能否升到 PP-StructureV3 / PaddleOCR-VL | ✅ 换 `paddlex --serve --pipeline PP-StructureV3` 即可 | ❌ 只能做检测+识别，**没有版面/表格/公式** | ✅ 同左，**同一套 HTTP 契约** |
| 许可证干净度 | Apache-2.0 | Apache-2.0（但 `rapidocr-node` 仓库 **0 star**，成熟度未验证） | Apache-2.0 |
| 维护活跃度 | `RapidAI/RapidOCR` 最后提交 2026-10-26 | `rapidocr-node` v0.3.4 / 2026-10-20，**0 star** | `PaddlePaddle/PaddleOCR` v3.7.0 / 2026-06-11，91.7k stars |
| 额外能力 | 中 | **只有文本+置信度** | **最高**：版面坐标、表格 HTML、公式 LaTeX、印章、图表 |

### 4.3 ✅ 推荐：③ **本地 PaddleOCR 3.x Serving（`paddlex --serve`）+ 现有 `server/ocr.js` 零改造**

**理由（按权重排序）**

1. **零改造、零风险**：`server/ocr.js` 的契约（`/predict` + `{images:[base64]}` → `result.ocrResults[].prunedResult.{rec_texts,rec_scores}`）与 PaddleOCR Serving v2 **逐字对应**；PaddleX 基础/高稳定部署的返回体同样包含 `{"errorCode":0,"result":{"ocrResults":[...]}}`。只需在设置页把 `ocrBaseUrl` 填 `http://127.0.0.1:8080`。
2. **唯一能同时给出「逐行置信度 + 版面坐标 + 表格 + 公式」的轻量方案**。方案 ②（onnxruntime-node）只能给文本+置信度，拿不到表格/公式/版面；PP-StructureV3 能把**几何信息**交给融合算法（§5 的 `layout` 信号依赖它）。
3. **一条命令平滑升级到 VLM 路线**：`paddlex --serve --pipeline PP-StructureV3` 走同一端口同一契约；再进一步 `paddleocr genai_server --backend vllm` 就能换成 PaddleOCR-VL（OpenAI 协议），**Node 侧几乎不改**。
4. **许可证最干净**：全 Apache-2.0，无 GPL/AGPL/商用附加条款（对比 Marker/Surya 的 OpenRAIL-M、MinerU 的附加条款）。
5. **上游最活跃 + 生态最大**：91.7k stars，Dify / RAGFlow / MinerU / Umi-OCR 等都在用；模型支持 ONNX / OpenVINO / TensorRT 高性能推理，**CPU 部署可行**（PP-OCRv6 CPU 5.2× 加速）。

**次选（当目标机器无 Python/无 pip 权限时）**：`rapidocr-node`（npm，Apache-2.0，onnxruntime-node）——但它是 **0 star 新项目**，且只有文本+置信度，**建议先在预发环境压测再上生产**。

**不推荐**：直接上 Marker / Surya（权重 OpenRAIL-M 商用限制）、MonkeyOCR v1（权重非商用且**明示不支持手写/拍照**）、chineseocr_lite（GPL-2.0）、Texify（已废弃）、PaddleOCR 官方 API（**是云端服务，会把图片发到百度 AI Studio，违反"数据不出校"**）。

### 4.4 落地步骤（最小侵入）

1. **部署 OCR 服务**（与 Node 同机或同内网）
   ```bash
   pip install "paddlepaddle==3.2.1"          # CPU 版
   pip install paddleocr
   paddlex --install serving
   paddlex --serve --pipeline OCR --host 127.0.0.1 --port 8080
   # 需要版面/公式/表格时改：
   # paddlex --serve --pipeline PP-StructureV3 --host 127.0.0.1 --port 8080
   ```
2. **设置页填地址**：前端「模型设置」→ `ocrBaseUrl = http://127.0.0.1:8080`，`ocrEnabled = true`。**无需改任何 Node 代码。**
3. **健康检查**（可选，放进 `scripts/smoke.mjs`）：`POST /predict` body `{"images":["<base64>"]}`，断言返回里有 `rec_texts` 与 `rec_scores`。
4. **若要接本地 VLM**：在 `server/providers.js` 加一条预设
   ```js
   { id: 'local-vllm', name: '校内私有 VLLM', baseUrl: 'http://127.0.0.1:8000/v1',
     models: ['Qwen/Qwen3-VL-8B-Instruct', 'PaddlePaddle/PaddleOCR-VL'],
     defaultModel: 'Qwen/Qwen3-VL-8B-Instruct', supportsVision: true,
     note: 'vLLM 起服务，数据不出校' }
   ```
   `modelClient.js` 已经是 OpenAI 兼容协议，**无需改动**。
5. **可选加固**：给 `ocr.js` 增加一条 `multipart/form-data` 分支，以兼容 `rapidocr_api` 这类侧车（当前只发 JSON `{image}`，与 `rapidocr_api` 的 `image_file` 字段不匹配）。

---

## 5. OCR 置信度 → 产品可用的「整体置信度」

### 5.1 现状（`server/vision.js`）

```js
SIGNAL_WEIGHTS = { ocrToken: 0.35, modelSelf: 0.35, structure: 0.2, crossCheck: 0.1 }
final = Σ(signal.value × signal.weight) / Σ(signal.weight)     // 缺失信号不参与，权重归一
```
`scoreStructure()` 已覆盖：题干长度 ≥8、选项 ≥2 且字母唯一、答案字母 ∈ 合法集合、知识点非空、学科/题型枚举合法、难度 1~5。

**这已经是可用的基线**。但有 5 个具体缺陷，直接拉低/扭曲整体置信度：

| # | 问题 | 后果 | 修复方向 |
|---|---|---|---|
| ① | `ocrToken` 用的是**全文行置信度算术平均** | OCR 置信度分布重尾：**一行 0.3 分就能把均值从 0.95 拉到 0.87**，肉眼不可见 | 改用**分位数**：`ocrToken = 0.6×P20 + 0.4×均值`，并按**字段归属**加权（题干/选项/学生答案各自的行分别算） |
| ② | `crossCheck` 用 `textSimilarity(ocr.text, modelText)` 的**对称相似度** | `ocr.text` 是**整页**多题文本，`modelText` 是**一道题**→ 相似度天然被压到 0.3~0.5，**系统性低估**置信度 | 改用**包含度**：`coverage = \|modelText ⊆ ocr.text\|`（或先按 bbox/阅读顺序切出对应题区再比） |
| ③ | 缺**版面完整度**信号 | 题号缺失、选项 A~D 不全、答题区没被检出、几何图形/表格被漏掉——这些**版面级错误完全没被惩罚** | 新增 `layout` 信号：PP-StructureV3 的版面块完整性（题号/选项/公式/图片块齐全度） |
| ④ | 缺**公式/图形覆盖率**信号 | 数学题里 LaTeX 丢一个符号会彻底改变题意，但当前评分不体现 | 新增 `formula` 信号：题干中数学符号密度 vs OCR 出的公式区域 LaTeX 是否自洽（`$…$` 配对、左括号计数、运算符密度） |
| ⑤ | 无**跨引擎一致性**信号 | 单一 OCR 引擎的系统性错误无法被发现 | 加一路异构引擎（PP-OCRv6 vs RapidOCR vs CnOCR）做**双路一致性**：`agree = 两路文本相似度`，一致则加分歧惩罚 |

### 5.2 改进后的融合打分算法（可直接落地）

**第 0 步：字段级切分（Node 端纯规则，不依赖模型）**
用 OCR 返回的 `rec_boxes` + 几何关系，把每一行归属到：`题号行 / 题干 / 选项(A,B,C,D) / 学生作答区 / 印刷答案区 / 公式区 / 其他`。
规则：选项字母 `^[（(]?([A-H])[）).．、．:：]` 开头 → 选项；行位于某题号块的下方且含手写笔迹（用笔迹分类或与印刷体基线差异近似）→ 作答区。

**第 1 步：算 6 个信号（各自 0~1）**

| 信号 | 计算方式 | 建议权重 |
|---|---|---|
| `ocrToken` | **字段加权**：`0.5×题干P20 + 0.3×选项均值 + 0.2×学生作答P20`（没有某字段则该项不计，按剩余权重归一） | **0.30** |
| `modelSelf` | VLM 自报的 `fieldConfidence` 加权平均（题干/选项权重高于 `correctAnswer`——它常常为空） | 0.25 |
| `structure` | 复用现有 `scoreStructure()` | 0.20 |
| `layout` | 版面完整度：题号存在 + 选项字母连续（A,B,C,D 无缺口）+ 检出 ≥1 个公式块（若题干含数学符号）+ 检出学生作答块 | **0.10**（新增） |
| `formula` | 公式自洽：LaTeX `$` 配对率、`\frac{` 分支闭合、括号平衡、OCR 出的公式长度与视觉墨迹面积比例 | **0.05**（新增） |
| `crossCheck` | **包含度**：`coverage(modelText ⊆ ocrText)`；若能切出题区，则改用题区内的双向相似度 | **0.10** |

> 权重合计 1.00。缺失信号**不参与**，最终按实际出现的权重**重新归一**（与现有实现一致）。

**第 2 步：最终分**
```
final = Σ(signal.value × weight) / Σ(weight)          // 保持现有实现不变
final_adj = final × layoutPenalty × consistencyPenalty
```
- `layoutPenalty`：缺题号 ×0.95；选项字母有缺口 ×0.85；**该有公式却没检出公式 ×0.80**
- `consistencyPenalty`：双路 OCR 文本相似度 < 0.6 → ×0.8；< 0.4 → ×0.6

**第 3 步：字段级置信度（前端高亮用）**
对每个字段 `f`：`conf(f) = 0.5×ocrToken(f) + 0.3×modelSelf(f) + 0.2×structure(f)`；
其中 `ocrToken(f)` 来自**该字段对应 OCR 行的分位数置信度**（不是全文平均）——这让"学生答案那一行看不清"能被精准定位到 `myAnswer` 字段，而不是被整页均值稀释。

### 5.3 置信度低时的降级策略

| 区间 | 判定 | 动作 |
|---|---|---|
| **≥ 0.85** | `high` | 直接入库，`byModel` 结果可信，无需人工 |
| **0.60 ~ 0.85** | `medium` | 入库但**打标 `needsReview=true`**；前端在对应字段旁显示"置信度偏低，请核对"，并把**原图 crop** 挂在该字段上（OCR 的 `rec_boxes` 已知，切图零成本） |
| **0.35 ~ 0.60** | `low` | **不自动写入统计口径**；只存"待确认草稿"，前端弹出原图 + 识别结果让家长/老师一键修正；修正后的结果走"已复核"通道，不参与置信度加权统计 |
| **< 0.35** | `rejected` | 判定为**识别失败**，返回明确错误提示：**"图片不清晰，请重新拍摄"**，并给出具体原因（模糊/过曝/倾斜/题目被裁切/手写潦草） |
| **结构冲突** | 任意区间 | 触发**自动重试链**：①换 `PP-StructureV3` 版面重解析 → ②换 VLM 单独识别手写作答区 → ③提示重拍。**三级都失败才降级** |

**重拍引导的判定钩子**（可直接用已有信号）
- `ocrToken` P20 < 0.45 → "光线不足或字迹过淡"
- 版面块数 < 2 或缺题号 → "请拍全整页，题目被裁切了"
- 图片宽高比异常 / 检测到大幅倾斜 → "请正对页面拍摄"
- 学生作答区未检出但题目区检出成功 → "没拍到学生的笔迹作答"

---

## 6. 最终推荐

> **一句话结论：以 `PaddleOCR 3.x 本地 Serving（paddlex --serve --pipeline OCR / PP-StructureV3）` 作为唯一 OCR 引擎，通过现有 `server/ocr.js` 的 HTTP 契约零改造接入本地 VLM（优先 Qwen3-VL-8B-Instruct 或 PaddleOCR-VL-0.9B，均 Apache-2.0、vLLM 提供 OpenAI 兼容接口），并把 `server/vision.js` 的置信度融合从「全文平均 token 置信度 + 对称相似度」升级为「字段级分位数 + 版面完整度 + 包含度交叉校验 + 双引擎一致性」的六信号模型。**

**理由（按权重）**

1. **唯一同时满足"私有化 + 手写 + 公式 + 表格 + 逐行置信度 + 许可证干净"的组合**。Marker/Surya 权重受 OpenRAIL-M 商用限制；MonkeyOCR v1 权重非商用且官方明示不支持手写；chineseocr_lite 是 GPL-2.0；MinerU 老权重是 AGPL-3.0、新权重许可又与仓库许可不同步；PaddleOCR 系**全链路 Apache-2.0**。
2. **对本项目改动最小**：OCR 接入层（`server/ocr.js`）和置信度融合层（`server/vision.js`）**已经存在且契约正确**，选型工作 = 部署一个服务 + 填一个 `ocrBaseUrl`，不是重写。
3. **置信度可落地**：`rec_scores` 是**真实的逐行识别置信度**，配合 `rec_boxes` 能做字段级切分与 crop 定位——这是 VLM 方案（方案 B）**拿不到**的客观锚点，恰好补上了"整体置信度"最缺的一环。
4. **平滑演进**：同一 HTTP 契约下可从 `OCR` → `PP-StructureV3`（加版面/公式/表格）→ `PaddleOCR-VL`（换 VLM 直出）逐级切换，Node 侧几乎不改；VLM 侧从云端 OpenAI 兼容切到校内 vLLM 也只需改 `providers.js` 一条预设。
5. **可回退**：当前 `/api/analyze/photo` 已有"大模型失败 → 本地启发式引擎（`server/ai.js` 引擎 B）"的降级链路，OCR 侧失败也能沿用同一模式，不产生 5xx。

---

---

## 7. OCR 服务的容器化

本项目提供**已跑通**的本地 OCR 容器镜像（`deploy/docker/ocr.Dockerfile`），把 RapidOCR 包成 PaddleOCR Serving v2 兼容的 HTTP 服务。

### 7.1 镜像与接口

| 项 | 值 |
| --- | --- |
| 基础镜像 | `python:3.12-slim-bookworm` |
| 引擎 | `rapidocr-onnxruntime`（纯 CPU，无需 GPU，Apache-2.0） |
| **OpenCV** | **`opencv-python-headless`**（headless 版，不需要任何图形库 → **镜像里零 apt 步骤**，见 §7.2） |
| **pip 源** | **清华 → 阿里 → 官方** 顺序回退（`ARG PIP_MIRRORS`） |
| 端口 | `8868` |
| 接口 | `POST /predict`（body `{"images": ["<base64>"]}`）、`GET /health` → `{"ok": true, "engine": "rapidocr", ...}` |
| **模型** | 3 个 `.onnx`（约 15 MB）**随 pip 包装进 site-packages**，不是运行时下载 → **不需要模型缓存卷** |
| 运行用户 | 非 root（`ocr`） |
| 实测镜像大小 | **615 MB**（主应用镜像 329 MB） |

```bash
# 构建
docker build -f deploy/docker/ocr.Dockerfile -t cuoti-analytics-ocr:1.0.0 .

# 或用 compose（推荐，profile 默认不启动）
docker compose --profile ocr up -d
```

### 7.2 我们为什么不用 `opencv-python`

`rapidocr-onnxruntime` 会连带装上**完整的 `opencv-python`**，而它在 slim 镜像里装不起来、也跑不起来。

| 问题 | 现象 |
| --- | --- |
| **依赖装不上** | 走 apt 装图形库时，`deb.debian.org` 拉 8.6 MB 的 Packages 索引**超时**（实测 `Connection timed out`），构建直接失败 |
| **即使装上也 import 不了** | 完整版 OpenCV 会去链图形库，`import cv2` 报 **`ImportError: libxcb.so.1: cannot open shared object file`** —— 还需要 libxcb 等一堆图形库 |
| **包名还会变** | Debian 13（trixie）把 `libglib2.0-0` 改名成 `libglib2.0-0t64`，`apt-get install libglib2.0-0` 会报 `E: Unable to locate package libglib2.0-0` |

> **结论**：只要用完整版 `opencv-python`，就绕不开"apt 装图形库 → apt 源可能超时 → 包名可能改名 → 还得补 libxcb"这一整条链。

**采用的方案：换成 headless 版**。

| 步骤 | 命令 | 说明 |
| --- | --- | --- |
| ① 装依赖 | `pip install -r requirements.txt` | `rapidocr-onnxruntime` 会连带装上完整版 `opencv-python` |
| ② 卸掉完整版 | `pip uninstall -y opencv-python` | 两个包**模块名相同**（都提供 `cv2`），必须卸掉一个 |
| ③ 装 headless 版 | `pip install opencv-python-headless` | **不依赖任何图形库** |
| ④ 构建期自检 | `python3 -c "import cv2; from rapidocr_onnxruntime import RapidOCR; …"` | 依赖坏了**当场构建失败**，而不是运行时才炸 |

| 顺带解决的三件事 | 说明 |
| --- | --- |
| **不再需要 apt** | headless 版没有 `libGL` / `libxcb` 依赖 → 镜像里**零 apt 步骤** |
| **顺带躲开 `t64` 改名** | 既然不装 `libglib2.0-0`，Debian 13 把它改名成 `libglib2.0-0t64` 就**与我们无关** |
| **不再有 apt 源超时** | 构建期唯一的外部依赖是 pip，而 pip 源**可配置且有回退** |

### 7.3 pip 镜像源回退

直连 `pypi.org` 在国内**基本必超时**，因此 pip 安装按**清华 → 阿里 → 官方**的顺序逐个尝试：

```dockerfile
ARG PIP_MIRRORS="https://pypi.tuna.tsinghua.edu.cn/simple https://mirrors.aliyun.com/pypi/simple https://pypi.org/simple"

RUN set -eu; \
    ok=0; \
    for m in $PIP_MIRRORS; do \
      echo "[ocr] 试 pip 源：$m"; \
      if pip install --no-cache-dir --index-url "$m" --timeout 30 --retries 2 \
           -r requirements.txt >/dev/null 2>&1; then ok=1; break; fi; \
    done; \
    [ "$ok" = "1" ] || { echo "[ocr] 所有 pip 源都不可达"; exit 1; }; \
    ...
```

| 项 | 说明 |
| --- | --- |
| 参数 | `--timeout 30 --retries 2` —— 单个源最多重试 2 次、每次 30 秒超时 |
| 失败兜底 | 三个源都不可达 → **构建直接失败**并打印「所有 pip 源都不可达」，不会产出半成品镜像 |
| 自定义 | `docker build --build-arg PIP_MIRRORS="https://your-mirror/simple https://pypi.org/simple" -f deploy/docker/ocr.Dockerfile -t cuoti-analytics-ocr:1.0.0 .` |
| 安装内容 | `requirements.txt` 里的 `rapidocr-onnxruntime>=1.3.0` 与 `pillow` |

### 7.3.1 模型不需要缓存卷

| 项 | 说明 |
| --- | --- |
| 模型位置 | RapidOCR 的 3 个 `.onnx`（约 15 MB）**随 pip 包一起装进 site-packages** |
| 不是运行时下载 | 因此**不需要**模型缓存卷，`compose` 里也没有 `ocr-models` 这个卷 |
| 影响 | 重建镜像不会重新下载模型；镜像体积 615 MB 里已包含模型 |

### 7.4 与主应用的通信

| 项 | 说明 |
| --- | --- |
| 网络地址 | 同一 compose 网络内用服务名：`http://ocr:8868` |
| 写入方式 | `entrypoint.sh` 用**应用自己的 `server/settings.js`**（`readStoredAiConfig` / `writeStoredAiConfig`）读写 `ai.config`（`ocrBaseUrl` / `ocrEnabled`） |
| 为什么由脚本代填 | 容器里进不去 UI 手填「系统设置 → AI 模型 → 本地 OCR 地址」 |
| 为什么用应用模块 | import `server/settings.js` 会**顺带建好表结构**，**全新卷上（数据库不存在）也能写进去**；且写出的 JSON 结构与 UI 保存的一致 |
| 不覆盖已有配置 | 已有 `ocrBaseUrl` 时**不写**，避免脚本覆盖管理员的设置 |
| 收益 | 拍照识别置信度从 **0.32** 提升到 **0.95 以上**，且**图片不出容器** |

**实测结果**：

| 项 | 实测值 |
| --- | --- |
| 侧车健康检查 | `{"ok":true,"engine":"rapidocr","error":null,"maxBytes":12582912}` |
| **真实识别** | 上传一张 `3/4 + 1/4 = 1` 的图片 → `rec_texts: ["3/4 + 1/4 = 1"]`，`rec_scores: [0.9488]` → **置信度 94.9%** |
| 引擎加载 | **惰性加载**：启动日志「引擎：none（首次调用时惰性加载）」，首次调用后变「引擎已就绪：rapidocr」 |
| 容器间连通 | app 容器内探测侧车 → `{"reachable":true,"detail":"{\"ok\": true, \"engine\": \"rapidocr\"...}"}` |

---

## 8. 识别率实测与流水线优化（零 AI）

用户抱怨「识别率太低」「连基本的学科都识别不对」。本节记录**可量化**的定位与优化过程。

### 8.1 根因：学科判定被写死

`server/vision.js` 的 `draftFromOcrLines()` 之前把学科**直接写死成「数学」** —— 无论拍的是语文卷还是英语卷，学科都是数学。这不是「识别不准」，是「根本没判」。现在改为**启发式判定**（§8.5）。

### 8.2 基准测试工具（`scripts/ocr-bench/`）

**没有基准就没有「提升」**。`scripts/ocr-bench/` 是本项目的 OCR 基准测试套件：

| 文件 | 作用 |
| --- | --- |
| `make_samples.py` | 生成三档难度的题目照片（用真实小学/初中题目的写法） |
| `bench.py` | 测三件事：**字符错误率（CER）**、引擎平均识别分、**学科判定对不对** |

| 脚本 | 作用 |
| --- | --- |
| `make_samples.py` | 生成三档素材到 `/tmp/ocrtest`（可用 `OCR_DIR` 改） |
| `bench.py` | 跑基准，输出 CER / 关键词命中 / 学科判定准确率 |

**学科判定这一项走真实接口** `POST /api/analyze/photo`（拿真实 Cookie），所以后端改完**立刻能看出效果**，不用自己造一套评分逻辑。

```bash
# 只测 OCR 引擎
OCR_HOST=http://127.0.0.1:8869 python3 scripts/ocr-bench/bench.py

# 连后端一起测（学科判定）
OCR_HOST=http://127.0.0.1:8869 API_BASE=http://127.0.0.1:5188 \
  API_COOKIE=/tmp/ck.txt python3 scripts/ocr-bench/bench.py
```

> ⚠️ **不要改 `scripts/ocr-bench/` 里的 truth 内容** —— 改了就是自己给自己放水，基准立刻失去意义。

### 8.3 三档素材

| 档位 | 造法 | 用途 |
| --- | --- | --- |
| `clean` | 干净数字排版 | 引擎能力的**上限** |
| `phone` | 仿手机拍：**透视 + 光照不均 + 阴影 + 反光 + 噪点 + JPEG** | 真实场景的**典型值** |
| `hard` | 远距离拍摄：**小字 + 更强的畸变和模糊** | 真实场景的**下限** |

> **为什么要分档**：只用「干净图」测，OCR 引擎本来就能满分，看不出预处理有没有用；只用「hard」测，又容易把「本来就不可能」的 case 算成失败。三档一起看，才知道预处理把哪一段差距补上了。

### 8.4 实测结果

| 档位 | 改前 CER | 改后 CER | 关键词命中（改前 → 改后） |
| --- | --- | --- | --- |
| `clean` | 1.90% | 1.90% | 20/20 → 20/20 |
| `phone` | 0.31% | 0.31% | 20/20 → 20/20 |
| `hard` | 74.49% | **52.00%** | 4/20 → **8/20** |

**怎么读这张表**：`clean` 与 `phone` 档**本来就接近满分**，优化空间本来就小（改前改后一样，不是没优化，是**天花板到了**）；真正拉开差距的是 `hard` 档 —— **CER 从 74.49% 降到 52.00%**，关键词命中**从 4/20 翻到 8/20**。

### 8.5 OCR 流水线优化

`ocr-service/ocr_service.py` 的处理链：

| 阶段 | 做什么 | 为什么 |
| --- | --- | --- |
| ① EXIF 转正 | 按 EXIF 方向摆正 | 手机横拍的照片浏览器读出来可能是**躺着的**，字全歪了识别率直接崩 |
| ② 尺寸归一化 | **短边 LANCZOS 放大到 736** | 736 = 引擎检测模型的原生尺度（`limit_side_len`）；比引擎内部的双线性拉伸更清晰（**实测 hard 档 736 比 1000/1400 更好**） |
| ③ **快速路径** | 清晰图**只跑一遍** | 不被过度处理弄坏 —— 预处理过头会把本来清楚的图弄糊 |
| ④ **兜底多变体择优** | 4 变体 × 2 检测外扩比例，按「**平均分 × 行数覆盖 × 字数覆盖**」选最优 | 快速路径没过时才会走这里 |

> **行数太少要罚分**：有的变体会「**自信地**只认出 1 行但内容全丢」 —— 单看平均分会误判成最优，必须同时看行数与字数覆盖。

**变体清单**（`OCR_VARIANTS` 环境变量可配，默认 `original,clahe,clahe_soft,sharp`）：

| 变体 | 做什么 | 针对什么 |
| --- | --- | --- |
| `original` | 不处理 | 清晰图 |
| `clahe` | 灰度 + **CLAHE（clip 2.0）** | 阴影 / 光照不均 / 反光 —— **hard 档救命** |
| `clahe_soft` | CLAHE 弱一点（**clip 1.5**） | 避免过度增强吃掉细笔画 |
| `sharp` | **USM 锐化** | 放大后笔画发糊时用 |
| `binary` | 自适应二值化 | ⚠️ **已从默认变体摘掉**，见下 |

> ⚠️ **【坑】自适应二值化会把细笔画吃掉**：`binary` 变体在 `hard` 档 **CER 直接 100%**。代码**保留**（`OCR_VARIANTS=binary` 可开），但**默认关闭**。后人别再打开它 —— 需要对比时可以手动开，但要知道它会把小字吃掉。

### 8.6 学科 / 题型 / 知识点启发式判定（`server/vision.js`）

**零 AI、零外部 API**，纯本地规则。

| 信号 | 做法 | 效果 |
| --- | --- | --- |
| **数量单位表**（个/只/本/元/米/小时…）+ **数量关系词**（一共/平均/剩下/相距…）+ 中文数字 | 小学数学应用题常常是**纯文字**（没有算式、没有阿拉伯数字），所以这组信号**不依赖数字占比** | 纯文字的数学应用题不再被误判成语文：**语文 0.8 → 数学 0.89** |
| **「英文主导度」** = 拉丁字母 ÷ (拉丁 + 汉字) | 所有英语信号**按它打折** | 语文卷里夹几句英文不再被误判成英语：**英语 0.74 → 语文 0.82** |
| **语文阅读强特征** | 阅读下面 / 这篇短文 / 课外阅读 / 概括 / 用中文… | 语文题夹一两句英文时靠它翻盘 |
| **数量单位的「邻近判定」** | 单位离提问词 **≤ 10 字**才算数 | 否则「一辆小车…摩擦力是多少」会误触发数学 |

**置信度**：

| 规则 | 阈值 |
| --- | --- |
| 前两名差距 **< 20%** | 置信度**直接压到 0.44 以下** |
| 文本太短（< 8 字 / < 12 字） | 压低 / ×0.7 |
| 纯数字无运算符却判成数学 | 压到 0.35 以下（可能只是编号 / 名单） |

前端收到 **< 50%** 的学科置信度时**显示琥珀色警示**，让用户去确认（不直接当成定论）。

> **用户手动选过的年级 / 学科优先于启发式判定** —— 用户的判断永远比规则可信。

### 8.7 诚实说明边界

**`hard` 档到不了 20% 是素材信息量的问题，不是流水线的问题。**

逐级消融显示：**CLAHE + 放大**能把「光照 + 噪声 + 模糊」从 **78% 拉到 20.2%**，但 **JPEG(q48) + 0.85 缩放**这一段把收益**吃掉了**。

要再往下压，得**换引擎**（PaddleOCR 服务版 / 视觉语言模型），那属于**选型变更**，**本轮未做**。

**契约（只增不改）**：`draft.subjectConfidence` / `draft.subjectEvidence` / `draft.questionTypeConfidence` 三个字段新增，低置信度提示走**已有的** `pipeline.warnings` 通道 —— 不新造一套提示机制。

---

## 附：来源清单（全部为我实际访问过的页面）

**PaddleOCR 系**
- [PaddleOCR GitHub README（main）](https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/README.md) — Apache-2.0、版本时间线、PP-OCRv6 指标
- [PaddleOCR Releases](https://github.com/PaddlePaddle/PaddleOCR/releases) — v3.7.0 / 2026-06-11
- [PaddleOCR-VL 官方文档 · 使用教程](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html) — vLLM / Docker / genai_server
- [PaddleOCR-VL-1.6 介绍（官方文档）](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL-1.6.html) 与 [原始 md](https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/docs/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL-1.6.en.md) — 96.33% OmniDocBench v1.6
- [PaddleOCR Serving 文档](https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/serving/serving.html) 与 [原始 md](https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/docs/version3.x/inference_deployment/serving/serving.en.md) — `paddlex --serve --pipeline`
- [PaddleOCR 官方 API 概览](https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/serving/paddleocr_official_api/overview.html) — **确认官方 API 是云端（AI Studio token）**
- [PaddleX Serving 文档](https://paddlepaddle.github.io/PaddleX/latest/en/pipeline_deploy/serving.html) — Triton 路径返回体 `{"errorCode":0,"result":{"ocrResults":[...]}}`
- [PaddleOCR-VL 模型卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL)（经 [hf-mirror](https://hf-mirror.com/PaddlePaddle/PaddleOCR-VL/raw/main/README.md)） — `license: apache-2.0`、109 语种、手写宣称
- [PaddleOCR-VL-1.6 模型卡](https://hf-mirror.com/PaddlePaddle/PaddleOCR-VL-1.6/raw/main/README.md) — `license: apache-2.0`
- [PP-FormulaNet_plus-M 模型卡](https://hf-mirror.com/PaddlePaddle/PP-FormulaNet_plus-M/raw/main/README.md) — `license: apache-2.0`、En/Zh-BLEU 与推理耗时表
- [arXiv:2510.14528 PaddleOCR-VL](https://arxiv.org/abs/2510.14528) — 0.9B 架构
- [PaddleOCR MCP 客户端源码 `http_result_parsers.py` / `self_hosted.py`](https://github.com/PaddlePaddle/PaddleOCR/tree/main/mcp_server/paddleocr_mcp) — `/ocr`、`/layout-parsing` 端点与 `rec_scores` 解析

**RapidOCR / CnOCR / 传统 OCR**
- [RapidOCR GitHub](https://github.com/RapidAI/RapidOCR) — Apache-2.0、模型源自 PaddleOCR、`MODEL_LICENSES.md`
- [RapidOCRAPI](https://github.com/RapidAI/RapidOCRAPI) — FastAPI/uvicorn、`POST /ocr`
- [rapidocr-node (npm)](https://registry.npmjs.org/rapidocr-node) — v0.3.4、Apache-2.0、onnxruntime-node、Node≥24、返回 `confidence`
- [CnOCR 源码 `cnocr/cn_ocr.py`](https://github.com/breezedeus/CnOCR/blob/master/cnocr/cn_ocr.py) — `ocr()` 返回 `text`/`score`/`position`
- [chineseocr_lite](https://github.com/DayBreak-u/chineseocr_lite) — GPL-2.0、ONNX/NCNN/MNN
- [Tesseract 手册 `tessdata.asc`](https://github.com/tesseract-ocr/tesseract/blob/main/doc/tesseract.1.asc) — TSV 含 bbox+confidence+text；hOCR 含置信度
- [EasyOCR 源码 `easyocr/easyocr.py`](https://github.com/JaidedAI/EasyOCR/blob/master/easyocr/easyocr.py) — `readtext` 返回 `confident`

**VLM / 文档解析**
- [MinerU GitHub](https://github.com/opendatalab/MinerU) 与 [LICENSE.md](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md) — MinerU 开源许可（Apache-2.0 + 3 条款）
- [MinerU2.5-2509-1.2B 模型卡](https://hf-mirror.com/opendatalab/MinerU2.5-2509-1.2B/raw/main/README.md)（`agpl-3.0`）与 [MinerU2.5-Pro-2605-1.2B](https://hf-mirror.com/api/models/opendatalab/MinerU2.5-Pro-2605-1.2B)（`apache-2.0`）
- [Marker GitHub](https://github.com/datalab-to/marker) — 代码 Apache-2.0 / 权重 OpenRAIL-M、olmOCR-bench 76.0%、llama.cpp 后端
- [Surya GitHub](https://github.com/datalab-to/surya) — 650M、olmOCR-bench 83.3、中文 82.5%、**confidence 输出说明**
- [Docling GitHub](https://github.com/docling-project/docling) — MIT、OCR 引擎目录（`docling/models/stages/ocr/`）
- [olmOCR GitHub](https://github.com/allenai/olmocr) — Apache-2.0、≥12GB VRAM、vLLM、OpenAI 兼容 server
- [dots.ocr GitHub](https://github.com/studio-dots-ai/dots.ocr) 与 [权重许可原文](https://hf-mirror.com/rednote-hilab/dots.ocr/raw/main/dots.ocr%20LICENSE%20AGREEMENT) — §3.2 企业本地闭源部署、§7.3 署名要求
- [MonkeyOCR GitHub](https://github.com/Yuliang-Liu/MonkeyOCR) — Apache-2.0 源码 / v1 权重非商用、**不支持拍照与手写**、速度表
- [DeepSeek-OCR GitHub](https://github.com/deepseek-ai/DeepSeek-OCR) 与 [模型卡](https://hf-mirror.com/deepseek-ai/DeepSeek-OCR/raw/main/README.md)（`mit`）、[config.json](https://hf-mirror.com/deepseek-ai/DeepSeek-OCR/raw/main/config.json) — MoE 结构、A100 2500 tokens/s、DeepSeek-OCR-2 发布
- [Qwen3-VL GitHub](https://github.com/QwenLM/Qwen3-VL) 与 [Qwen3-VL-8B 模型卡](https://hf-mirror.com/Qwen/Qwen3-VL-8B-Instruct/raw/main/README.md) — Apache-2.0、32 语种 OCR、vLLM 命令
- [Qwen2.5-VL-7B / 72B 模型卡](https://hf-mirror.com/api/models/Qwen/Qwen2.5-VL-7B-Instruct) — Apache-2.0 vs other

**公式专用**
- [GOT-OCR2.0 GitHub](https://github.com/Ucas-HaoranWei/GOT-OCR2.0) 与 [权重卡](https://hf-mirror.com/api/models/ucaslcl/GOT-OCR2_0)（`apache-2.0`）
- [UniMERNet GitHub](https://github.com/opendatalab/UniMERNet) — Apache-2.0、UniMER-1M/UniMER-Test、HWE 6,332
- [Texify GitHub](https://github.com/VikParuchuri/texify) — **已废弃，迁移到 surya**
- [Nougat GitHub](https://github.com/facebookresearch/nougat) — MIT

**仓库元数据（GitHub REST API，2026-10-26 实测）**
`PaddlePaddle/PaddleOCR`(Apache-2.0, 91701★) · `RapidAI/RapidOCR`(Apache-2.0, 8327★, pushed 2026-10-26) · `opendatalab/MinerU`(NOASSERTION→自定义许可, 82516★, pushed 2026-10-26) · `datalab-to/marker`(Apache-2.0, 40647★) · `docling-project/docling`(MIT, 69610★, pushed 2026-10-26) · `allenai/olmocr`(Apache-2.0, 19801★, pushed 2026-03-25) · `studio-dots-ai/dots.ocr`(MIT, 9180★) · `Yuliang-Liu/MonkeyOCR`(Apache-2.0, 6650★, pushed 2026-07-20) · `datalab-to/surya`(Apache-2.0, 21535★) · `Ucas-HaoranWei/GOT-OCR2.0`(8225★, pushed 2025-02-10) · `opendatalab/UniMERNet`(Apache-2.0, 506★, pushed 2025-09-28) · `breezedeus/CnOCR`(Apache-2.0, 3773★, pushed 2026-07-05) · `JaidedAI/EasyOCR`(Apache-2.0, 30105★, pushed 2025-12-05) · `tesseract-ocr/tesseract`(Apache-2.0, 77170★, pushed 2026-10-24) · `QwenLM/Qwen3-VL`(Apache-2.0, 20128★) · `deepseek-ai/DeepSeek-OCR`(MIT, 24069★, pushed 2026-01-27) · `VikParuchuri/texify`(GPL-3.0, 1123★, pushed 2025-01-29) · `DayBreak-u/chineseocr_lite`(GPL-2.0, 12351★) · `facebookresearch/nougat`(MIT, 10089★, pushed 2025-02-21) · `OSpoon/RapidOCRNode`(Apache-2.0, **0★**)

---

## 未核实项清单（诚实标注）

- PaddleOCR 3.x **基础 Serving `/predict` 的确切请求/响应字段**未逐字核实（已核实：PaddleX Triton 路径返回 `{"errorCode":0,"result":{"ocrResults":[...]}}`；PaddleOCR 官方 MCP 客户端使用 `/ocr` 与 `/layout-parsing`；`server/ocr.js` 按 PaddleOCR Serving v2 契约编写）。
- **所有延迟/吞吐数字**中，除明确标注出处者（MonkeyOCR 官方速度表、PP-FormulaNet_plus 模型卡、Marker/Surya olmOCR-bench、DeepSeek-OCR A100 tokens/s）外，**均为量级估计，需在目标硬件实测**。
- PaddleOCR-VL 的**官方 tokens/s 与显存占用表**：我读到的是 1.6 文档指向"1.5 文档第 4 节"，但该节原文抓取失败 → **未核实**。
- **手写体准确率**除 PaddleOCR-VL（官方宣称）与 MonkeyOCR（官方否认）外，其余项目**无公开手写基准数字**，标注为"⚠️"表示未核实而非"不可用"。
- Pix2Tex (LaTeX-OCR) 的许可证**未核实**（社区普遍称 GPL-3.0）。
- `rapidocr-node` 的生产成熟度**未核实**（仓库 0 star，建议压测后再用）。
- `echo840/MonkeyOCR-pro-1.2B` 权重卡无 `license` 字段 → **未核实**。
- `opendatalab/MinerU-4_models_onnx` 模型卡无 `license` 字段 → **未核实**。
