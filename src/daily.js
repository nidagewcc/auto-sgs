// 一键日常：保存选择和顺序，逐步确认页面，记录业务结果；不自动重试消费任务。
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.daily = {
    FILE: "/sdcard/Download/autosgs-logs/daily-plan.json",
    RESULT_FILE: "/sdcard/Download/autosgs-logs/daily-last-result.json",
    CATALOG: [
        { id: "mail", name: "邮件", description: "全部领取；不消耗元宝" },
        { id: "xiaoqiao", name: "小乔日常", description: "游戏助手一键日常；会消耗元宝" },
        { id: "playerinfo", name: "玩家信息", description: "只读取昵称、等级和资源" },
        { id: "junqing", name: "紧急军情", description: "一键挑战；消耗体力" },
        { id: "zhuxian", name: "主线副本", description: "消耗体力；日常中不花元宝重置，0 次则跳过" }
    ],

    info: function (id) {
        for (var i = 0; i < this.CATALOG.length; i++) if (this.CATALOG[i].id === id) return this.CATALOG[i];
        return null;
    },
    defaultPlan: function () {
        var plan = [];
        for (var i = 0; i < this.CATALOG.length; i++) {
            var id = this.CATALOG[i].id;
            plan.push({ id: id, enabled: id === "mail" || id === "xiaoqiao" });
        }
        return plan;
    },
    validatePlan: function (plan) {
        if (Object.prototype.toString.call(plan) !== "[object Array]") throw new Error("日常方案必须是任务列表");
        var out = [], seen = {};
        for (var i = 0; i < plan.length; i++) {
            var item = plan[i];
            if (!item || typeof item.id !== "string" || !this.info(item.id) || typeof item.enabled !== "boolean") throw new Error("日常方案含无效任务或开关");
            if (seen[item.id]) throw new Error("日常方案含重复任务 " + item.id);
            seen[item.id] = true;
            out.push({ id: item.id, enabled: item.enabled });
        }
        // 新增或省略的任务默认不选，不能让配置升级自动增加资源消费。
        for (var j = 0; j < this.CATALOG.length; j++) {
            var id = this.CATALOG[j].id;
            if (!seen[id]) out.push({ id: id, enabled: false });
        }
        return out;
    },
    _guard: function (file) {
        if (file !== this.FILE && file !== this.RESULT_FILE) throw new Error("非日常配置路径");
        var expected = file.replace("/sdcard/", "/storage/emulated/0/");
        if (String(new java.io.File(file).getCanonicalPath()) !== expected
            || String(new java.io.File(file + ".tmp").getCanonicalPath()) !== expected + ".tmp") throw new Error("日常文件路径异常");
    },
    _write: function (file, value) {
        this._guard(file);
        files.ensureDir("/sdcard/Download/autosgs-logs/");
        var tmp = file + ".tmp";
        files.write(tmp, JSON.stringify(value, null, 2));
        if (!new java.io.File(tmp).renameTo(new java.io.File(file))) throw new Error("日常文件保存失败，保留原文件");
    },
    loadPlan: function () {
        if (!files.exists(this.FILE)) return this.defaultPlan();
        this._guard(this.FILE);
        var saved = JSON.parse(String(files.read(this.FILE)));
        if (!saved || saved.version !== 1) throw new Error("日常配置版本无效，请打开设置检查并保存");
        return this.validatePlan(saved.items);
    },
    savePlan: function (plan) {
        if (sgs.ui && sgs.ui.isBusy()) throw new Error("任务运行中，请停止后再修改日常方案");
        var items = this.validatePlan(plan);
        this._write(this.FILE, { version: 1, items: items });
        return items;
    },
    planLabel: function (plan) {
        plan = this.validatePlan(plan || this.loadPlan());
        var names = [];
        for (var i = 0; i < plan.length; i++) if (plan[i].enabled) names.push(this.info(plan[i].id).name);
        return names.length ? names.join(" → ") : "未选择任务";
    },
    _cancelled: function (options) {
        if (options.isCancelled && options.isCancelled()) return true;
        try { return java.lang.Thread.currentThread().isInterrupted(); } catch (e) { return false; }
    },
    _check: function (options) {
        if (this._cancelled(options)) {
            var e = new Error("日常已停止");
            e.cancelled = true;
            throw e;
        }
    },
    _result: function (id, value) {
        if (id === "playerinfo") {
            var fields = ["nickname", "level", "combat_power", "physical", "energy", "sycee", "jade"], missing = [];
            for (var i = 0; i < fields.length; i++) {
                var cell = value && value[fields[i]], v = cell && cell.value, valid = false;
                if (fields[i] === "nickname") valid = typeof v === "string" && !!v.replace(/\s+/g, "");
                else if (fields[i] === "physical" || fields[i] === "energy") {
                    valid = !!v && typeof v.current === "number" && isFinite(v.current) && v.current >= 0 && Math.floor(v.current) === v.current
                        && typeof v.max === "number" && isFinite(v.max) && v.max > 0 && Math.floor(v.max) === v.max;
                } else {
                    valid = typeof v === "number" && isFinite(v) && v >= 0;
                    if (fields[i] === "level") valid = valid && v > 0 && Math.floor(v) === v;
                }
                if (!valid) missing.push(fields[i]);
            }
            return { status: missing.length ? "failed" : "success", message: missing.length ? "字段未读到：" + missing.join("、") : "7 个字段读取完成" };
        }
        if (value && (value.status === "success" || value.status === "skipped" || value.status === "unconfirmed" || value.status === "failed")) {
            return { status: value.status, message: String(value.message || "") };
        }
        return { status: "unconfirmed", message: "任务未返回可确认的业务结果，不计入成功" };
    },
    _finish: function (report) {
        report.endedAt = new Date().getTime();
        report.durationMs = report.endedAt - report.startedAt;
        var counts = { success: 0, skipped: 0, unconfirmed: 0, failed: 0, not_run: 0, cancelled: 0 };
        for (var i = 0; i < report.items.length; i++) counts[report.items[i].status]++;
        report.counts = counts;
        if (!report.status) {
            if (!report.items.length) report.status = "empty";
            else if (report.aborted || counts.failed || counts.unconfirmed || counts.not_run) report.status = counts.success || counts.skipped ? "partial" : "failed";
            else report.status = "success";
        }
        try { this._write(this.RESULT_FILE, report); } catch (e) { sgs.log.w("保存日常结果失败 " + e); }
        return report;
    },
    lastSummary: function () {
        try {
            if (!files.exists(this.RESULT_FILE)) return "暂无日常执行记录";
            this._guard(this.RESULT_FILE);
            var report = JSON.parse(String(files.read(this.RESULT_FILE)));
            if (!report || report.version !== 1 || !report.counts) return "最近结果不可读";
            return this.formatReport(report);
        } catch (e) { return "最近结果不可读"; }
    },
    formatReport: function (report) {
        if (!report) return "暂无日常结果";
        if (report.status === "empty") return "未选择日常任务";
        var c = report.counts;
        var text = "成功 " + c.success + " / 跳过 " + c.skipped;
        if (c.unconfirmed) text += " / 待确认 " + c.unconfirmed;
        if (c.failed) text += " / 失败 " + c.failed;
        if (c.not_run) text += " / 未执行 " + c.not_run;
        if (report.status === "cancelled") text = "已停止 · " + text;
        return text;
    },
    run: function (options) {
        options = options || {};
        // 配置损坏直接失败；不能悄悄退回会消耗元宝的默认方案。
        var plan = options.plan ? this.validatePlan(options.plan) : this.loadPlan();
        var report = { version: 1, startedAt: new Date().getTime(), plan: plan, items: [], aborted: false };
        for (var p = 0; p < plan.length; p++) if (plan[p].enabled) {
            report.items.push({ id: plan[p].id, name: this.info(plan[p].id).name, status: "not_run", message: "尚未执行" });
        }
        var self = this, previous = null;
        function cancelled() { return self._cancelled(options); }
        function stopRemaining(from, reason) {
            for (var n = from; n < report.items.length; n++) report.items[n].message = reason;
        }
        for (var i = 0; i < report.items.length; i++) {
            var item = report.items[i], taskStarted = false;
            try {
                this._check(options);
                if (options.onTaskProgress) options.onTaskProgress(i + 1, report.items.length, item, "确认主城", "检查页面，尚未开始本项操作");
                if (!sgs.dailyRecovery.ensureHome(previous, cancelled, i === 0)) {
                    report.aborted = true;
                    report.error = "未确认可操作主城，停止后续任务";
                    stopRemaining(i, report.error);
                    break;
                }
                this._check(options);
                item.startedAt = new Date().getTime();
                if (options.onProgress) options.onProgress(i + 1, report.items.length, item);
                sgs.log.i("--- 日常 " + (i + 1) + "/" + report.items.length + "：" + item.name + " ---");
                var task = sgs.tasks[item.id];
                if (!task || typeof task.run !== "function") throw new Error("任务模块不存在 " + item.id);
                taskStarted = true;
                var taskOptions = {
                    checkCancelled: function () { self._check(options); },
                    onProgress: function (phase, detail) {
                        self._check(options);
                        if (options.onTaskProgress) options.onTaskProgress(i + 1, report.items.length, item, phase, detail);
                    }
                };
                if (item.id === "zhuxian") taskOptions.allowReset = false;
                var raw = task.run(taskOptions);
                this._check(options);
                var result = this._result(item.id, raw);
                item.status = result.status;
                item.message = result.message;
            } catch (e) {
                if ((e && e.cancelled) || cancelled()) {
                    if (taskStarted) item.status = "cancelled";
                    item.message = "用户停止";
                    stopRemaining(i + 1, "前序任务已停止");
                    report.status = "cancelled";
                    break;
                }
                item.message = String(e);
                if (!taskStarted) {
                    report.aborted = true;
                    report.error = "任务开始前检查失败：" + e;
                    stopRemaining(i + 1, report.error);
                    break;
                }
                item.status = "failed";
                sgs.log.e(item.name + " 失败: " + e);
            } finally {
                item.endedAt = new Date().getTime();
                item.durationMs = item.endedAt - (item.startedAt || item.endedAt);
            }
            previous = item.id;
            try {
                this._check(options);
                if (options.onTaskProgress) options.onTaskProgress(i + 1, report.items.length, item, "恢复主城", "核对任务结束页面，无法确认则停止后续步骤");
                var home = sgs.dailyRecovery.ensureHome(item.id, cancelled, false);
                this._check(options);
                item.homeRecovered = home;
                if (!home) {
                    report.aborted = true;
                    report.error = "未能从" + item.name + "恢复主城，后续任务不执行";
                    item.resultBeforeRecovery = item.status;
                    item.status = "failed";
                    item.message += "；恢复主城失败";
                    stopRemaining(i + 1, report.error);
                    break;
                }
                // 消费型长流程失败时可能仍在游戏内运行；即使回城也不继续或重试。
                if ((item.id === "xiaoqiao" || item.id === "zhuxian") && (item.status === "failed" || item.status === "unconfirmed")) {
                    report.aborted = true;
                    report.error = item.name + "结果未确认，停止后续任务以避免交叉执行";
                    stopRemaining(i + 1, report.error);
                    break;
                }
            } catch (recoveryError) {
                if ((recoveryError && recoveryError.cancelled) || cancelled()) {
                    report.status = "cancelled";
                    stopRemaining(i + 1, "恢复期间用户停止");
                } else {
                    report.aborted = true;
                    report.error = "恢复主城异常：" + recoveryError;
                    item.resultBeforeRecovery = item.status;
                    item.status = "failed";
                    item.message += "；" + report.error;
                    stopRemaining(i + 1, report.error);
                }
                break;
            }
            sgs.log.i("日常结果 " + item.name + "：" + item.status + " " + item.message);
        }
        return this._finish(report);
    }
};
