# 一次性探针（2026-11-27 矿点详情面板几何）：
# 量「迁入」黄色按钮 bbox/主色、面板遮罩范围、关闭 X 位置，并检查面板内是否有付费元素。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "kuangzhan-detail-check-20261127.png"))
H, W = img.shape[:2]
print("frame", W, H)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

# 1) 「迁入」黄色按钮：右下区高饱和黄/橙
rx1, ry1, rx2, ry2 = 1850, 850, 2772, 1280
band = hsv[ry1:ry2, rx1:rx2]
yellow = cv2.inRange(band, (15, 120, 140), (38, 255, 255))
yellow = cv2.morphologyEx(yellow, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (25, 15)), iterations=2)
n, lab, stats, cent = cv2.connectedComponentsWithStats(yellow, 8)
print("=== yellow blobs in move-in region (area>=3000) ===")
move = None
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 3000:
        full = (rx1 + x, ry1 + y, rx1 + x + w, ry1 + y + h)
        print("  bbox", full, "w", w, "h", h, "area", int(area), "center",
              (rx1 + x + w // 2, ry1 + y + h // 2))
        if move is None or area > move[0]:
            # 取该按钮主色
            sub = img[ry1 + y:ry1 + y + h, rx1 + x:rx1 + x + w]
            bgr = sub.reshape(-1, 3).mean(0).round(1)
            move = (area, full, bgr)
if move:
    print("MOVE-IN button bbox", move[1], "mean BGR", move[2],
          "hex #%02X%02X%02X" % (int(move[2][2]), int(move[2][1]), int(move[2][0])))

# 2) 面板遮罩：统计画面四周暗化程度（详情打开时地图被压暗）
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
print("\n=== mean brightness by region (map dimmed?) ===")
for name, (x1, y1, x2, y2) in {
    "top-left map": (60, 60, 700, 300),
    "center panel": (700, 300, 2100, 950),
    "bottom strip": (400, 1150, 1800, 1280),
    "far-right map": (2400, 400, 2700, 800),
}.items():
    print(f"  {name:16s} {int(gray[y1:y2, x1:x2].mean())}")

# 3) 关闭 X：右上灯笼形亮橙组件（x2050-2500 y120-420）
cx1, cy1, cx2, cy2 = 2050, 120, 2500, 420
cband = hsv[cy1:cy2, cx1:cx2]
orange = cv2.inRange(cband, (8, 120, 120), (25, 255, 255))
n2, l2, st2, c2 = cv2.connectedComponentsWithStats(orange, 8)
print("=== close-X orange blobs (area>=1500) ===")
for i in range(1, n2):
    x, y, w, h, area = st2[i]
    if area >= 1500:
        print("  bbox", (cx1 + x, cy1 + y, cx1 + x + w, cy1 + y + h), "area", int(area),
              "center", (cx1 + x + w // 2, cy1 + y + h // 2))

# 4) 找「产量 200/天」绿色数字与面板标题（左上蓝框区）
green = cv2.inRange(hsv[0:420, 0:900], (40, 120, 120), (90, 255, 255))
n3, l3, st3, c3 = cv2.connectedComponentsWithStats(green, 8)
print("=== green production blobs top-left (area>=800) ===")
for i in range(1, n3):
    x, y, w, h, area = st3[i]
    if area >= 800:
        print("  bbox", (x, y, x + w, y + h), "area", int(area))

# 标注图
vis = img.copy()
if move:
    x1, y1, x2, y2 = move[1]
    cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 0, 255), 6)
cv2.imwrite(str(root / "_shot" / "kuangzhan-detail-annotated.png"),
            cv2.resize(vis, (1386, 640), interpolation=cv2.INTER_NEAREST))
print("\nsaved annotated")
