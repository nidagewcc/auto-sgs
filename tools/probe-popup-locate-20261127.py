# 一次性探针（2026-11-27 主公信息弹窗帧）：
# 1) 定位左缘圆形头像/控件的精确 bbox；2) 定位右上灯笼形 X 关闭钮；
# 3) 用现有小乔模板在弹窗帧左带打分，看压暗背景下的匹配表现。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "playerinfo-popup-20261127.png"))
H, W = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# ---------- 左缘头像：在 x0-400 / y300-800 内找非暗像素连通域 ----------
x1, y1, x2, y2 = 0, 300, 400, 800
band_hsv = hsv[y1:y2, x1:x2]
# 压暗背景 V 很低；头像皮肤/头发 V 相对高或有饱和色
mask = cv2.inRange(band_hsv, (0, 60, 60), (179, 255, 255))
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
print("=== left-edge colored blobs (area>=1500) ===")
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 1500:
        print("  bbox full-frame", (x1 + x, y1 + y, x1 + x + w, y1 + y + h), "area", int(area),
              "center", (x1 + x + w // 2, y1 + y + h // 2))

# ---------- 灯笼 X：右上亮斑（高 V） ----------
rx1, ry1, rx2, ry2 = 2250, 40, 2720, 280
rg = gray[ry1:ry2, rx1:rx2]
bright = (rg > 150).astype(np.uint8) * 255
bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)), iterations=2)
n2, l2, st2, c2 = cv2.connectedComponentsWithStats(bright, 8)
print("=== upper-right bright blobs (lantern X candidates, area>=800) ===")
for i in range(1, n2):
    x, y, w, h, area = st2[i]
    if area >= 800:
        print("  bbox", (rx1 + x, ry1 + y, rx1 + x + w, ry1 + y + h), "area", int(area),
              "center", (rx1 + x + w // 2, ry1 + y + h // 2))

# ---------- 现有小乔模板在弹窗帧左带的分数 ----------
bands = {"left": (0, 0, 400, 1280)}
for rel, th, tag in [("xiaoqiao/entry-left.png", 0.75, "entry-left"),
                     ("xiaoqiao/xiaoqiao_entry.png", 0.9, "fallback")]:
    tpl = cv2.imread(str(root / "res" / "img" / rel))
    hh, ww = tpl.shape[:2]
    crop = img[0:1280, 0:400]
    res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
    _, mv, _, ml = cv2.minMaxLoc(res)
    print(f"popup-frame {tag}: score={mv:.4f} center=({ml[0]+ww//2},{ml[1]+hh//2}) (th {th})")

# 可视化：左缘头像框 + 灯笼候选框
vis = img.copy()
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area >= 1500:
        cv2.rectangle(vis, (x1 + x, y1 + y), (x1 + x + w, y1 + y + h), (0, 0, 255), 5)
for i in range(1, n2):
    x, y, w, h, area = st2[i]
    if area >= 800:
        cv2.rectangle(vis, (rx1 + x, ry1 + y), (rx1 + x + w, ry1 + y + h), (0, 255, 255), 5)
cv2.imwrite(str(root / "_shot" / "popup-locate-annotated.png"),
            cv2.resize(vis[0:900, 0:2772], None, fx=0.7, fy=0.7, interpolation=cv2.INTER_NEAREST))
print("saved popup-locate-annotated.png")
