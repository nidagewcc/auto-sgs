// vision.js —— AutoX 版识别/操作封装
// EC 的 roi 是 [左,上,右,下]；AutoX 的 region 是 [x,y,宽,高]，这里做统一转换
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.vision = {
    _img: null,
    _capOk: false,

    /** 申请一次截图权限（每次启动需一次）；强制横屏，否则游戏横屏时会拿到竖屏画布 */
    init: function () {
        if (this._capOk) return true;
        try {
            try {
                this._capOk = requestScreenCapture(true);
                log("[vision] 横屏截图已申请");
            } catch (eLand) {
                this._capOk = requestScreenCapture();
                log("[vision] 横屏失败，退回默认 " + eLand);
            }
            sleep(800);
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
            this._img = captureScreen();
            return this._img;
        } catch (e) {
            log("[vision] 截图失败 " + e);
            return null;
        }
    },

    reset: function () { this._img = null; },

    /** [左,上,右,下] -> [x,y,w,h] */
    _toRegion: function (rect) {
        return [rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]];
    },

    /** 按 ROI 裁图做 OCR，返回去掉空白的文本 */
    ocrRect: function (rect, img) {
        img = img || this.frame();
        if (!img) return "";
        try {
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
            if (rect) opt.region = this._toRegion(rect);
            return images.findImage(img, tpl, opt);
        } catch (e) {
            log("[vision] find 异常 " + name + " : " + e);
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

    /** OCR 判断区域内是否含关键词 */
    hasText: function (kw, rect, img) {
        var t = this.ocrRect(rect, img);
        return String(t).indexOf(kw) >= 0;
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
