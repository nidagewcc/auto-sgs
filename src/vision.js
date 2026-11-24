// vision.js —— AutoX 版识别/操作封装
// EC 的 roi 是 [左,上,右,下]；AutoX 的 region 是 [x,y,宽,高]，这里做统一转换
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.vision = {
    _img: null,
    _capOk: false,
    _band: null,
    _scale: null,

    /** 申请一次截图权限（每次启动需一次）；强制横屏，否则游戏横屏时会拿到竖屏画布 */
    init: function () {
        if (this._capOk) return true;
        try {
            var land = false;
            if (this._landForce) {
                land = true; // 强制横屏画布（游戏横屏时用）
            } else {
                try {
                    var ori = context.getResources().getConfiguration().orientation;
                    land = (ori == android.content.res.Configuration.ORIENTATION_LANDSCAPE);
                } catch (eo) { land = (device.width > device.height); }
            }
            this._capOk = requestScreenCapture(land);
            log("[vision] 申请截图 land=" + land + " 结果=" + this._capOk);
            sleep(500);
            return this._capOk;
        } catch (e) {
            log("[vision] 截图权限异常 " + e);
            return false;
        }
    },

    /** 是否在主城：横屏 + 命中锚点 */
    isHome: function (img) {
        img = img || this.frame();
        if (!img) return false;
        if (img.getWidth() <= img.getHeight()) return false;
        var p = this.find(sgs.ANCHOR.image, sgs.ANCHOR.threshold || 0.7, sgs.ANCHOR.region, img);
        if (p) return true;
        // 兜底：region 没命中就全屏再找一次
        return !!this.find(sgs.ANCHOR.image, sgs.ANCHOR.threshold || 0.7, null, img);
    },

    /** 取一帧（内部缓存，同帧复用） */
    frame: function (force) {
        if (!force && this._img) return this._img;
        if (!this._capOk && !this.init()) return null;
        try {
            this._img = this._normalize(captureScreen());
            return this._img;
        } catch (e) {
            log("[vision] 截图失败 " + e);
            return null;
        }
    },

    /**
     * 本机 MediaProjection 固定按物理竖屏 1280x2772 建画布（requestScreenCapture 的方向参数无效），
     * 横屏游戏画面被等比缩小、垂直居中放在中间一条，上下全黑。
     * 这里把内容带裁出来并还原成 2772x1280，后续所有 ROI / 坐标都按游戏坐标走。
     */
    _normalize: function (img) {
        if (!img) return img;
        var w = img.getWidth(), h = img.getHeight();
        if (w > h) return img; // 已经是横屏画布
        try {
            if (!this._band) {
                var cx = Math.floor(w / 2);
                var top = -1, bot = -1, y, c, sum;
                for (y = 0; y < h; y++) {
                    c = images.pixel(img, cx, y);
                    sum = ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
                    if (sum > 45) { top = y; break; }
                }
                for (y = h - 1; y >= 0; y--) {
                    c = images.pixel(img, cx, y);
                    sum = ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
                    if (sum > 45) { bot = y; break; }
                }
                if (top < 0 || bot - top < 200) {
                    sgs.log.e("[vision] 未找到内容带 top=" + top + " bot=" + bot);
                    return img;
                }
                var bh = bot - top + 1;
                var bw = Math.round(bh * 2772 / 1280);
                if (bw > w) bw = w;
                this._band = { x: Math.round((w - bw) / 2), y: top, w: bw, h: bh };
                sgs.log.i("[vision] letterbox 内容带 " + JSON.stringify(this._band) + " 画布 " + w + "x" + h);
            }
            var b = this._band;
            var clip = images.clip(img, b.x, b.y, b.w, b.h);
            var rs = null;
            try {
                rs = images.resize(clip, 2772, 1280, "LINEAR");
            } catch (er1) {
                try {
                    rs = images.scale(clip, 2772 / b.w, 1280 / b.h, "LINEAR");
                } catch (er2) {
                    sgs.log.e("[vision] resize/scale 都不可用，改走坐标映射：" + er2);
                    this._scale = { x: b.w / 2772, y: b.h / 1280 };
                    rs = clip;
                }
            }
            this._normOnce = (this._normOnce || 0) + 1;
            if (this._normOnce <= 2) {
                sgs.log.i("[vision] 归一化输出 " + rs.getWidth() + "x" + rs.getHeight()
                    + (this._scale ? " (映射模式)" : " (还原模式)"));
            }
            if (!this._dbgSaved) {
                this._dbgSaved = true;
                try { images.save(img, sgs.LOG_DIR + "_raw.jpg"); } catch (e1) { sgs.log.e("[vision] save raw 失败 " + e1); }
                try { images.save(rs, sgs.LOG_DIR + "_norm.jpg"); } catch (e2) { sgs.log.e("[vision] save norm 失败 " + e2); }
            }
            return rs;
        } catch (e) {
            sgs.log.e("[vision] normalize 异常 " + e);
            return img;
        }
    },

    reset: function () { this._img = null; this._band = null; this._scale = null; },

    /** [左,上,右,下] -> [x,y,w,h] */
    _toRegion: function (rect) {
        return [rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]];
    },

    /** 游戏坐标(2772x1280) -> 当前画布坐标（仅在缩放模式需要） */
    _mapRect: function (rect) {
        if (!rect || !this._scale) return rect;
        var s = this._scale;
        return [
            Math.round(rect[0] * s.x), Math.round(rect[1] * s.y),
            Math.round(rect[2] * s.x), Math.round(rect[3] * s.y)
        ];
    },

    /** 按 ROI 裁图做 OCR，返回去掉空白的文本 */
    ocrRect: function (rect, img) {
        img = img || this.frame();
        if (!img) return "";
        try {
            rect = this._mapRect(rect);
            var w = rect[2] - rect[0];
            var h = rect[3] - rect[1];
            if (w <= 0 || h <= 0) return "";
            var clip = images.clip(img, rect[0], rect[1], w, h);
            var r = gmlkit.ocr(clip, "zh");
            var txt = r && r.text ? r.text : "";
            return String(txt).replace(/\s+/g, " ").trim();
        } catch (e) {
            log("[vision] ocrRect 异常 " + rect + " : " + e);
            return "";
        }
    },

    /** 全屏 OCR，返回整段文本 */
    ocrFull: function (img) {
        img = img || this.frame();
        if (!img) return "";
        try {
            var r = gmlkit.ocr(img, "zh");
            return r && r.text ? String(r.text) : "";
        } catch (e) {
            log("[vision] ocrFull 异常 " + e);
            return "";
        }
    },

    /** 读模板（脚本目录下 res/img/...） */
    loadTpl: function (name) {
        try {
            var p = files.cwd() + "/res/img/" + name;
            var t = images.read(p);
            if (!t) log("[vision] 模板不存在 " + p);
            return t;
        } catch (e) {
            log("[vision] 模板读取异常 " + name + " : " + e);
            return null;
        }
    },

    /** 找图：rect 为 [左,上,右,下] 或 null（全屏） */
    find: function (name, threshold, rect, img) {
        img = img || this.frame();
        if (!img) return null;
        var tpl = this.loadTpl(name);
        if (!tpl) return null;
        try {
            var opt = { threshold: threshold || sgs.THRESHOLD.image };
            // 本机 findImage 的 region 参数不可靠（会报 Path bounds must not be negative），
            // 改为先用 images.clip 裁出 ROI 再全图匹配，返回坐标补回偏移。
            var ox = 0, oy = 0, target = img;
            rect = this._mapRect(rect);
            if (rect) {
                var rw = rect[2] - rect[0], rh = rect[3] - rect[1];
                if (rw <= 0 || rh <= 0) return null;
                if (rw < tpl.getWidth() || rh < tpl.getHeight()) return null;
                target = images.clip(img, rect[0], rect[1], rw, rh);
                ox = rect[0]; oy = rect[1];
            }
            var r = images.findImage(target, tpl, opt);
            if (r) r = { x: r.x + ox, y: r.y + oy };
            return r;
        } catch (e) {
            log("[vision] find 异常 " + name + " : " + e
                + " | img=" + (img && img.getWidth ? img.getWidth() + "x" + img.getHeight() : "?")
                + " | rect=" + JSON.stringify(rect) + " | stack=" + (e && e.stack ? e.stack : "-"));
            return null;
        }
    },

    /** 点击图片中心 */
    tapImage: function (name, threshold, rect) {
        var p = this.find(name, threshold, rect);
        if (!p) return false;
        click(p.x, p.y);
        return true;
    },

    tap: function (x, y, jitter) {
        jitter = jitter === undefined ? 4 : jitter;
        var dx = Math.round((Math.random() * 2 - 1) * jitter);
        var dy = Math.round((Math.random() * 2 - 1) * jitter);
        click(x + dx, y + dy);
    },

    /** OCR 判断区域内是否含关键词（忽略空白差异，每次都取新帧） */
    hasText: function (kw, rect, img) {
        var t = this.ocrRect(rect, img || this.frame(true)).replace(/\s+/g, "");
        return t.indexOf(String(kw).replace(/\s+/g, "")) >= 0;
    },

    /** 等到区域内出现关键词 */
    waitText: function (kw, rect, timeout) {
        timeout = timeout || sgs.TIMEOUT.page;
        var t0 = new Date().getTime();
        while (new Date().getTime() - t0 < timeout) {
            if (this.hasText(kw, rect)) return true;
            sleep(600);
        }
        return false;
    },

    /** 等到图片出现，返回匹配点或 null */
    waitImage: function (name, timeout, rect, threshold) {
        timeout = timeout || sgs.TIMEOUT.page;
        var t0 = new Date().getTime();
        while (new Date().getTime() - t0 < timeout) {
            var p = this.find(name, threshold, rect, this.frame(true));
            if (p) return p;
            sleep(600);
        }
        return null;
    },

    hasImage: function (name, rect, threshold) {
        return !!this.find(name, threshold, rect, this.frame(true));
    },

    /** 点击区域中心 */
    tapRect: function (rect, jitter) {
        if (!rect) return false;
        var cx = Math.round((rect[0] + rect[2]) / 2);
        var cy = Math.round((rect[1] + rect[3]) / 2);
        this.tap(cx, cy, jitter);
        return true;
    },

    clickPointAt: function (x, y, jitter) { this.tap(x, y, jitter); },

    clickRect: function (p) { if (p) this.tap(p.x, p.y); },

    sleep: function (ms) { sleep(ms); }
};
