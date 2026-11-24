// ===== bundle 引导：eval 环境自动落地为文件并重启 =====
var __SELF = "/storage/emulated/0/脚本/auto-sgs/_main.js";
var __SRC = String(engines.myEngine().getSource());

if (__SRC.indexOf("_main.js") < 0) {
    // 第一遍（由 bootstrap eval 进来）：把完整代码写进手机文件，然后交给新引擎，自己自然结束
    try {
        var __r = http.get("http://192.168.2.250:8099/src/main.js", { timeout: 20000 });
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


// ===== src/game.js =====

// game.js —— 游戏启动与主城检测
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.game = {
    PKG: "com.sanguosha.mjz.mi",

    /** 确保在游戏主城；返回 true/false */
    ensure: function (maxMs) {
        maxMs = maxMs || 120000;
        var v = sgs.vision;
        if (!v.init()) throw new Error("截图权限失败");

        // 先探一帧：已经在主城就直接返回（currentPackage 在该机上不可靠）
        var im = v.frame(true);
        if (im && v.isHome(im)) {
            sgs.log.i("已在主城，无需拉起");
            return true;
        }

        var cur = "";
        try { cur = currentPackage(); } catch (e) { cur = ""; }
        sgs.log.i("前台 " + cur + "，拉起游戏 " + this.PKG);
        try { app.launchPackage(this.PKG); } catch (e) { sgs.log.e("启动失败 " + e); }
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
                    sgs.log.i("重新申请横屏截图");
                    v._capOk = false;
                    v.reset();
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
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.playerinfo = {
    id: "playerinfo",
    name: "玩家信息读取",

    // 主城可直接读到的 6 个字段；level 需点头像开弹窗，单独处理
    FIELDS: [
        { key: "nickname", parser: "text" },
        { key: "level", parser: "level" },
        { key: "combat_power", parser: "text" },
        { key: "physical", parser: "fraction" },
        { key: "energy", parser: "fraction" },
        { key: "sycee", parser: "int" },
        { key: "jade", parser: "int" }
    ],

    run: function () {
        var v = sgs.vision;
        var roi = sgs.ROI.playerInfo;
        var out = {};

        if (!v.init()) throw new Error("截图权限获取失败");
        var img = v.frame(true);
        if (!img) throw new Error("截图失败");
        sgs.log.i("画面 " + img.getWidth() + "x" + img.getHeight());

        for (var i = 0; i < this.FIELDS.length; i++) {
            var f = this.FIELDS[i];
            var rect = roi[f.key];
            var raw = v.ocrRect(rect, img);
            var parsed = this._parse(f.parser, raw);
            out[f.key] = { raw: raw, value: parsed };
            if (parsed === null) {
                sgs.log.e(f.key + " 解析失败 原文=[" + raw + "]");
            } else {
                sgs.log.i(f.key + " = " + JSON.stringify(parsed) + "  原文=[" + raw + "]");
            }
        }
        return out;
    },

    _parse: function (type, raw) {
        var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
        if (type === "text") return s === "" ? null : s;
        if (type === "level") {
            // 等级上限三位数；OCR 常把「级」认成 2/1，多末尾一位就丢尾
            var m0 = s.replace(/\s+/g, "").match(/\d+/);
            if (!m0) return null;
            var v0 = m0[0];
            if (v0.length > 3) v0 = v0.substring(0, 3);
            return parseInt(v0, 10);
        }
        if (type === "int") {
            var m1 = s.replace(/[,\s]/g, "").match(/(\d+)/);
            return m1 ? parseInt(m1[1], 10) : null;
        }
        if (type === "fraction") {
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

    ENTRY: "xiaoqiao/xiaoqiao_entry.png",
    ENTRY_LEFT: [0, 0, 180, 1280],
    ENTRY_RIGHT: [2670, 0, 2772, 1280],
    ENTRY_RIGHT_TPL: "xiaoqiao/home-avatar.png",
    ENTRY_TH: 0.86,

    TAB_TEXT: "日常功能",
    TAB_REGION: [1820, 390, 2090, 535],

    KAIQI: "xiaoqiao/kaiqi.png",
    KAIQI_REGION: [1800, 700, 2150, 1050],
    KAIQI_TH: 0.8,

    COMPLETION_REGION: [1190, 1070, 1580, 1155],
    REWARD_REGION: [950, 70, 1850, 260],
    BLANK_TAP: [400, 640],
    RESULT_CLOSE: [1999, 89],
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

    _findReward: function () {
        var v = sgs.vision;
        return v.hasText("恭喜获得", this.REWARD_REGION) || v.hasText("贡献获得", this.REWARD_REGION);
    },

    _panelOpen: function () {
        return sgs.vision.hasImage(this.KAIQI, this.KAIQI_REGION, this.KAIQI_TH);
    },

    _openPanel: function () {
        var v = sgs.vision;
        if (v.hasText(this.TAB_TEXT, this.TAB_REGION)) {
            sgs.log.i("小乔助手面板已打开");
            return;
        }
        var t0 = new Date().getTime();
        var avatar = this._findAvatar();
        while (!avatar && new Date().getTime() - t0 < sgs.TIMEOUT.page) {
            sleep(800);
            avatar = this._findAvatar();
        }
        if (!avatar) throw new Error("未识别到小乔头像");
        v.clickRect(avatar);
        sgs.log.i("已点击小乔头像");
        if (!v.waitText(this.TAB_TEXT, this.TAB_REGION, sgs.TIMEOUT.page)) {
            throw new Error("点击头像后未确认助手面板");
        }
        sgs.log.i("小乔助手面板已打开");
    },

    _openDailyTab: function () {
        var v = sgs.vision;
        for (var t = 1; t <= 3; t++) {
            if (!v.hasText(this.TAB_TEXT, this.TAB_REGION)) {
                throw new Error("找不到「日常功能」Tab");
            }
            v.tapRect(this.TAB_REGION);
            sgs.log.i("点击「日常功能」Tab（第 " + t + " 轮）");
            var btn = v.waitImage(this.KAIQI, sgs.TIMEOUT.page, this.KAIQI_REGION, this.KAIQI_TH);
            if (btn) return btn;
        }
        throw new Error("连续 3 次未出现开启按钮");
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
        for (var c = 1; c <= 3 && v.hasText("执行完成", this.COMPLETION_REGION); c++) {
            v.clickPointAt(this.RESULT_CLOSE[0], this.RESULT_CLOSE[1]);
            var d3 = new Date().getTime();
            while (new Date().getTime() - d3 < sgs.TIMEOUT.ui && v.hasText("执行完成", this.COMPLETION_REGION)) sleep(700);
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

        v.clickRect(btn);
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
            if (v.hasText("执行完成", this.COMPLETION_REGION)) {
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


// ===== src/ui.js =====

// ui.js —— 悬浮球 / 控制面板
// 纯 Java View + WindowManager 直挂（floaty 在本机 eval 环境会 NPE）
// 颜色统一走 hex()，避免 Rhino 把 0xFFxxxxxx 当大数传给 int 参数溢出
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.ui = {
    _wm: null,
    _main: null,
    _ctx: null,
    dp: 1,

    ballView: null,
    ballLp: null,
    panelView: null,
    _statusTv: null,
    _thread: null,
    _t0: 0,

    TASKS: [
        { id: "playerinfo", icon: "人", title: "读取玩家信息", desc: "昵称 · 等级 · 战力 · 资源", color: "FF2B5C9E" },
        { id: "mail", icon: "邮", title: "邮件全部领取", desc: "领完并关闭弹窗回主城", color: "FF356B4E" },
        { id: "xiaoqiao", icon: "乔", title: "小乔 · 一键日常", desc: "开启日常并等完成（会耗元宝）", color: "FF7A5128" },
        { id: "shot", icon: "图", title: "截屏回传", desc: "把当前画面发到电脑", color: "FF4A4A55" }
    ],

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
                        try { sgs.log.e("UI异常 " + e); sgs.pushLog(); } catch (e2) { }
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

    _lp: function (w, h, x, y) {
        var lp = new android.view.WindowManager.LayoutParams();
        lp.type = android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        lp.format = android.graphics.PixelFormat.RGBA_8888;
        lp.flags = android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        // 用 BOTTOM|END 对齐，屏幕横竖切换时位置自动跟着走
        lp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.END;
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
        tv.setGravity(android.view.Gravity.CENTER_VERTICAL);
        if (bold) tv.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return tv;
    },

    _v: function (w, h) {
        var v = new android.view.View(this._ctx);
        var lp = new android.widget.LinearLayout.LayoutParams(w, h);
        v.setLayoutParams(lp);
        return v;
    },

    // ---------------- 球 ----------------
    showBall: function () {
        if (!this._ctx) this._init();
        if (this.ballView) return;
        var self = this;

        var tv = new android.widget.TextView(this._ctx);
        tv.setText("三");
        tv.setTextSize(21);
        tv.setTextColor(this.hex("FFFFFFFF"));
        tv.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        tv.setGravity(android.view.Gravity.CENTER);
        tv.setBackground(this._shape("FF1B6FD4", "FF7FB3F0", 2, -1));
        tv.setElevation(this.px(8));

        var size = this.px(62);
        // 贴右下角：x/y 是相对 BOTTOM|END 的偏移（负值向内）
        var lp = this._lp(size, size, -this.px(14), -this.px(150));
        this.ballLp = lp;

        // 拖动 + 点击（END 方向下 dx 需要反号）
        var startX = 0, startY = 0, baseX = lp.x, baseY = lp.y, moved = false;
        tv.setOnTouchListener(new android.view.View.OnTouchListener({
            onTouch: function (v, ev) {
                var act = ev.getAction();
                if (act == 0) {
                    startX = ev.getRawX();
                    startY = ev.getRawY();
                    baseX = self.ballLp.x;
                    baseY = self.ballLp.y;
                    moved = false;
                    return true;
                } else if (act == 2) {
                    var dx = ev.getRawX() - startX;
                    var dy = ev.getRawY() - startY;
                    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) moved = true;
                    self.ballLp.x = Math.round(baseX - dx);
                    self.ballLp.y = Math.round(baseY - dy);
                    try { self._wm.updateViewLayout(v, self.ballLp); } catch (e) { }
                    return true;
                } else if (act == 1) {
                    if (!moved) self.togglePanel();
                    return true;
                }
                return false;
            }
        }));

        this.ballView = tv;
        this._post(function () { self._wm.addView(tv, lp); });
        sgs.log.i("悬浮球已显示");
    },

    // ---------------- 面板 ----------------
    togglePanel: function () {
        if (this.panelView) { this.hidePanel(); } else { this.showPanel(); }
    },

    hidePanel: function () {
        if (!this.panelView) return;
        var self = this;
        var v = this.panelView;
        this.panelView = null;
        this._statusTv = null;
        this._post(function () {
            try { self._wm.removeView(v); } catch (e) { }
        });
    },

    showPanel: function () {
        if (!this._ctx) this._init();
        var self = this;
        var W = this.px(258);

        // 外层卡片
        var root = new android.widget.LinearLayout(this._ctx);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setBackground(this._shape("FF14171C", "FF333A44", 1, 16));
        root.setPadding(this.px(12), this.px(12), this.px(12), this.px(12));
        root.setElevation(this.px(10));

        // 标题行
        var head = new android.widget.LinearLayout(this._ctx);
        head.setOrientation(android.widget.LinearLayout.HORIZONTAL);

        var dot = this._v(this.px(8), this.px(8));
        dot.setBackground(this._shape(this.isBusy() ? "FFFF8B3D" : "FF3DDC84", null, 1, -1));
        var lpDot = new android.widget.LinearLayout.LayoutParams(this.px(8), this.px(8));
        lpDot.setMargins(0, 0, this.px(7), 0);
        dot.setLayoutParams(lpDot);
        head.addView(dot);

        var title = this._tv("名将传 · 助手", 15, "FFF5F7FA", true);
        head.addView(title);

        var status = this._tv(this.isBusy() ? "运行中" : "空闲", 11, "FF8C97A5", false);
        var lpSt = new android.widget.LinearLayout.LayoutParams(0, -2, 1);
        lpSt.setMargins(this.px(8), 0, 0, 0);
        status.setLayoutParams(lpSt);
        head.addView(status);
        this._statusTv = status;

        var close = this._tv("✕", 16, "FF9AA5B1", false);
        close.setGravity(android.view.Gravity.CENTER);
        var lpC = new android.widget.LinearLayout.LayoutParams(this.px(30), this.px(30));
        close.setLayoutParams(lpC);
        close.setClickable(true);
        close.setOnClickListener(new android.view.View.OnClickListener({
            onClick: function (v) { self.hidePanel(); }
        }));
        head.addView(close);

        root.addView(head);

        // 细分隔线
        var line = this._v(-1, this.px(1));
        line.setBackgroundColor(this.hex("FF262C35"));
        var lpLine = new android.widget.LinearLayout.LayoutParams(-1, this.px(1));
        lpLine.setMargins(0, this.px(10), 0, this.px(4));
        line.setLayoutParams(lpLine);
        root.addView(line);

        // 任务行
        for (var i = 0; i < this.TASKS.length; i++) {
            root.addView(this._row(this.TASKS[i]));
        }

        // 停止按钮
        var stop = this._tv("停止当前任务", 14, "FFFFD9D9", true);
        stop.setGravity(android.view.Gravity.CENTER);
        stop.setBackground(this._shape("FF5A2328", "FF8C3A41", 1, 10));
        stop.setPadding(0, this.px(11), 0, this.px(11));
        var lpS = new android.widget.LinearLayout.LayoutParams(-1, -2);
        lpS.setMargins(0, this.px(10), 0, 0);
        stop.setLayoutParams(lpS);
        stop.setClickable(true);
        stop.setOnClickListener(new android.view.View.OnClickListener({
            onClick: function (v) { self.stopAll(); }
        }));
        root.addView(stop);

        // 位置：面板出现在球上方偏左
        var bx = this.ballLp ? this.ballLp.x : -this.px(14);
        var by = this.ballLp ? this.ballLp.y : -this.px(150);
        var px0 = bx - this.px(6);
        var py0 = by - this.px(250);

        var lpP = this._lp(W, -2, px0, py0);
        this.panelView = root;
        this._post(function () { self._wm.addView(root, lpP); });
        sgs.log.i("面板已展开");
    },

    /** 单条任务行 */
    _row: function (t) {
        var self = this;
        var row = new android.widget.LinearLayout(this._ctx);
        row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        row.setBackground(this._shape("FF1C2129", "FF2A313B", 1, 10));
        row.setPadding(this.px(10), this.px(9), this.px(10), this.px(9));
        row.setClickable(true);
        var lp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, this.px(6), 0, 0);
        row.setLayoutParams(lp);

        // 图标块
        var icon = this._tv(t.icon, 13, "FFFFFFFF", true);
        icon.setGravity(android.view.Gravity.CENTER);
        icon.setBackground(this._shape(t.color, null, 1, 8));
        var lpI = new android.widget.LinearLayout.LayoutParams(this.px(30), this.px(30));
        icon.setLayoutParams(lpI);
        row.addView(icon);

        // 文字区
        var txt = new android.widget.LinearLayout(this._ctx);
        txt.setOrientation(android.widget.LinearLayout.VERTICAL);
        var lp2 = new android.widget.LinearLayout.LayoutParams(0, -2, 1);
        lp2.setMargins(this.px(10), 0, this.px(6), 0);
        txt.setLayoutParams(lp2);

        var name = this._tv(t.title, 14, "FFF2F5F8", true);
        txt.addView(name);

        var desc = this._tv(t.desc, 10, "FF7E8894", false);
        txt.addView(desc);

        row.addView(txt);

        var arrow = this._tv("›", 16, "FF6C7683", false);
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

    // ---------------- 执行 ----------------
    isBusy: function () {
        if (!this._t0) return false;
        return (new Date().getTime() - this._t0) < 300000;
    },

    runTask: function (id, label) {
        var self = this;
        if (this.isBusy()) { toast("任务执行中"); return; }
        this._t0 = new Date().getTime();
        this._thread = threads.start(function () {
            var t0 = new Date().getTime();
            try {
                sgs.log.i("=== 开始 " + label + " ===");
                if (id === "shot") {
                    sgs.pushShot();
                    sgs.log.i("=== 截屏已回传 ===");
                    toast("截图已上传");
                    return;
                }
                if (!sgs.game.ensure(120000)) throw new Error("未进入主城");
                var task = sgs.tasks[id];
                if (!task) throw new Error("任务不存在 " + id);
                task.run();
                var cost = Math.round((new Date().getTime() - t0) / 1000);
                sgs.log.i("=== " + label + " 完成 " + cost + "s ===");
                toast(label + " 完成 " + cost + "s");
            } catch (e) {
                sgs.log.e("任务异常: " + e);
                toast("异常: " + e);
            } finally {
                self._t0 = 0;
                self._thread = null;
                try { if (id !== "shot" && sgs.pushShot) sgs.pushShot(); } catch (e2) { }
                sgs.ui.refreshLog();
            }
        });
    },

    stopAll: function () {
        try {
            if (this._thread) this._thread.interrupt();
        } catch (e) { }
        this._t0 = 0;
        this._thread = null;
        toast("已请求停止");
    },

    refreshLog: function () {
        if (sgs.pushLog) sgs.pushLog();
    }
};

// ===== 启动（分步执行，每步单独 catch，便于定位）=====
sgs.log.i("=== 悬浮面板启动 " + new Date().toTimeString().substring(0, 8) + " ===");
try { sgs.log.i(device.brand + " " + device.model + " / Android " + device.release); } catch (e0) { }

sgs.log.i("step2 截图权限");
try {
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
setInterval(function () {
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
                    var nr = http.get(sgs.PC + "/src/main.js", { timeout: 25000 });
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
}, 3000);
}
