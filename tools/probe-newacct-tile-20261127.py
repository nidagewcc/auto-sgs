# 一次性探针（2026-11-27 新账号控件定性）：
# 取 fallback 在各帧左带的精确命中 tile（等大），与已知有控件的黄天当道/弹窗帧做两两相似度，
# 判定血域魔神左缘命中的是不是同一个圆形助手控件；并裁高倍特写查圆边。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tpl = cv2.imread(str(root / "res" / "img" / "xiaoqiao" / "xiaoqiao_entry.png"))
h, w = tpl.shape[:2]
frames = [
    ("huangtian", "_shot/huangtian-home-20261127-1402.png"),
    ("xueyu-newacct", "_shot/newacct-home-20261127-1430.png"),
    ("product-light", "_shot/daily-after-xiaoqiao-fail-20261127-1238.png"),
    ("product-dark", "_shot/skin-dark-home-20261127-1256.png"),
    ("popup", "_shot/playerinfo-popup-20261127.png"),
    ("yesterday-ok", "_shot/xiaoqiao-final-home.png"),
]
tiles = {}
for tag, rel in frames:
    img = cv2.imread(str(root / rel))
    r = cv2.matchTemplate(img[0:1280, 0:400], tpl, cv2.TM_CCOEFF_NORMED)
    _, mv, _, ml = cv2.minMaxLoc(r)
    tile = img[ml[1]:ml[1] + h, ml[0]:ml[0] + w]
    tiles[tag] = tile
    print(f"{tag:14s} match={mv:.4f} top-left=({ml[0]},{ml[1]}) tile mean BGR={tile.reshape(-1,3).mean(0).round(1)}")

# 两两相似度（TM_CCOEFF_NORMED，整 tile 对整 tile）
print("\n=== pairwise tile similarity (1.0=identical) ===")
keys = list(tiles)
print("            " + "".join(f"{k[:10]:>12}" for k in keys))
for a in keys:
    row = []
    for b in keys:
        if a == b:
            row.append(1.0); continue
        r = cv2.matchTemplate(tiles[b], tiles[a], cv2.TM_CCOEFF_NORMED)
        row.append(float(cv2.minMaxLoc(r)[1]))
    print(f"{a[:10]:12s}" + "".join(f"{v:12.3f}" for v in row))

# 高倍特写：血域魔神与黄天当道左缘控件区
for tag, rel in [("xueyu", "_shot/newacct-home-20261127-1430.png"),
                 ("huangtian", "_shot/huangtian-home-20261127-1402.png")]:
    img = cv2.imread(str(root / rel))
    cv2.imwrite(str(root / f"_shot/ctrl-zoom-{tag}.png"),
                cv2.resize(img[390:600, 0:160], None, fx=5, fy=5, interpolation=cv2.INTER_NEAREST))
print("\nsaved ctrl-zoom-xueyu.png / ctrl-zoom-huangtian.png")
