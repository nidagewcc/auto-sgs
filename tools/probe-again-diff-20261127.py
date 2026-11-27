# 一次性探针（2026-11-27）：用 1s 与 6s 帧差分，定位点「开启」后短暂出现的提示条。
# 两帧面板静止，差异主要来自提示条/气泡；输出差异 bbox、裁剪图。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
f1 = cv2.imread(str(root / "_shot" / "again-after-kaiqi-1s.png"))
f6 = cv2.imread(str(root / "_shot" / "again-after-kaiqi-6s.png"))
d = cv2.absdiff(f1, f6)
gray = cv2.cvtColor(d, cv2.COLOR_BGR2GRAY)
_, th = cv2.threshold(gray, 28, 255, cv2.THRESH_BINARY)
th = cv2.morphologyEx(th, cv2.MORPH_CLOSE,
                      cv2.getStructuringElement(cv2.MORPH_RECT, (25, 15)), iterations=2)
n, lab, stats, cent = cv2.connectedComponentsWithStats(th, 8)
print("=== changed regions (area>=3000) between 1s and 6s ===")
boxes = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 3000:
        boxes.append((x, y, x + w, y + h, int(area)))
        print("  bbox", (x, y, x + w, y + h), "w", w, "h", h, "area", int(area),
              "center", (x + w // 2, y + h // 2))

# 对每个候选框裁 1s 帧高倍图
for k, (x1, y1, x2, y2, area) in enumerate(boxes[:4]):
    pad = 12
    cx1, cy1 = max(0, x1 - pad), max(0, y1 - pad)
    cx2, cy2 = min(f1.shape[1], x2 + pad), min(f1.shape[0], y2 + pad)
    crop = f1[cy1:cy2, cx1:cx2]
    up = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    p = root / f"_shot/again-diff-{k}.png"
    cv2.imwrite(str(p), up)
    print("saved", p, (cx1, cy1, cx2, cy2))

# 标注全景
vis = f1.copy()
for (x1, y1, x2, y2, area) in boxes:
    cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 0, 255), 5)
cv2.imwrite(str(root / "_shot/again-diff-annotated.png"),
            cv2.resize(vis, (1386, 640), interpolation=cv2.INTER_NEAREST))
print("saved annotated overview")
