# 一次性探针（2026-11-27 等级 ROI 跨帧包络测量）：
# 在现状 ROI [1090,500,1280,570] 内部对多帧做暗部连通域，定位「120级」文本实际 bbox，
# 量出首位「1」距 ROI 左边界的余量、文本上下余量，跨帧取包络后给建议 ROI。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
cur = (1090, 500, 1280, 570)
frames = [
    ("today-1118", "_shot/level-roi-home-20261127-1118.png"),
    ("yest-running-1701", "_shot/status-running.png"),
    ("yest-done-1701", "_shot/status-done.png"),
]

envelope = None
for tag, rel in frames:
    img = cv2.imread(str(root / rel))
    x1, y1, x2, y2 = cur
    crop = img[y1:y2, x1:x2]  # 190x70
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    dark = cv2.inRange(hsv, (0, 0, 0), (179, 255, 120))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    merged = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, kernel, iterations=1)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(merged, 8)
    boxes = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 120:
            continue
        boxes.append((x, y, x + w, y + h, int(area)))
    print(f"\n=== {tag} components inside current ROI (ROI-local coords) ===")
    for b in sorted(boxes, key=lambda t: t[0]):
        print("  local", b[:4], "area", b[4], "| full-frame",
              (x1 + b[0], y1 + b[1], x1 + b[2], y1 + b[3]))
    if boxes:
        ax1 = min(b[0] for b in boxes); ay1 = min(b[1] for b in boxes)
        ax2 = max(b[2] for b in boxes); ay2 = max(b[3] for b in boxes)
        print(f"  text envelope local: x {ax1}-{ax2} (left margin {ax1}px, right margin {190-ax2}px),"
              f" y {ay1}-{ay2} (top {ay1}px, bottom {70-ay2}px)")
        print(f"  full-frame envelope: ({x1+ax1},{y1+ay1})-({x1+ax2},{y1+ay2})")
        env_full = (x1 + ax1, y1 + ay1, x1 + ax2, y1 + ay2)
        if envelope is None:
            envelope = list(env_full)
        else:
            envelope[0] = min(envelope[0], env_full[0])
            envelope[1] = min(envelope[1], env_full[1])
            envelope[2] = max(envelope[2], env_full[2])
            envelope[3] = max(envelope[3], env_full[3])

print("\n=== CROSS-FRAME ENVELOPE (full frame) ===", envelope)
if envelope:
    # 建议 ROI：包络四周各留 25px 边距，钳制到屏幕内
    pad = 25
    sug = (max(0, envelope[0] - pad), max(0, envelope[1] - pad),
           min(2772, envelope[2] + pad), min(1280, envelope[3] + pad))
    print("suggested ROI (25px padding):", sug, "w", sug[2]-sug[0], "h", sug[3]-sug[1])
