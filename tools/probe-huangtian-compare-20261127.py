# 一次性探针（2026-11-27 切回黄天当道后的三方对照）：
# 新主城帧上跑小乔三模板×两侧带矩阵 + 锚点分，并与产品经理浅/深皮肤两组数据对照。纯离线。
import cv2
from pathlib import Path

root = Path(__file__).resolve().parent.parent
frames = {
    "黄天当道 14:02": "_shot/huangtian-home-20261127-1402.png",
    "产品经理-浅色 12:38": "_shot/daily-after-xiaoqiao-fail-20261127-1238.png",
    "产品经理-深色 12:56": "_shot/skin-dark-home-20261127-1256.png",
}
bands = {"left": (0, 0, 400, 1280), "right": (2372, 0, 2772, 1280)}
templates = [
    ("xiaoqiao/entry-left.png", 0.75, "entry-left"),
    ("xiaoqiao/home-avatar.png", 0.75, "home-avatar"),
    ("xiaoqiao/xiaoqiao_entry.png", 0.9, "fallback"),
]

for fname, rel in frames.items():
    screen = cv2.imread(str(root / rel))
    print(f"\n########## {fname} ({screen.shape[1]}x{screen.shape[0]}) ##########")
    for trel, th, tag in templates:
        tpl = cv2.imread(str(root / "res" / "img" / trel))
        h, w = tpl.shape[:2]
        for bname, (x1, y1, x2, y2) in bands.items():
            crop = screen[y1:y2, x1:x2]
            res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
            _, mv, _, ml = cv2.minMaxLoc(res)
            center = (ml[0] + x1 + w // 2, ml[1] + y1 + h // 2)
            hit = " *** HIT ***" if mv >= th else ""
            print(f"  {tag:11s}({th}) {bname:5s} score={mv:.4f} center={center}{hit}")
    anchor = cv2.imread(str(root / "res" / "img" / "common" / "anchor-zhengzhan.png"))
    ac = screen[980:1280, 2400:2772]
    ra = cv2.matchTemplate(ac, anchor, cv2.TM_CCOEFF_NORMED)
    _, mva, _, mla = cv2.minMaxLoc(ra)
    ah, aw = anchor.shape[:2]
    print(f"  anchor-zhengzhan ROI score={mva:.4f} center={mla[0]+2400+aw//2, mla[1]+980+ah//2}")

# 新帧侧带裁剪
new = cv2.imread(str(root / rel if False else str(root / frames["黄天当道 14:02"])))
cv2.imwrite(str(root / "_shot" / "huangtian-leftband.png"),
            cv2.resize(new[300:750, 0:560], None, fx=2.5, fy=2.5, interpolation=cv2.INTER_NEAREST))
cv2.imwrite(str(root / "_shot" / "huangtian-rightband.png"),
            cv2.resize(new[300:1000, 2300:2772], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
print("\nsaved huangtian-leftband.png / huangtian-rightband.png")
