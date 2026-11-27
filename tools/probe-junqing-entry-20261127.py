# 一次性探针（2026-11-27 主城只读确认用）：
# 在指定安全区域 [650,800,1800,1180] 内对紧急军情入口模板做 OpenCV 匹配，
# 输出匹配分与中心坐标，并在截图副本上画框留证。不做全屏兜底。
# 用法：python tools/probe-junqing-entry-20261127.py
import cv2
from pathlib import Path

root = Path(__file__).resolve().parent.parent
screen_path = root / "_shot" / "home-check-20261127-1050.png"
tpl_path = root / "res" / "img" / "special_event" / "jinjijunqing.png"
out_path = root / "_shot" / "home-check-20261127-1050-match.png"

screen = cv2.imread(str(screen_path))
tpl = cv2.imread(str(tpl_path))
print("screen", None if screen is None else screen.shape)
print("template", None if tpl is None else tpl.shape)
if screen is None or tpl is None:
    raise SystemExit(1)

x1, y1, x2, y2 = 650, 800, 1800, 1180
crop = screen[y1:y2, x1:x2]
h, w = tpl.shape[:2]
if crop.shape[0] < h or crop.shape[1] < w:
    print("safe region too small for template")
    raise SystemExit(1)

res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
_, maxv, _, maxloc = cv2.minMaxLoc(res)
top_left = (maxloc[0] + x1, maxloc[1] + y1)
center = (top_left[0] + w // 2, top_left[1] + h // 2)
print("safe_region [650,800,1800,1180] score", round(float(maxv), 4))
print("top-left", top_left, "center", center, "template_size", (w, h))

annotated = screen.copy()
cv2.rectangle(annotated, top_left, (top_left[0] + w, top_left[1] + h), (0, 0, 255), 6)
cv2.putText(annotated, f"junqing {maxv:.3f}", (top_left[0], max(40, top_left[1] - 20)),
            cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
cv2.imwrite(str(out_path), annotated)
print("annotated", out_path)
