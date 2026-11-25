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
            this._capOk = this._autoGrant(land);
            log("[vision] 申请截图 land=" + land + " 结果=" + this._capOk);
            sleep(500);
            return this._capOk;
        } catch (e) {
            log("[vision] 截图权限异常 " + e);
            return false;
        }
    },
    /**
     * 申请截图权限，同时用无障碍把系统授权弹框点掉。
     * MediaProjection 授权框每次都会弹，坐标会随横竖屏变化，
     * 用 text("共享屏幕") 定位比死坐标可靠。
     */
    _autoGrant: function (land) {
        var th = threads.start(function () {
            try {
                for (var i = 0; i < 60; i++) {
                    sleep(300);
                    var b = null;
                    try { b = text("共享屏幕").findOnce(); } catch (e0) { b = null; }
                    if (!b) { try { b = textContains("共享屏幕").findOnce(); } catch (e1) { b = null; } }
                    if (b) {
                        var done = false;
                        try { done = b.click(); } catch (e2) { done = false; }
                        if (!done) {
                            var bb = b.bounds();
                            done = click(bb.centerX(), bb.centerY());
                        }
                        sgs.log.i("[vision] 自动点掉截图授权框 " + (done ? "成功" : "失败"));
                        return;
                    }
                }
                sgs.log.w("[vision] 18s 内没等到授权框（可能此前已授权）");
            } catch (e3) { sgs.log.w("[vision] 自动授权异常 " + e3); }
        });
        var ok = false;
        try { ok = requestScreenCapture(land); } catch (e4) { sgs.log.e("[vision] requestScreenCapture 异常 " + e4); }
        try { th.interrupt(); } catch (e5) { }
        sleep(600);
        return ok;
    },

    /** 是否在主城：横屏 + 锚点或底部菜单文字 */
    isHome: function (img) {
        img = img || this.frame();
        if (!img) return false;
        if (img.getWidth() <= img.getHeight()) return false;
        if (this.find(sgs.ANCHOR.image, sgs.ANCHOR.threshold || 0.7, sgs.ANCHOR.region, img)) return true;
        // 全屏兜底，阈值放低（面板打开时游戏压了一层暗色遮罩）
        if (this.find(sgs.ANCHOR.image, 0.55, null, img)) return true;
        // 再兜一层：读底部菜单文字
        return this.hasText(sgs.HOME_TEXT.text, sgs.HOME_TEXT.region, img);
    },

    /** 取一帧（内部缓存，同帧复用） */
    frame: function (force) {
        if (!force && this._img) return this._img;
        if (!this._capOk && !this.init()) return null;
        try {
            var raw = captureScreen();
            // AutoJs6 的 Image 背后是复用池，下一次 captureScreen 会让旧对象失效
            // （报 "图像资源已被回收"），所以拿到就立刻 clone 一份脱离池子
            try { if (raw) raw = raw.clone(); } catch (ec) { }
            this._img = this._normalize(raw);
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
                // 上下都没黑边 = 根本没有 letterbox（竖屏 app 铺满整屏），
                // 这种情况下拉伸只会把画面搞变形，直接返回原图
                if (top <= 2 && bot >= h - 3) {
                    sgs.log.i("[vision] 无黑边，不做归一化，原样返回 " + w + "x" + h);
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
                // AutoJs6: images.resize(img, size[, interpolation])，size 必须传数组
                rs = images.resize(clip, [2772, 1280], "LINEAR");
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

    /**
     * OCR 引擎自适应
     * - AutoX: gmlkit.ocr(img, "zh") -> { text }
     * - AutoJs6: ocr(img) -> string[]（文本数组），需要 join
     */
    _ocr: function (img) {
        try {
            if (typeof gmlkit !== "undefined" && gmlkit && gmlkit.ocr) {
                if (this._ocrEng === undefined) sgs.log.i("[vision] OCR 引擎 gmlkit");
                this._ocrEng = "gmlkit";
                var r1 = gmlkit.ocr(img, "zh");
                return r1 && r1.text ? String(r1.text) : "";
            }
        } catch (e1) { sgs.log.e("[vision] gmlkit.ocr 失败 " + e1); }

        try {
            if (typeof ocr !== "undefined") {
                if (this._ocrEng === undefined) sgs.log.i("[vision] OCR 引擎 ocr (AutoJs6)");
                this._ocrEng = "ocr";
                var r2 = ocr(img);
                if (r2 && r2.length !== undefined && typeof r2 !== "string") {
                    // 文本数组：按行拼回去
                    var arr = [];
                    for (var i = 0; i < r2.length; i++) arr.push(String(r2[i]));
                    return arr.join("\n");
                }
                if (typeof r2 === "string") return r2;
                if (r2 && r2.text) return String(r2.text);
                return "";
            }
        } catch (e2) { sgs.log.e("[vision] ocr() 失败 " + e2); }
        return "";
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
            return String(this._ocr(clip)).replace(/\s+/g, " ").trim();
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
            return String(this._ocr(img));
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

    /**
     * 找图：rect 为 [左,上,右,下] 或 null（全屏）
     * 平台自适应：原生 region 参数可用时直接用（AutoJs6），
     * 不可用时降级为 clip 裁 ROI + 坐标补偏移（AutoX 会报 Path bounds must not be negative）
     */
    find: function (name, threshold, rect, img) {
        img = img || this.frame();
        if (!img) return null;
        var tpl = this.loadTpl(name);
        if (!tpl) return null;
        rect = this._mapRect(rect);
        var th = threshold || sgs.THRESHOLD.image;

        // AutoJs6 要求 region 严格落在图像内部（贴边会被判 "not within the image"），收 1px
        if (rect) {
            var iw = img.getWidth(), ih = img.getHeight();
            rect = [
                Math.max(0, Math.min(rect[0], iw - 2)),
                Math.max(0, Math.min(rect[1], ih - 2)),
                Math.max(1, Math.min(rect[2], iw - 1)),
                Math.max(1, Math.min(rect[3], ih - 1))
            ];
            if (rect[2] - rect[0] < 2 || rect[3] - rect[1] < 2) return null;
        }

        // 原生 region 一律不用：AutoJs6 把数组按 [x,y,w,h] 解释且禁止贴边，
        // 校验文案和实际语义对不上，试探成本太高。统一走 clip 裁 ROI，两平台都稳。
        if (rect && this._regionOk !== false) {
            try {
                var hit = images.findImage(img, tpl, {
                    threshold: th,
                    region: [rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]]
                });
                if (this._regionOk === undefined) {
                    this._regionOk = true;
                    sgs.log.i("[vision] 原生 region 可用");
                }
                return hit ? { x: hit.x, y: hit.y } : null;
            } catch (er) {
                this._regionOk = false;
                sgs.log.i("[vision] 原生 region 不可用，降级 clip 模式：" + er);
            }
        }

        try {
            var ox = 0, oy = 0, target = img;
            if (rect) {
                var rw = rect[2] - rect[0], rh = rect[3] - rect[1];
                if (rw <= 0 || rh <= 0) return null;
                if (rw < tpl.getWidth() || rh < tpl.getHeight()) return null;
                target = images.clip(img, rect[0], rect[1], rw, rh);
                ox = rect[0]; oy = rect[1];
            }
            var r = images.findImage(target, tpl, { threshold: th });
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
