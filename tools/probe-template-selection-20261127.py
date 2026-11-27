# 一次性探针（2026-11-27 小乔入口模板离线选型）：
# 从主公信息弹窗帧（压暗背景、控件圆边清晰）裁 3 个候选模板，与现状 2 个模板对照，
# 在正样本（控件在）/负样本（控件不在）帧的左侧带 [0,0,400,1280] 内打分，
# 输出每候选的正样本最低分、负样本最高分、分离带，数据选型。禁止全屏匹配。纯离线。
import cv2
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
popup = cv2.imread(str(root / "_shot" / "playerinfo-popup-20261127.png"))
out_dir = root / "_shot" / "tpl-candidates"
out_dir.mkdir(exist_ok=True)

# 控件实测 bbox (0,419)-(71,558)，圆边头像。三个候选裁剪框
candidates = {
    "C1-tight-round": (0, 408, 82, 566),      # 紧贴圆框，最少黑边
    "C2-narrow-black": (0, 398, 100, 578),    # 带窄黑边
    "C3-edge-only": (0, 408, 82, 566),        # 同 C1，匹配时走 Canny 边缘
}
saved = {}
for name, (x1, y1, x2, y2) in candidates.items():
    crop = popup[y1:y2, x1:x2]
    if name == "C3-edge-only":
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        tpl = cv2.Canny(gray, 60, 160)
    else:
        tpl = crop
    cv2.imwrite(str(out_dir / f"{name}.png"), tpl)
    saved[name] = tpl
    print(f"{name}: tpl size {tpl.shape[1]}x{tpl.shape[0]} rect={[x1,y1,x2,y2]}")

# 现状模板
baseline = {
    "BASE-entry-left": cv2.imread(str(root / "res/img/xiaoqiao/entry-left.png")),
    "BASE-fallback": cv2.imread(str(root / "res/img/xiaoqiao/xiaoqiao_entry.png")),
}
all_tpls = {**saved, **baseline}

# 正样本：控件在左缘；负样本：产品经理账号控件不在
frames = {
    "POS popup-1414": ("_shot/playerinfo-popup-20261127.png", True),
    "POS huangtian-1402": ("_shot/huangtian-home-20261127-1402.png", True),
    "POS yesterday-2058": ("_shot/xiaoqiao-final-home.png", True),
    "POS selfcheck-1414": ("_shot/selfcheck-20261127-1414.png", True),
    "NEG product-light": ("_shot/daily-after-xiaoqiao-fail-20261127-1238.png", False),
    "NEG product-dark": ("_shot/skin-dark-home-20261127-1256.png", False),
}
band = (0, 0, 400, 1280)

print("\n=== score matrix (left band only) ===")
summary = {}
for tname, tpl in all_tpls.items():
    row = {}
    for fname, (rel, pos) in frames.items():
        img = cv2.imread(str(root / rel))
        x1, y1, x2, y2 = band
        crop = img[y1:y2, x1:x2]
        if tname == "C3-edge-only":
            crop = cv2.Canny(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), 60, 160)
        if crop.shape[0] < tpl.shape[0] or crop.shape[1] < tpl.shape[1]:
            row[fname] = None; continue
        res = cv2.matchTemplate(crop, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        row[fname] = float(mv)
    pos_scores = [v for (k, v) in row.items() if k.startswith("POS") and v is not None]
    neg_scores = [v for (k, v) in row.items() if k.startswith("NEG") and v is not None]
    pmin, nmax = min(pos_scores), max(neg_scores)
    summary[tname] = (pmin, nmax, pmin - nmax)
    print(f"\n{tname}:")
    for k, v in row.items():
        print(f"   {k:22s} {v:.4f}" if v is not None else f"   {k}: n/a")
    print(f"   >> POS min={pmin:.4f}  NEG max={nmax:.4f}  separation={pmin-nmax:.4f}")

print("\n=== ranking by separation (wider is better) ===")
for tname, (pmin, nmax, sep) in sorted(summary.items(), key=lambda kv: -kv[1][2]):
    print(f"  {tname:18s} separation={sep:+.4f}  (posMin {pmin:.3f} / negMax {nmax:.3f})")
