// ===== bundle 引导：eval 环境自动落地为文件并重启 =====
var __SELF = "/storage/emulated/0/脚本/auto-sgs/_main.js";
var __SRC = String(engines.myEngine().getSource());

if (__SRC.indexOf("_main.js") < 0) {
    // 第一遍（由 bootstrap eval 进来）：把完整代码写进手机文件，然后交给新引擎，自己自然结束
    try {
        var __r = http.get("http://192.168.2.250:8099/src/main.js?t=" + new Date().getTime(), { timeout: 20000 });
        var __code = __r.body.string();
        files.createWithDirs(__SELF);
        files.write(__SELF, __code);
        toast("已落地到手机，正在启动");
        sleep(400);
        engines.execScriptFile(__SELF);
    } catch (__e) {
        toast("落地失败 " + __e);
        log("落地失败 " + __e);
    }
} else {

// ===== 日志与回传 =====
sgs = (typeof sgs === "undefined") ? {} : sgs;
var LOGS = [];
var pushedIdx = 0;

sgs.log = {
    i: function (m) { var s = "[I] " + m; LOGS.push(s); log(s); },
    w: function (m) { var s = "[W] " + m; LOGS.push(s); log(s); },
    e: function (m) { var s = "[E] " + m; LOGS.push(s); log(s); }
};

sgs.pushLog = function () {
    if (pushedIdx >= LOGS.length) return;
    var chunk = LOGS.slice(pushedIdx).join("\n");
    pushedIdx = LOGS.length;
    try { http.post(sgs.PC + "/log", chunk, { timeout: 15000 }); } catch (e) { log("pushLog 失败 " + e); }
};

sgs.pushShot = function () {
    try {
        var im = sgs.vision ? sgs.vision.frame(true) : null;
        if (!im) return;
        var b64 = images.toBase64(im, "jpg", 55);
        http.post(sgs.PC + "/shot", b64, { timeout: 180000 });
    } catch (e) {
        sgs.log.e("截图回传失败 " + e);
    }
};


// ===== src/config.js =====

// config.js —— 常量与 ROI（坐标与 EC 版一致，横屏 2772x1280）
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.PC = "http://192.168.2.250:8099";
sgs.SCREEN = { width: 2772, height: 1280 };

// ROI 统一用 [左, 上, 右, 下]
sgs.ROI = {
    playerInfo: {
        nickname: [235, 10, 480, 75],
        level: [1090, 500, 1280, 570],
        combat_power: [320, 120, 500, 192],
        physical: [1430, 0, 1780, 75],
        energy: [1780, 0, 2100, 75],
        sycee: [2210, 0, 2430, 75],
        jade: [2530, 0, 2772, 75]
    }
};

sgs.ANCHOR = { image: "common/anchor-zhengzhan.png", region: [2400, 980, 2772, 1280] };
sgs.THRESHOLD = { image: 0.8, weak: 0.7 };
sgs.TIMEOUT = { ui: 3000, page: 8000, task: 300000 };
sgs.LOG_DIR = "/sdcard/Download/autosgs-logs/";


// ===== src/vision.js =====

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
            if (name.indexOf("anchor") >= 0) {
                sgs.log.i("[dbg] anchor img=" + img.getWidth() + "x" + img.getHeight()
                    + " tpl=" + tpl.getWidth() + "x" + tpl.getHeight()
                    + " rect=" + JSON.stringify(rect) + " -> " + (r ? (r.x + "," + r.y) : "null"));
            }
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


// ===== src/game.js =====

// game.js —— 游戏启动与主城检测
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.game = {
    PKG: "com.sanguosha.mjz.mi",

    /** 确保在游戏主城；返回 true/false */
    ensure: function (maxMs) {
        maxMs = maxMs || 120000;
        var v = sgs.vision;

        // 关键：游戏是横屏 app。必须先把游戏拉到前台再申请截图，
        // 否则脚本在 AutoX 竖屏界面启动，画布会被建成 1280x2772，之后永远错位。
        var cur = "";
        try { cur = currentPackage(); } catch (e) { cur = ""; }
        if (cur !== this.PKG) {
            sgs.log.i("前台 " + cur + "，先拉起游戏 " + this.PKG);
            try { app.launchPackage(this.PKG); } catch (e) { sgs.log.e("启动失败 " + e); }
            sleep(4000);
        }

        // 按当前（游戏横屏）方向重建画布
        v._capOk = false;
        v.reset();
        v._landForce = false;
        if (!v.init()) throw new Error("截图权限失败");

        var im = v.frame(true);
        if (im && v.isHome(im)) {
            sgs.log.i("已在主城，无需拉起");
            return true;
        }
        sgs.log.i("游戏已在前台，等待主城");
        return this.waitHome(maxMs);
    },

    waitHome: function (maxMs) {
        var v = sgs.vision;
        var t0 = new Date().getTime();
        var n = 0;
        var notLand = 0;
        while (new Date().getTime() - t0 < maxMs) {
            sleep(2500);
            n++;
            var im = v.frame(true);
            if (!im) {
                sgs.log.i("第" + n + "次 截图为空");
                continue;
            }
            var w = im.getWidth();
            var h = im.getHeight();
            if (w > h) {
                notLand = 0;
                var p = v.find(sgs.ANCHOR.image, 0.72, sgs.ANCHOR.region, im);
                if (p) {
                    sgs.log.i("到主城 " + Math.round((new Date().getTime() - t0) / 1000) + "s");
                    return true;
                }
                sgs.log.i("第" + n + "次 未命中锚点");
            } else {
                notLand++;
                sgs.log.i("第" + n + "次 竖屏画布 " + w + "x" + h + "（连续" + notLand + "）");
                if (notLand >= 3) {
                    sgs.log.i("重新申请横屏截图（强制横屏）");
                    v._capOk = false;
                    v.reset();
                    v._landForce = true;
                    v.init();
                    notLand = 0;
                }
            }
        }
        sgs.log.e("未见主城");
        return false;
    }
};


// ===== src/tasks/playerinfo.js =====

// tasks/playerinfo.js —— 玩家信息读取（AutoX 移植版）
// 稳定性改造：一个字段连取多帧 OCR 后投票，解决 level 偶发读成 920/20、昵称「血→合」这类抖动
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.playerinfo = {
    id: "playerinfo",
    name: "玩家信息读取",

    // 主城可直接读到的 7 个字段
    FIELDS: [
        { key: "nickname", parser: "text" },
        { key: "level", parser: "level" },
        { key: "combat_power", parser: "text" },
        { key: "physical", parser: "fraction" },
        { key: "energy", parser: "fraction" },
        { key: "sycee", parser: "int" },
        { key: "jade", parser: "int" }
    ],

    // 这些字段历史上抖动过，多帧投票；其余单帧即可
    UNSTABLE: { level: 1, nickname: 1, physical: 1, energy: 1 },

    SAMPLES: 3,

    run: function () {
        var v = sgs.vision;
        var roi = sgs.ROI.playerInfo;
        var out = {};

        if (!v.init()) throw new Error("截图权限获取失败");

        // 先连取 SAMPLES 帧：第 1 帧给所有字段，后两帧只补不稳定字段
        var imgs = [];
        for (var k = 0; k < this.SAMPLES; k++) {
            var f = v.frame(true);
            if (f) imgs.push(f);
            if (k < this.SAMPLES - 1) sleep(220);
        }
        if (!imgs.length) throw new Error("截图失败");
        var img = imgs[0];
        sgs.log.i("画面 " + img.getWidth() + "x" + img.getHeight() + " / 取帧 " + imgs.length);

        for (var i = 0; i < this.FIELDS.length; i++) {
            var fd = this.FIELDS[i];
            var rect = roi[fd.key];
            var tries = this.UNSTABLE[fd.key] ? imgs.length : 1;
            var raws = [];
            var vals = [];
            for (var t = 0; t < tries; t++) {
                var raw = v.ocrRect(rect, imgs[t]);
                raws.push(raw);
                vals.push(this._parse(fd.parser, raw));
            }
            var chosen = this._pick(fd.parser, vals, raws);
            out[fd.key] = { raw: chosen.raw, value: chosen.value, samples: raws };
            if (chosen.value === null) {
                sgs.log.e(fd.key + " 解析失败 原文=" + JSON.stringify(raws));
            } else {
                sgs.log.i(fd.key + " = " + JSON.stringify(chosen.value) + " 原文=" + JSON.stringify(raws));
            }
        }
        return out;
    },

    /** 多帧投票选值：票多者胜；level 平票时取位数多的 */
    _pick: function (type, vals, raws) {
        var cnt = {}, first = {};
        for (var i = 0; i < vals.length; i++) {
            if (vals[i] === null) continue;
            var key = JSON.stringify(vals[i]);
            cnt[key] = (cnt[key] || 0) + 1;
            if (!first[key]) first[key] = { value: vals[i], raw: raws[i] };
        }
        var keys = [];
        for (var kk in cnt) { if (cnt.hasOwnProperty(kk)) keys.push(kk); }
        if (!keys.length) return { value: null, raw: raws.length ? raws[0] : "" };

        var bestKey = keys[0];
        for (var j = 1; j < keys.length; j++) {
            var kj = keys[j];
            if (cnt[kj] > cnt[bestKey]) { bestKey = kj; continue; }
            if (cnt[kj] < cnt[bestKey]) continue;
            if (type === "level") {
                var lj = String(first[kj].value).length;
                var lb = String(first[bestKey].value).length;
                if (lj > lb) bestKey = kj;
            }
        }
        return first[bestKey];
    },

    _parse: function (type, raw) {
        var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
        if (type === "text") return s === "" ? null : s;

        if (type === "level") {
            // 「120级」常被认成 920 / 20 / 12093：去空白、统一「級」、只取首段 1~4 位数字再截 3 位
            var t0 = s.replace(/\s+/g, "").replace(/級/g, "级");
            var m0 = t0.match(/(\d{1,4})/);
            if (!m0) return null;
            var n0 = m0[1];
            if (n0.length > 3) n0 = n0.substring(0, 3);
            var i0 = parseInt(n0, 10);
            if (isNaN(i0) || i0 <= 0) return null;
            return i0;
        }

        if (type === "int") {
            var m1 = s.replace(/[,\s]/g, "").match(/(\d+)/);
            return m1 ? parseInt(m1[1], 10) : null;
        }

        if (type === "fraction") {
            // 「精力32/30」这类前后带字的原文也能取到数字对
            var m2 = s.replace(/\s+/g, "").match(/(\d+)\s*\/\s*(\d+)/);
            return m2 ? { current: parseInt(m2[1], 10), max: parseInt(m2[2], 10) } : null;
        }

        return s === "" ? null : s;
    }
};


// ===== src/tasks/mail.js =====

// tasks/mail.js —— 邮件全部领取（AutoX 版，流程与 EC 版一致）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.mail = {
    id: "mail",
    name: "邮件全部领取",

    ENTRY: "daily_task/youjian.png",
    ENTRY_REGION: [60, 150, 520, 400],
    CLAIM: "daily_task/quanbulingqu.png",
    CLAIM_REGION: [400, 900, 1000, 1200],
    CLOSE: "daily_task/close.png",
    CLOSE_REGION: [2200, 80, 2500, 360],
    REWARD: "daily_task/reward_popup.png",
    REWARD_REGION: [900, 80, 1900, 330],
    DISMISS: [1386, 1180],

    run: function () {
        var v = sgs.vision;

        // 1) 打开邮件弹窗
        var opened = false;
        for (var i = 1; i <= 3; i++) {
            if (v.tapImage(this.ENTRY, 0.8, this.ENTRY_REGION)) {
                sgs.log.i("点击邮件入口（第 " + i + " 轮）");
                if (v.waitImage(this.CLOSE, sgs.TIMEOUT.page, this.CLOSE_REGION, 0.8)) {
                    opened = true;
                    break;
                }
            }
            sleep(600);
        }
        if (!opened) throw new Error("未找到邮件入口或弹窗未打开");
        sgs.log.i("邮件弹窗已打开");

        // 2) 全部领取
        var claim = v.find(this.CLAIM, 0.8, this.CLAIM_REGION, v.frame(true));
        if (claim) {
            v.clickRect(claim);
            sgs.log.i("已点击全部领取");

            // 领到附件会弹「恭喜获得」浮层，必须先点掉，否则会截获后面的关闭点击
            if (v.waitImage(this.REWARD, 1500, this.REWARD_REGION, 0.75)) {
                v.clickPointAt(this.DISMISS[0], this.DISMISS[1], 8);
                sgs.log.i("已点掉奖励浮层");
                sleep(400);
            }
            if (!v.waitImage(this.CLOSE, sgs.TIMEOUT.ui, this.CLOSE_REGION, 0.8)) {
                throw new Error("点击全部领取后弹窗状态异常");
            }
        } else {
            sgs.log.i("未检测到全部领取按钮，无可领取内容");
        }

        // 3) 关闭弹窗，确认回主城
        var closed = false;
        for (var j = 1; j <= 3; j++) {
            if (v.tapImage(this.CLOSE, 0.8, this.CLOSE_REGION)) {
                var t0 = new Date().getTime();
                while (new Date().getTime() - t0 < sgs.TIMEOUT.ui) {
                    if (!v.hasImage(this.CLOSE, this.CLOSE_REGION, 0.8)) {
                        closed = true;
                        break;
                    }
                    sleep(600);
                }
                if (closed) break;
            }
        }
        if (!closed) throw new Error("邮件弹窗未能关闭");

        var home = v.waitImage(sgs.ANCHOR.image, sgs.TIMEOUT.ui, sgs.ANCHOR.region, 0.72);
        if (!home) throw new Error("关闭弹窗后未确认回到主城");
        sgs.log.i("邮件任务完成");
    }
};


