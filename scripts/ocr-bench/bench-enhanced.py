#!/usr/bin/env python3
"""
scripts/ocr-bench/bench-enhanced.py —— 图像增强（/preprocess）收益基准
==============================================================================
**为什么要有这个脚本**

「增强图到底让识别准了多少」是个容易被测错的题：

  把增强图塞回**会自己做 CLAHE 的** OCR 管线 = 二次增强 → 反而更差
  （第一次测就踩了这个坑，结论完全反了）

所以必须**隔离**：
  1. 起一个 `OCR_VARIANTS=original` 的侧车 —— 它只做「解码 + EXIF + 尺寸归一化」，
     不做任何对比度增强；
  2. 再起一个完整侧车，只用它 `/preprocess` 拿增强图；
  3. 同一张图、同一台 OCR 引擎，**只换喂进去的图**。

这样测出来的差值，才是增强本身贡献。

**这个数字的意义**：它衡量的是「这张图给**任何**识别引擎看有多好」。
视觉模型现在吃的就是增强图（server/ai.js 的 enhancedImage），
所以这个数字直接对应用户看到的识别准确率。

用法：
  # 起两个侧车
  docker run -d --name ocr-bench-full -p 8870:8868 cuoti-analytics-ocr:<版本>
  docker run -d --name ocr-bench-orig -p 8871:8868 -e OCR_VARIANTS=original cuoti-analytics-ocr:<版本>

  # 跑
  python3 scripts/ocr-bench/bench-enhanced.py

  # 换端口 / 换样本目录
  python3 scripts/ocr-bench/bench-enhanced.py --dir /tmp/ocrtest \
      --ocr-host http://127.0.0.1:8871 --pre-host http://127.0.0.1:8870

==============================================================================
"""
import argparse
import base64
import difflib
import glob
import json
import os
import re
import urllib.request


def norm(s):
    return re.sub(r'\s+', '', str(s or ''))


def cer(ref, hyp):
    """字符错误率（CER）"""
    ref, hyp = norm(ref), norm(hyp)
    if not ref:
        return 1.0
    sm = difflib.SequenceMatcher(None, ref, hyp)
    matched = sum(b.size for b in sm.get_matching_blocks())
    return 1 - matched / len(ref)


def post(host, path, payload, timeout=180):
    req = urllib.request.Request(
        f'{host}{path}',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
    )
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())


def ocr_text(host, b64):
    """调 /predict 拿识别文本（PaddleOCR Serving v2 兼容结构）"""
    r = post(host, '/predict', {'images': [b64]})
    res = r['result']['ocrResults'][0]['prunedResult']
    return '\n'.join(res.get('rec_texts') or [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.environ.get('OCR_DIR', '/tmp/ocrtest'))
    ap.add_argument('--ocr-host', default='http://127.0.0.1:8871',
                    help='OCR_VARIANTS=original 的侧车（隔离二次增强）')
    ap.add_argument('--pre-host', default='http://127.0.0.1:8870',
                    help='完整侧车，提供 /preprocess')
    ap.add_argument('--tiers', default='real,hard')
    args = ap.parse_args()

    truth = json.load(open(os.path.join(args.dir, 'truth.json'), encoding='utf-8'))
    rows = []

    for tier in args.tiers.split(','):
        tier = tier.strip()
        for path in sorted(glob.glob(os.path.join(args.dir, tier, '*.jpg'))):
            name = os.path.splitext(os.path.basename(path))[0]
            t = truth.get(name)
            if not t:
                continue
            ref = '\n'.join(t.get('lines') or [])

            raw = base64.b64encode(open(path, 'rb').read()).decode()
            hyp_raw = ocr_text(args.ocr_host, raw)

            pr = post(args.pre_host, '/preprocess', {'image': raw})
            img = pr.get('image') or ''
            if ',' in img:
                img = img.split(',', 1)[1]
            hyp_enh = ocr_text(args.ocr_host, img)

            c_raw, c_enh = cer(ref, hyp_raw), cer(ref, hyp_enh)
            rows.append((tier, name, c_raw, c_enh))
            if c_enh < c_raw - 0.001:
                tag = '↓更好'
            elif abs(c_enh - c_raw) <= 0.001:
                tag = '持平'
            else:
                tag = '↑变差'
            print(f'  {tier:5} {name:12} 原图 {c_raw * 100:5.1f}%  →  增强 {c_enh * 100:5.1f}%  {tag}')

    print()
    for tier in args.tiers.split(','):
        tier = tier.strip()
        sub = [r for r in rows if r[0] == tier]
        if not sub:
            continue
        a = sum(r[2] for r in sub) / len(sub) * 100
        b = sum(r[3] for r in sub) / len(sub) * 100
        print(f'  ── {tier:4} 档平均：原图 {a:.2f}%  →  增强图 {b:.2f}%   ({b - a:+.2f} 个百分点)')
    if rows:
        a = sum(r[2] for r in rows) / len(rows) * 100
        b = sum(r[3] for r in rows) / len(rows) * 100
        print(f'  ── 总体平均：  原图 {a:.2f}%  →  增强图 {b:.2f}%   ({b - a:+.2f} 个百分点)')
        worse = [r for r in rows if r[3] > r[2] + 0.001]
        print(f'  ── 变差的样例：{len(worse)} 个' + (f'（{", ".join(r[1] for r in worse)}）' if worse else '（无）'))


if __name__ == '__main__':
    main()
