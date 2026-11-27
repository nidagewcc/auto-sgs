# 一次性探针（2026-11-27 小乔失败归因）：
# 在失败现场截图上，用生产代码的三个小乔入口模板与两条搜索带做匹配，
# 输出各模板最高得分，与生产阈值 0.75/0.9 对比，判断是头像不在屏还是阈值回归。纯离线。
import cv2
from pathlib import Path

root = Path(__file__).resolve().parent.parent
screen = cv2.imread(str(root / "_shot" / "daily-after-xiaoqiao-fail-20261127-1238.png"))
print("screen", screen.shape[1], "x", screen.shape[0])
bands = {"left[0,0,400,1280]": (0, 0, 400, 1280),
         "right[2372,0,2772,1280]": (2372, 0, 2772, 1280)}
templates = {
    "entry-left.png (TH 0.75)": ("xiaoqiao/entry-left.png", 0.75),
    "home-avatar.png (TH 0.75)": ("xiaoqiao/home-avatar.png", 0.75),
    "xiaoqiao_entry.png fallback (TH 0.9)": ("xiaoqiao/xiaoqiao_entry.png", 0.9),
}
for tname, (rel, th) in templates.items():
    tpl = cv2.imread(str(root / "res" / "img" / rel))
    if tpl is None:
        print(tname, "TEMPLATE MISSING"); continue
    th_h, th_w = tpl.shape[:2]
    for bname, (x1, y1, x2, y2) in bands.items():
        crop = screen[y1:y2, x1:x2]
        if crop.shape[0] < th_h or crop.shape[1] < th_w:
            print(f"{tname} | {bname}: band too small"); continue
        res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        center = (ml[0] + x1 + th_w // 2, ml[1] + y1 + th_h // 2)
        verdict = "HIT" if mv >= th else "below threshold"
        print(f"{tname} | {bname}: score={mv:.4f} (th {th}) center={center} -> {verdict}")
