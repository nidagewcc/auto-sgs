# 一次性探针（2026-11-27 阶段0 续）：
# 1) 用亮度剖面+轮廓精测底部状态条面板矩形；2) 输出徽章区坐标网格图供定裁剪框。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "daily-20261127-mail-unconfirmed.png"))
H, W = img.shape[:2]
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# ---------- 状态条面板：y1100-1280 带内的列/行亮度剖面 ----------
y1, y2 = 1120, 1275
band = gray[y1:y2, :]
col_mean = band.mean(axis=0)
# 面板内部很暗（<60），找居中连续暗段
dark_cols = col_mean < 60
xs = np.where(dark_cols)[0]
segs, s = [], xs[0]
for a, b in zip(xs, xs[1:]):
    if b - a > 12:
        segs.append((int(s), int(a))); s = b
segs.append((int(s), int(xs[-1])))
print("=== dark column segments (mean<60, y1120-1275) ===")
for a, b in sorted(segs, key=lambda t: -(t[1] - t[0]))[:6]:
    print("  x", a, "-", b, "w", b - a, "center", (a + b) // 2)

# 以居中长段为面板 x 范围，再量纵向
cx_seg = max(segs, key=lambda t: t[1] - t[0])
px1, px2 = cx_seg
sub = gray[:, px1 + 20: px2 - 20]
row_mean = sub.mean(axis=1)
dark_rows = np.where(row_mean < 70)[0]
dark_rows = dark_rows[dark_rows >= 1080]
ys, s2 = [], dark_rows[0]
for a, b in zip(dark_rows, dark_rows[1:]):
    if b - a > 8:
        ys.append((int(s2), int(a))); s2 = b
ys.append((int(s2), int(dark_rows[-1])))
print("=== dark row segments (within panel x) ===")
for a, b in sorted(ys, key=lambda t: -(t[1] - t[0]))[:6]:
    print("  y", a, "-", b, "h", b - a)

# 轮廓法交叉验证：面板区 Canny 找最大矩形轮廓
roi = img[1100:1280, 900:2000]
edges = cv2.Canny(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), 40, 120)
contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print("=== contours (w>300) ===")
for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
    x, y, w, h = cv2.boundingRect(c)
    if w > 300:
        print("  bbox full-frame", (900 + x, 1100 + y, 900 + x + w, 1100 + y + h), "area", int(cv2.contourArea(c)))

# 面板候选画框可视化
vis = img.copy()
if ys:
    py1, py2 = max(ys, key=lambda t: t[1] - t[0])
    cv2.rectangle(vis, (px1, py1), (px2, py2), (0, 0, 255), 5)
    print("PANEL CANDIDATE:", (px1, py1, px2, py2))
out = vis[1080:1280, 700:2100]
out = cv2.resize(out, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
cv2.imwrite(str(root / "_shot" / "mail-panel-measured.png"), out)

# ---------- 徽章区坐标网格（每 20px） ----------
bx1, by1, bx2, by2 = 1230, 940, 1460, 1110
badge = img[by1:by2, bx1:bx2].copy()
for gx in range(0, bx2 - bx1, 20):
    cv2.line(badge, (gx, 0), (gx, by2 - by1), (255, 200, 0), 1)
    cv2.putText(badge, str(bx1 + gx), (gx + 2, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
for gy in range(0, by2 - by1, 20):
    cv2.line(badge, (0, gy), (bx2 - bx1, gy), (255, 200, 0), 1)
    cv2.putText(badge, str(by1 + gy), (2, gy + 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
badge = cv2.resize(badge, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
cv2.imwrite(str(root / "_shot" / "mail-badge-grid.png"), badge)
print("saved mail-panel-measured.png / mail-badge-grid.png")
