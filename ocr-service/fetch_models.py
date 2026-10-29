#!/usr/bin/env python3
"""下载 server 级 OCR 模型（可选，用于提升「拍糊的照片」识别率）。

用法：
    python3 ocr-service/fetch_models.py            # 下载到 ocr-service/models/
    python3 ocr-service/fetch_models.py --dir /opt/ocr-models

默认走 HF 镜像（国内可直连）：
    https://hf-mirror.com/<repo>/resolve/main/<file>?download=true

体积（务必确认 NAS 放得下）：
    ch_PP-OCRv4_det_server.onnx   108 MB   检测（server）
    PP-OCRv5_server_rec.onnx       81 MB   识别（server，字符表 1.8 万字，含生僻字）
    rec_keys_v5.txt               74 KB   识别用字符表
    合计约 190 MB（移动版模型只要 15 MB）
"""
import argparse
import os
import sys
import urllib.request

DEFAULT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MIRROR = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")

FILES = [
    # (仓库, 文件, 本地名, 说明)
    ("cycloneboy/ch_PP-OCRv4_det_server_infer", "model.onnx", "ch_PP-OCRv4_det_server.onnx",
     "检测 server 版（108MB）"),
    ("PaddlePaddle/PP-OCRv5_server_rec_onnx", "inference.onnx", "PP-OCRv5_server_rec.onnx",
     "识别 server 版（81MB）"),
    ("PaddlePaddle/PP-OCRv5_server_rec_onnx", "inference.yml", "PP-OCRv5_server_rec.yml",
     "识别模型配置（内含字符表）"),
]


def download(repo: str, filename: str, dest: str) -> None:
    url = f"{MIRROR}/{repo}/resolve/main/{filename}?download=true"
    print(f"  ↓ {filename} …", flush=True)
    with urllib.request.urlopen(url, timeout=600) as resp, open(dest, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            got += len(chunk)
            if total:
                pct = got * 100 // total
                print(f"    {pct}% ({got >> 20}MB/{total >> 20}MB)", end="\r", flush=True)
    print(f"    完成 {got >> 20}MB -> {os.path.basename(dest)}")


def extract_keys(yml_path: str, keys_path: str) -> int:
    """从 inference.yml 里抠出 character_dict（v5 的字符表有 1.8 万字）。"""
    import re
    with open(yml_path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    start = None
    for i, ln in enumerate(lines):
        if ln.strip().startswith("character_dict:"):
            start = i
            break
    if start is None:
        print("  ! inference.yml 里没有 character_dict", file=sys.stderr)
        return 0
    chars = []
    pat = re.compile(r"^\s*-\s(.*)$")
    for ln in lines[start + 1:]:
        m = pat.match(ln)
        if not m:
            break
        c = m.group(1).strip()
        if len(c) >= 2 and c[0] == c[-1] and c[0] in "'\"":
            c = c[1:-1]
        chars.append(c)
    with open(keys_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(chars))
    return len(chars)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR, help="模型存放目录")
    ap.add_argument("--force", action="store_true", help="已存在也重新下载")
    args = ap.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    print(f"模型目录：{args.dir}")
    for repo, filename, local, desc in FILES:
        dest = os.path.join(args.dir, local)
        if os.path.exists(dest) and not args.force:
            print(f"  ✓ {local} 已存在（{os.path.getsize(dest) >> 20}MB）")
            continue
        try:
            download(repo, filename, dest)
        except Exception as exc:
            print(f"  ! 下载 {local} 失败：{exc}", file=sys.stderr)
            return 1
        print(f"    {desc}")

    yml = os.path.join(args.dir, "PP-OCRv5_server_rec.yml")
    keys = os.path.join(args.dir, "rec_keys_v5.txt")
    if os.path.exists(yml):
        n = extract_keys(yml, keys)
        print(f"  ✓ 字符表 rec_keys_v5.txt（{n} 字）")

    print("\n启动时加上这些环境变量即可启用：")
    print(f'  OCR_SERVER_DET={os.path.join(args.dir, "ch_PP-OCRv4_det_server.onnx")}')
    print(f'  OCR_SERVER_REC={os.path.join(args.dir, "PP-OCRv5_server_rec.onnx")}')
    print(f'  OCR_SERVER_KEYS={keys}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
