#!/usr/bin/env python3
"""
错题本 · 本地 OCR 服务（零框架依赖）
=================================================
一个只用 Python 标准库实现的 HTTP 服务，把开源 OCR 引擎包装成
**PaddleOCR Serving v2 兼容**的接口，供后端 `server/` 的 OCR 适配器调用。

特点
----
* 不需要 Flask/FastAPI：`python3 ocr_service.py` 就能跑。
* 引擎按优先级自动探测：RapidOCR → PaddleOCR → CnOCR → 报错并给出安装指引。
* 返回格式与 PaddleOCR Serving v2 一致，因此后端无需任何改动即可对接。
* **图像预处理流水线**：EXIF 旋转矫正 + 尺寸归一化 + CLAHE 对比度增强 +
  自适应二值化，多个变体各跑一遍 OCR 取最优（治光照不均 / 阴影 / 反光 / 透视）。
* **保留文字框坐标**（rec_boxes），并把同一行的碎片按 y 坐标聚类合并。
* 图片不出本机，适合校园/家庭私有化部署。

启动
----
    pip install -r requirements.txt
    python3 ocr_service.py                 # 默认监听 0.0.0.0:8868

    # 或者用官方 PaddleOCR Serving（更重，但版面/公式更强）
    paddleocr --host 0.0.0.0 --port 8868 --use_angle_cls true --lang ch

接口
----
    GET  /health   → {"ok":true,"engine":"rapidocr","version":"..."}
    POST /predict  → {"images":["<base64>"]}
                  → {"result":{"ocrResults":[{"prunedResult":{
                        "rec_texts":["...","..."],
                        "rec_scores":[0.99,0.93],
                        "rec_boxes":[[[x,y],[x,y],[x,y],[x,y]], ...],  # 新增（可选）
                        "text_lines":[{"text":"...","score":0.99,
                                       "box":[x0,y0,x1,y1],"center":[cx,cy]}],  # 新增（可选）
                        "variant":"clahe"}}]}}
    POST /ocr      → {"image":"<base64>"} → {"text":"...","confidence":0.96}

向后兼容
--------
`rec_texts` / `rec_scores` 的语义不变；新增字段（rec_boxes / text_lines / variant）
放在**新字段**里，旧客户端直接忽略即可。
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("OCR_HOST", "0.0.0.0")
PORT = int(os.environ.get("OCR_PORT", "8868"))
MAX_IMAGE_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(12 * 1024 * 1024)))
# 预处理相关开关
PREPROCESS = os.environ.get("OCR_PREPROCESS", "1") not in ("0", "false", "False")
# 归一化尺寸：短边太小（远距离拍）-> 等比放大。
# 736 = 引擎检测模型自己的输入尺度（limit_side_len），先按这个尺度用 LANCZOS 放大，
# 比引擎内部的双线性拉伸更清晰（实测 hard 档 736 比 1000/1400 更好）。
TARGET_SHORT = int(os.environ.get("OCR_TARGET_SHORT", "736"))
# 预处理阶段的放大下限。**默认 0 = 不放大**：
#   实测（scripts/ocr-bench 四档）引擎自己把短边拉到 736（双线性）的效果
#   比我们先用 LANCZOS 放大到 2000px 再让引擎拉一次更好：
#     引擎自己拉   clean 1.90% phone 0.15% real 0.85% hard 50.69%
#     侧车先拉     clean 2.29% phone 0.31% real 0.85% hard 51.18%
#   需要自己放大时把它设成 300~700。
MIN_SHORT = int(os.environ.get("OCR_MIN_SHORT", "0"))
MAX_LONG = int(os.environ.get("OCR_MAX_LONG", "2000"))
# 参与对比的变体（逗号分隔）
VARIANTS = [
    v.strip()
    for v in os.environ.get("OCR_VARIANTS", "original,clahe,clahe_soft,sharp").split(",")
    if v.strip()
]
# CLAHE 参数
CLAHE_CLIP = float(os.environ.get("OCR_CLAHE_CLIP", "2.0"))
CLAHE_CLIP_SOFT = float(os.environ.get("OCR_CLAHE_CLIP_SOFT", "1.5"))
CLAHE_GRID = int(os.environ.get("OCR_CLAHE_GRID", "8"))
# 检测框外扩比例（默认 1.6 会把被压扁的文字切掉，2.5 对小字更友好）
DET_UNCLIP = float(os.environ.get("OCR_DET_UNCLIP", "2.5"))
# ONNX Runtime 线程数：默认 -1 = 用满所有核。
# 实测（Mac, 10 核）：-1 时单张识别峰值内存 1.7GB，限到 2 线程后降到几百 MB，
# 速度基本不变 —— 检测是访存瓶颈，多开线程收益很小、内存却是线性涨。
# NAS 部署建议保持 2（内存吃紧可以设 1）。
ORT_THREADS = int(os.environ.get("OCR_ORT_THREADS", "2"))
# 检测模型输入的短边下限（RapidOCR 的 limit_side_len）
# 736 = RapidOCR 默认。调小能显著降低峰值内存（NAS 友好），调大对大图更准。
DET_LIMIT_SIDE_LEN = int(os.environ.get("OCR_DET_LIMIT", "736"))
# 兜底阶段尝试的外扩比例
UNCLIP_VALUES = [
    float(v.strip())
    for v in os.environ.get("OCR_UNCLIP_VALUES", "2.0,2.5,3.0").split(",")
    if v.strip()
]
# 快速路径默认外扩
UNCLIP_DEFAULT = float(os.environ.get("OCR_UNCLIP_DEFAULT", "1.6"))
# 快速路径里的「增强候选」：哪个变体 + 外扩比例
# 实测（scripts/ocr-bench，real 档 = 真实手机分辨率）：
#   保守(original@1.6) 4.50%  ->  增强(clahe@2.5 + 放宽阈值) 0.70%
# 所以快速路径跑两次，谁好谁上，约 0.8s/张。
FAST_STRONG_VARIANT = os.environ.get("OCR_FAST_STRONG_VARIANT", "clahe")
UNCLIP_STRONG = float(os.environ.get("OCR_UNCLIP_STRONG", "2.5"))
# 兜底阶段的检测阈值（比引擎默认更宽松，保住被截断的半行）
# 引擎默认：thresh=0.3 / box_thresh=0.5
DET_THRESH = float(os.environ.get("OCR_DET_THRESH", "0.15"))
DET_BOX_THRESH = float(os.environ.get("OCR_DET_BOX_THRESH", "0.2"))
# 快速路径的「够好」门槛：平均分达到这个值就不用再跑其它变体
FAST_MIN_SCORE = float(os.environ.get("OCR_FAST_MIN_SCORE", "0.90"))
FAST_MIN_CHARS = int(os.environ.get("OCR_FAST_MIN_CHARS", "10"))
# --------------------------------------------------------------------------
# 可选：server 级大模型（体积/速度/准确率见 README 的对照表）
#   移动版模型 15MB / 0.3s 一张 / hard 档 CER 54%
#   server 版模型 ~190MB / 5s 一张 / hard 档 CER 43%
# 配了文件路径才启用；没配就完全不影响现有行为（clear/phone 档根本走不到这里）。
# 用 ocr-service/fetch_models.py 下载模型。
# --------------------------------------------------------------------------
SERVER_DET = os.environ.get("OCR_SERVER_DET", "").strip()
SERVER_REC = os.environ.get("OCR_SERVER_REC", "").strip()
SERVER_KEYS = os.environ.get("OCR_SERVER_KEYS", "").strip()
# server 模型的外扩比例（实测 2.5 最稳）
SERVER_UNCLIP = float(os.environ.get("OCR_SERVER_UNCLIP", "2.5"))
# 移动版结果「太差」时才启用 server 模型（平均分低于这个值 / 行数不足）
SERVER_TRIGGER_SCORE = float(os.environ.get("OCR_SERVER_TRIGGER_SCORE", "0.95"))
SERVER_TRIGGER_ROWS = int(os.environ.get("OCR_SERVER_TRIGGER_ROWS", "3"))
# server 模型最多试几个预处理变体（每个 5 秒，不能多跑）
SERVER_MAX_VARIANTS = int(os.environ.get("OCR_SERVER_MAX_VARIANTS", "2"))
# 大模型候选要比移动版好这么多才换（1.08 = 至少好 8%）
SERVER_SWITCH_RATIO = float(os.environ.get("OCR_SERVER_SWITCH_RATIO", "0.88"))
# 「不处理」变体的排序加成（只有别的变体明显更好才换）
ORIG_BONUS = float(os.environ.get("OCR_ORIG_BONUS", "1.03"))
# 调试：打印每个变体的打分
DEBUG = os.environ.get("OCR_DEBUG", "") not in ("", "0", "false", "False")
# 同一行碎片的 y 聚类容差（相对行高）
ROW_TOLERANCE = float(os.environ.get("OCR_ROW_TOLERANCE", "0.6"))

_engine_name = "none"
_engine = None
_engine_lock = threading.Lock()
_engine_error: str | None = None
# 正在处理的 OCR 请求数（只给 /health 看，不参与任何判定，避免和长请求互相等待）
_busy_count = 0
_busy_lock = threading.Lock()


# --------------------------------------------------------------------------
# 引擎探测
# --------------------------------------------------------------------------
def _try_rapidocr():
    """RapidOCR（onnxruntime 版）：PaddleOCR 模型转 ONNX，CPU 可跑，体积小。"""
    global _engine_name
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        _engine_name = "rapidocr"
        # 走自定义配置：限制 ONNX 线程数（默认用满所有核，常驻内存能到 1.7GB）
        try:
            eng = _build_engine()
            eng.text_det.postprocess_op.unclip_ratio = DET_UNCLIP
            return eng
        except Exception:
            # det_unclip_ratio=2.0：默认 1.6 会把被压扁/糊掉的文字切掉一截
            try:
                return RapidOCR(det_unclip_ratio=DET_UNCLIP)
            except Exception:
                return RapidOCR()
    except ImportError:
        pass
    try:
        from rapidocr import RapidOCR  # type: ignore

        _engine_name = "rapidocr"
        try:
            return RapidOCR(det_unclip_ratio=DET_UNCLIP)
        except Exception:
            return RapidOCR()
    except ImportError:
        return None


def _try_paddleocr():
    """官方 PaddleOCR：版面/公式/表格能力最全，但依赖较重。"""
    global _engine_name
    try:
        from paddleocr import PaddleOCR  # type: ignore

        _engine_name = "paddleocr"
        return PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    except Exception:
        return None


def _try_cnocr():
    """CnOCR：轻量备选。"""
    global _engine_name
    try:
        from cnocr import CnOcr  # type: ignore

        _engine_name = "cnocr"
        return CnOcr()
    except Exception:
        return None


def get_engine():
    """惰性加载 OCR 引擎；加载失败时缓存错误信息，避免每次请求都重试。"""
    global _engine, _engine_error
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        if _engine_error is not None:
            return None
        for loader in (_try_rapidocr, _try_paddleocr, _try_cnocr):
            eng = loader()
            if eng is not None:
                _engine = eng
                print(f"[ocr] 引擎已就绪：{_engine_name}", flush=True)
                return _engine
        _engine_error = (
            "未找到可用的 OCR 引擎。请执行：pip install -r requirements.txt "
            "（推荐 rapidocr-onnxruntime，纯 CPU 即可运行）"
        )
        print(f"[ocr] {_engine_error}", file=sys.stderr, flush=True)
        return None


# --------------------------------------------------------------------------
# 可选的 server 级引擎（大模型，体积大、慢，但拍糊的图识别率高很多）
# --------------------------------------------------------------------------
_server_engine = None
_server_engine_failed = False


def _build_engine(det_path: str | None = None, rec_path: str | None = None,
                  keys_path: str | None = None, threads: int | None = None):
    """按 RapidOCR 的安装配置生成一个指定模型的引擎实例。

    threads：ONNX Runtime 的 intra_op 线程数。
      onnxruntime 每个线程都会给卷积层留一份大的临时缓冲，默认「-1」= 用满所有核，
      一张 2000px 的图就能把常驻内存顶到 1.7GB（NAS 上很容易 OOM）。
      限制成 2 线程后内存大幅下降，速度基本不变（检测是访存瓶颈，不是算力瓶颈）。
    """
    from rapidocr_onnxruntime import RapidOCR  # type: ignore
    import rapidocr_onnxruntime as _pkg
    import re as _re
    import tempfile as _tf

    if threads is None:
        threads = ORT_THREADS

    base = os.path.join(os.path.dirname(_pkg.__file__), "config.yaml")
    with open(base, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    pkg_dir = os.path.dirname(_pkg.__file__)

    def _abs(p: str) -> str:
        return p if os.path.isabs(p) else os.path.join(pkg_dir, p)

    section = None
    for i, ln in enumerate(lines):
        m = _re.match(r"^([A-Za-z_]+):", ln)
        if m:
            section = m.group(1)
        if "model_path:" in ln:
            if section == "Det":
                lines[i] = f"    model_path: {_abs(det_path) if det_path else _abs(ln.split(':', 1)[1].strip())}"
            elif section == "Rec":
                lines[i] = f"    model_path: {_abs(rec_path) if rec_path else _abs(ln.split(':', 1)[1].strip())}"
        if "intra_op_num_threads:" in ln and "&intra_nums" in ln:
            lines[i] = _re.sub(r"(-?\d+)\s*$", str(threads), ln)
        if section == "Det" and "limit_side_len:" in ln:
            # 检测模型的输入尺寸：RapidOCR 的「短边至少 limit_side_len」= 把短边
            # 拉到 limit_side_len（长边等比变长）。短边越大，检测越准、内存越高：
            #   736 -> 输入约 2400x736，峰值内存 ~700MB
            #   576 -> 输入约 1900x576，峰值内存 ~350MB（实测 hard 档准确率反而更高）
            lines[i] = f"    limit_side_len: {DET_LIMIT_SIDE_LEN}"
    text = "\n".join(lines) + "\n"
    if keys_path:
        text = text.replace(
            "    rec_img_shape: [3, 48, 320]",
            f"    rec_img_shape: [3, 48, 320]\n    rec_keys_path: {keys_path}",
        )
    tag = "server" if det_path else "mobile"
    cfg_path = os.path.join(_tf.gettempdir(), f"ocr_{tag}_engine.yaml")
    with open(cfg_path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return RapidOCR(config_path=cfg_path)


def get_server_engine():
    """惰性加载 server 级引擎（只有配了模型文件才会用）。"""
    global _server_engine, _server_engine_failed
    if _server_engine is not None:
        return _server_engine
    if _server_engine_failed:
        return None
    if not (SERVER_DET and SERVER_REC):
        _server_engine_failed = True
        return None
    if not (os.path.exists(SERVER_DET) and os.path.exists(SERVER_REC)):
        print(f"[ocr] 找不到 server 模型（{SERVER_DET} / {SERVER_REC}），跳过", file=sys.stderr, flush=True)
        _server_engine_failed = True
        return None
    if SERVER_KEYS and not os.path.exists(SERVER_KEYS):
        print(f"[ocr] 找不到字符表 {SERVER_KEYS}，跳过 server 模型", file=sys.stderr, flush=True)
        _server_engine_failed = True
        return None
    try:
        _server_engine = _build_engine(SERVER_DET, SERVER_REC, SERVER_KEYS or None)
        print("[ocr] server 级模型已就绪（拍糊的图会用它兜底）", flush=True)
        return _server_engine
    except Exception as exc:  # pragma: no cover - 环境相关
        print(f"[ocr] server 模型加载失败：{exc}", file=sys.stderr, flush=True)
        _server_engine_failed = True
        return None


# --------------------------------------------------------------------------
# 引擎调用适配：不同引擎返回结构不同，统一成 (texts, scores, boxes)
# --------------------------------------------------------------------------
def _normalize(raw: Any) -> tuple[list[str], list[float], list[Any]]:
    """把各种引擎的返回统一成 (texts, scores, boxes)。

    boxes 元素为 4 点多边形 [[x,y],[x,y],[x,y],[x,y]]（没有坐标时为 None）。
    """
    texts: list[str] = []
    scores: list[float] = []
    boxes: list[Any] = []

    def push(t: Any, s: Any, box: Any = None) -> None:
        if t is None:
            return
        text = str(t).strip()
        if not text:
            return
        texts.append(text)
        try:
            scores.append(float(s))
        except (TypeError, ValueError):
            scores.append(0.9)
        boxes.append(box)

    # PaddleOCR 3.x / 2.x: result = [[ [box, (text, score)], ... ]]
    if isinstance(raw, list) and raw and isinstance(raw[0], list):
        for line in raw:
            if not line:
                continue
            last = line[-1]
            box = line[0] if isinstance(line[0], (list, tuple)) else None
            if isinstance(last, (list, tuple)) and len(last) >= 2:
                push(last[0], last[1], box)
            elif isinstance(last, str):
                push(last, 0.9, box)
        return texts, scores, boxes

    # RapidOCR: (result_list, elapse) 且 result_list 元素为 (box, text, score)
    if isinstance(raw, tuple) and len(raw) == 2 and isinstance(raw[0], list):
        raw = raw[0]
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, (list, tuple)) and len(item) >= 3:
                push(item[1], item[2], item[0])
            elif isinstance(item, dict):
                push(item.get("text"), item.get("score", item.get("confidence")), item.get("box"))
        return texts, scores, boxes

    # 已经是 dict 的情况
    if isinstance(raw, dict):
        if "rec_texts" in raw:
            ss = raw.get("rec_scores") or []
            bb = raw.get("rec_boxes") or []
            for i, t in enumerate(raw["rec_texts"]):
                push(t, ss[i] if i < len(ss) else 0.9, bb[i] if i < len(bb) else None)
        elif "text" in raw:
            push(raw.get("text"), raw.get("confidence", raw.get("score", 0.9)))
        return texts, scores, boxes

    return texts, scores, boxes


# --------------------------------------------------------------------------
# 图像预处理：EXIF 矫正 + 尺寸归一化 + 多个变体
# --------------------------------------------------------------------------
def _encode_png(img: Any) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _decode(image_bytes: bytes) -> Any:
    """解码 + EXIF 方向矫正（手机竖拍常见问题）。"""
    from PIL import Image, ImageOps  # type: ignore

    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def _normalize_size(img: Any) -> Any:
    """尺寸归一化。

    * 短边太小（远距离拍、字小）-> **等比放大**到 TARGET_SHORT（引擎内部只会用
      双线性拉伸，放大质量差；我们先用 LANCZOS 放大 + 锐化，识别率提升最明显）。
    * 长边太大（手机原图）-> 等比缩小到 MAX_LONG。

    ⚠️ 这里的 PIL 必须在函数内 import：模块顶层没有 `from PIL import Image`，
    之前写成 `Image.LANCZOS` 会抛 NameError，被 except 吞掉后**悄悄返回原图**，
    整个「把小字放大」的处理其实一次都没生效过。
    """
    try:
        from PIL import Image  # type: ignore
    except Exception:
        return img

    w, h = img.size
    long_side, short_side = max(w, h), min(w, h)
    if not long_side or not short_side:
        return img

    scale = 1.0
    if short_side < MIN_SHORT:
        scale = TARGET_SHORT / short_side
    if long_side * scale > MAX_LONG:
        scale = MAX_LONG / long_side
    if abs(scale - 1.0) < 0.02:
        return img

    new_size = (max(32, int(w * scale)), max(32, int(h * scale)))
    try:
        resample = getattr(Image, "Resampling", Image).LANCZOS
        return img.resize(new_size, resample)
    except Exception:
        return img


def _build_variants(image_bytes: bytes) -> list[tuple[str, bytes]]:
    """返回 [(变体名, PNG 字节), ...]；预处理不可用时返回原图。

    变体说明（实测数据见 scripts/ocr-bench/ 的基准测试）：
      original   —— 归一化后的彩色图，清晰图/手机拍用它最稳
      clahe      —— 灰度 + CLAHE（clip 2.0），治阴影/光照不均/反光，hard 档救命
      clahe_soft —— CLAHE 弱一点（clip 1.5），避免过度增强吃掉细笔画
      sharp      —— USM 锐化，放大后笔画发糊时用
      binary     —— 自适应二值化：**实测会把细笔画吃掉**（hard 档 CER 直接 100%），
                    默认关闭，需要对比时可 OCR_VARIANTS=binary 打开
    """
    try:
        from PIL import Image, ImageFilter, ImageOps  # type: ignore
    except Exception:
        return [("original", image_bytes)]

    try:
        base = _normalize_size(_decode(image_bytes))
    except Exception:
        return [("original", image_bytes)]

    variants: list[tuple[str, bytes]] = []

    def add(name: str, img: Any) -> None:
        if name in VARIANTS:
            variants.append((name, _encode_png(img)))

    add("original", base)

    try:
        from PIL import ImageFilter as _IF  # type: ignore

        add("sharp", base.filter(_IF.UnsharpMask(radius=2, percent=150, threshold=3)))
    except Exception:
        pass

    try:
        import numpy as np  # type: ignore
        import cv2  # type: ignore

        gray = cv2.cvtColor(np.array(base), cv2.COLOR_RGB2GRAY)
        add("clahe", Image.fromarray(
            cv2.createCLAHE(clipLimit=CLAHE_CLIP, tileGridSize=(CLAHE_GRID, CLAHE_GRID)).apply(gray)))
        add("clahe_soft", Image.fromarray(
            cv2.createCLAHE(clipLimit=CLAHE_CLIP_SOFT, tileGridSize=(CLAHE_GRID, CLAHE_GRID)).apply(gray)))
        add("binary", Image.fromarray(
            cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                  cv2.THRESH_BINARY, 31, 10)))
    except Exception:
        try:
            add("clahe", ImageOps.autocontrast(base.convert("L")))
        except Exception:
            pass

    if not variants:
        variants = [("original", _encode_png(base))]
    return variants


# --------------------------------------------------------------------------
# 行合并：把同一 y 的碎片合并成一行
# --------------------------------------------------------------------------
def _box_rect(box: Any) -> tuple[float, float, float, float] | None:
    """把 4 点多边形 / 矩形转成 (x0, y0, x1, y1)。"""
    if not box:
        return None
    pts: list[tuple[float, float]] = []
    try:
        if isinstance(box, (list, tuple)):
            if len(box) == 4 and all(
                isinstance(p, (list, tuple)) and len(p) >= 2 for p in box
            ):
                pts = [(float(p[0]), float(p[1])) for p in box]
            elif len(box) == 4 and all(isinstance(v, (int, float)) for v in box):
                x0, y0, x1, y1 = (float(v) for v in box)
                return (x0, y0, x1, y1)
    except Exception:
        return None
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _merge_rows(
    texts: list[str], scores: list[float], boxes: list[Any]
) -> tuple[list[str], list[float], list[dict]]:
    """按 y 中心把同一行的碎片合并；合并后该行分数取组内最低分。"""
    items: list[dict] = []
    for i, text in enumerate(texts):
        rect = _box_rect(boxes[i] if i < len(boxes) else None)
        if rect is None:
            continue
        x0, y0, x1, y1 = rect
        items.append(
            {
                "text": text,
                "score": float(scores[i]) if i < len(scores) else 0.9,
                "box": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                "cx": (x0 + x1) / 2,
                "cy": (y0 + y1) / 2,
                "h": max(1.0, y1 - y0),
            }
        )
    if not items:
        return texts, scores, []

    items.sort(key=lambda it: (it["cy"], it["cx"]))

    rows: list[list[dict]] = []
    for it in items:
        placed = False
        for row in rows:
            ref = row[-1]
            tol = max(ref["h"], it["h"]) * ROW_TOLERANCE
            if abs(ref["cy"] - it["cy"]) <= tol:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])

    merged_texts: list[str] = []
    merged_scores: list[float] = []
    merged_lines: list[dict] = []
    for row in rows:
        row.sort(key=lambda it: it["cx"])
        merged_texts.append("".join(it["text"] for it in row))
        merged_scores.append(round(min(it["score"] for it in row), 6))
        x0 = min(it["box"][0] for it in row)
        y0 = min(it["box"][1] for it in row)
        x1 = max(it["box"][2] for it in row)
        y1 = max(it["box"][3] for it in row)
        merged_lines.append(
            {
                "text": merged_texts[-1],
                "score": merged_scores[-1],
                "box": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                "center": [round((x0 + x1) / 2, 2), round((y0 + y1) / 2, 2)],
            }
        )
    return merged_texts, merged_scores, merged_lines


def _set_det_params(engine: Any, unclip: float, thresh: float | None = None,
                     box_thresh: float | None = None) -> None:
    """运行时切换检测参数（不必为不同参数各加载一个引擎）。

    实测（scripts/ocr-bench，hard 档）：
      * box_thresh 0.5 -> 0.2：DB 会把「整行中间偏淡的一段」直接丢掉，
        结果是句子被从中间截断（"Read and choose tre best" 少了 answer）；
        放宽阈值后这类碎片能被检出、再由同行合并拼回去。
      * thresh 0.3 -> 0.15：同上，让概率图保留更多弱笔画。
      * unclip_ratio 1.6 -> 2.5/3.0：被压扁/糊掉的行往外扩一点，框才盖得住。
    """
    try:
        op = engine.text_det.postprocess_op
        if hasattr(op, "unclip_ratio"):
            op.unclip_ratio = unclip
        if thresh is not None and hasattr(op, "thresh"):
            op.thresh = thresh
        if box_thresh is not None and hasattr(op, "box_thresh"):
            op.box_thresh = box_thresh
    except Exception:
        pass


def _rank(r: dict, mx: dict) -> float:
    """候选打分：置信度 × 行覆盖 × 字覆盖。

    * 行数/字数太少 -> 罚分（0.25 保底）：有的变体会「自信地」只认出 1 行、
      平均分还不低，但内容全丢了，所以覆盖率必须参与打分。
    * 「不处理」变体有加成：只有别的变体明显更好才换（否则清晰图会被过度处理弄坏）。
    * 大模型候选要**明显更好**才换：它更自信，但偶尔会在本来清楚的图上读错
      （实测 real 档：直接换成大模型 4.50%，移动版 0.85%）。
    """
    row_factor = r["rows"] / (mx.get("rows") or 1)
    char_factor = r["chars"] / (mx.get("chars") or 1)
    rank = r["mean"] * (0.5 + 0.5 * row_factor) * (0.25 + 0.75 * char_factor)
    if r["name"].startswith("original"):
        rank *= ORIG_BONUS
    if r["name"].startswith("server_"):
        rank /= SERVER_SWITCH_RATIO
    return rank


def _ocr_variant(engine: Any, name: str, data: bytes, unclip: float,
                 thresh: float | None = None, box_thresh: float | None = None) -> dict | None:
    """跑一个「预处理变体 + 检测参数」的组合，返回结果字典。"""
    _set_det_params(engine, unclip, thresh, box_thresh)
    try:
        raw = engine(data)
    except TypeError:
        # 某些版本签名是 engine(img, use_det=True, use_cls=True, use_rec=True)
        raw = engine(data, True, True, True)
    except Exception:
        return None

    texts, scores, boxes = _normalize(raw)
    if not texts:
        return None

    merged_texts, merged_scores, merged_lines = _merge_rows(texts, scores, boxes)
    if not merged_texts:
        merged_texts, merged_scores, merged_lines = texts, scores, []

    chars = sum(len(t) for t in merged_texts)
    mean = sum(merged_scores) / len(merged_scores) if merged_scores else 0.0
    return {
        "name": f"{name}@{unclip}",
        "texts": merged_texts,
        "scores": merged_scores,
        "lines": merged_lines,
        "mean": mean,
        "rows": len(merged_texts),
        "chars": chars,
    }


def run_ocr(image_bytes: bytes) -> tuple[list[str], list[float], list[dict], str]:
    """跑一次 OCR（含预处理），返回 (texts, scores, lines, variant)。

    策略（实测数据见 scripts/ocr-bench/ 的基准测试）：
      1. **快速路径**：先用「不处理 + 默认外扩」跑一遍。清晰图/普通手机拍一次就够，
         又快又不会被过度处理弄坏（clean/phone 档就是靠它保住分数）。
      2. **兜底**：快速路径的分数不够高（说明图糊/光线差）时，才把
         「多个预处理变体 × 多个检测外扩比例」全跑一遍，按
         「平均分 × 行数/字数覆盖率」选最好的那个。
         注意**不能只看平均分** —— 有的变体会「自信地」只认出 1 行、
         平均分还不低，但内容全丢了，所以覆盖率必须参与打分。
    """
    engine = get_engine()
    if engine is None:
        raise RuntimeError(_engine_error or "OCR 引擎不可用")

    variants = _build_variants(image_bytes) if PREPROCESS else [("original", image_bytes)]
    if not variants:
        variants = [("original", image_bytes)]

    # ---- 1. 快速路径 ----
    # 两个候选，谁好谁上：
    #   a) 保守（original + 引擎默认阈值）：清晰图最稳（clean 档 1.90%）
    #   b) 增强（clahe + 放宽阈值）：手机拍的题差别很大（real 档 4.50% -> 0.70%）
    # 只跑这两次就够绝大多数图片定稿，约 0.8s/张。
    results: list[dict] = []
    fast = _ocr_variant(engine, variants[0][0], variants[0][1], UNCLIP_DEFAULT)
    if fast:
        results.append(fast)
    for name, data in variants:
        if name == FAST_STRONG_VARIANT:
            r = _ocr_variant(engine, name, data, UNCLIP_STRONG, DET_THRESH, DET_BOX_THRESH)
            if r:
                results.append(r)
            break

    if results:
        mx_fast = {
            "rows": max(r["rows"] for r in results) or 1,
            "chars": max(r["chars"] for r in results) or 1,
        }
        best_fast = max(results, key=lambda r: _rank(r, mx_fast))
        if (
            best_fast["mean"] >= FAST_MIN_SCORE
            and best_fast["rows"] >= 2
            and best_fast["chars"] >= FAST_MIN_CHARS
        ):
            return best_fast["texts"], best_fast["scores"], best_fast["lines"], best_fast["name"]

    # ---- 2. 兜底：全量候选 ----
    # 图糊/光线差时放宽检测阈值（保住被截断的半行），再叠加多个预处理变体。
    for unclip in UNCLIP_VALUES:
        for name, data in variants:
            if unclip == UNCLIP_DEFAULT and name == variants[0][0]:
                continue  # 快速路径已经跑过
            if unclip == UNCLIP_STRONG and name == FAST_STRONG_VARIANT:
                continue  # 快速路径已经跑过
            r = _ocr_variant(engine, name, data, unclip, DET_THRESH, DET_BOX_THRESH)
            if r:
                results.append(r)

    if not results:
        return [], [], [], "none"

    # ---- 3. server 级大模型兜底 ----
    # 移动版模型实在认不动时（分数低 / 行数不够），才请大模型上。
    # 大模型 ~5s 一张、~190MB，所以只在「真的不行」时才用，清晰图永远走不到这里。
    server_used = False
    if SERVER_DET and SERVER_REC:
        best_mobile = max(results, key=lambda r: r["mean"] * (0.5 + 0.5 * r["rows"]) * r["chars"])
        if best_mobile["mean"] < SERVER_TRIGGER_SCORE or best_mobile["rows"] < SERVER_TRIGGER_ROWS:
            server = get_server_engine()
            if server is not None:
                # 挑移动版表现最好的几个预处理变体给大模型用
                ordered = sorted(results, key=lambda r: r["mean"] * r["chars"], reverse=True)
                picked: list[str] = []
                for r in ordered:
                    base_name = r["name"].split("@")[0]
                    if base_name not in picked:
                        picked.append(base_name)
                    if len(picked) >= SERVER_MAX_VARIANTS:
                        break
                for base_name in picked:
                    for name, data in variants:
                        if name != base_name:
                            continue
                        r = _ocr_variant(server, name, data, SERVER_UNCLIP, DET_THRESH, DET_BOX_THRESH)
                        if r:
                            r["name"] = f"server_{r['name']}"
                            results.append(r)
                            server_used = True

    # 期望行数 / 字数 = 各候选里的最大值（谁认得最全，谁当基准）
    max_rows = max(r["rows"] for r in results) or 1
    max_chars = max(r["chars"] for r in results) or 1
    mx = {"rows": max_rows, "chars": max_chars}

    best = None
    best_rank = -1.0
    ranks = []
    for r in results:
        rank = _rank(r, mx)
        ranks.append((r["name"], round(rank, 4), round(r["mean"], 3), r["rows"], r["chars"]))
        if rank > best_rank:
            best_rank = rank
            best = r

    if DEBUG:
        print(f"[ocr] 变体打分 {ranks} -> 选中 {best['name']}", flush=True)

    return best["texts"], best["scores"], best["lines"], best["name"]


def decode_image(b64: str) -> bytes:
    if not b64:
        raise ValueError("空的图片数据")
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[-1]
    b64 = b64.strip().replace("\n", "").replace("\r", "")
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"base64 解码失败：{exc}") from exc
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("图片过大")
    return data


# --------------------------------------------------------------------------
# HTTP 处理
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:  # 精简日志
        print(f"[ocr] {self.address_string()} {fmt % args}", flush=True)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            # 健康检查**绝不能被长请求阻塞**：
            #   - 不调用 get_engine()（那会把引擎加载锁一起等住，最坏等好几秒）
            #   - 只读已经缓存好的状态
            #   - 容器编排（docker compose / k8s）靠这个判断存活，
            #     一旦超时就会把容器标成 unhealthy，用户看到的是「服务不稳定」。
            loaded = _engine is not None
            failed = _engine_error is not None and not loaded
            self._send(
                503 if failed else 200,
                {
                    "ok": not failed,
                    "engine": _engine_name,
                    "status": "ready" if loaded else ("failed" if failed else "loading"),
                    "busy": _busy_count,
                    "error": _engine_error,
                    "maxBytes": MAX_IMAGE_BYTES,
                },
            )
            return
        self._send(404, {"error": "NotFound", "message": f"未知路径 {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, {"error": "BadRequest", "message": "请求体为空"})
            return
        if length > MAX_IMAGE_BYTES * 2:
            self._send(413, {"error": "PayloadTooLarge", "message": "请求体过大"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send(400, {"error": "BadRequest", "message": f"JSON 解析失败：{exc}"})
            return

        started = time.time()
        try:
            if self.path.rstrip("/") == "/predict":
                images = payload.get("images") or []
                if not isinstance(images, list) or not images:
                    raise ValueError("缺少 images 数组")
                results = []
                for item in images:
                    data = decode_image(item)
                    global _busy_count
                    with _busy_lock:
                        _busy_count += 1
                    try:
                        texts, scores, lines, variant = run_ocr(data)
                    finally:
                        with _busy_lock:
                            _busy_count -= 1
                    results.append(
                        {
                            "prunedResult": {
                                # ↓ 与 PaddleOCR Serving v2 完全一致的字段（旧客户端只看这两个）
                                "rec_texts": texts,
                                "rec_scores": scores,
                                # ↓ 新增字段：坐标与预处理变体（旧客户端可忽略）
                                "rec_boxes": [ln["box"] for ln in lines],
                                "text_lines": lines,
                                "variant": variant,
                            }
                        }
                    )
                self._send(
                    200,
                    {
                        "result": {
                            "ocrResults": results,
                            "elapse": round(time.time() - started, 3),
                        }
                    },
                )
                return

            if self.path.rstrip("/") == "/ocr":
                image = payload.get("image")
                if not image:
                    raise ValueError("缺少 image 字段")
                texts, scores, _lines, _variant = run_ocr(decode_image(image))
                mean = sum(scores) / len(scores) if scores else 0.0
                self._send(
                    200,
                    {"text": "\n".join(texts), "confidence": round(mean, 4)},
                )
                return

            self._send(404, {"error": "NotFound", "message": f"未知路径 {self.path}"})
        except ValueError as exc:
            self._send(400, {"error": "BadRequest", "message": str(exc)})
        except RuntimeError as exc:
            self._send(503, {"error": "EngineUnavailable", "message": str(exc)})
        except Exception as exc:  # pragma: no cover - 兜底
            self._send(500, {"error": "InternalError", "message": f"{type(exc).__name__}: {exc}"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[ocr] 本地 OCR 服务已启动：http://{HOST}:{PORT}", flush=True)
    print(f"[ocr] 引擎：{_engine_name}（启动后台预热中）", flush=True)

    # 后台预热：别让第一个真实请求替大家等模型加载（移动版约 1~3s，server 版更久）。
    # 预热线程是守护线程，失败也不影响服务可用性 —— /health 会如实报 loading/failed。
    def _warmup() -> None:
        try:
            eng = get_engine()
            if eng is not None:
                print(f"[ocr] 引擎已就绪：{_engine_name}", flush=True)
        except Exception as exc:  # pragma: no cover
            print(f"[ocr] 引擎预热失败：{exc}", file=sys.stderr, flush=True)

    threading.Thread(target=_warmup, name="ocr-warmup", daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[ocr] 已停止", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
