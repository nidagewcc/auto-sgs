// Rhino ES5 task state only: no game calls and no storage access until first use.
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.taskStatus = (function () {
    var FILE = "/sdcard/Download/autosgs-logs/task-status.json";
    var loaded = false, active = null, records = [], owner = null, serial = 0;
    // One reentrant lock protects state checks, mutation, and the shared .tmp write.
    // Host VM tests may have no java.util; Android workers share this Java lock.
    var lock = null;
    try {
        if (typeof java !== "undefined" && java.util && java.util.concurrent && java.util.concurrent.locks && java.util.concurrent.locks.ReentrantLock) lock = new java.util.concurrent.locks.ReentrantLock();
    } catch (noJavaLock) {}
    function synchronized(operation) {
        return function () {
            if (lock) lock.lock();
            try { return operation.apply(this, arguments); }
            finally { if (lock) lock.unlock(); }
        };
    }
    var names = { running: "运行中", finishing: "收尾中", stopping: "正在停止", success: "成功", skipped: "已跳过", unconfirmed: "待确认", failed: "失败", stopped: "已停止" };
    var phases = { starting: "开始任务", running: "执行中", preparing: "准备中", recovery: "恢复主城", finishing: "收尾中", stopping: "正在停止" };
    function now() { return new Date().getTime(); }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function terminal(status) { return status === "success" || status === "skipped" || status === "unconfirmed" || status === "failed" || status === "stopped"; }
    function warn(error) { try { if (sgs.log && sgs.log.w) sgs.log.w("任务状态存储失败 " + error); } catch (ignored) {} }
    function storage() {
        try { return typeof files !== "undefined" && files && typeof java !== "undefined" && java && java.io && java.io.File && typeof files.exists === "function" && typeof files.read === "function" && typeof files.write === "function" && typeof files.ensureDir === "function"; }
        catch (e) { return false; }
    }
    function guard() {
        var expected = FILE.replace("/sdcard/", "/storage/emulated/0/");
        if (String(new java.io.File(FILE).getCanonicalPath()) !== expected || String(new java.io.File(FILE + ".tmp").getCanonicalPath()) !== expected + ".tmp") throw new Error("任务状态文件路径异常");
    }
    function snapshot(record) {
        if (!record) return null;
        var copy = clone(record);
        if (!terminal(copy.status)) copy.durationMs = Math.max(0, now() - copy.startedAt);
        return copy;
    }
    function save() {
        if (!storage()) return;
        try {
            guard();
            files.ensureDir("/sdcard/Download/autosgs-logs/");
            guard();
            files.write(FILE + ".tmp", JSON.stringify({ version: 1, active: snapshot(active), history: records }, null, 2));
            guard();
            if (!new java.io.File(FILE + ".tmp").renameTo(new java.io.File(FILE))) throw new Error("任务状态保存失败，保留原文件");
        } catch (e) { warn(e); }
    }
    function number(value) { return typeof value === "number" && isFinite(value) && value >= 0; }
    function parseRecord(value, isActive) {
        if (!value || typeof value.runId !== "string" || !value.runId || typeof value.id !== "string" || typeof value.label !== "string" || typeof value.phase !== "string" || typeof value.message !== "string" || !number(value.startedAt) || !number(value.updatedAt) || !number(value.durationMs) || Object.prototype.toString.call(value.items) !== "[object Array]" || (isActive ? (value.status !== "running" && value.status !== "finishing" && value.status !== "stopping") || value.endedAt !== null : !terminal(value.status) || !number(value.endedAt))) throw new Error("任务状态记录损坏");
        return { runId: value.runId, id: value.id, label: value.label, status: value.status, phase: value.phase, message: value.message, startedAt: value.startedAt, updatedAt: value.updatedAt, endedAt: value.endedAt, durationMs: value.durationMs, items: clone(value.items) };
    }
    function load() {
        if (loaded) return;
        loaded = true;
        if (!storage()) return;
        try {
            guard();
            if (!files.exists(FILE)) return;
            var data = JSON.parse(String(files.read(FILE))), next = [], seen = {}, i;
            if (!data || data.version !== 1 || Object.prototype.toString.call(data.history) !== "[object Array]" || !(data.active === null || (data.active && typeof data.active === "object"))) throw new Error("任务状态配置损坏");
            for (i = 0; i < data.history.length; i++) {
                var record = parseRecord(data.history[i], false);
                if (!seen["$" + record.runId]) { next.push(record); seen["$" + record.runId] = true; }
            }
            var interrupted = data.active === null ? null : parseRecord(data.active, true);
            records = next.slice(0, 20);
            if (interrupted) {
                interrupted.status = "unconfirmed";
                interrupted.message = "上次运行没有结束记录，结果未确认";
                interrupted.endedAt = Math.max(now(), interrupted.updatedAt, interrupted.startedAt);
                interrupted.updatedAt = interrupted.endedAt;
                interrupted.durationMs = Math.max(0, interrupted.endedAt - interrupted.startedAt);
                records = [interrupted].concat(records.filter(function (r) { return r.runId !== interrupted.runId; })).slice(0, 20);
                save();
            }
        } catch (e) { records = []; active = null; warn(e); }
    }
    function owns(token) { return active && token !== null && typeof token !== "undefined" && token === owner; }
    function update(token, status, phase, detail) {
        load();
        if (!owns(token) || active.status === "stopping") return false;
        active.status = status; active.phase = phase;
        if (typeof detail !== "undefined") active.message = String(detail === null ? "" : detail);
        active.updatedAt = now(); save(); return true;
    }
    var api = {
        begin: function (token, task) {
            load();
            if (token === null || typeof token === "undefined" || !task || typeof task.id !== "string" || typeof task.label !== "string") return false;
            var time = now();
            owner = token;
            active = { runId: String(time) + "-" + (++serial), id: task.id, label: task.label, status: "running", phase: "starting", message: "", startedAt: time, updatedAt: time, endedAt: null, durationMs: 0, items: [] };
            // Avoid collisions with loaded history when a host clock has not advanced.
            while (records.some(function (r) { return r.runId === active.runId; })) active.runId = String(time) + "-" + (++serial);
            save(); return snapshot(active);
        },
        step: function (token, phase, detail) { return update(token, "running", String(phase || "running"), detail); },
        finishing: function (token, detail) { return update(token, "finishing", "finishing", detail); },
        stopping: function (token) { return update(token, "stopping", "stopping", "用户请求停止"); },
        finish: function (token, status, message, items) {
            load();
            if (!owns(token) || !terminal(status)) return false;
            if (active.status === "stopping" && status !== "stopped") return false;
            var copied;
            try { copied = typeof items === "undefined" ? active.items : clone(items); } catch (e) { return false; }
            if (Object.prototype.toString.call(copied) !== "[object Array]") return false;
            active.status = status; active.message = String(message || ""); active.items = copied;
            active.endedAt = Math.max(now(), active.startedAt); active.updatedAt = active.endedAt;
            active.durationMs = active.endedAt - active.startedAt;
            records.unshift(active); records = records.slice(0, 20); active = null; owner = null;
            save(); return snapshot(records[0]);
        },
        current: function () { load(); return snapshot(active || records[0]); },
        history: function () { load(); return clone(records); },
        title: function (record) { record = record || this.current(); return record ? (names[record.status] || "未确认") + "·" + record.label : "暂无任务"; },
        detail: function (record) {
            record = record || this.current();
            if (!record) return "暂无执行记录";
            var duration = terminal(record.status) ? record.durationMs : Math.max(0, now() - record.startedAt);
            return (record.message || phases[record.phase] || record.phase || names[record.status] || "未确认") + " · 总耗时 " + (duration / 1000).toFixed(1) + " 秒";
        }
    };
    for (var method in api) if (Object.prototype.hasOwnProperty.call(api, method)) api[method] = synchronized(api[method]);
    return api;
}());
