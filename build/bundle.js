// ===== bundle 引导：eval 环境自动落地为文件并重启 =====
var __SELF = "/storage/emulated/0/脚本/auto-sgs/_main.js";
var __SRC = String(engines.myEngine().getSource());

if (__SRC.indexOf("_main.js") < 0) {
    // 第一遍（由 bootstrap eval 进来）：把完整代码写进手机文件，然后交给新引擎，自己自然结束
    // AutoJs6 直接打开本文件运行时不会走这里，只有 eval 自举才需要
    try {
        var __pc = "http://192.168.2.250:8099";
        try {
            var __pf = "/sdcard/Download/autosgs-logs/pc.txt";
            if (files.exists(__pf)) {
                var __pt = String(files.read(__pf)).trim();
                if (__pt) {
                    if (__pt.indexOf("http") !== 0) __pt = "http://" + __pt;
                    if (__pt.indexOf(":", 8) < 0) __pt = __pt + ":8099";
                    __pc = __pt;
                }
            }
        } catch (__pe) { }
        var __r = http.get(__pc + "/src/main.js?t=" + new Date().getTime(), { timeout: 20000 });
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
var LOG_FILE = "/sdcard/Download/autosgs-logs/run.log";

// 手机本地日志：不依赖电脑端服务，adb pull 就能看
var LOG_MAX = 1024 * 1024;
function appendFile(s) {
    try {
        files.ensureDir("/sdcard/Download/autosgs-logs/");
        // 只留最近 1MB。日志涨到几十 MB 后 append 会明显变慢，adb tail/pull 也从毫秒变秒级，
        // 轮转保留一份 .1 便于回看上一轮，剩下的直接丢
        try {
            if (files.exists(LOG_FILE)) {
                var __sz = 0;
                try { __sz = files.size(LOG_FILE); } catch (e1) { __sz = 0; }
                if (__sz > LOG_MAX) {
                    try { files.copy(LOG_FILE, LOG_FILE + ".1"); } catch (e2) { }
                    files.write(LOG_FILE, "");
                }
            }
        } catch (e3) { }
        files.append(LOG_FILE, s + "\n");
    } catch (e) { }
}

sgs.log = {
    i: function (m) { var s = "[I] " + m; LOGS.push(s); log(s); appendFile(s); },
    w: function (m) { var s = "[W] " + m; LOGS.push(s); log(s); appendFile(s); },
    e: function (m) { var s = "[E] " + m; LOGS.push(s); log(s); appendFile(s); }
};

// 电脑端服务不可达时自动停用，避免每次都刷异常
var pushFail = 0;

sgs.pushLog = function () {
    // sgs.PC 为空 = 没配电脑端，整套 HTTP 回传不启用，日志只落本地
    if (!sgs.PC) { pushedIdx = LOGS.length; return; }
    if (pushFail >= 3 || pushedIdx >= LOGS.length) return;
    var chunk = LOGS.slice(pushedIdx).join("\n");
    pushedIdx = LOGS.length;
    try {
        http.post(sgs.PC + "/log", chunk, { timeout: 15000 });
        pushFail = 0;
    } catch (e) {
        pushFail++;
        if (pushFail === 1) sgs.log.w("电脑端日志服务不可达，改为只写本地文件");
    }
};

sgs.pushShot = function () {
    if (!sgs.PC || pushFail >= 3) return;
    try {
        var im = sgs.vision ? sgs.vision.frame(true) : null;
        if (!im) return;
        var b64 = images.toBase64(im, "jpg", 55);
        http.post(sgs.PC + "/shot", b64, { timeout: 180000 });
    } catch (e) {
        pushFail++;
        if (pushFail === 1) sgs.log.w("截图回传不可用（电脑端服务不可达）");
    }
};


// ===== src/config.js =====

// config.js —— 常量与 ROI（坐标与 EC 版一致，横屏 2772x1280）
sgs = (typeof sgs === "undefined") ? {} : sgs;

// 电脑端服务地址：只有手机上明确写了 pc.txt 才启用。
// 空字符串 = 整套 HTTP 回传/远程指令关闭，只写本地 run.log。
// （AutoX 时代靠电脑 8099 收日志发指令，现在用 adb + autotask.txt 就够，不必强制开机）
sgs.PC = (function () {
    try {
        var f = "/sdcard/Download/autosgs-logs/pc.txt";
        if (!files.exists(f)) return "";
        var t = String(files.read(f)).trim();
        if (!t) return "";
        if (t.indexOf("http") !== 0) t = "http://" + t;
        if (t.indexOf(":", 8) < 0) t = t + ":8099";
        return t;
    } catch (e) { return ""; }
})();
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

// 主城兜底判定：暗色遮罩下模板匹配会掉分，改看底部菜单文字
sgs.HOME_TEXT = { text: "征战", region: [2560, 1150, 2772, 1250] };

// 异常页 / 登录流程的 ROI 与点击点（2772x1280）
sgs.PAGES = {
    relogin: { text: "重新登录", region: [1050, 800, 1900, 930], point: [1437, 862] },
    notice: { text: "孤知道了", region: [1000, 990, 1900, 1120], point: [1432, 1051] },
    login: { text: "进入游戏", region: [1000, 890, 1900, 1120], point: [1324, 1043] },
    // 登录页专属判据：页面底部协议行，主城没有。用来把登录页从「主城」里排除出去
    loginAgree: { text: "我已阅读并同意", region: [800, 890, 1500, 1000], point: [952, 947] },
    adDismiss: { point: [1964, 97] },
    offline: { text: "网络", region: [1000, 700, 1900, 830] }
};
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

    /** 是否在主城：先排除登录页，再判横屏 + 锚点或底部菜单文字 */
    isHome: function (img) {
        img = img || this.frame();
        if (!img) return false;
        if (img.getWidth() <= img.getHeight()) return false;
        // 登录页和主城共用同一张背景图，下面 0.55 的全屏兜底会把它认成主城，
        // 结果「看着在主城」却一个字都 OCR 不到。先按登录页专属文字排掉。
        if (this.hasText("我已阅读并同意", sgs.PAGES.loginAgree.region, img)) return false;
        if (this.hasText(sgs.PAGES.login.text, sgs.PAGES.login.region, img)) return false;
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
            var next = this._normalize(raw);
            // 换帧不能立刻回收上一帧：playerinfo 一次连取 3 帧做投票，调用方手里还攥着旧帧，
            // 立即 recycle 会让第 738 行 getWidth() 报「图像资源已被回收」（真机实测踩到）。
            // 改成延迟回收：只留最近 KEEP 帧，超出的才真正释放，泄漏有界（KEEP 帧 = 约 42MB）
            var old = this._img;
            this._img = next;
            if (old && old !== next) this._retire(old);
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
                // 只有 resize 真产出了新对象才能回收中间图；原地缩放时 rs 就是 clip 本身
                if (rs !== clip) { try { clip.recycle(); } catch (r1) { } }
            } catch (er1) {
                try {
                    rs = images.scale(clip, 2772 / b.w, 1280 / b.h, "LINEAR");
                    if (rs !== clip) { try { clip.recycle(); } catch (r2) { } }
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

    /**
     * 退役帧暂存。最近 KEEP 帧一律不回收，超出的才真回收。
     * 每帧 2772x1280 约 14MB，不回收跑几十帧就把 native 堆吃穿；回收太早又会踩到调用方的旧帧。
     */
    _retire: function (img) {
        try {
            if (!this._kept) this._kept = [];
            this._kept.push(img);
            while (this._kept.length > 3) {
                var o = this._kept.shift();
                if (o && o !== this._img) { try { o.recycle(); } catch (e) { } }
            }
        } catch (e) { }
    },

    reset: function () {
        var arr = [this._img].concat(this._kept || []);
        for (var i = 0; i < arr.length; i++) {
            if (arr[i]) { try { arr[i].recycle(); } catch (e) { } }
        }
        this._img = null; this._kept = []; this._band = null; this._scale = null;
    },

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
            // 模板缓存：原来每次 find 都 images.read 一遍，同一个小乔头像在轮询里
            // 会被读上百次，既慢又攒下一堆没人回收的 Image
            if (!this._tpls) this._tpls = {};
            var c = this._tpls[name];
            if (c) return c;
            var p = files.cwd() + "/res/img/" + name;
            var t = images.read(p);
            if (!t) { log("[vision] 模板不存在 " + p); return null; }
            this._tpls[name] = t;
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
                // 返回模板中心，不是左上角。点左上角会让每个点击都偏半个模板，
                // 落在按钮外面还查不出来（mail 的「全部领取」就是这么一直点空的）
                if (hit) {
                    return {
                        x: hit.x + Math.round(tpl.getWidth() / 2),
                        y: hit.y + Math.round(tpl.getHeight() / 2)
                    };
                }
                return null;
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
            if (r) {
                r = {
                    x: r.x + ox + Math.round(tpl.getWidth() / 2),
                    y: r.y + oy + Math.round(tpl.getHeight() / 2)
                };
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

// game.js —— 游戏就绪检测与异常页自愈
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.game = {
    PKG: "com.sanguosha.mjz.mi",

    /** 建画布（不切前台） */
    _initCap: function (land) {
        var v = sgs.vision;
        v._capOk = false;
        v.reset();
        v._landForce = !!land;
        return v.init();
    },

    /**
     * 确保在游戏主城。
     * 原则：不主动把游戏拉前台。切前台会触发游戏 loading，久了直接掉线。
     * 先看图（主城/公告/登录/掉线），认不出且前台不是游戏时才拉一次。
     */
    ensure: function (maxMs) {
        maxMs = maxMs || 120000;
        var v = sgs.vision;
        var g = sgs.game;

        v._capOk = false;
        v.reset();
        // 进程内「首次」申请决定画布方向，之后改参数无效。
        // AutoJs6 的 requestScreenCapture(true) 确实能给出 2772x1280，所以首次就强制横屏。
        v._landForce = true;
        if (!v.init()) throw new Error("截图权限失败");

        var t0 = new Date().getTime();
        var notLand = 0;
        var launched = 0;
        var blank = 0;

        while (new Date().getTime() - t0 < maxMs) {
            var im = v.frame(true);
            if (!im) { sleep(1500); continue; }

            if (im.getWidth() <= im.getHeight()) {
                notLand++;
                if (notLand >= 2) {
                    sgs.log.i("画布竖屏，强制横屏重建");
                    g._initCap(true);
                    notLand = 0;
                }
                sleep(1200);
                continue;
            }
            notLand = 0;

            if (v.isHome(im)) {
                // 刚被拉回前台时游戏还在同步 loading：画面看着像主城，
                // 但点击全被吞，这时候干活等于白点（邮件「全部领取」就栽在这）
                sgs.log.i("画面已是主城 " + Math.round((new Date().getTime() - t0) / 1000) + "s，等同步完成");
                sleep(4000);
                var imS = v.frame(true);
                if (imS && v.isHome(imS)) {
                    sgs.log.i("同步完成，可交互 " + Math.round((new Date().getTime() - t0) / 1000) + "s");
                    return true;
                }
                sgs.log.w("复检仍不稳定，继续等");
                sleep(1500);
                continue;
            }

            if (g._recover(im, v)) { sleep(2000); continue; }

            // 认不出任何已知页面：可能是黑屏/加载中，先等；超过 3 次才考虑拉起
            blank++;
            if (blank >= 3) {
                var cur = "";
                try { cur = currentPackage(); } catch (e) { cur = ""; }
                var inGame = (cur === g.PKG);
                sgs.log.i("第" + blank + "次认不出画面，前台=" + (cur || "未知"));
                // 前台为空说明拿不到判定（无障碍异常），按"不在游戏"处理；
                // 只要当前前台确实是游戏就别拉，避免打断加载导致 loading 循环掉线
                if (!inGame && launched < 2) {
                    launched++;
                    sgs.log.i("拉起游戏（第 " + launched + " 次）");
                    try { app.launchPackage(g.PKG); } catch (e1) { sgs.log.e("拉起失败 " + e1); }
                    sleep(12000);
                    blank = 0;
                }
            }
            sleep(1800);
        }
        sgs.log.e("超时未到主城");
        return false;
    },

    /** 处理掉线/公告/登录页；返回 true 表示点掉了一个页面 */
    _recover: function (im, v) {
        var P = sgs.PAGES;
        if (!P) return false;

        if (v.hasText(P.relogin.text, P.relogin.region, im)) {
            sgs.log.i("掉线弹窗，点重新登录");
            v.tap(P.relogin.point[0], P.relogin.point[1]);
            return true;
        }
        if (v.hasText(P.notice.text, P.notice.region, im)) {
            sgs.log.i("公告弹窗，点关闭");
            v.tap(P.notice.point[0], P.notice.point[1]);
            return true;
        }
        if (v.hasText(P.login.text, P.login.region, im)) {
            sgs.log.i("登录页，点进入游戏");
            v.tap(P.login.point[0], P.login.point[1]);
            return true;
        }
        return false;
    },

    /** 等待主城（沿用旧入口，内部走 ensure） */
    waitHome: function (maxMs) {
        return this.ensure(maxMs);
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
        { key: "combat_power", parser: "power" },
        { key: "physical", parser: "fraction" },
        { key: "energy", parser: "fraction" },
        // 元宝/玉石超过百万时 UI 会缩写成「139万」，必须走带单位的解析
        { key: "sycee", parser: "power" },
        { key: "jade", parser: "power" }
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
        var pick = first[bestKey];
        if (type === "level") {
            // 等级只会被 OCR 吃掉前导位（「120级」→「20级」「A20级」），不会凭空多一位。
            // 若众数是某个更长候选的后缀，取更长的那个。
            var bv = pick.value, br = pick.raw;
            for (var k3 in first) {
                if (!first.hasOwnProperty(k3)) continue;
                var v3 = first[k3].value;
                if (v3 === null || v3 === undefined) continue;
                var s3 = String(v3), sb = String(bv);
                if (s3.length > sb.length && s3.substring(s3.length - sb.length) === sb) {
                    bv = v3; br = first[k3].raw;
                }
            }
            return { value: bv, raw: br };
        }
        return pick;
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

        if (type === "power") {
            // 「1271037万」容易被 OCR 读成「1271037万万」，先把重复单位压成一个
            var p = s.replace(/[,\s]/g, "").replace(/万{2,}/g, "万");
            var m3 = p.match(/(\d+(?:\.\d+)?)\s*(亿|万|千)?/);
            if (!m3) return null;
            var n3 = parseFloat(m3[1]);
            if (isNaN(n3)) return null;
            var u3 = m3[2] || "";
            if (u3 === "亿") n3 *= 100000000;
            else if (u3 === "万") n3 *= 10000;
            else if (u3 === "千") n3 *= 1000;
            return n3;
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

        // 2) 全部领取。有附件会弹「恭喜获得」浮层，点屏幕下方空白即关；
        //    无可领邮件时按钮不消失、点了没反应，所以不拿按钮消失当判据。
        //    但第一轮必须真的识别到按钮：识别不到说明模板失配或弹窗没开成，
        //    继续静默走完会给出一个假的「已领取」结论，宁可直接报错。
        for (var ci = 1; ci <= 2; ci++) {
            if (!v.tapImage(this.CLAIM, 0.8, this.CLAIM_REGION)) {
                if (ci === 1) throw new Error("未识别到「全部领取」按钮，领取结果未知");
                sgs.log.w("第 2 轮未检测到全部领取按钮，停止重试");
                break;
            }
            sgs.log.i("点击「全部领取」（第 " + ci + " 轮）");
            sleep(2000);
            v.clickPointAt(this.DISMISS[0], this.DISMISS[1]);
            sleep(600);
        }

        // 3) 关闭弹窗，确认回主城
        var cp = v.find(this.CLOSE, 0.8, this.CLOSE_REGION, v.frame(true));
        sgs.log.i("关闭按钮命中 " + (cp ? (cp.x + "," + cp.y) : "无"));
        var closed = false;
        for (var j = 1; j <= 3; j++) {
            if (v.tapImage(this.CLOSE, 0.8, this.CLOSE_REGION)) {
                sleep(900);
                // 判定弹窗是否真关掉，看「全部领取」按钮还在不在。
                // 不能用"close 图标找不到"当依据——模板匹不上时 hasImage 恒 false，
                // 会被当成已关闭，一步没点就误报成功（踩过一次）
                if (!v.hasImage(this.CLAIM, this.CLAIM_REGION, 0.8)) {
                    closed = true;
                    break;
                }
            }
            sleep(600);
        }
        if (!closed) throw new Error("邮件弹窗未能关闭");
        sgs.log.i("邮件弹窗已关闭");

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
    // 入口是可拖动的悬浮头像，位置会变。先试左右两个常见位，最后全屏兜底；
    // 点击一律用识别到的中心点，不再写死坐标——写死等于把「头像没挪」当成前提
    ENTRY_LEFT: [0, 280, 320, 860],
    ENTRY_RIGHT: [2180, 340, 2772, 940],
    ENTRY_RIGHT_TPL: "xiaoqiao/home-avatar.png",
    ENTRY_TH: 0.75,

    TAB_TEXT: "日常功能",
    TAB_CHECK: "日常", // OCR 常把「功」认成「劝」，判断时用短词
    TAB_REGION: [1820, 390, 2090, 535],

    KAIQI: "xiaoqiao/kaiqi.png",
    KAIQI_REGION: [1800, 700, 2150, 1050],
    KAIQI_POINT: [1900, 940], // 仅作文档参考；点击一律用图识别到的按钮中心，不做盲点兜底
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
        var img = v.frame(true);
        if (!img) return null;
        // 顺序：左右常见位 -> 全屏兜底。同一个 frame 反复 find，避免每试一次截一屏
        var cands = [
            { tpl: this.ENTRY, rect: this.ENTRY_LEFT },
            { tpl: this.ENTRY_RIGHT_TPL, rect: this.ENTRY_RIGHT },
            { tpl: this.ENTRY, rect: null },
            { tpl: this.ENTRY_RIGHT_TPL, rect: null }
        ];
        for (var i = 0; i < cands.length; i++) {
            var p = v.find(cands[i].tpl, this.ENTRY_TH, cands[i].rect, img);
            if (p) {
                sgs.log.i("头像命中 " + cands[i].tpl
                    + (cands[i].rect ? " 区域" + JSON.stringify(cands[i].rect) : " 全屏")
                    + " 中心 " + p.x + "," + p.y);
                return p;
            }
        }
        return null;
    },

    _done: function () {
        var v = sgs.vision;
        var im = v.frame(true);
        // 结果窗底部绿条（实测 RGB #80CF4C）：OCR 读不出描边字，改判颜色
        try {
            var b = this.COMPLETION_REGION;
            var c = images.clip(im, b[0], b[1], b[2] - b[0], b[3] - b[1]);
            try {
                if (images.findColor(c, "#80CF4C", { threshold: 60 })) return true;
            } finally { try { c.recycle(); } catch (r) { } }
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

    // 面板判定：Tab 文字在 = 面板已开。不靠「找不到头像就当面板开着」这种反推，
    // 头像识别失败的原因可能是加载中、被弹窗盖住、模板失配，反推会直接跳到盲点。
    _panelOpenExplicit: function () {
        var v = sgs.vision;
        return v.hasText(this.TAB_TEXT, this.TAB_REGION) || v.hasText(this.TAB_CHECK, this.TAB_REGION);
    },

    _openPanel: function () {
        var v = sgs.vision;
        if (this._panelOpenExplicit()) {
            sgs.log.i("小乔助手面板已打开");
            return;
        }
        var t0 = new Date().getTime();
        var avatar = this._findAvatar();
        while (!avatar && new Date().getTime() - t0 < sgs.TIMEOUT.page) {
            sleep(800);
            avatar = this._findAvatar();
        }
        if (!avatar) throw new Error("未识别到小乔头像，无法打开助手面板");
        // 点识别到的中心点。find() 返回的已经是模板中心，不是左上角
        v.clickPointAt(avatar.x, avatar.y);
        sgs.log.i("已点击小乔头像 (" + avatar.x + "," + avatar.y + ")");
        if (!this._waitPanel(1)) throw new Error("点击头像后未确认助手面板");
        sgs.log.i("小乔助手面板已打开");
    },

    /** 等面板出现，最多 timeout 秒，命中即返回 true */
    _waitPanel: function (timeoutSec) {
        var t0 = new Date().getTime();
        while (new Date().getTime() - t0 < timeoutSec * 1000) {
            if (this._panelOpenExplicit()) return true;
            sleep(700);
        }
        return false;
    },

    _openDailyTab: function () {
        var v = sgs.vision;
        for (var t = 1; t <= 3; t++) {
            // 每轮先确认 Tab 还在。不在说明面板已经没了或点歪了，
            // 这时继续按固定坐标点下去，点在什么功能上完全不可控（可能是花元宝的入口）
            if (!this._panelOpenExplicit()) throw new Error("找不到「日常功能」Tab");
            v.tapRect(this.TAB_REGION);
            sgs.log.i("点击「日常功能」Tab（第 " + t + " 轮）");
            var btn = v.waitImage(this.KAIQI, sgs.TIMEOUT.page, this.KAIQI_REGION, this.KAIQI_TH);
            if (btn) { sgs.log.i("已识别到「开启」按钮"); return btn; }
            sgs.log.w("第 " + t + " 轮图识别未命中");
        }
        throw new Error("连续 3 次未出现「开启」按钮");
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
        // 4) 陌生子界面兜底：误触进拍卖 / 图鉴 / 军团等页面时，点左上角返回
        //    实测主城 2772x1280 下点 (70,70) 能从「全服拍卖」退回主城
        //    每轮必须重新取帧：isHome() 不带参数会读缓存，第一次已回主城也看不出来，
        //    会继续白点两次再按旧帧抛错
        for (var q = 1; q <= 3; q++) {
            if (sgs.vision.isHome(v.frame(true))) break;
            sgs.log.w("未回主城，点左上角返回（第 " + q + " 轮）");
            v.clickPointAt(70, 70);
            sleep(2500);
        }
        if (!sgs.vision.isHome(v.frame(true))) throw new Error("面板未能关闭并回到主城");
        sgs.log.i("已确认回到主城");
    },

    run: function () {
        var v = sgs.vision;

        this._openPanel();
        var btn = this._openDailyTab();
        sgs.log.i("「日常功能」页就绪");

        // 点识别到的按钮本身，不用写死的坐标：图匹上了就说明位置在这，点空的风险为零
        v.clickRect(btn);
        sgs.log.i("已点击「开启」(" + btn.x + "," + btn.y + ")，每 " + (this.POLL_MS / 1000) + " 秒轮询，超时 " +
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

    _thread: null, _t0: 0, _tick: null, _lastResult: "", _token: null,

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
        var row = new android.widget.LinearLayout(this._ctx);
        row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        var lp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, this.px(6));
        row.setLayoutParams(lp);

        for (var i = 0; i < items.length; i++) {
            row.addView(this._dockCell(items[i], i === 0));
        }
        return row;
    },

    // 每个格子单独成函数：回调闭包捕获的是本函数的参数 t，每次调用独立。
    // 原来在 for 循环里用 var t 建监听器，Rhino 无块作用域，循环结束后所有回调共用
    // 同一个 t（停在最后一项），导致「信息/邮件」都去启动小乔、「更多」那行读 null.id 报错。
    _dockCell: function (t, isFirst) {
        var self = this;
        var cell = new android.widget.LinearLayout(this._ctx);
        cell.setOrientation(android.widget.LinearLayout.VERTICAL);
        cell.setGravity(android.view.Gravity.CENTER);
        cell.setBackground(this._shape(this.C.card, this.C.line, 1, 10));
        cell.setPadding(this.px(4), this.px(6), this.px(4), this.px(6));
        cell.setClickable(true);
        var clp = new android.widget.LinearLayout.LayoutParams(this.px(60), this.px(52));
        if (!isFirst) clp.setMargins(this.px(6), 0, 0, 0);
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
        return cell;
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
    // 忙碌以线程是否存活为准，不能只看时间戳：
    // 小乔允许跑 420s，原来硬编码 300s 会把还在执行的任务判成空闲，后面进来的任务并行抢点击
    isBusy: function () {
        if (this._thread) {
            try { if (this._thread.isAlive()) return true; } catch (e) { }
        }
        if (!this._t0) return false;
        return (new Date().getTime() - this._t0) < 600000;
    },

    runTask: function (id, label) {
        var self = this;
        if (this.isBusy()) { toast("任务执行中"); return; }
        if (id === "daily") { this.runDaily(label); return; }
        this._t0 = new Date().getTime();
        this._paintBall(true);
        var token = {};
        this._token = token;
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
                // 只有自己仍是当前任务才清状态：旧任务收尾不能把新任务的 _thread/_t0 抹掉
                if (self._token === token) {
                    self._t0 = 0;
                    self._thread = null;
                    self._paintBall(false);
                }
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
        var token = {};
        this._token = token;
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
                if (self._token === token) {
                    self._t0 = 0;
                    self._thread = null;
                    self._paintBall(false);
                }
                try { sgs.pushShot(); } catch (e4) { }
                try { sgs.pushLog(); } catch (e5) { }
                self._post(function () { self._refresh(); });
            }
        });
    },

    stopAll: function () {
        var th = this._thread;
        var alive = false;
        try { if (th) th.interrupt(); } catch (e) { }
        // token 置空：让旧任务的 finally 认不出自己，不会把「已手动停止」之后的状态再改一遍
        this._token = null;
        // interrupt 只是打了个标记，线程还在 sleep 里，醒来前随时可能再点一下屏幕。
        // 必须等它真的退出再放开互斥，否则新任务进来就是两个线程抢同一块屏
        if (th) {
            for (var w = 0; w < 40; w++) {
                try { alive = th.isAlive(); } catch (e2) { alive = false; }
                if (!alive) break;
                sleep(100);
            }
        }
        this._t0 = 0;
        this._thread = null;
        this._lastResult = "已手动停止";
        this._paintBall(false);
        toast(alive ? "已请求停止，线程未在 4s 内退出" : "已停止");
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
// 注意 engines.all() 直接返回 ScriptEngine，AutoX 的 .getEngine() 在 AutoJs6 上取不到
try {
    var __mine = engines.myEngine();
    var __myId = __mine.getId();
    var __all = engines.all();
    var __killed = 0;
    for (var __i = 0; __i < __all.length; __i++) {
        try {
            var __en = __all[__i];
            var __id = -1;
            try { __id = __en.getId(); } catch (__e0) { __id = -1; }
            if (__id < 0) {
                try { __id = __en.getEngine().getId(); } catch (__e1) { __id = -1; }
            }
            if (__id >= 0 && __id != __myId) {
                try { __en.forceStop(); } catch (__e2) { try { __en.getEngine().forceStop(); } catch (__e3) { } }
                __killed++;
            }
        } catch (__eq) { }
    }
    sgs.log.i("step1 清理引擎：停掉 " + __killed + " 个 / 共 " + __all.length + " 个");
} catch (__ec) { }

sgs.log.i("step2 截图权限（强制横屏：进程内首次申请就决定画布方向）");
try {
    sgs.vision._landForce = true;
    var okCap = sgs.vision.init();
    sgs.log.i("截图权限 " + okCap);
    if (!okCap) {
        sgs.log.e("截图权限未授予，任务无法运行");
    }
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

// 冒烟开关：存在 autotask.txt 就自动跑一次该任务，跑完删除，方便无人值守验证
try {
    var __tf = "/sdcard/Download/autosgs-logs/autotask.txt";
    if (files.exists(__tf)) {
        var __tid = String(files.read(__tf)).replace(/[ \r\n\t]+/g, "");
        files.remove(__tf);
        if (__tid) {
            // 只跑真实任务。reload / tap: / shot: / ball: 属于控制指令，交给心跳循环处理；
            // 启动阶段把 "reload" 当任务名会直接报「任务不存在 reload」
            if (!sgs.tasks[__tid]) {
                sgs.log.w("冒烟忽略非任务指令 " + __tid);
            } else {
                sgs.log.i("冒烟任务 " + __tid);
                sgs.ui.runTask(__tid, "冒烟-" + __tid);
                sgs.log.i("冒烟任务结束 " + __tid);
            }
        }
    }
} catch (e5) { sgs.log.e("冒烟任务异常 " + e5); }

// 常驻心跳：推日志 + 拉电脑端指令（3 秒一次），这样电脑可以直接指挥手机，不用人点
var __hb = 0;
var __cmdFail = 0;
var __busy = false;
var __SELF = "/storage/emulated/0/脚本/auto-sgs/_main.js";
var __TASKFILE = "/sdcard/Download/autosgs-logs/autotask.txt";
threads.start(function () {
  while (true) {
    sleep(3000);
    __hb++;
    if (__hb % 20 == 0) {
        try { sgs.log.i("♥ 心跳 " + __hb + " 次"); sgs.pushLog(); } catch (e) { }
    }
    try { sgs.pushLog(); } catch (e) { }

    // 任务投递：adb 往 autotask.txt 写任务名即可，脚本自己取自己跑。
    // 这样不用把 AutoJs6 拉到前台，游戏一直留前台，不会被挤出触发同步 loading。
    // 互斥直接看真实任务线程（sgs.ui.isBusy），不能用 __busy：
    // __busy 只包住「启动任务」的包装线程，runTask 起完线程立刻返回，真实任务还在跑时 __busy 已经放开，
    // 下一条指令会被取走并删掉，任务运行中又拒绝执行，指令就静默消失。任务在跑时文件留在盘上，天然排队。
    if (!sgs.ui.isBusy()) {
        try {
            if (files.exists(__TASKFILE)) {
                var __tid2 = String(files.read(__TASKFILE)).replace(/[ \r\n\t]+/g, "");
                files.remove(__TASKFILE);
                if (__tid2 === "reload") {
                    sgs.log.i("[投递] reload：重新加载脚本");
                    sgs.pushLog();
                    try { engines.execScriptFile(__SELF); } catch (er0) { sgs.log.e("reload 失败 " + er0); }
                    sleep(1500);
                    try { engines.myEngine().forceStop(); } catch (er1) { }
                    return;
                }
                // 单步点击：tap:x,y —— 点完自动存档一帧，方便逐步确认界面（换号这类一次性流程用）
                if (__tid2.indexOf("tap:") === 0) {
                    var __xy = __tid2.substring(4).split(",");
                    var __tx = parseInt(__xy[0], 10), __ty = parseInt(__xy[1], 10);
                    sgs.log.i("[tap] " + __tx + "," + __ty);
                    try {
                        sgs.vision.frame(true);
                        click(__tx, __ty);
                        sleep(2000);
                        var __im = sgs.vision.frame(true);
                        if (__im) {
                            var __p = "/sdcard/Download/autosgs-logs/shot_tap_" + __tx + "x" + __ty + ".png";
                            images.save(__im, __p);
                            sgs.log.i("[tap] 截图 " + __p);
                        }
                    } catch (__es) { sgs.log.w("[tap] 异常 " + __es); }
                    continue;
                }
                // 收/放悬浮球：ball:hide / ball:show —— 浮球压在游戏右侧按钮上会抢触摸
                if (__tid2.indexOf("ball:") === 0) {
                    try {
                        if (__tid2 === "ball:hide") { sgs.ui.hideBall(); sgs.log.i("[ball] 已收起悬浮球"); }
                        else { sgs.ui.showBall(); sgs.log.i("[ball] 已显示悬浮球"); }
                    } catch (__eb) { sgs.log.w("[ball] " + __eb); }
                    continue;
                }
                // 单存一帧：shot:名字
                if (__tid2.indexOf("shot:") === 0) {
                    try {
                        var __nm = __tid2.substring(5) || "now";
                        var __im2 = sgs.vision.frame(true);
                        if (__im2) {
                            var __p2 = "/sdcard/Download/autosgs-logs/shot_" + __nm + ".png";
                            images.save(__im2, __p2);
                            sgs.log.i("[shot] " + __p2);
                        }
                    } catch (__es2) { sgs.log.w("[shot] 失败 " + __es2); }
                    continue;
                }
                if (__tid2) {
                    sgs.log.i("[投递] " + __tid2);
                    // 直接调 runTask：它自己起任务线程并立即返回，外面再包一层线程只会让互斥提前释放
                    (function (tidc) {
                        try { sgs.ui.runTask(tidc, "投递-" + tidc); }
                        catch (et) { sgs.log.e("投递任务异常 " + et); }
                    })(__tid2);
                }
            }
        } catch (e7) { sgs.log.e("投递检查异常 " + e7); }
    }

    if (!sgs.PC || __cmdFail >= 10) continue;
    try {
        var cr = http.get(sgs.PC + "/cmd", { timeout: 8000 });
        __cmdFail = 0;
        var cmd = String(cr.body.string()).replace(/[ \r\n\t]+/g, "");
        if (cmd && cmd != "none") {
            sgs.log.i("[cmd] " + cmd);
            if (cmd.indexOf("run:") == 0) {
                var tid = cmd.substring(4);
                // 原来这里先清 _t0 再启动，等于主动绕过互斥，会让两个任务并行抢点击
                if (sgs.ui.isBusy()) sgs.log.w("[cmd] 任务运行中，拒绝 " + tid);
                else sgs.ui.runTask(tid, "远程-" + tid);
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
                    // 不再向 PC 拉 /src/main.js：那个路径映射早已不存在，且手机上的 _main.js
                    // 就是最新 bundle，自己重启最省事，也避免和投递版 reload 走两种行为
                    sgs.log.i("reload 本地重启");
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
                    toast("重启中");
                    engines.execScriptFile("/storage/emulated/0/脚本/auto-sgs/_main.js");
                    sgs.log.i("reload 新引擎已拉起");
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
    } catch (e) {
        // 原来这里是空 catch，__cmdFail 永远涨不上去：电脑端一挂，每轮仍要空等 8s 超时，
        // 心跳被拖成 11s 一次，投递和停止指令全跟着变慢
        __cmdFail++;
        if (__cmdFail === 1) sgs.log.w("[cmd] 电脑端服务不可达，暂停远程指令：" + e);
        if (__cmdFail >= 10) sgs.log.w("[cmd] 连续 10 次不可达，停用远程指令，只走本地投递");
    }
  }
});
}
