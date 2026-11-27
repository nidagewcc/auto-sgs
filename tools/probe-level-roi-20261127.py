# 一次性探针（2026-11-27 等级 ROI 调研用）：
# 裁剪 playerinfo level 现状 ROI 与周边宽区，放大留证，并对宽区做文字像素边界统计，
# 用来判断现状 ROI [1090,500,1280,570] 是否裁掉等级首位。纯离线分析，不连手机。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
img = cv2.imread(str(root / "_shot" / "level-roi-home-20261127-1118.png"))
print("frame", img.shape)

def crop_save(rect, name, scale=3):
    x1, y1, x2, y2 = rect
    c = img[y1:y2, x1:x2]
    up = cv2.resize(c, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    p = root / "_shot" / name
    cv2.imwrite(str(p), up)
    print(name, "src rect", rect, "size", (x2 - x1, y2 - y1), "->", up.shape[1], "x", up.shape[0])

# 现状 ROI（宽 190 / 高 70）
crop_save([1090, 500, 1280, 570], "level-roi-current-zoom.png")
# 周边宽区
crop_save([900, 420, 1500, 680], "level-roi-wide-zoom.png", scale=2)
# 左上玩家横幅（昵称/等级可能在这）
crop_save([0, 0, 760, 220], "level-roi-banner-zoom.png", scale=2)

# 在宽区内统计"文字像素"：与局部背景差异显著的深色/亮色描边像素
x1, y1, x2, y2 = [900, 420, 1500, 680]
wide = img[y1:y2, x1:x2]
gray = cv2.cvtColor(wide, cv2.COLOR_BGR2GRAY)
# 自适应阈值抓文字（等级数字通常是亮黄/白色带深色描边）
mask = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                             cv2.THRESH_BINARY_INV, 31, 8)
# 列/行投影
col = mask.sum(axis=0) / 255
row = mask.sum(axis=1) / 255
col_idx = np.where(col > 3)[0]
row_idx = np.where(row > 3)[0]
if len(col_idx):
    print("wide-region ink bbox: x", x1 + col_idx[0], "-", x1 + col_idx[-1],
          " y", y1 + row_idx[0], "-", y1 + row_idx[-1])
else:
    print("no ink found")
# 输出每 20px 的列投影密度，便于人工判读分段
dens = [int(col[i:i+20].sum()) for i in range(0, len(col), 20)]
print("column density (20px bins from x=900):", dens)
cv2.imwrite(str(root / "_shot" / "level-roi-wide-mask.png"), mask)
