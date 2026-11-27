# 一次性探针（2026-11-27 矿战占矿态几何测量）：
# 定位倒计时条、兵力条、按钮与角色脚下光环的像素坐标/颜色，输出网格标注图。纯离线只读。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "kuangzhan-occupied-1-20261127-1533.png"))
H, W = img.shape[:2]
print("frame", W, H)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

# 1) 橙色文字（倒计时/标题）连通域，y 150-360 带
band = hsv[150:360, :]
orange = cv2.inRange(band, (8, 120, 120), (28, 255, 255))
orange = cv2.morphologyEx(orange, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (25, 9)), iterations=2)
n, lab, stats, cent = cv2.connectedComponentsWithStats(orange, 8)
print("=== orange text blobs y150-360 (area>=1500) ===")
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 1500:
        print("  bbox", (x, 150 + y, x + w, 150 + y + h), "area", int(area),
              "center", (x + w // 2, 150 + y + h // 2))

# 2) 绿色兵力条（高饱和绿，左上区 y60-200 x0-760）
gb = hsv[60:210, 0:760]
green = cv2.inRange(gb, (40, 120, 120), (90, 255, 255))
n2, l2, st2, c2 = cv2.connectedComponentsWithStats(green, 8)
print("=== green troop bar blobs (area>=2000) ===")
for i in range(1, n2):
    x, y, w, h, area = st2[i]
    if area >= 2000:
        print("  bbox", (x, 60 + y, x + w, 60 + y + h), "area", int(area))

# 3) 角色脚下光环：中央偏左找高亮度蓝/青色圆形（淡蓝光环）
#    扫描 x300-1300 y700-1150 的高亮低饱和青蓝
ring_band = img[700:1150, 300:1300]
rhsv = cv2.cvtColor(ring_band, cv2.COLOR_BGR2HSV)
cyan = cv2.inRange(rhsv, (85, 40, 150), (115, 200, 255))
cyan = cv2.morphologyEx(cyan, cv2.MORPH_CLOSE,
                        cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15)), iterations=2)
n3, l3, st3, c3 = cv2.connectedComponentsWithStats(cyan, 8)
print("=== cyan ring candidates x300-1300/y700-1150 (area>=3000) ===")
for i in range(1, n3):
    x, y, w, h, area = st3[i]
    if area >= 3000:
        print("  bbox", (300 + x, 700 + y, 300 + x + w, 700 + y + h), "area", int(area),
              "center", (300 + x + w // 2, 700 + y + h // 2))

# 4) 金色高亮按钮（右上四钮）：高 V、黄橙色调，x1850-2772 y60-620
btn = hsv[60:620, 1850:2772]
gold = cv2.inRange(btn, (15, 80, 140), (40, 255, 255))
n4, l4, st4, c4 = cv2.connectedComponentsWithStats(gold, 8)
print("=== gold button blobs top-right (area>=2500) ===")
for i in range(1, n4):
    x, y, w, h, area = st4[i]
    if area >= 2500:
        print("  bbox", (1850 + x, 60 + y, 1850 + x + w, 60 + y + h), "area", int(area),
              "center", (1850 + x + w // 2, 60 + y + h // 2))

# 网格标注全景
vis = img.copy()
for x in range(0, W, 200):
    cv2.line(vis, (x, 0), (x, H), (0, 255, 255), 2)
    cv2.putText(vis, str(x), (x + 3, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
for y in range(0, H, 160):
    cv2.line(vis, (0, y), (W, y), (0, 255, 255), 2)
    cv2.putText(vis, str(y), (4, y + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
cv2.imwrite(str(root / "_shot" / "kuangzhan-grid.png"),
            cv2.resize(vis, (1386, 640), interpolation=cv2.INTER_NEAREST))
print("saved kuangzhan-grid.png")
