# 一次性探针（2026-11-27 新账号小乔入口核查）：
# 新主城帧上跑小乔三模板×两侧带矩阵 + 锚点分，生成左右侧带裁剪，并与历史四组并排。纯离线。
import cv2
from pathlib import Path

root = Path(__file__).resolve().parent.parent
new = "_shot/newacct-home-20261127-1430.png"
screen = cv2.imread(str(root / new))
print("newacct frame", screen.shape[1], "x", screen.shape[0])
bands = {"left": (0, 0, 400, 1280), "right": (2372, 0, 2772, 1280)}
templates = [("xiaoqiao/entry-left.png", 0.75, "entry-left"),
             ("xiaoqiao/home-avatar.png", 0.75, "home-avatar"),
             ("xiaoqiao/xiaoqiao_entry.png", 0.9, "fallback")]
print("\n=== newacct matrix ===")
for rel, th, tag in templates:
    tpl = cv2.imread(str(root / "res" / "img" / rel))
    h, w = tpl.shape[:2]
    for bname, (x1, y1, x2, y2) in bands.items():
        crop = screen[y1:y2, x1:x2]
        res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        center = (ml[0] + x1 + w // 2, ml[1] + y1 + h // 2)
        print(f"  {tag:11s}({th}) {bname:5s} score={mv:.4f} center={center} {'*** HIT ***' if mv>=th else ''}")
anchor = cv2.imread(str(root / "res/img/common/anchor-zhengzhan.png"))
ac = screen[980:1280, 2400:2772]
ra = cv2.matchTemplate(ac, anchor, cv2.TM_CCOEFF_NORMED)
_, mva, _, mla = cv2.minMaxLoc(ra)
ah, aw = anchor.shape[:2]
print(f"  anchor-zhengzhan score={mva:.4f} center={mla[0]+2400+aw//2, mla[1]+980+ah//2}")

# 五组并排（只列 fallback 左带，最有判别力）
print("\n=== fallback(left) across five groups ===")
groups = [("黄天当道 14:02", "_shot/huangtian-home-20261127-1402.png"),
          ("产品经理-浅", "_shot/daily-after-xiaoqiao-fail-20261127-1238.png"),
          ("产品经理-深", "_shot/skin-dark-home-20261127-1256.png"),
          ("昨天成功帧", "_shot/xiaoqiao-final-home.png"),
          ("新账号 14:30", new)]
ftpl = cv2.imread(str(root / "res/img/xiaoqiao/xiaoqiao_entry.png"))
for name, rel in groups:
    im = cv2.imread(str(root / rel))
    r = cv2.matchTemplate(im[0:1280, 0:400], ftpl, cv2.TM_CCOEFF_NORMED)
    _, mv, _, ml = cv2.minMaxLoc(r)
    print(f"  {name:14s} fallback(left)={mv:.4f} top-left=({ml[0]},{ml[1]}) {'HIT' if mv>=0.9 else ''}")

cv2.imwrite(str(root / "_shot/newacct-leftband.png"),
            cv2.resize(screen[300:750, 0:560], None, fx=2.5, fy=2.5, interpolation=cv2.INTER_NEAREST))
cv2.imwrite(str(root / "_shot/newacct-rightband.png"),
            cv2.resize(screen[300:1000, 2300:2772], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
print("\nsaved newacct-leftband.png / newacct-rightband.png")
