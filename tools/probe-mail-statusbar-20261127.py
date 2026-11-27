# 一次性探针（2026-11-27 阶段0 续）：
# 1) 量本项目底部状态条面板的精确像素矩形（暗面板连通域 + 居中过滤）
# 2) 复核附件徽章数量数字区域裁剪
# 纯离线，仅读 _shot/daily-20261127-mail-unconfirmed.png
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "daily-20261127-mail-unconfirmed.png"))
H, W = img.shape[:2]
print("frame", W, H)

# ---------- 状态条面板：底部区域暗半透明矩形 ----------
# 只看 y 1080 以下；面板比周边暗且均匀，用自适应阈值后做形态学闭合成块
probe = img[1080:1280, :]
gray = cv2.cvtColor(probe, cv2.COLOR_BGR2GRAY)
# 半透明深色面板：亮度明显低于两侧游戏画面，固定阈值取暗部
mask = (gray < 70).astype(np.uint8) * 255
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 9))
closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
n, labels, stats, cents = cv2.connectedComponentsWithStats(closed, 8)
print("\n=== dark components in y>=1080 (area>=8000) ===")
cands = []
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area < 8000:
        continue
    fy1, fy2 = 1080 + y, 1080 + y + h
    cands.append((x, fy1, x + w, fy2, int(area), tuple(round(v, 1) for v in cents[i])))
for c in sorted(cands, key=lambda t: -t[4]):
    print("  bbox", c[:4], "area", c[4], "centroid", c[5],
          "center_x", (c[0] + c[2]) // 2, "screen center", W // 2)

# ---------- 列/行投影辅助：在 y1120-1230 带内找面板横向范围 ----------
band = gray[40:150, :]  # 全帧 y 1120-1230
col_dark = (band < 70).mean(axis=0)
xs = np.where(col_dark > 0.6)[0]
if len(xs):
    # 取最长连续段
    segs, s = [], xs[0]
    for a, b in zip(xs, xs[1:]):
        if b - a > 30:
            segs.append((s, a)); s = b
    segs.append((s, xs[-1]))
    print("\n=== horizontal dark segments (y1120-1230, dark ratio>0.6) ===")
    for a, b in sorted(segs, key=lambda t: -(t[1] - t[0]))[:6]:
        print("  x", a, "-", b, "width", b - a, "center", (a + b) // 2)

# 行投影：面板纵向范围（取居中 x 1000-1772 列）
sub = gray[:, 1000:1772]
row_dark = (sub < 70).mean(axis=1)
ys = np.where(row_dark > 0.6)[0]
if len(ys):
    segs2, s = [], ys[0]
    for a, b in zip(ys, ys[1:]):
        if b - a > 8:
            segs2.append((s, a)); s = b
    segs2.append((s, ys[-1]))
    print("=== vertical dark segments (x1000-1772) full-frame y ===")
    for a, b in sorted(segs2, key=lambda t: -(t[1] - t[0]))[:6]:
        print("  y", 1080 + a, "-", 1080 + b, "height", b - a)

# ---------- 徽章数量数字复核裁剪 ----------
# 绿勾主块 (1279,983)-(1398,1068)，数字应在徽章右下或相邻
for name, rect in {
    "badge-full": (1240, 950, 1450, 1100),
    "badge-number-zone": (1300, 1030, 1450, 1110),
}.items():
    x1, y1, x2, y2 = rect
    z = cv2.resize(img[y1:y2, x1:x2], None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    p = root / "_shot" / f"mail-{name}.png"
    cv2.imwrite(str(p), z)
    print("saved", p, rect)
