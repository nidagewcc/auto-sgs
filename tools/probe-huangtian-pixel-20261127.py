# 一次性探针（2026-11-27 修正版）：按全带匹配的精确 top-left 取与后备模板等大的裁剪，
# 四帧并排对照，回答黄天当道左带命中位与产品经理两版皮肤的像素内容差异。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tpl = cv2.imread(str(root / "res" / "img" / "xiaoqiao" / "xiaoqiao_entry.png"))
h, w = tpl.shape[:2]
band = (0, 0, 400, 1280)
frames = [
    ("huangtian-1402", "_shot/huangtian-home-20261127-1402.png"),
    ("product-light", "_shot/daily-after-xiaoqiao-fail-20261127-1238.png"),
    ("product-dark", "_shot/skin-dark-home-20261127-1256.png"),
    ("yesterday-ok", "_shot/xiaoqiao-final-home.png"),
]
tiles = []
for tag, rel in frames:
    img = cv2.imread(str(root / rel))
    x1, y1, x2, y2 = band
    crop = img[y1:y2, x1:x2]
    res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
    _, mv, _, ml = cv2.minMaxLoc(res)
    tx, ty = x1 + ml[0], y1 + ml[1]            # 全帧精确 top-left
    exact = img[ty:ty + h, tx:tx + w].copy()   # 与模板严格等大
    up = cv2.resize(exact, (w * 4, h * 4), interpolation=cv2.INTER_NEAREST)
    cv2.putText(up, f"{tag} {mv:.3f} @({tx},{ty})", (4, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    tiles.append(up)
    print(f"{tag:14s} band best={mv:.4f} exact tile top-left=({tx},{ty})")
tpl_up = cv2.resize(tpl, (w * 4, h * 4), interpolation=cv2.INTER_NEAREST)
cv2.putText(tpl_up, "TEMPLATE fallback", (4, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
strip = np.vstack([tpl_up] + tiles)
cv2.imwrite(str(root / "_shot/cmp-xiaoqiao-entry-strip.png"), strip)
print("saved _shot/cmp-xiaoqiao-entry-strip.png", strip.shape)
