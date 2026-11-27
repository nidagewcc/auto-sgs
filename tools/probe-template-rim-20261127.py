# 一次性探针（2026-11-27 补）：从【正常主城】正样本帧取圆形边框/边缘结构模板，
# 验证"纯结构、非脸部、非压暗"路线能否把正负样本分离。与弹窗压暗候选对照。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
pos = cv2.imread(str(root / "_shot" / "huangtian-home-20261127-1402.png"))
H, W = pos.shape[:2]
# 控件圆心实测约 (35,488)，半径约 70；取方形窗
cx, cy, r = 35, 488, 78
x1, y1, x2, y2 = max(0, cx - r), max(0, cy - r), cx + r, cy + r
win = pos[y1:y2, x1:x2]
out = root / "_shot" / "tpl-candidates"
out.mkdir(exist_ok=True)

# C4: 正常帧 Canny 边缘（圆框结构）
gray = cv2.cvtColor(win, cv2.COLOR_BGR2GRAY)
c4 = cv2.Canny(gray, 50, 150)
cv2.imwrite(str(out / "C4-rim-edge-normal.png"), c4)
# C5: 圆环遮罩，只保留圆周边框带（半径 52-72），内部脸和外部背景置黑
hh, ww = win.shape[:2]
mask = np.zeros((hh, ww), np.uint8)
cv2.circle(mask, (cx - x1, cy - y1), 72, 255, -1)
cv2.circle(mask, (cx - x1, cy - y1), 50, 0, -1)
c5 = cv2.bitwise_and(win, win, mask=mask)
cv2.imwrite(str(out / "C5-rim-annulus-normal.png"), c5)
print("C4", c4.shape[1], "x", c4.shape[0], " C5", c5.shape[1], "x", c5.shape[0])

frames = {
    "POS popup": ("_shot/playerinfo-popup-20261127.png", True),
    "POS huangtian": ("_shot/huangtian-home-20261127-1402.png", True),
    "POS yesterday": ("_shot/xiaoqiao-final-home.png", True),
    "POS selfcheck": ("_shot/selfcheck-20261127-1414.png", True),
    "NEG product-light": ("_shot/daily-after-xiaoqiao-fail-20261127-1238.png", False),
    "NEG product-dark": ("_shot/skin-dark-home-20261127-1256.png", False),
}
for tname, tpl, edge in [("C4-rim-edge-normal", c4, True), ("C5-rim-annulus-normal", c5, False)]:
    posv, negv = [], []
    print(f"\n{tname}:")
    for fname, (rel, ispos) in frames.items():
        img = cv2.imread(str(root / rel))
        crop = img[0:1280, 0:400]
        if edge:
            crop = cv2.Canny(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), 50, 150)
        if crop.shape[0] < tpl.shape[0] or crop.shape[1] < tpl.shape[1]:
            print("  too small", fname); continue
        res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        (posv if ispos else negv).append(float(mv))
        print(f"   {fname:20s} {mv:.4f}")
    print(f"   >> POS min={min(posv):.4f} NEG max={max(negv):.4f} separation={min(posv)-max(negv):+.4f}")
