// ui.js —— 悬浮球 / 快捷圆盘 / 完整面板
// 纯 Java View + WindowManager 直挂（floaty 在本机不可用，会 NPE）
// 颜色统一走 hex()：Rhino 把 0xFFxxxxxx 当大数传 int 会溢出，必须转有符号 int
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.ui = {
    _wm: null, _main: null, _ctx: null, dp: 1,

    ballView: null, ballLp: null,
    _views: [], _disposed: false,
    dockView: null,
    panelView: null, dailySettingsView: null, statusBadgeView: null, resultsView: null,
    _statusTv: null, _logTv: null, _taskStatusTv: null, _statusTick: null,

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
        { id: "zhuxian", icon: "副", title: "主线副本扫荡", desc: "最新回扫荡 5 次（0 次时花 20 元宝重置）", color: "FF8A5A2B" },
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

    // 退出回调必须等主线程移除窗口后才结束，不能只排一个随后失效的 JS 回调。
    _onMainSync: function (fn) {
        if (!this._main) this._init();
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) { fn(); return; }
        var latch = new java.util.concurrent.CountDownLatch(1);
        var interrupted = java.lang.Thread.interrupted();
        try {
            var accepted = this._main.post(new java.lang.Runnable({ run: function () {
                try { fn(); } catch (e) { sgs.log.e("清理窗口异常 " + e); }
                finally { latch.countDown(); }
            } }));
            if (!accepted || !latch.await(3000, java.util.concurrent.TimeUnit.MILLISECONDS)) sgs.log.w("等待窗口清理超时");
        } finally { if (interrupted) java.lang.Thread.currentThread().interrupt(); }
    },

    _attachWindow: function (view, lp, kind, field) {
        var self = this;
        view.setTag("auto-sgs:" + kind);
        lp.setTitle("auto-sgs:" + kind);
        this._post(function () {
            // hide/dispose 可能发生在 addView 回调执行之前。
            if (self._disposed || self[field] !== view) return;
            try { self._wm.addView(view, lp); self._views.push(view); }
            catch (e) {
                if (self[field] === view) self[field] = null;
                sgs.log.e("添加悬浮窗失败 " + kind + " " + e);
            }
        });
    },

    _viewIndex: function (view) {
        for (var i = 0; i < this._views.length; i++) {
            if (this._views[i] === view) return i;
            try { if (this._views[i].equals(view)) return i; } catch (e) { }
        }
        return -1;
    },

    _removeWindowNow: function (view) {
        if (!view) return;
        try {
            if (view.isAttachedToWindow()) this._wm.removeViewImmediate(view);
            var i = this._viewIndex(view);
            if (i >= 0) this._views.splice(i, 1);
        } catch (e) { sgs.log.w("移除悬浮窗失败 " + e); }
    },

    _removeWindow: function (view) {
        var self = this;
        this._post(function () { self._removeWindowNow(view); });
    },

    // API 29+ 的公开接口，只列举本应用进程的窗口，不操作其他应用窗口。
    recoverOrphans: function () {
        var self = this, removed = 0;
        this._onMainSync(function () {
            try {
                var roots = android.view.inspector.WindowInspector.getGlobalWindowViews();
                var candidates = [];
                for (var i = 0; i < roots.size(); i++) {
                    var view = roots.get(i);
                    if (self._viewIndex(view) >= 0) continue;
                    var lp = view.getLayoutParams();
                    if (!lp || lp.type != android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY) continue;
                    var tag = String(view.getTag());
                    var owned = tag === "auto-sgs:ball" || tag === "auto-sgs:dock" || tag === "auto-sgs:panel" || tag === "auto-sgs:daily-settings" || tag === "auto-sgs:status" || tag === "auto-sgs:results";
                    // 兼容旧版无标签的球：同时匹配类型、文字、尺寸、背景形状及颜色。
                    if (!owned && view instanceof android.widget.TextView && String(view.getText()) === "三"
                        && lp.width === self.px(54) && lp.height === self.px(54)) {
                        var bg = view.getBackground();
                        if (bg instanceof android.graphics.drawable.GradientDrawable
                            && bg.getShape() === android.graphics.drawable.GradientDrawable.OVAL && bg.getColor()) {
                            var color = bg.getColor().getDefaultColor();
                            owned = (color === self.hex(self.C.bg) || color === self.hex(self.C.ballOn))
                                && view.getCurrentTextColor() === self.hex("FFF2E2C0");
                        }
                    }
                    if (owned) candidates.push(view);
                }
                if (candidates.length > 64) throw new Error("匹配数量异常，保留所有窗口等待检查");
                for (var c = 0; c < candidates.length; c++) {
                    self._removeWindowNow(candidates[c]);
                    if (!candidates[c].isAttachedToWindow()) removed++;
                }
            } catch (e) { sgs.log.w("检查本项目残留窗口失败 " + e); }
        });
        sgs.log.i("清理本项目残留悬浮窗 " + removed + " 个");
        return removed;
    },

    dispose: function () {
        this._disposed = true;
        this._stopTick();
        if (this._statusTick) { try { clearInterval(this._statusTick); } catch (e) { } this._statusTick = null; }
        if (sgs.statusUI) sgs.statusUI.stop();
        this.ballView = null; this.ballLp = null;
        this.dockView = null; this.panelView = null; this.dailySettingsView = null;
        this._statusTv = null; this._logTv = null; this._taskStatusTv = null;
        this.statusBadgeView = null; this.resultsView = null;
        var self = this;
        this._onMainSync(function () {
            var views = self._views.slice();
            for (var i = 0; i < views.length; i++) self._removeWindowNow(views[i]);
        });
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
        var self = this;
        this._post(function () { self._showBall(); });
    },

    _showBall: function () {
        if (this._disposed || this.ballView) return;
        if (!this._ctx) this._init();
        var self = this;

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
                if (self._disposed || self.ballView !== v) return true;
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
                        if (self.isBusy()) { self.stopAll(); return true; }
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
        this._attachWindow(tv, lp, "ball", "ballView");
        this._startStatusTick();
        sgs.log.i("悬浮球已显示");
    },

    hideBall: function () {
        var v = this.ballView;
        if (!v) return;
        this.ballView = null;
        this.ballLp = null;
        this._removeWindow(v);
    },

    _paintBall: function (busy) {
        var v = this.ballView;
        if (!v) return;
        var self = this;
        this._post(function () {
            try {
                v.setText(busy ? "停" : "三");
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
        this._removeWindow(v);
    },

    showDock: function () {
        if (this.isBusy()) { toast("任务执行中，点悬浮球「停」可停止"); return; }
        if (this._disposed) return;
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
        this._attachWindow(root, lp, "dock", "dockView");
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

            var lbl = this._tv(t.id === "playerinfo" ? "信息" : t.id === "mail" ? "邮件" : t.id === "xiaoqiao" ? "小乔" : t.id === "junqing" ? "军情" : t.id === "zhuxian" ? "副本" : t.id === "daily" ? "日常" : "截图", 9, this.C.sub, false);
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
        if (this.isBusy()) { toast("任务执行中，请看底部状态；点「停」可停止"); return; }
        if (this._disposed) return;
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

        if (sgs.taskStatus) {
            this._taskStatusTv = this._tv(sgs.taskStatus.title() + "\n" + sgs.taskStatus.detail(), 11, this.C.text, false);
            this._taskStatusTv.setPadding(0, this.px(8), 0, this.px(8));
            root.addView(this._taskStatusTv);
            var records = this._tv("执行状态与最近记录 ›", 12, this.C.gold, true);
            records.setPadding(0, this.px(8), 0, this.px(8));
            records.setClickable(true);
            records.setOnClickListener(new android.view.View.OnClickListener({ onClick: function () { self.showTaskResults(); } }));
            root.addView(records);
        }
        if (sgs.dailyUI) {
            var settings = this._tv("日常设置 · 勾选与排序 ›", 12, this.C.gold, true);
            settings.setPadding(0, this.px(10), 0, this.px(10));
            settings.setClickable(true);
            settings.setOnClickListener(new android.view.View.OnClickListener({
                onClick: function () { sgs.dailyUI.show(); }
            }));
            root.addView(settings);
        }
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

        // 横屏空间有限，完整面板可滚动，避免新增设置把底部按钮挤出屏幕。
        var scroll = new android.widget.ScrollView(this._ctx);
        scroll.setFillViewport(true);
        scroll.addView(root);
        var height = Math.max(1, Math.min(this._ctx.getResources().getDisplayMetrics().heightPixels - this.px(32), this.px(600)));
        var lp = this._lp(W, height, this.px(8), 0, android.view.Gravity.RIGHT | android.view.Gravity.CENTER_VERTICAL);
        this.panelView = scroll;
        this._attachWindow(scroll, lp, "panel", "panelView");
        this._startTick();
        sgs.log.i("完整面板已展开");
    },

    hidePanel: function () {
        this._stopTick();
        var v = this.panelView;
        if (!v) return;
        this.panelView = null;
        this._statusTv = null;
        this._logTv = null; this._taskStatusTv = null;
        this._removeWindow(v);
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
        var description = t.desc;
        if (t.id === "daily" && sgs.daily) {
            try { description = sgs.daily.planLabel(); }
            catch (e) { description = "配置需检查，请打开日常设置"; }
        }
        box.addView(this._tv(description, 9, this.C.sub, false));
        if (t.id === "daily" && sgs.daily) box.addView(this._tv(sgs.daily.lastSummary(), 9, this.C.sub, false));
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
        if (this._taskStatusTv && sgs.taskStatus) {
            try { this._taskStatusTv.setText(sgs.taskStatus.title() + "\n" + sgs.taskStatus.detail()); } catch (e) { }
        }
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

    // 状态条的刷新不依赖完整面板是否展开。
    _startStatusTick: function () {
        if (!sgs.statusUI || !sgs.taskStatus || this._statusTick) return;
        var self = this;
        this._statusTick = setInterval(function () {
            if (!self._disposed) { sgs.statusUI.refresh(); self._post(function () { self._refresh(); }); }
        }, 900);
        sgs.statusUI.refresh();
    },
    _beginStatus: function (token, id, label) {
        if (!sgs.taskStatus) return;
        sgs.taskStatus.begin(token, { id: id, label: label || id });
        this._startStatusTick();
        if (sgs.statusUI) sgs.statusUI.refresh();
    },
    _stepStatus: function (token, phase, detail) {
        if (sgs.taskStatus) sgs.taskStatus.step(token, phase, detail);
        if (sgs.statusUI) sgs.statusUI.refresh();
    },
    _finishStatus: function (token, status, message, items) {
        if (sgs.taskStatus) sgs.taskStatus.finish(token, status, message, items);
        if (sgs.statusUI) sgs.statusUI.refresh();
    },
    showTaskResults: function () {
        if (this.isBusy()) { toast("任务执行中，请看底部状态；点悬浮球「停」可停止"); return; }
        if (sgs.statusUI) sgs.statusUI.showResults();
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
        this.hideDock(); this.hidePanel();
        if (sgs.dailyUI) sgs.dailyUI.hide();
        if (id === "daily") { this.runDaily(label); return; }
        this._t0 = new Date().getTime();
        this._paintBall(true);
        var token = {};
        this._token = token;
        this._beginStatus(token, id, label || id);
        if (sgs.statusUI) sgs.statusUI.hideResults();
        this._thread = threads.start(function () {
            var t0 = new Date().getTime();
            var outcome = { status: "failed", message: "任务没有完成" };
            try {
                sgs.log.i("=== 开始 " + label + " ===");
                if (id === "shot") {
                    self._stepStatus(token, "截图回传", "正在截图并检查回传结果");
                    var sent = sgs.pushShot();
                    outcome = sent === true ? { status: "success", message: "截图已回传" }
                        : { status: "failed", message: sgs.lastShotError || "截图未回传，请检查电脑端地址和连接" };
                    toast(outcome.message);
                    self._lastResult = outcome.message;
                    return;
                }
                self._stepStatus(token, "确认主城", "检查当前主城，不自动登录或切号");
                if (!sgs.dailyRecovery.ensureHome(null, function () { return self._token !== token; }, false)) {
                    throw new Error("未确认主城，请先手动登录；不会自动登录或切号");
                }
                var task = sgs.tasks[id];
                if (!task) throw new Error("任务不存在 " + id);
                var result = task.run({ checkCancelled: function () {
                    if (self._token !== token) { var e = new Error("任务已停止"); e.cancelled = true; throw e; }
                }, onProgress: function (phase, detail) {
                    if (self._token === token) self._stepStatus(token, phase, phase + " · " + detail);
                } });
                self._stepStatus(token, "核对主城", "操作结束，复检主城后确定最终结果");
                var state = sgs.daily._result(id, result);
                if (!sgs.dailyRecovery.ensureHome(id, function () { return self._token !== token; }, false)) {
                    state = { status: "failed", message: state.message + "；操作后未确认回到主城" };
                }
                outcome = state;
                var names = { success: "成功", skipped: "跳过", unconfirmed: "待确认", failed: "失败" };
                var cost = Math.round((new Date().getTime() - t0) / 1000);
                sgs.log.i("=== " + label + " " + names[state.status] + " " + cost + "s：" + state.message + " ===");
                if (self._token === token) {
                    toast(label + " " + names[state.status] + " " + cost + "s");
                    self._lastResult = label + " " + names[state.status] + " " + cost + "s";
                }
            } catch (e) {
                outcome = { status: "failed", message: String(e) };
                sgs.log.e("任务异常: " + e + " || stack=" + (e && e.stack ? e.stack : "-"));
                if (self._token === token) { toast("异常: " + e); self._lastResult = label + "失败 · " + e; }
            } finally {
                if (sgs.taskStatus) sgs.taskStatus.finishing(token, "结果已记录，正在收尾");
                try { if (id !== "shot" && sgs.pushShot) sgs.pushShot(); } catch (e2) { }
                try { sgs.pushLog(); } catch (e3) { }
                self._finishStatus(token, self._token === token ? outcome.status : "stopped",
                    self._token === token ? outcome.message : "用户停止；最后状态：" + outcome.message);
                // 回传也属于本线程；完成后才释放互斥。
                if (self._token === token) {
                    self._t0 = 0;
                    self._thread = null;
                    self._paintBall(false);
                }
                self._post(function () { self._refresh(); });
            }
        });
    },

    /** 日常顺序、选择、结果和恢复统一交给执行器。 */
    runDaily: function (label, planOverride) {
        var self = this;
        if (this.isBusy()) { toast("任务执行中"); return; }
        this.hideDock(); this.hidePanel();
        if (sgs.dailyUI) sgs.dailyUI.hide();
        this._t0 = new Date().getTime();
        this._paintBall(true);
        var token = {};
        this._token = token;
        this._beginStatus(token, "daily", label || "一键日常");
        if (sgs.statusUI) sgs.statusUI.hideResults();
        this._thread = threads.start(function () {
            var terminal = "failed", message = "日常没有完成", items = [];
            try {
                self._stepStatus(token, "确认主城", "检查日常方案与手动主城");
                sgs.log.i("=== 开始 " + (label || "一键日常") + "：" + sgs.daily.planLabel(planOverride) + " ===");
                var report = sgs.daily.run({
                    plan: planOverride,
                    isCancelled: function () { return self._token !== token; },
                    onProgress: function (index, total, item) {
                        if (self._token !== token) return;
                        self._lastResult = "日常 " + index + "/" + total + " · " + item.name;
                        self._stepStatus(token, "日常执行", index + "/" + total + " · " + item.name + "开始");
                        self._post(function () { self._refresh(); });
                    },
                    onTaskProgress: function (index, total, item, phase, detail) {
                        if (self._token === token) self._stepStatus(token, phase, index + "/" + total + " " + item.name + " · " + phase + " · " + detail);
                    }
                });
                self._dailyReport = report;
                var msg = sgs.daily.formatReport(report);
                items = report.items;
                message = msg + (report.error ? "；" + report.error : "");
                terminal = report.status === "success" ? "success" : report.status === "empty" ? "skipped"
                    : report.status === "cancelled" ? "stopped" : report.counts.unconfirmed ? "unconfirmed" : "failed";
                sgs.log.i("=== 一键日常 " + msg + (report.error ? "；" + report.error : "") + " ===");
                if (self._token === token) { toast(msg); self._lastResult = "日常 " + msg; }
            } catch (e) {
                message = String(e);
                sgs.log.e("一键日常异常: " + e);
                if (self._token === token) { toast("日常未完成：" + e); self._lastResult = "日常失败 · " + e; }
            } finally {
                if (sgs.taskStatus) sgs.taskStatus.finishing(token, "日常结果已记录，正在收尾");
                try { if (sgs.pushShot) sgs.pushShot(); } catch (e4) { }
                try { sgs.pushLog(); } catch (e5) { }
                self._finishStatus(token, self._token === token ? terminal : "stopped",
                    self._token === token ? message : "用户停止；" + message, items);
                if (self._token === token) {
                    self._t0 = 0;
                    self._thread = null;
                    self._paintBall(false);
                }
                self._post(function () { self._refresh(); });
            }
        });
    },

    stopAll: function () {
        var self = this;
        var th = this._thread;
        var stoppedToken = this._token;
        if (th && sgs.taskStatus) sgs.taskStatus.stopping(stoppedToken);
        if (sgs.statusUI) sgs.statusUI.refresh();
        // 旧任务不能再清理状态；保留线程引用，直到它实际退出才解除互斥。
        this._token = null;
        this._t0 = 0;
        if (!th) {
            this._lastResult = "已手动停止";
            this._paintBall(false);
            toast("已停止");
            return;
        }
        this._lastResult = "正在停止";
        try { th.interrupt(); } catch (e) { sgs.log.e("请求停止失败 " + e); }
        toast("已请求停止，等待任务退出");
        // 停止按钮在 Android 主线程执行，不能在这里 sleep 等待，更不能超时后放行。
        threads.start(function () {
            try {
                while (th.isAlive()) sleep(100);
            } catch (e2) {
                sgs.log.e("等待任务退出失败 " + e2);
                return; // 无法确认退出时保留线程引用，不宣告已经停止
            }
            // 新任务可能在旧线程退出后已经启动，不能清除新任务的状态。
            if (self._thread !== th) return;
            self._finishStatus(stoppedToken, "stopped", "用户已停止，任务线程已经退出");
            self._thread = null;
            self._lastResult = "已手动停止";
            self._paintBall(false);
            self._post(function () { self._refresh(); });
        });
    },

    refreshLog: function () {
        if (sgs.pushLog) sgs.pushLog();
        var self = this;
        this._post(function () { self._refresh(); });
    }
};

if (typeof events !== "undefined") {
    events.on("exit", function () {
        try { sgs.ui.dispose(); } catch (e) { try { sgs.log.e("退出清理失败 " + e); } catch (ignored) { } }
    });
}
