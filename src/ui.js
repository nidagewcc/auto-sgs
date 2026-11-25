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
        { id: "junqing", icon: "军", title: "紧急军情 · 一键挑战", desc: "三关一键挑战（耗体力约 30）", color: "FFA34A2A" },
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

        // 第一行：信息 / 邮件 / 小乔
        root.addView(this._dockRow([this.TASKS[0], this.TASKS[1], this.TASKS[2]]));
        // 第二行：军情 / 一键日常 / 更多（截图改到面板里点，圆盘只留 6 格）
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

            var lbl = this._tv(t.id === "playerinfo" ? "信息" : t.id === "mail" ? "邮件" : t.id === "xiaoqiao" ? "小乔" : t.id === "junqing" ? "军情" : t.id === "daily" ? "日常" : "截图", 9, this.C.sub, false);
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