// ===== src/tasks/xiaoqiao.js =====

// tasks/xiaoqiao.js —— 主城小乔·一键日常（AutoX 版）
// 注意：点「开启」会花元宝买体力/精力丹，属预期行为（EC 版实测消耗约 80）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.xiaoqiao = {
    id: "xiaoqiao",
    name: "主城小乔·一键日常",

    ENTRY: "xiaoqiao/entry-left.png",
    ENTRY_LEFT: [0, 380, 150, 600],
    ENTRY_RIGHT: [2400, 480, 2772, 780],
    ENTRY_RIGHT_TPL: "xiaoqiao/home-avatar.png",
    ENTRY_TH: 0.75,
    AVATAR_POINT: [38, 485], // 左侧头像被屏幕边缘裁掉一半，点击用固定坐标更稳

    TAB_TEXT: "日常功能",
    TAB_CHECK: "日常", // OCR 常把「功」认成「劝」，判断时用短词
    TAB_REGION: [1820, 390, 2090, 535],

    KAIQI: "xiaoqiao/kaiqi.png",
    KAIQI_REGION: [1800, 700, 2150, 1050],
    KAIQI_POINT: [1900, 940], // 图识别兜底 + 实际点击点：日常功能页右下角「开启」中心
    KAIQI_TH: 0.8,

    COMPLETION_REGION: [860, 1060, 1980, 1165],
    REWARD_REGION: [950, 70, 1850, 260],
    BLANK_TAP: [400, 640],
    RESULT_CLOSE: [1940, 88],
    PANEL_CLOSE: [2127, 235],
    AGAIN_REGION: [875, 530, 1870, 675],
    CONFIRM_REGION: [1430, 800, 1800, 925],

    POLL_MS: 8000,
    RUN_TIMEOUT: 420000,

    _findAvatar: function () {
        var v = sgs.vision;
        var p = v.find(this.ENTRY, this.ENTRY_TH, this.ENTRY_LEFT, v.frame(true));
        if (p) return p;
        return v.find(this.ENTRY_RIGHT_TPL, this.ENTRY_TH, this.ENTRY_RIGHT, v.frame(true));
    },

    _done: function () {
        var v = sgs.vision;
        var im = v.frame(true);
        // 结果窗底部绿条（实测 RGB #80CF4C）：OCR 读不出描边字，改判颜色
        try {
            var b = this.COMPLETION_REGION;
            var c = images.clip(im, b[0], b[1], b[2] - b[0], b[3] - b[1]);
            if (images.findColor(c, "#80CF4C", { threshold: 60 })) return true;
        } catch (e) { }
        return false;
    },

    _findReward: function () {
        var v = sgs.vision;
        return v.hasText("恭喜获得", this.REWARD_REGION) || v.hasText("贡献获得", this.REWARD_REGION);
    },

    _panelOpen: function () {
        return sgs.vision.hasImage(this.KAIQI, this.KAIQI_REGION, this.KAIQI_TH);
    },

    _openPanel: function () {
        var v = sgs.vision;
        // 主城能识别到头像 → 面板没开，点它；识别不到 → 视为面板已打开
        var avatar = this._findAvatar();
        if (!avatar) {
            sgs.log.i("未找到小乔头像，视为助手面板已打开");
            return;
        }
        v.clickPointAt(this.AVATAR_POINT[0], this.AVATAR_POINT[1]);
        sgs.log.i("已点击小乔头像 (" + this.AVATAR_POINT[0] + "," + this.AVATAR_POINT[1] + ") 匹配点 " + avatar.x + "," + avatar.y);
        sleep(1800);
    },

    _openDailyTab: function () {
        var v = sgs.vision;
        for (var t = 1; t <= 3; t++) {
            v.tapRect(this.TAB_REGION);
            sgs.log.i("点击「日常功能」Tab（第 " + t + " 轮）");
            sleep(1500);
            var btn = v.waitImage(this.KAIQI, 4000, this.KAIQI_REGION, this.KAIQI_TH);
            if (btn) { sgs.log.i("已识别到「开启」按钮"); return btn; }
            sgs.log.w("第 " + t + " 轮图识别未命中");
        }
        sgs.log.w("图识别 3 轮均失败，改用固定坐标 " + this.KAIQI_POINT);
        return { x: this.KAIQI_POINT[0], y: this.KAIQI_POINT[1] };
    },

    _closeResult: function () {
        var v = sgs.vision;
        sleep(800);

        // 1) 奖励弹窗：点空白优先，右上 X 兜底
        for (var r = 1; r <= 3 && this._findReward(); r++) {
            v.clickPointAt(this.BLANK_TAP[0], this.BLANK_TAP[1]);
            var d1 = new Date().getTime();
            while (new Date().getTime() - d1 < sgs.TIMEOUT.ui && this._findReward()) sleep(700);
            sgs.log.i("奖励弹窗空白关闭第 " + r + " 轮，仍在=" + this._findReward());
        }
        if (this._findReward()) {
            sgs.log.e("空白点击无效，兜底点右上 X");
            for (var x = 1; x <= 3 && this._findReward(); x++) {
                v.clickPointAt(this.RESULT_CLOSE[0], this.RESULT_CLOSE[1]);
                var d2 = new Date().getTime();
                while (new Date().getTime() - d2 < sgs.TIMEOUT.ui && this._findReward()) sleep(700);
            }
            if (this._findReward()) throw new Error("奖励弹窗未能关闭");
        }

        // 2) 旧版「执行完成」结果窗
        for (var c = 1; c <= 3 && this._done(); c++) {
            v.clickPointAt(this.RESULT_CLOSE[0], this.RESULT_CLOSE[1]);
            var d3 = new Date().getTime();
            while (new Date().getTime() - d3 < sgs.TIMEOUT.ui && this._done()) sleep(700);
        }

        // 3) 助手面板金色 X
        for (var p = 1; p <= 3; p++) {
            if (!this._panelOpen() && sgs.vision.isHome()) {
                sgs.log.i("已确认回到主城");
                return;
            }
            if (this._panelOpen()) {
                v.clickPointAt(this.PANEL_CLOSE[0], this.PANEL_CLOSE[1]);
                sgs.log.i("点击面板关闭（第 " + p + " 轮）");
                var d4 = new Date().getTime();
                while (new Date().getTime() - d4 < sgs.TIMEOUT.ui && this._panelOpen()) sleep(700);
            } else {
                sleep(700);
            }
        }
        if (!sgs.vision.isHome()) throw new Error("面板未能关闭并回到主城");
        sgs.log.i("已确认回到主城");
    },

    run: function () {
        var v = sgs.vision;

        this._openPanel();
        var btn = this._openDailyTab();
        sgs.log.i("「日常功能」页就绪");

        v.clickPointAt(this.KAIQI_POINT[0], this.KAIQI_POINT[1]);
        sgs.log.i("已点击「开启」，每 " + (this.POLL_MS / 1000) + " 秒轮询，超时 " +
            Math.round(this.RUN_TIMEOUT / 1000) + " 秒");

        var deadline = new Date().getTime() + this.RUN_TIMEOUT;
        var againConfirmed = false;
        while (new Date().getTime() < deadline) {
            if (this._findReward()) {
                sgs.log.i("识别到完成弹窗");
                this._closeResult();
                return;
            }
            if (this._done()) {
                sgs.log.i("识别到「执行完成」绿条");
                this._closeResult();
                return;
            }
            if (!againConfirmed && v.hasText("再次执行", this.AGAIN_REGION)) {
                if (!v.waitText("确认", this.CONFIRM_REGION, sgs.TIMEOUT.page)) {
                    throw new Error("「再次执行」弹窗未识别到确认");
                }
                v.tapRect(this.CONFIRM_REGION);
                againConfirmed = true;
                deadline = new Date().getTime() + this.RUN_TIMEOUT;
                sgs.log.i("已确认「再次执行」，重新计时");
            }
            var remain = deadline - new Date().getTime();
            sleep(Math.min(this.POLL_MS, remain > 0 ? remain : 1));
        }
        throw new Error("未识别到完成信号");
    }
};

