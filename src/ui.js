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
