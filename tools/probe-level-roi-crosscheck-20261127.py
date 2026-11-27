# 一次性探针（2026-11-27 等级 ROI 历史交叉验证）：
# 在昨天 17:01 玩家信息任务的真机调试图与今日主城帧上，用同一现状 ROI [1090,500,1280,570]
# 裁剪并做暗部连通域测量，对比「120级」首位在不同账号/场景下是否被左边界裁掉。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
shots = [
    ("today-home", "_shot/level-roi-home-20261127-1118.png"),
    ("yesterday-running", "_shot/status-running.png"),       # dbg_1795683704645 17:01:44
    ("yesterday-done", "_shot/status-done.png"),             # dbg_1795683717373 17:01:57
    ("yesterday-results", "_shot/status-results.png"),       # dbg_1795683722602 17:02:02
    ("yesterday-final", "_shot/status-final-window-evidence.txt"),  # 占位，会跳过
]
cur = (1090, 500, 1280, 570)

for tag, rel in shots:
    p = root / rel
    if not p.exists() or p.suffix != ".png":
        print(tag, "skip", rel)
        continue
    img = cv2.imread(str(p))
    if img is None:
        print(tag, "unreadable", img.shape if img is not None else "")
        continue
    H, W = img.shape[:2]
    print(f"\n=== {tag} {rel} frame {W}x{H} ===")
    if (H, W) != (1280, 2772):
        print("  UNEXPECTED SIZE, skip measure")
        continue
    x1, y1, x2, y2 = cur
    crop = img[y1:y2, x1:x2]
    up = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
    out = root / f"_shot/level-xcheck-{tag}-current-roi.png"
    cv2.imwrite(str(out), up)
    # 宽区暗部组件（同今日测量参数）
    bx1, by1, bx2, by2 = 950, 420, 1450, 560
    band = img[by1:by2, bx1:bx2]
    hsv = cv2.cvtColor(band, cv2.COLOR_BGR2HSV)
    dark = cv2.inRange(hsv, (0, 0, 0), (179, 255, 110))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    merged = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, kernel, iterations=2)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(merged, 8)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 400:
            continue
        print("  comp bbox", (bx1 + x, by1 + y, bx1 + x + w, by1 + y + h), "area", int(area))
    # 现状 ROI 左边界 x=1090 与最左组件的关系
    print("  current ROI left edge x=1090; any component starting left of it indicates clipping risk")