// 诊断任务：查看结果区 OCR 原文与颜色
sgs.tasks.diag = {
    id: "diag", name: "诊断",
    run: function () {
        var v = sgs.vision;
        var im = v.frame(true);
        sgs.log.i("[diag] 帧 " + im.getWidth() + "x" + im.getHeight() + " scale=" + JSON.stringify(v._scale));
        var zones = {
            big: [860, 1060, 1980, 1165],
            tight: [1280, 1075, 1460, 1145],
            small: [1190, 1070, 1580, 1155]
        };
        for (var k in zones) {
            try { sgs.log.i("[diag] " + k + " 原文=「" + v.ocrRect(zones[k], im) + "」"); }
            catch (e) { sgs.log.e("[diag] " + k + " 异常 " + e); }
        }
        try {
            var b = [860, 1060, 1980, 1165];
            var c = images.clip(im, b[0], b[1], b[2] - b[0], b[3] - b[1]);
            var p = images.findColor(c, "#3CC83C", { threshold: 80 });
            sgs.log.i("[diag] 绿色命中 " + (p ? p.x + "," + p.y : "null"));
        } catch (e2) { sgs.log.e("[diag] findColor 异常 " + e2); }
    }
};


// ===== src/ui.js =====

// ui.js —— 悬浮球 / 快捷圆盘 / 完整面板
// 纯 Java View + WindowManager 直挂（floaty 在本机不可用，会 NPE）
// 颜色统一走 hex()：Rhino 把 0xFFxxxxxx 当大数传 int 会溢出，必须转有符号 int
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.ui = {
    _wm: null, _main: null, _ctx: null, dp: 1,

    ballView: null, ballLp: null,
    dockView: null,
    panelView: null, _statusTv: null, _logTv: null,

    _thread: null, _t0: 0, _tick: null, _lastResult: "",

    C: {
        ballOff: "FF121821", ballOn: "FF3A2410",
        gold: "FFE8B349", goldDim: "FF7C6027",
        bg: "FF0B0F14", card: "FF161C24", line: "FF232B35",
        text: "FFEDF1F5", sub: "FF8A94A2",
        ok: "FF3DDC84", busy: "FFFF9A3C", danger: "FFE05555"
    },

    TASKS: [
        { id: "playerinfo", icon: "人", title: "读取玩家信息", desc: "昵称 · 等级 · 战力 · 资源", color: "FF2B6CB0" },
        { id: "mail", icon: "邮", title: "邮件全部领取", desc: "领完并关闭弹窗回主城", color: "FF2F7A57" },
        { id: "xiaoqiao", icon: "乔", title: "小乔 · 一键日常", desc: "开启日常并等完成（耗元宝）", color: "FF6C4FA8" },
        { id: "daily", icon: "全", title: "一键日常", desc: "邮件 → 小乔，依次跑完", color: "FFB8862B" },
        { id: "shot", icon: "图", title: "截屏回传", desc: "把当前画面发到电脑", color: "FF46566B" }
    ],

    // ---------------- 基础设施 ----------------
    _init: function () {
        this._ctx = context;
        this.dp = context.getResources().getDisplayMetrics().density;
        this._wm = context.getSystemService(android.content.Context.WINDOW_SERVICE);
        this._main = new android.os.Handler(android.os.Looper.getMainLooper());
    },

    _post: function (fn) {
        if (!this._main) this._init();
        try {
            this._main.post(new java.lang.Runnable({
                run: function () {
                    try { fn(); } catch (e) {
                        try { sgs.log.e("UI异常 " + e); } catch (e2) { }
                    }
                }
            }));
        } catch (e) {
            try { sgs.log.e("post 失败 " + e); } catch (e2) { }
        }
    },

    px: function (v) { return Math.round(v * this.dp); },

    hex: function (h) {
        var v = parseInt(String(h).replace("#", ""), 16);
        if (v > 2147483647) v = v - 4294967296;
        return v;
    },

    _lp: function (w, h, x, y, gravity) {
        var lp = new android.view.WindowManager.LayoutParams();
        lp.type = android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        lp.format = android.graphics.PixelFormat.RGBA_8888;
        lp.flags = android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            | android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED;
        lp.gravity = gravity || (android.view.Gravity.BOTTOM | android.view.Gravity.END);
        lp.x = x; lp.y = y;
        lp.width = w; lp.height = h;
        return lp;
    },

    _shape: function (fillHex, strokeHex, strokeDp, radiusDp) {
        var gd = new android.graphics.drawable.GradientDrawable();
        if (radiusDp === -1) {
            gd.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        } else {
            gd.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE);
            gd.setCornerRadius(this.px(radiusDp));
        }
        gd.setColor(this.hex(fillHex));
        if (strokeHex) gd.setStroke(this.px(strokeDp), this.hex(strokeHex));
        return gd;
    },

    _tv: function (txt, sizeSp, colorHex, bold) {
        var tv = new android.widget.TextView(this._ctx);
        tv.setText(txt);
        tv.setTextSize(sizeSp);
        tv.setTextColor(this.hex(colorHex));
        tv.setIncludeFontPadding(false);
        tv.setGravity(android.view.Gravity.CENTER_VERTICAL);
        if (bold) tv.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return tv;
    },

    _v: function (w, h) {
        var v = new android.view.View(this._ctx);
        v.setLayoutParams(new android.widget.LinearLayout.LayoutParams(w, h));
        return v;
    },

    _margins: function (v, l, t, r, b) {
        var lp = v.getLayoutParams();
        if (!lp) lp = new android.widget.LinearLayout.LayoutParams(-2, -2);
        lp.setMargins(this.px(l), this.px(t), this.px(r), this.px(b));
        v.setLayoutParams(lp);
        return v;
    },

    // ---------------- 悬浮球 ----------------
    showBall: function () {
        if (!this._ctx) this._init();
        var self = this;
        if (this.ballView) { this.hideBall(); }

        var tv = new android.widget.TextView(this._ctx);
        tv.setText("三");
        tv.setTextSize(19);
        tv.setTextColor(this.hex("FFF2E2C0"));
        tv.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        tv.setGravity(android.view.Gravity.CENTER);
        tv.setIncludeFontPadding(false);
        tv.setBackground(this._shape(this.C.bg, this.C.gold, 1.5, -1));
        tv.setElevation(this.px(6));

        var size = this.px(54);
        var lp = this._lp(size, size, this.px(6), this.px(150));
        this.ballLp = lp;

        var sx = 0, sy = 0, bx = lp.x, by = lp.y, moved = false, tDown = 0;
        tv.setOnTouchListener(new android.view.View.OnTouchListener({
            onTouch: function (v, ev) {
                var act = ev.getAction();
                if (act == 0) {
                    sx = ev.getRawX(); sy = ev.getRawY();
                    bx = self.ballLp.x; by = self.ballLp.y;
                    moved = false; tDown = new Date().getTime();
                    v.setAlpha(0.75);
                    return true;
                } else if (act == 2) {
                    var dx = ev.getRawX() - sx, dy = ev.getRawY() - sy;
                    if (Math.abs(dx) > 14 || Math.abs(dy) > 14) moved = true;
                    self.ballLp.x = Math.round(bx - dx);
                    self.ballLp.y = Math.round(by - dy);
                    try { self._wm.updateViewLayout(v, self.ballLp); } catch (e) { }
                    return true;
                } else if (act == 1 || act == 3) {
                    v.setAlpha(1.0);
                    if (!moved) {
                        var held = new Date().getTime() - tDown;
                        if (held > 480) { self.hideDock(); self.showPanel(); }
                        else { self.toggleDock(); }
                    }
                    return true;
                }
                return false;
            }
        }));

        this.ballView = tv;
        this._post(function () {
            try { self._wm.addView(tv, lp); } catch (e) { sgs.log.e("加球失败 " + e); }
        });
        sgs.log.i("悬浮球已显示");
    },

    hideBall: function () {
        var v = this.ballView;
        if (!v) return;
        this.ballView = null;
        var self = this;
        this._post(function () { try { self._wm.removeView(v); } catch (e) { } });
    },

    _paintBall: function (busy) {
        var v = this.ballView;
        if (!v) return;
        var self = this;
        this._post(function () {
            try {
                v.setBackground(self._shape(busy ? self.C.ballOn : self.C.bg, busy ? self.C.busy : self.C.gold, 1.5, -1));
            } catch (e) { }
        });
    },

    // ---------------- 快捷圆盘（轻点球）----------------
    toggleDock: function () {
        if (this.dockView) this.hideDock(); else this.showDock();
    },

    hideDock: function () {
        var v = this.dockView;
        if (!v) return;
        this.dockView = null;
        var self = this;
        this._post(function () { try { self._wm.removeView(v); } catch (e) { } });
    },

    showDock: function () {
        if (!this._ctx) this._init();
        var self = this;
        if (this.dockView) return;
        if (this.panelView) { this.hidePanel(); return; }

        var W = this.px(210);
        var root = new android.widget.LinearLayout(this._ctx);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setBackground(this._shape(this.C.bg, this.C.goldDim, 1, 14));
        root.setPadding(this.px(8), this.px(8), this.px(8), this.px(8));
        root.setElevation(this.px(10));

        // 第一行：三个任务
        root.addView(this._dockRow([this.TASKS[0], this.TASKS[1], this.TASKS[2]]));
        // 第二行：一键日常 / 截图 / 更多
        var row2 = this._dockRow([this.TASKS[3], this.TASKS[4], null]);
        root.addView(row2);

        var lp = this._lp(W, -2, this.px(8), 0, android.view.Gravity.RIGHT | android.view.Gravity.CENTER_VERTICAL);
        this.dockView = root;
        this._post(function () {
            try { self._wm.addView(root, lp); } catch (e) { sgs.log.e("加圆盘失败 " + e); }
        });
        sgs.log.i("快捷圆盘已展开");
    },

    _dockRow: function (items) {
        var self = this;
        var row = new android.widget.LinearLayout(this._ctx);
        row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        var lp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, this.px(6));
        row.setLayoutParams(lp);

        for (var i = 0; i < items.length; i++) {
            var t = items[i];
            var cell = new android.widget.LinearLayout(this._ctx);
            cell.setOrientation(android.widget.LinearLayout.VERTICAL);
            cell.setGravity(android.view.Gravity.CENTER);
            cell.setBackground(this._shape(t ? this.C.card : this.C.card, this.C.line, 1, 10));
            cell.setPadding(this.px(4), this.px(6), this.px(4), this.px(6));
            cell.setClickable(true);
            var cw = this.px(60);
            var clp = new android.widget.LinearLayout.LayoutParams(cw, this.px(52));
            if (i > 0) clp.setMargins(this.px(6), 0, 0, 0);
            cell.setLayoutParams(clp);

            if (t) {
                var icon = this._tv(t.icon, 13, "FFFFFFFF", true);
                icon.setGravity(android.view.Gravity.CENTER);
                icon.setBackground(this._shape(t.color, null, 1, -1));
                var ilp = new android.widget.LinearLayout.LayoutParams(this.px(26), this.px(26));
                icon.setLayoutParams(ilp);
                cell.addView(icon);

                var lbl = this._tv(t.id === "playerinfo" ? "信息" : t.id === "mail" ? "邮件" : t.id === "xiaoqiao" ? "小乔" : t.id === "daily" ? "日常" : "截图", 9, this.C.sub, false);
                lbl.setGravity(android.view.Gravity.CENTER);
                var llp = new android.widget.LinearLayout.LayoutParams(-1, -2);
                llp.setMargins(0, this.px(5), 0, 0);
                lbl.setLayoutParams(llp);
                cell.addView(lbl);

                cell.setOnClickListener(new android.view.View.OnClickListener({
                    onClick: function (v) {
                        if (self.isBusy()) { toast("任务执行中"); return; }
                        self.hideDock();
                        self.runTask(t.id, t.title);
                    }
                }));
            } else {
                var more = this._tv("⋯", 16, this.C.gold, true);
                more.setGravity(android.view.Gravity.CENTER);
                more.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
                cell.addView(more);
                var mlbl = this._tv("更多", 9, this.C.sub, false);
                mlbl.setGravity(android.view.Gravity.CENTER);
                var mlp = new android.widget.LinearLayout.LayoutParams(-1, -2);
                mlp.setMargins(0, this.px(5), 0, 0);
                mlbl.setLayoutParams(mlp);
                cell.addView(mlbl);

                cell.setOnClickListener(new android.view.View.OnClickListener({
                    onClick: function (v) { self.hideDock(); self.showPanel(); }
                }));
            }
            row.addView(cell);
        }
        return row;
    },

    // ---------------- 完整面板（长按球）----------------
    showPanel: function () {
        if (!this._ctx) this._init();
        var self = this;
        if (this.panelView) { this.hidePanel(); return; }

        var W = this.px(250);
        var root = new android.widget.LinearLayout(this._ctx);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setBackground(this._shape(this.C.bg, this.C.goldDim, 1, 14));
        root.setPadding(this.px(11), this.px(10), this.px(11), this.px(10));
        root.setElevation(this.px(12));

        // 标题行
        var head = new android.widget.LinearLayout(this._ctx);
        head.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        head.setGravity(android.view.Gravity.CENTER_VERTICAL);

        var dot = this._v(this.px(7), this.px(7));
        dot.setBackground(this._shape(this.isBusy() ? this.C.busy : this.C.ok, null, 1, -1));
        this._margins(dot, 0, 0, 7, 0);
        head.addView(dot);

        head.addView(this._tv("名将传 · 助手", 14, this.C.text, true));

        var st = this._tv(this.isBusy() ? "运行中" : "空闲", 10, this.C.sub, false);
        var slp = new android.widget.LinearLayout.LayoutParams(0, -2, 1);
        slp.setMargins(this.px(8), 0, 0, 0);
        st.setLayoutParams(slp);
        head.addView(st);
        this._statusTv = st;

        var close = this._tv("✕", 15, this.C.sub, false);
        close.setGravity(android.view.Gravity.CENTER);
        close.setLayoutParams(new android.widget.LinearLayout.LayoutParams(this.px(28), this.px(28)));
        close.setClickable(true);
        close.setOnClickListener(new android.view.View.OnClickListener({
            onClick: function (v) { self.hidePanel(); }
        }));
        head.addView(close);
        root.addView(head);

        var line = this._v(-1, this.px(1));
        line.setBackgroundColor(this.hex(this.C.line));
        this._margins(line, 0, 8, 0, 2);
        root.addView(line);

        // 任务行
        for (var i = 0; i < this.TASKS.length; i++) root.addView(this._row(this.TASKS[i]));

        // 日志区
        var logBox = new android.widget.LinearLayout(this._ctx);
        logBox.setOrientation(android.widget.LinearLayout.VERTICAL);
        logBox.setBackground(this._shape(this.C.card, this.C.line, 1, 10));
        logBox.setPadding(this.px(8), this.px(6), this.px(8), this.px(6));
        logBox.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        this._margins(logBox, 0, 8, 0, 0);

        var logTv = this._tv(this._tailLog(), 9, this.C.sub, false);
        logTv.setGravity(android.view.Gravity.LEFT);
        logTv.setTypeface(android.graphics.Typeface.MONOSPACE);
        logTv.setMaxLines(3);
        logTv.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        logBox.addView(logTv);
        this._logTv = logTv;
        root.addView(logBox);

        // 停止
        var stop = this._tv("停止当前任务", 13, "FFFFDCDC", true);
        stop.setGravity(android.view.Gravity.CENTER);
        stop.setBackground(this._shape("FF3A1C1F", "FF7A343A", 1, 9));
        stop.setPadding(0, this.px(10), 0, this.px(10));
        stop.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        this._margins(stop, 0, 8, 0, 0);
        stop.setClickable(true);
        stop.setOnClickListener(new android.view.View.OnClickListener({
            onClick: function (v) { self.stopAll(); }
        }));
        root.addView(stop);

        var lp = this._lp(W, -2, this.px(8), 0, android.view.Gravity.RIGHT | android.view.Gravity.CENTER_VERTICAL);
        this.panelView = root;
        this._post(function () {
            try { self._wm.addView(root, lp); } catch (e) { sgs.log.e("加面板失败 " + e); }
        });
        this._startTick();
        sgs.log.i("完整面板已展开");
    },

    hidePanel: function () {
        this._stopTick();
        var v = this.panelView;
        if (!v) return;
        this.panelView = null;
        this._statusTv = null;
        this._logTv = null;
        var self = this;
        this._post(function () { try { self._wm.removeView(v); } catch (e) { } });
    },

    _row: function (t) {
        var self = this;
        var row = new android.widget.LinearLayout(this._ctx);
        row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setBackground(this._shape(this.C.card, this.C.line, 1, 9));
        row.setPadding(this.px(9), this.px(8), this.px(9), this.px(8));
        row.setClickable(true);
        row.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        this._margins(row, 0, 6, 0, 0);

        var icon = this._tv(t.icon, 12, "FFFFFFFF", true);
        icon.setGravity(android.view.Gravity.CENTER);
        icon.setBackground(this._shape(t.color, null, 1, 7));
        icon.setLayoutParams(new android.widget.LinearLayout.LayoutParams(this.px(26), this.px(26)));
        row.addView(icon);

        var box = new android.widget.LinearLayout(this._ctx);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        var blp = new android.widget.LinearLayout.LayoutParams(0, -2, 1);
        blp.setMargins(this.px(9), 0, this.px(5), 0);
        box.setLayoutParams(blp);
        box.addView(this._tv(t.title, 13, this.C.text, true));
        box.addView(this._tv(t.desc, 9, this.C.sub, false));
        row.addView(box);

        var arrow = this._tv("›", 15, this.C.sub, false);
        arrow.setGravity(android.view.Gravity.CENTER);
        row.addView(arrow);

        row.setOnClickListener(new android.view.View.OnClickListener({
            onClick: function (v) {
                if (self.isBusy()) { toast("任务执行中"); return; }
                self.hidePanel();
                self.runTask(t.id, t.title);
            }
        }));
        return row;
    },

    _tailLog: function () {
        try {
            var all = (typeof LOGS !== "undefined") ? LOGS : [];
            var n = all.length;
            var lines = [];
            for (var i = Math.max(0, n - 3); i < n; i++) lines.push(String(all[i]).replace(/^\[[IE]\] /, ""));
            return lines.length ? lines.join("\n") : "（暂无日志）";
        } catch (e) { return "（日志不可用）"; }
    },

    // ---------------- 周期刷新 ----------------
    _startTick: function () {
        var self = this;
        this._stopTick();
        this._tick = setInterval(function () {
            self._post(function () { self._refresh(); });
        }, 900);
    },

    _stopTick: function () {
        if (this._tick) { try { clearInterval(this._tick); } catch (e) { } this._tick = null; }
    },

    _refresh: function () {
        var busy = this.isBusy();
        if (this._statusTv) {
            try {
                this._statusTv.setText(busy ? "运行中" : (this._lastResult || "空闲"));
                this._statusTv.setTextColor(this.hex(busy ? this.C.busy : this.C.sub));
            } catch (e) { }
        }
        if (this._logTv) {
            try { this._logTv.setText(this._tailLog()); } catch (e) { }
        }
    },

    // ---------------- 执行 ----------------
    isBusy: function () {
        if (!this._t0) return false;
        return (new Date().getTime() - this._t0) < 300000;
    },

    runTask: function (id, label) {
        var self = this;
        if (this.isBusy()) { toast("任务执行中"); return; }
        if (id === "daily") { this.runDaily(label); return; }
        this._t0 = new Date().getTime();
        this._paintBall(true);
        this._thread = threads.start(function () {
            var t0 = new Date().getTime();
            try {
                sgs.log.i("=== 开始 " + label + " ===");
                if (id === "shot") {
                    sgs.pushShot();
                    sgs.log.i("=== 截屏已回传 ===");
                    toast("截图已上传");
                    self._lastResult = "截图 " + Math.round((new Date().getTime() - t0) / 1000) + "s ✓";
                    return;
                }
                if (!sgs.game.ensure(120000)) throw new Error("未进入主城");
                var task = sgs.tasks[id];
                if (!task) throw new Error("任务不存在 " + id);
                task.run();
                var cost = Math.round((new Date().getTime() - t0) / 1000);
                sgs.log.i("=== " + label + " 完成 " + cost + "s ===");
                toast(label + " 完成 " + cost + "s");
                self._lastResult = label + " " + cost + "s ✓";
            } catch (e) {
                sgs.log.e("任务异常: " + e + " || stack=" + (e && e.stack ? e.stack : "-"));
                toast("异常: " + e);
                self._lastResult = "上次失败 ✗";
            } finally {
                self._t0 = 0;
                self._thread = null;
                self._paintBall(false);
                try { if (id !== "shot" && sgs.pushShot) sgs.pushShot(); } catch (e2) { }
                try { sgs.pushLog(); } catch (e3) { }
                self._post(function () { self._refresh(); });
            }
        });
    },

    /** 一键日常：邮件 → 小乔，各自独立 catch，一个失败不阻塞另一个 */
    runDaily: function (label) {
        var self = this;
        if (this.isBusy()) { toast("任务执行中"); return; }
        this._t0 = new Date().getTime();
        this._paintBall(true);
        this._thread = threads.start(function () {
            var t0 = new Date().getTime();
            var done = [], fail = [];
            try {
                sgs.log.i("=== 开始 一键日常 ===");
                if (!sgs.game.ensure(120000)) throw new Error("未进入主城");

                var steps = [
                    { id: "mail", name: "邮件" },
                    { id: "xiaoqiao", name: "小乔日常" }
                ];
                for (var i = 0; i < steps.length; i++) {
                    var st = steps[i];
                    try {
                        sgs.log.i("--- 日常 " + (i + 1) + "/2：" + st.name + " ---");
                        sgs.tasks[st.id].run();
                        done.push(st.name);
                    } catch (e) {
                        sgs.log.e(st.name + " 失败: " + e);
                        fail.push(st.name);
                        try { sgs.pushShot(); } catch (e2) { }
                    }
                }

                var cost = Math.round((new Date().getTime() - t0) / 1000);
                var msg = "完成 " + done.length + "/2";
                if (fail.length) msg += "，失败 " + fail.join("/");
                sgs.log.i("=== 一键日常 " + msg + " " + cost + "s ===");
                toast("一键日常 " + msg + " " + cost + "s");
                self._lastResult = "日常 " + msg + " " + cost + "s";
            } catch (e) {
                sgs.log.e("一键日常异常: " + e);
                toast("异常: " + e);
                self._lastResult = "上次失败 ✗";
            } finally {
                self._t0 = 0;
                self._thread = null;
                self._paintBall(false);
                try { sgs.pushShot(); } catch (e4) { }
                try { sgs.pushLog(); } catch (e5) { }
                self._post(function () { self._refresh(); });
            }
        });
    },

    stopAll: function () {
        try { if (this._thread) this._thread.interrupt(); } catch (e) { }
        this._t0 = 0;
        this._thread = null;
        this._lastResult = "已手动停止";
        this._paintBall(false);
        toast("已请求停止");
    },

    refreshLog: function () {
        if (sgs.pushLog) sgs.pushLog();
        var self = this;
        this._post(function () { self._refresh(); });
    }
};

