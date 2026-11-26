// daily-ui.js —— 日常计划编辑器；只保存配置，不执行任务。
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.dailyUI = {
    _request: 0,

    _copy: function (plan) {
        var result = [];
        for (var i = 0; i < plan.length; i++) result.push({ id: plan[i].id, enabled: plan[i].enabled });
        return result;
    },

    show: function () {
        var self = this, ui = sgs.ui;
        if (ui._disposed || ui.dailySettingsView) return;
        if (ui.isBusy()) { toast("任务执行中，不能编辑日常设置"); return; }
        var request = ++this._request;
        ui._post(function () {
            if (request !== self._request || ui._disposed || ui.dailySettingsView) return;
            if (ui.isBusy()) { toast("任务执行中，不能编辑日常设置"); return; }
            ui.hideDock();
            ui.hidePanel();
            self._show(ui);
        });
    },

    hide: function () {
        ++this._request;
        var ui = sgs.ui, view = ui.dailySettingsView;
        ui.dailySettingsView = null;
        if (view) ui._removeWindow(view);
    },

    _show: function (ui) {
        var self = this, daily = sgs.daily, draft, damaged = false;
        try { draft = this._copy(daily.loadPlan()); }
        catch (e) {
            draft = this._copy(daily.defaultPlan());
            damaged = true;
            try { sgs.log.w("日常配置读取失败，等待用户明确保存：" + e); } catch (ignored) { }
        }
        var root = new android.widget.LinearLayout(ui._ctx);
        root.setOrientation(android.widget.LinearLayout.VERTICAL);
        root.setPadding(ui.px(10), ui.px(10), ui.px(10), ui.px(10));
        root.setBackground(ui._shape(ui.C.bg, ui.C.goldDim, 1, 14));
        root.setElevation(ui.px(12));

        function live() { return !ui._disposed && ui.dailySettingsView === root; }
        function editable() {
            if (!live()) return false;
            if (ui.isBusy()) { toast("任务执行中，不能编辑或保存日常设置"); return false; }
            return true;
        }
        function vertical() {
            var view = new android.widget.LinearLayout(ui._ctx);
            view.setOrientation(android.widget.LinearLayout.VERTICAL);
            view.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
            return view;
        }
        function button(text, callback, color) {
            var view = ui._tv(text, 12, color || ui.C.text, true);
            view.setGravity(android.view.Gravity.CENTER);
            view.setPadding(ui.px(8), ui.px(10), ui.px(8), ui.px(10));
            view.setBackground(ui._shape(ui.C.card, ui.C.line, 1, 7));
            view.setClickable(true);
            view.setOnClickListener(new android.view.View.OnClickListener({ onClick: callback }));
            return view;
        }
        root.addView(ui._tv("一键日常 · 设置", 16, ui.C.gold, true));
        var actions = new android.widget.LinearLayout(ui._ctx);
        actions.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        actions.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        ui._margins(actions, 0, 8, 0, 6);
        var save = button("保存", function () {
            if (!editable()) return;
            try { daily.savePlan(self._copy(draft)); }
            catch (e) {
                status.setText("保存失败：" + e + "\n草稿已保留，请检查后重试。");
                status.setTextColor(ui.hex(ui.C.danger));
                return;
            }
            self.hide();
            ui.showPanel();
        }, ui.C.ok);
        save.setLayoutParams(new android.widget.LinearLayout.LayoutParams(0, -2, 1));
        actions.addView(save);
        var cancel = button("取消", function () {
            if (!live()) return;
            self.hide();
            ui.showPanel();
        });
        cancel.setLayoutParams(new android.widget.LinearLayout.LayoutParams(0, -2, 1));
        ui._margins(cancel, 6, 0, 0, 0);
        actions.addView(cancel);
        root.addView(actions);

        // 固定标题和保存/取消，所有提示和条目均放入滚动区域，横屏也能操作。
        var scroll = new android.widget.ScrollView(ui._ctx);
        scroll.setFillViewport(true);
        scroll.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
        var body = vertical();
        var status = ui._tv(damaged
            ? "警告：已保存的日常配置损坏！\n当前展示默认草稿，尚未修复。请检查后明确点击保存；取消会保留原配置。"
            : "勾选要执行的任务，用上移/下移调整顺序。所有更改仅为草稿，保存后才生效。", 12, damaged ? ui.C.danger : ui.C.sub, damaged);
        status.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        body.addView(status);
        var cost = ui._tv("成本提示：小乔日常消耗元宝；紧急军情消耗体力约30；日常主线扫荡不花元宝重置，剩余0次会跳过。请按需勾选。", 11, ui.C.busy, false);
        cost.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        ui._margins(cost, 0, 8, 0, 6);
        body.addView(cost);
        var summary = ui._tv("", 11, ui.C.gold, false);
        summary.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        body.addView(summary);
        var list = vertical();
        body.addView(list);

        function catalogEntry(id) {
            for (var i = 0; i < daily.CATALOG.length; i++) if (daily.CATALOG[i].id === id) return daily.CATALOG[i];
            throw new Error("未知日常任务：" + id);
        }
        // 每次调用单独捕获 index，避免 Rhino 的 var 循环闭包共享位置。
        function makeRow(index) {
            var item = draft[index], entry = catalogEntry(item.id), card = vertical();
            card.setBackground(ui._shape(ui.C.card, ui.C.line, 1, 8));
            card.setPadding(ui.px(8), ui.px(7), ui.px(8), ui.px(7));
            ui._margins(card, 0, 7, 0, 0);
            var check = button((item.enabled ? "☑ " : "☐ ") + (index + 1) + ". " + entry.name, function () {
                if (!editable()) return;
                draft[index].enabled = !draft[index].enabled;
                render();
            }, item.enabled ? ui.C.ok : ui.C.text);
            check.setGravity(android.view.Gravity.LEFT | android.view.Gravity.CENTER_VERTICAL);
            check.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
            card.addView(check);
            var description = ui._tv(String(entry.description || ""), 11, ui.C.sub, false);
            description.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
            card.addView(description);
            var order = new android.widget.LinearLayout(ui._ctx);
            order.setOrientation(android.widget.LinearLayout.HORIZONTAL);
            order.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
            function move(delta) {
                if (!editable()) return;
                var target = index + delta;
                if (target < 0 || target >= draft.length) return;
                var temp = draft[index];
                draft[index] = draft[target];
                draft[target] = temp;
                render();
            }
            var up = button("↑ 上移", function () { move(-1); });
            var down = button("↓ 下移", function () { move(1); });
            up.setLayoutParams(new android.widget.LinearLayout.LayoutParams(0, -2, 1));
            down.setLayoutParams(new android.widget.LinearLayout.LayoutParams(0, -2, 1));
            up.setEnabled(index > 0);
            down.setEnabled(index < draft.length - 1);
            up.setAlpha(index > 0 ? 1 : 0.35);
            down.setAlpha(index < draft.length - 1 ? 1 : 0.35);
            order.addView(up);
            order.addView(down);
            card.addView(order);
            return card;
        }
        function render() {
            list.removeAllViews();
            for (var i = 0; i < draft.length; i++) list.addView(makeRow(i));
            summary.setText("草稿顺序：" + daily.planLabel(draft));
        }
        var reset = button("恢复默认（仅修改草稿）", function () {
            if (!editable()) return;
            draft = self._copy(daily.defaultPlan());
            render();
            toast("已恢复默认草稿，点击保存后生效");
        }, ui.C.gold);
        reset.setLayoutParams(new android.widget.LinearLayout.LayoutParams(-1, -2));
        ui._margins(reset, 0, 10, 0, 0);
        body.addView(reset);
        scroll.addView(body);
        root.addView(scroll);
        render();
        var metrics = ui._ctx.getResources().getDisplayMetrics();
        var height = Math.max(1, Math.min(metrics.heightPixels - ui.px(32), ui.px(600)));
        var lp = ui._lp(ui.px(290), height, ui.px(8), 0,
            android.view.Gravity.RIGHT | android.view.Gravity.CENTER_VERTICAL);
        if (ui._disposed || ui.dailySettingsView) return;
        ui.dailySettingsView = root;
        ui._attachWindow(root, lp, "daily-settings", "dailySettingsView");
    }
};
