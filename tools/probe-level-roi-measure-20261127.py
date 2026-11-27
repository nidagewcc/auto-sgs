# 一次性探针（2026-11-27 等级 ROI 调研·精确测量）：
# 在主城帧上画出当前 level ROI 与候选边界，对等级文本带做暗色像素连通域分析，
# 输出「120级」文本的实测像素 bbox，与现状 ROI [1090,500,1280,570] 逐边对比。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "level-roi-home-20261127-1118.png"))
H, W = img.shape[:2]
print("frame", W, H)

cur = (1090, 500, 1280, 570)

# 文本带：宽区上部（角色名/等级在 y 420-540 一带），先暗色阈值找粗体字填充
x1, y1, x2, y2 = 950, 420, 1450, 560
band = img[y1:y2, x1:x2]
hsv = cv2.cvtColor(band, cv2.COLOR_BGR2HSV)
# 深色粗体字：V 较低；描边外圈是浅色，取核心暗部
dark = cv2.inRange(hsv, (0, 0, 0), (179, 255, 110))
# 闭运算把同一字的笔画连起来
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
merged = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, kernel, iterations=2)
n, labels, stats, cents = cv2.connectedComponentsWithStats(merged, 8)
comps = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area < 400:  # 过滤小噪点
        continue
    comps.append((x1 + x, y1 + y, x1 + x + w, y1 + y + h, area))
print("dark components (full-frame coords), sorted by x:")
for c in sorted(comps, key=lambda t: t[0]):
    print("  bbox", c[:4], "area", c[4])

# 合成可视化：当前 ROI 红框、组件蓝框、边界坐标
vis = img.copy()
cv2.rectangle(vis, (cur[0], cur[1]), (cur[2], cur[3]), (0, 0, 255), 5)  # 红=现状ROI
for (a, b, c, d, area) in comps:
    cv2.rectangle(vis, (a, b), (c, d), (255, 0, 0), 4)  # 蓝=实测暗部
cv2.line(vis, (cur[0], 0), (cur[0], H), (0, 0, 255), 3)
cv2.line(vis, (cur[2], 0), (cur[2], H), (0, 0, 255), 3)
cv2.line(vis, (0, cur[1]), (W, cur[1]), (0, 0, 255), 3)
cv2.line(vis, (0, cur[3]), (W, cur[3]), (0, 0, 255), 3)
crop = vis[380:700, 850:1550]
crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
cv2.imwrite(str(root / "_shot" / "level-roi-measure-annotated.png"), crop)
print("annotated -> _shot/level-roi-measure-annotated.png")

# 单独把现状 ROI 与左扩/上扩版本各存一份放大图，供 OCR/肉眼对照
for name, rect in {
    "roi-current": cur,
    "roi-left-expanded": (980, 500, 1280, 570),
    "roi-top-expanded": (1090, 430, 1280, 570),
    "roi-both-expanded": (980, 430, 1330, 580),
}.items():
    a, b, c, d = rect
    z = cv2.resize(img[b:d, a:c], None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(root / f"_shot/level-{name}.png"), z)
    print(name, rect, "w", c - a, "h", d - b)