// ===== 启动（分步执行，每步单独 catch，便于定位）=====
sgs.log.i("=== 悬浮面板启动 " + new Date().toTimeString().substring(0, 8) + " ===");
try { sgs.log.i(device.brand + " " + device.model + " / Android " + device.release); } catch (e0) { }

// step1 清理残留引擎：重复 bootstrap 会留下多个引擎抢 /cmd，只保留自己
try {
    var __mine = engines.myEngine();
    var __all = engines.all();
    var __killed = 0;
    for (var __i = 0; __i < __all.length; __i++) {
        try {
            var __en = __all[__i].getEngine();
            if (__en && __en.getId() != __mine.getId()) { __en.forceStop(); __killed++; }
        } catch (__eq) { }
    }
    sgs.log.i("step1 清理引擎：停掉 " + __killed + " 个 / 共 " + __all.length + " 个");
} catch (__ec) { }

sgs.log.i("step2 截图权限");
try {
    // 画布方向只在进程内「首次」申请时生效（之后重复 requestScreenCapture 会忽略方向参数），
    // 所以必须先让横屏的游戏进入前台，再申请截图。
    var __cur = "";
    try { __cur = currentPackage(); } catch (__e0) { __cur = ""; }
    if (__cur !== "com.sanguosha.mjz.mi") {
        sgs.log.i("前台 " + __cur + "，先拉起游戏再申请截图");
        try { app.launchPackage("com.sanguosha.mjz.mi"); } catch (__e1) { }
    }
    var __land = false;
    for (var __i = 0; __i < 6 && !__land; __i++) {
        sleep(2000);
        try {
            __land = (context.getResources().getConfiguration().orientation
                == android.content.res.Configuration.ORIENTATION_LANDSCAPE);
        } catch (__e2) { __land = (device.width > device.height); }
    }
    sgs.log.i("横屏确认 land=" + __land);
    var okCap = sgs.vision.init();
    sgs.log.i("截图权限 " + okCap);
} catch (e2) {
    sgs.log.e("vision.init 失败 " + e2);
}

