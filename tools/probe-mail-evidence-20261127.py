# 一次性探针（2026-11-27 邮件证据离线素材·定位）：
# 在邮件真机截图上：1) HSV 定位附件绿色对勾的像素 bbox；2) 量底部状态条暗带矩形；
# 3) 输出坐标网格图与各候选裁剪，供人工复核。纯离线，不连手机。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "_shot" / "daily-20261127-mail-unconfirmed.png"
img = cv2.imread(str(src))
H, W = img.shape[:2]
print("frame", W, H)

# ---------- 1. 绿色对勾：HSV 绿色阈值 ----------
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
# 绿 ~ H 60-90（OpenCV 0-180），要求较高饱和与亮度
green = cv2.inRange(hsv, (45, 80, 80), (95, 255, 255))
n, labels, stats, cents = cv2.connectedComponentsWithStats(green, 8)
greens = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 80:
        greens.append((x, y, x + w, y + h, int(area), tuple(round(v, 1) for v in cents[i])))
print("\n=== green components (area>=80) ===")
for g in sorted(greens, key=lambda t: -t[4])[:20]:
    print("  bbox", g[:4], "area", g[4], "centroid", g[5])

# ---------- 2. 底部状态条：扫描底部 250px 的暗像素行分布 ----------
bottom = img[H - 260: H, :]
gray = cv2.cvtColor(bottom, cv2.COLOR_BGR2GRAY)
dark = (gray < 90).astype(np.uint8)
row_dark = dark.mean(axis=1)
# 连续暗带（暗像素占比 > 55%）
bands, start = [], None
for i, v in enumerate(row_dark):
    if v > 0.55 and start is None:
        start = i
    elif v <= 0.55 and start is not None:
        if i - start >= 12:
            bands.append((H - 260 + start, H - 260 + i, round(float(row_dark[start:i].mean()), 2)))
        start = None
if start is not None:
    bands.append((H - 260 + start, H - 1, round(float(row_dark[start:].mean()), 2)))
print("\n=== dark horizontal bands in bottom 260px ===")
for b in bands:
    print("  y", b[0], "-", b[1], "mean dark ratio", b[2])
# 状态条的横向范围：在最暗的一条带上按列统计
if bands:
    by1, by2, _ = max(bands, key=lambda b: b[1] - b[0])
    strip = gray[by1 - (H - 260): by2 - (H - 260) + 1, :]
    col_dark = (strip < 90).mean(axis=0)
    cols = np.where(col_dark > 0.5)[0]
    if len(cols):
        print("  status bar x range:", int(cols[0]), "-", int(cols[-1]), "y:", by1, "-", by2)

# ---------- 3. 坐标网格全图 ----------
grid = img.copy()
for x in range(0, W, 200):
    cv2.line(grid, (x, 0), (x, H), (0, 255, 255), 2)
    cv2.putText(grid, str(x), (x + 4, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
for y in range(0, H, 160):
    cv2.line(grid, (0, y), (W, y), (0, 255, 255), 2)
    cv2.putText(grid, str(y), (6, y + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
small = cv2.resize(grid, (1386, 640))
cv2.imwrite(str(root / "_shot/mail-grid-overview.png"), small)
print("\ngrid -> _shot/mail-grid-overview.png")

# 绿色组件标注图（右半屏放大）
ann = img.copy()
for (x1, y1, x2, y2, area, c) in greens:
    cv2.rectangle(ann, (x1, y1), (x2, y2), (0, 0, 255), 4)
cv2.imwrite(str(root / "_shot/mail-green-annotated.png"), ann)
print("green annotation -> _shot/mail-green-annotated.png")
