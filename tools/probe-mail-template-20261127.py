# 一次性探针（2026-11-27 阶段0）：
# 区分绿勾与数量数字的像素分布，选数字零包含的最大对勾裁剪框；
# 生成模板 res/img/daily_task/mail-claimed-check.png，测自匹配分与跨帧误报分布。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "_shot" / "daily-20261127-mail-unconfirmed.png"
img = cv2.imread(str(src))
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
green = cv2.inRange(hsv, (45, 80, 80), (95, 255, 255))

# 数字：深灰低饱和像素，限定徽章右下区
zx1, zy1, zx2, zy2 = 1290, 1025, 1440, 1110
zhsv = hsv[zy1:zy2, zx1:zx2]
gray_dark = cv2.inRange(zhsv, (0, 0, 0), (179, 70, 120))
# 去掉其中的绿色（对勾尾巴可能伸入）
g_sub = green[zy1:zy2, zx1:zx2]
digit_mask = cv2.bitwise_and(gray_dark, cv2.bitwise_not(g_sub))
n, lab, stats, cent = cv2.connectedComponentsWithStats(digit_mask, 8)
print("=== digit-like components (zone 1290,1025-1440,1110) ===")
digit_boxes = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 60:
        b = (zx1 + x, zy1 + y, zx1 + x + w, zy1 + y + h)
        digit_boxes.append(b)
        print("  bbox", b, "area", int(area))

# 绿勾像素在徽章区的逐行/逐列范围
gx1, gy1, gx2, gy2 = 1260, 960, 1420, 1100
g = green[gy1:gy2, gx1:gx2]
ys, xs = np.where(g > 0)
print("\ngreen check extent: x", gx1 + xs.min(), "-", gx1 + xs.max(),
      " y", gy1 + ys.min(), "-", gy1 + ys.max(), "pixels", len(xs))

# 数字联合 bbox
if digit_boxes:
    dx1 = min(b[0] for b in digit_boxes); dy1 = min(b[1] for b in digit_boxes)
    dx2 = max(b[2] for b in digit_boxes); dy2 = max(b[3] for b in digit_boxes)
    print("digit union bbox:", (dx1, dy1, dx2, dy2))
else:
    dx1 = dy1 = dx2 = dy2 = None

# 候选框：网格搜索，约束不含任何数字像素，最大化包含绿像素
best = None
for x1 in range(1270, 1310, 5):
    for y1 in range(975, 1000, 5):
        for x2 in range(1340, 1405, 5):
            for y2 in range(1045, 1080, 5):
                if dx1 is not None and not (x2 <= dx1 or y2 <= dy1 or x1 >= dx2 or y1 >= dy2):
                    continue  # 与数字 bbox 相交则淘汰
                gp = green[y1:y2, x1:x2].sum() // 255
                if best is None or gp > best[0]:
                    best = (int(gp), (x1, y1, x2, y2))
print("\nbest digit-free rect:", best)

# 用最佳框裁模板
_, (tx1, ty1, tx2, ty2) = best
tpl = img[ty1:ty2, tx1:tx2]
tpl_path = root / "res" / "img" / "daily_task" / "mail-claimed-check.png"
cv2.imwrite(str(tpl_path), tpl)
print("template saved:", tpl_path, tpl.shape[1], "x", tpl.shape[0])

# 自匹配（源帧同位置应 =1.0）
res = cv2.matchTemplate(img, tpl, cv2.TM_CCOEFF_NORMED)
_, maxv, _, maxloc = cv2.minMaxLoc(res)
print("full-frame self match max:", round(float(maxv), 4), "at", maxloc,
      "expect loc", (tx1, ty1))

# 建议搜索区域（附件阅读窗带，排除顶部 UI 与底部状态条 y1166）
search = (1050, 760, 1750, 1120)
sx1, sy1, sx2, sy2 = search
crop = img[sy1:sy2, sx1:sx2]
r2 = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
_, m2, _, l2 = cv2.minMaxLoc(r2)
th, tw = tpl.shape[:2]
print("search-region", search, "max:", round(float(m2), 4),
      "center", (l2[0] + sx1 + tw // 2, l2[1] + sy1 + th // 2))

# 跨帧误报分布：在多张不含绿勾的截图上跑全屏匹配
print("\n=== false-positive scan (other frames) ===")
for f in ["home-check-20261127-1050.png", "engine-start-check-20261127-1102.png",
          "daily-before-20261127-1128.png", "daily-after-20261127-1131.png",
          "junqing-skipped-home.png", "status-running.png"]:
    p = root / "_shot" / f
    if not p.exists():
        print(f, "missing"); continue
    im = cv2.imread(str(p))
    if im is None or im.shape[0] < 1280:
        print(f, "bad"); continue
    rr = cv2.matchTemplate(im, tpl, cv2.TM_CCOEFF_NORMED)
    _, mv, _, ml = cv2.minMaxLoc(rr)
    print(f"  {f:40s} max={mv:.4f} at {ml}")