sgs.log.i("step3 悬浮球");
try {
    sgs.ui.showBall();
} catch (e3) {
    sgs.log.e("showBall 失败 " + e3);
}

sgs.pushLog();
toast("启动完成");

sgs.log.i("step4 截图自检");
try { sleep(4000); sgs.pushShot(); } catch (e4) { sgs.log.e("pushShot 失败 " + e4); }

// 常驻心跳：推日志 + 拉电脑端指令（3 秒一次），这样电脑可以直接指挥手机，不用人点
var __hb = 0;
threads.start(function () {
  while (true) {
    sleep(3000);
    __hb++;
    if (__hb % 20 == 0) {
        try { sgs.log.i("♥ 心跳 " + __hb + " 次"); sgs.pushLog(); } catch (e) { }
    }
    try { sgs.pushLog(); } catch (e) { }
    try {
        var cr = http.get(sgs.PC + "/cmd", { timeout: 8000 });
        var cmd = String(cr.body.string()).replace(/[ \r\n\t]+/g, "");
        if (cmd && cmd != "none") {
            sgs.log.i("[cmd] " + cmd);
            if (cmd.indexOf("run:") == 0) {
                var tid = cmd.substring(4);
                sgs.ui._t0 = 0;
                sgs.ui.runTask(tid, "远程-" + tid);
            } else if (cmd.indexOf("stop") == 0) {
                sgs.ui.stopAll();
            } else if (cmd.indexOf("shot") == 0) {
                sgs.pushShot();
            } else if (cmd.indexOf("diag") == 0) {
                try { sgs.tasks.diag.run(); } catch (ed) { sgs.log.e("diag 失败 " + ed); }
                sgs.pushLog();
            } else if (cmd.indexOf("ball") == 0) {
                sgs.ui.ballView = null;
                sgs.ui.showBall();
            } else if (cmd.indexOf("clean") == 0) {
                // 停掉除自己以外的所有脚本引擎（多次 bootstrap 会留下僵尸引擎抢指令）
                var killed = 0;
                try {
                    var mine = engines.myEngine();
                    var all = engines.all();
                    for (var qi = 0; qi < all.length; qi++) {
                        try {
                            var en = all[qi].getEngine();
                            if (en && en.getId() != mine.getId()) {
                                en.forceStop();
                                killed++;
                            }
                        } catch (eq) { }
                    }
                } catch (qc) { sgs.log.e("clean 失败 " + qc); }
                sgs.log.i("clean 完成，停掉 " + killed + " 个引擎");
                sgs.pushLog();
            } else if (cmd.indexOf("panel") == 0) {
                sgs.ui.showPanel();
            } else if (cmd.indexOf("closepanel") == 0) {
                sgs.ui.hidePanel();
            } else if (cmd.indexOf("reload") == 0) {
                try {
                    sgs.log.i("reload step1 拉取代码");
                    sgs.pushLog();
                    var nr = http.get(sgs.PC + "/src/main.js?t=" + new Date().getTime(), { timeout: 25000 });
                    var ncode = nr.body.string();
                    sgs.log.i("reload step2 拿到 " + ncode.length + " 字节");
                    sgs.pushLog();
                    if (ncode.length < 5000) throw new Error("代码过短，放弃");
                    files.write("/storage/emulated/0/脚本/auto-sgs/_main.js", ncode);
                    sgs.log.i("reload step3 已落盘，清理其它引擎");
                    sgs.pushLog();
                    // 先清僵尸引擎，否则新旧两个引擎会抢 /cmd
                    try {
                        var mine2 = engines.myEngine();
                        var all2 = engines.all();
                        for (var ri = 0; ri < all2.length; ri++) {
                            try {
                                var en2 = all2[ri].getEngine();
                                if (en2 && en2.getId() != mine2.getId()) en2.forceStop();
                            } catch (re) { }
                        }
                    } catch (rc) { }
                    toast("代码已更新，重启中");
                    sleep(400);
                    engines.execScriptFile("/storage/emulated/0/脚本/auto-sgs/_main.js");
                    sgs.log.i("reload step4 新引擎已拉起");
                    sgs.pushLog();
                    sleep(1500);
                    try { engines.myEngine().forceStop(); } catch (er) {
                        sgs.log.e("reload 停旧引擎失败 " + er);
                    }
                } catch (er2) {
                    sgs.log.e("reload 失败 " + er2);
                    sgs.pushLog();
                }
            }
            sgs.pushLog();
        }
    } catch (e) { }
  }
});
}
