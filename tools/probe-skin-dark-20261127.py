# 一次性探针（2026-11-27 深色皮肤 A/B 验证）：
# 深色皮肤主城帧上：1) 小乔三模板在左右侧带的匹配矩阵；2) 主城锚点匹配给分；
# 3) 输出左侧带放大裁剪供肉眼确认。纯离线只读，不点手机。
import cv2
from pathlib import Path

root = Path(__file__).resolve().parent.parent
screen_path = root / "_shot" / "skin-dark-home-20261127-1256.png"
screen = cv2.imread(str(screen_path))
print("screen", screen.shape[1], "x", screen.shape[0])

# 生产代码同款搜索带
bands = {
    "left[0,0,400,1280]": (0, 0, 400, 1280),
    "right[2372,0,2772,1280]": (2372, 0, 2772, 1280),
}
templates = [
    ("xiaoqiao/entry-left.png", 0.75, "entry-left"),
    ("xiaoqiao/home-avatar.png", 0.75, "home-avatar(right)"),
    ("xiaoqiao/xiaoqiao_entry.png", 0.9, "fallback"),
]
print("\n=== xiaoqiao entry matrix (dark skin) ===")
for rel, th, tag in templates:
    tpl = cv2.imread(str(root / "res" / "img" / rel))
    h, w = tpl.shape[:2]
    for bname, (x1, y1, x2, y2) in bands.items():
        crop = screen[y1:y2, x1:x2]
        res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        center = (ml[0] + x1 + w // 2, ml[1] + y1 + h // 2)
        print(f"{tag:20s} th={th} | {bname:28s} score={mv:.4f} center={center} "
              f"{'*** HIT ***' if mv >= th else ''}")

# 主城锚点
anchor_tpl = cv2.imread(str(root / "res" / "img" / "common" / "anchor-zhengzhan.png"))
ax1, ay1, ax2, ay2 = (2400, 980, 2772, 1280)
acrop = screen[ay1:ay2, ax1:ax2]
if acrop.shape[0] >= anchor_tpl.shape[0] and acrop.shape[1] >= anchor_tpl.shape[1]:
    ra = cv2.matchTemplate(acrop, anchor_tpl, cv2.TM_CCOEFF_NORMED)
    _, mva, _, mla = cv2.minMaxLoc(ra)
    ah, aw = anchor_tpl.shape[:2]
    print(f"\nanchor-zhengzhan in {[ax1,ay1,ax2,ay2]}: score={mva:.4f} "
          f"center={mla[0]+ax1+aw//2, mla[1]+ay1+ah//2} (isHome threshold 0.7/0.72)")
# 全屏兜底对照
rf = cv2.matchTemplate(screen, anchor_tpl, cv2.TM_CCOEFF_NORMED)
_, mvf, _, mlf = cv2.minMaxLoc(rf)
print(f"anchor full-screen fallback score={mvf:.4f} at {mlf}")

# 左侧带裁剪（Chief 指定 [0,300,560,750]）+ 昨天成功同位
band = screen[300:750, 0:560]
band_up = cv2.resize(band, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_NEAREST)
cv2.imwrite(str(root / "_shot" / "skin-dark-leftband.png"), band_up)
# 右侧带也裁一份排查入口是否跑到右边
rband = screen[300:1000, 2300:2772]
rband_up = cv2.resize(rband, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
cv2.imwrite(str(root / "_shot" / "skin-dark-rightband.png"), rband_up)
print("\nsaved skin-dark-leftband.png / skin-dark-rightband.png")
