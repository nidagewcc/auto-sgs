# 一次性探针（2026-11-27）：定位点「开启」后 1 秒帧里的完成提示条。
# 用暗像素连通域在画面中下部找半透明深色横条，输出 bbox、尺寸、主色，并裁高倍图。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "again-after-kaiqi-1s.png"))
H, W = img.shape[:2]
print("frame", W, H)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# 提示条是半透明深色，比压暗背景更暗且呈宽扁矩形；在 y 850-1150 带内找
band_y1, band_y2 = 850, 1150
band = gray[band_y1:band_y2, :]
# 阈值：很暗的像素
mask = (band < 45).astype(np.uint8) * 255
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                        cv2.getStructuringElement(cv2.MORPH_RECT, (31, 9)), iterations=2)
n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
print("=== dark wide blobs in y850-1150 ===")
cands = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if w > 500 and h >= 30:  # 宽扁条
        full = (x, band_y1 + y, x + w, band_y1 + y + h)
        cands.append((area, full))
        print("  bbox", full, "w", w, "h", h, "area", int(area),
              "center", (x + w // 2, band_y1 + y + h // 2))
# 取最宽的候选做颜色采样与裁剪
if cands:
    _, (x1, y1, x2, y2) = max(cands)
    crop = img[y1:y2, x1:x2]
    mean_bgr = crop.reshape(-1, 3).mean(0).round(1)
    print("chosen strip mean BGR", mean_bgr, "hex #%02X%02X%02X" %
          (int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0])))
    up = cv2.resize(crop, None, fx=2, fy=3, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(root / "_shot/again-done-strip-zoom.png"), up)
    # 在原图上标注
    vis = img.copy()
    cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 0, 255), 5)
    cv2.imwrite(str(root / "_shot/again-done-strip-annotated.png"),
                cv2.resize(vis[800:1200, 300:2500], None, fx=1.2, fy=1.2,
                           interpolation=cv2.INTER_NEAREST))
    print("saved zoom + annotated")

# 对照：脚本现有 COMPLETION_REGION [860,1060,1980,1165] 找绿 #80CF4C
comp = img[1060:1165, 860:1980]
hsv = cv2.cvtColor(comp, cv2.COLOR_BGR2HSV)
green = cv2.inRange(hsv, (35, 80, 80), (95, 255, 255))
print("green pixels in COMPLETION_REGION:", int((green > 0).sum()))
