// status-ui.js —— 只展示任务模型；常驻刷新由 ui ticker 驱动。
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.statusUI = {
    _stopped: false, _badgeRequest: 0, _resultsRequest: 0,
    _badgePending: false, _resultsPending: false, _refreshPending: false,
    _badgeTitle: null, _badgeDetail: null, _currentTitle: null, _currentDetail: null, _stopButton: null,
    _state: function (status) {
        var ui = sgs.ui, s = String(status || "").toLowerCase();
        if (s === "running" || s === "pending" || s === "started" || s === "stopping" || s === "finishing") return { text: "运行中", color: ui.C.busy };
        if (s === "success" || s === "succeeded" || s === "completed" || s === "done") return { text: "成功", color: ui.C.ok };
        if (s === "uncertain" || s === "unconfirmed" || s === "needs_confirmation" || s === "needs_confirm") return { text: "待确认", color: ui.C.gold };
        if (s === "failed" || s === "failure" || s === "error") return { text: "失败", color: ui.C.danger };
        if (s === "not_run") return { text: "未执行", color: ui.C.sub };
        if (s === "skipped" || s === "skip") return { text: "已跳过", color: ui.C.sub };
        if (s === "stopped" || s === "cancelled" || s === "canceled") return { text: "已停止", color: ui.C.sub };
        return { text: "待确认", color: ui.C.gold };
    },
    _latest: function () {
        var model = sgs.taskStatus, current = model.current(), history;
        if (current) return current;
        history = model.history() || [];
        return history.length ? history[0] : null;
    },
    _title: function (record) { return String(sgs.taskStatus.title(record) || (record && (record.label || record.id)) || "暂无任务"); },
    _detail: function (record) { return String(sgs.taskStatus.detail(record) || (record && record.message) || ""); },
    _vertical: function (ui) {
        var v = new android.widget.LinearLayout(ui._ctx);
        v.setOrientation(android.widget.LinearLayout.VERTICAL);
        v.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        return v;
    },
    showBadge: function () {
        var self = this, ui = sgs.ui;
        if (this._stopped || ui._disposed || ui.statusBadgeView || this._badgePending) return;
        this._badgePending = true;
        var request = ++this._badgeRequest;
        ui._post(function () {
            if (request !== self._badgeRequest) return;
            self._badgePending = false;
            if (self._stopped || ui._disposed || ui.statusBadgeView) return;
            var record = self._latest();
            if (!record) return;
            var root = self._vertical(ui);
            root.setPadding(ui.px(8), ui.px(3), ui.px(8), ui.px(3));
            root.setBackground(ui._shape(ui.C.bg, ui.C.line, 1, 0));
            self._badgeTitle = ui._tv("", 10, ui.C.text, false);
            self._badgeDetail = ui._tv("", 10, ui.C.sub, false);
            var lines = [self._badgeTitle, self._badgeDetail];
            for (var i = 0; i < lines.length; i++) {
                lines[i].setMaxLines(1);
                lines[i].setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
                root.addView(lines[i]);
            }
            var lp = ui._lp(ui.px(220), ui.px(44), 0, ui.px(8), android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL);
            lp.flags |= android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
            // Android 12+ also checks overlay opacity before passing touches through.
            lp.alpha = 0.7;
            ui.statusBadgeView = root;
            self._updateBadge(record);
            ui._attachWindow(root, lp, "status", "statusBadgeView");
        });
    },
    _updateBadge: function (record) {
        if (!sgs.ui.statusBadgeView || !this._badgeTitle) return;
        this._badgeTitle.setText(this._title(record) + " · " + this._duration(record));
        this._badgeTitle.setTextColor(sgs.ui.hex(this._state(record.status).color));
        this._badgeDetail.setText(this._detail(record));
    },
    refresh: function () {
        var self = this, ui = sgs.ui;
        if (this._stopped || ui._disposed || this._refreshPending) return;
        this._refreshPending = true;
        var badgeRequest = this._badgeRequest;
        ui._post(function () {
            self._refreshPending = false;
            if (self._stopped || ui._disposed) return;
            var record = self._latest();
            if (record) {
                if (ui.statusBadgeView) self._updateBadge(record);
                else if (badgeRequest === self._badgeRequest) self.showBadge();
            } else self.hideBadge();
            if (ui.resultsView) self._updateCurrent();
        });
    },
    _updateCurrent: function () {
        var record = sgs.taskStatus.current(), latest = record || this._latest(), ui = sgs.ui;
        if (!this._currentTitle || !ui.resultsView) return;
        this._currentTitle.setText(latest ? this._title(latest) + " · " + this._state(latest.status).text : "当前空闲");
        this._currentTitle.setTextColor(ui.hex(latest ? this._state(latest.status).color : ui.C.sub));
        this._currentDetail.setText(latest ? this._detail(latest) : "尚无执行状态");
        this._stopButton.setVisibility(record && this._state(record.status).text === "运行中" ? 0 : 8);
    },
    _time: function (value) {
        if (value === null || typeof value === "undefined" || value === "") return "未知";
        var date = new Date(value);
        if (isNaN(date.getTime())) return String(value);
        function pad(n) { return n < 10 ? "0" + n : String(n); }
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
    },
    _duration: function (record) {
        var ms = record.durationMs;
        if (ms === null || typeof ms === "undefined") ms = record.endedAt && record.startedAt ? new Date(record.endedAt).getTime() - new Date(record.startedAt).getTime() : null;
        return ms === null || !isFinite(ms) ? "未知" : Math.max(0, Math.round(ms / 1000)) + "秒";
    },
    _resultsBusy: function (ui) {
        if (typeof ui.isBusy !== "function" || !ui.isBusy()) return false;
        toast("任务执行中，请看底部状态；点击悬浮球「停」可停止");
        return true;
    },
    showResults: function () {
        var self = this, ui = sgs.ui;
        if (this._stopped || ui._disposed || ui.resultsView || this._resultsPending) return;
        if (this._resultsBusy(ui)) return;
        this._resultsPending = true;
        var request = ++this._resultsRequest;
        ui._post(function () {
            if (request !== self._resultsRequest) return;
            self._resultsPending = false;
            if (self._stopped || ui._disposed || ui.resultsView) return;
            if (self._resultsBusy(ui)) return;
            ui.hideDock(); ui.hidePanel();
            if (request !== self._resultsRequest || self._stopped || ui._disposed) return;
            var root = self._vertical(ui);
            root.setPadding(ui.px(10), ui.px(10), ui.px(10), ui.px(10));
            root.setBackground(ui._shape(ui.C.bg, ui.C.goldDim, 1, 10));
            function text(value, color) { var tv = ui._tv(value, 12, color || ui.C.text, false); tv.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2)); return tv; }
            function button(value, callback) {
                var v = text(value, ui.C.gold);
                v.setPadding(ui.px(4), ui.px(10), ui.px(4), ui.px(10));
                v.setClickable(true);
                v.setOnClickListener(new android.view.View.OnClickListener({ onClick: function () {
                    if (!self._stopped && !ui._disposed && ui.resultsView === root) callback();
                } }));
                return v;
            }
            root.addView(ui._tv("执行状态与记录", 16, ui.C.gold, true));
            root.addView(button("关闭", function () { self.hideResults(); }));
            self._currentTitle = text(""); self._currentDetail = text("", ui.C.sub);
            root.addView(self._currentTitle); root.addView(self._currentDetail);
            self._stopButton = button("停止当前任务", function () {
                var current = sgs.taskStatus.current();
                if (current && self._state(current.status).text === "运行中") ui.stopAll();
            });
            root.addView(self._stopButton);
            var scroll = new android.widget.ScrollView(ui._ctx), body = self._vertical(ui);
            scroll.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
            var history = sgs.taskStatus.history() || [];
            if (!history.length) body.addView(text("尚无完成记录", ui.C.sub));
            for (var i = 0; i < history.length; i++) {
                var record = history[i], state = self._state(record.status);
                body.addView(text((record.label || record.id || "任务") + " · " + state.text, state.color));
                body.addView(text("开始：" + self._time(record.startedAt) + "\n耗时：" + self._duration(record) + "\n原因：" + (record.message || self._detail(record) || "无"), ui.C.sub));
                var items = record.items || [];
                for (var j = 0; j < items.length; j++) {
                    var item = items[j], itemState = self._state(item.status);
                    body.addView(text("  " + (item.name || item.label || item.id || "日常项目") + "：" + itemState.text + (item.message ? "\n  " + item.message : ""), itemState.color));
                }
            }
            scroll.addView(body); root.addView(scroll);
            var metrics = ui._ctx.getResources().getDisplayMetrics();
            var height = Math.min(metrics.heightPixels - ui.px(32), ui.px(600));
            var lp = ui._lp(ui.px(290), height, 0, 0, android.view.Gravity.CENTER);
            ui.resultsView = root;
            self._updateCurrent();
            ui._attachWindow(root, lp, "results", "resultsView");
        });
    },
    hideResults: function () {
        ++this._resultsRequest; this._resultsPending = false;
        var ui = sgs.ui, root = ui.resultsView;
        ui.resultsView = null; this._currentTitle = null; this._currentDetail = null; this._stopButton = null;
        if (root) ui._removeWindow(root);
    },
    hideBadge: function () {
        ++this._badgeRequest; this._badgePending = false;
        var ui = sgs.ui, root = ui.statusBadgeView;
        ui.statusBadgeView = null; this._badgeTitle = null; this._badgeDetail = null;
        if (root) ui._removeWindow(root);
    },
    stop: function () {
        this._stopped = true;
        this.hideResults(); this.hideBadge();
    }
};
