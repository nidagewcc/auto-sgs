// Pure memory Android/UI/model fixtures; no device access.
var assert = require('assert'), fs = require('fs'), vm = require('vm');
function fixture() {
    var queue = [], added = [], removed = [], stopped = 0, current = null, history = [], notices = [];
    function View() { this.children = []; }
    View.prototype.setOrientation = function (x) { this.orientation = x; };
    View.prototype.setLayoutParams = function (x) { this.lp = x; };
    View.prototype.setPadding = function () {};
    View.prototype.setBackground = function (x) { this.background = x; };
    View.prototype.setMaxLines = function (x) { this.maxLines = x; };
    View.prototype.setText = function (x) { this.text = x; };
    View.prototype.setTextColor = function (x) { this.color = x; };
    View.prototype.setVisibility = function (x) { this.visibility = x; };
    View.prototype.setClickable = function () {};
    View.prototype.setOnClickListener = function (x) { this.listener = x; };
    View.prototype.addView = function (x) { this.children.push(x); };
    function LP(w, h, weight) { this.width = w; this.height = h; this.weight = weight; }
    View.LayoutParams = LP; View.VERTICAL = 1;
    var ui = {
        _ctx: { getResources: function () { return { getDisplayMetrics: function () { return { heightPixels: 1000 }; } }; } },
        C: { busy: 'orange', ok: 'green', gold: 'yellow', danger: 'red', sub: 'gray', text: 'white', bg: 'black', line: 'line', goldDim: 'dim' },
        px: function (x) { return x * 2; }, hex: function (x) { return x; },
        _post: function (fn) { queue.push(fn); },
        _shape: function () { return [].slice.call(arguments); },
        _tv: function (text, size, color) { var v = new View(); v.text = text; v.size = size; v.color = color; return v; },
        _lp: function (w, h, x, y, gravity) { return { width: w, height: h, x: x, y: y, gravity: gravity, flags: 2 }; },
        _attachWindow: function (root, lp, kind, field) { root.lp = lp; root.kind = kind; ui._post(function () { if (!ui._disposed && ui[field] === root) added.push(root); }); },
        _removeWindow: function (v) { ui._post(function () { removed.push(v); }); },
        hideDock: function () {}, hidePanel: function () {}, stopAll: function () { stopped++; }
    };
    var model = { current: function () { return current; }, history: function () { return history; }, title: function (r) { return r.label + ' · 中文状态'; }, detail: function (r) { return r.message || '中文详情'; } };
    var context = { sgs: { ui: ui, taskStatus: model }, android: { widget: { LinearLayout: View, ScrollView: View }, view: { Gravity: { BOTTOM: 1, CENTER_HORIZONTAL: 2, CENTER: 4 }, WindowManager: { LayoutParams: { FLAG_NOT_TOUCHABLE: 16 } }, View: { OnClickListener: function (o) { return o; } } } } };
    context.toast = function (message) { notices.push(message); };
    vm.runInNewContext(fs.readFileSync(require('path').join(__dirname, '../src/status-ui.js'), 'utf8'), context);
    return { ui: ui, api: context.sgs.statusUI, added: added, removed: removed, queue: queue, notices: notices,
        flush: function () { while (queue.length) queue.shift()(); },
        current: function (v) { current = v; }, history: function (v) { history = v; }, stops: function () { return stopped; } };
}
function record(status) { return { label: '邮件领取', status: status, message: '已经领取', startedAt: 1000, endedAt: 4000, durationMs: 3000 }; }
function texts(v) { return (v.text ? [v.text] : []).concat.apply(v.text ? [v.text] : [], v.children.map(texts)); }
(function badge() {
    var f = fixture(); f.api.showBadge(); f.flush(); assert.equal(f.added.length, 0);
    f.current(record('running')); f.api.showBadge(); f.api.showBadge(); f.flush();
    var root = f.ui.statusBadgeView;
    assert.equal(root.lp.width, 440); assert.equal(root.lp.height, 88); assert.equal(root.lp.y, 16);
    assert.equal(root.lp.gravity, 3); assert(root.lp.flags & 16); assert.strictEqual(root.lp.alpha, 0.7); assert.equal(root.children.length, 2);
    root.children.forEach(function (v) { assert.equal(v.size, 10); assert.equal(v.maxLines, 1); });
    assert.equal(root.children[0].color, 'orange');
    assert.equal(root.children[0].text, '邮件领取 · 中文状态 · 3秒');
    var running = record('running'); running.durationMs = 32000;
    running.message = '很长的原因'.repeat(50);
    f.current(running); f.api.refresh(); f.flush();
    assert.equal(root.children[0].text, '邮件领取 · 中文状态 · 32秒');
    assert.equal(root.children[1].text, running.message);
    f.current(null); f.history([record('success')]); f.api.refresh(); f.flush();
    assert.strictEqual(f.ui.statusBadgeView, root); assert.equal(root.children[0].color, 'green');
    assert.equal(root.children[0].text, '邮件领取 · 中文状态 · 3秒');
    for (var i = 0; i < 5; i++) f.api.refresh(); f.flush(); assert.equal(f.added.length, 1);
    assert.equal(root.children[0].text, '邮件领取 · 中文状态 · 3秒');
    [['unconfirmed', '待确认', 'yellow'], ['failed', '失败', 'red'], ['skipped', '已跳过', 'gray'], ['stopped', '已停止', 'gray'], ['not_run', '未执行', 'gray'], ['cancelled', '已停止', 'gray']].forEach(function (entry) {
        var state = f.api._state(entry[0]); assert.equal(state.text, entry[1]); assert.equal(state.color, entry[2]);
    });
})();
(function results() {
    var f = fixture(), completed = record('unconfirmed');
    completed.items = [{ name: '邮件', status: 'success', message: '领取成功' }, { name: '小乔', status: 'not_run', message: '未配置' }, { name: '扫荡', status: 'cancelled', message: '用户停止' }];
    f.history([completed]); f.current(record('running')); f.api.showResults(); f.api.showResults(); f.flush();
    var root = f.ui.resultsView, all = texts(root).join('\n');
    assert.equal(root.lp.width, 580); assert.equal(root.lp.height, 936); assert.equal(f.added.length, 1);
    ['执行状态与记录', '待确认', '开始：', '耗时：3秒', '原因：已经领取', '邮件：成功', '领取成功', '小乔：未执行', '扫荡：已停止'].forEach(function (t) { assert(all.indexOf(t) >= 0, t); });
    f.api._stopButton.listener.onClick(); assert.equal(f.stops(), 1);
    var scroll = root.children[root.children.length - 1];
    f.current(null); f.api.refresh(); f.flush(); assert.strictEqual(f.ui.resultsView, root); assert.strictEqual(root.children[root.children.length - 1], scroll); assert.equal(f.api._stopButton.visibility, 8);
    f.api._stopButton.listener.onClick(); assert.equal(f.stops(), 1);
    root.children[1].listener.onClick(); f.flush(); assert.equal(f.ui.resultsView, null); assert.equal(completed.items.length, 3);
    f.history([]); f.api.showResults(); f.flush(); assert(texts(f.ui.resultsView).join('\n').indexOf('尚无完成记录') >= 0);
})();
(function pendingGuards() {
    var f = fixture(); f.current(record('running'));
    f.api.showResults(); f.api.hideResults(); f.api.showBadge(); f.api.hideBadge(); f.flush(); assert.equal(f.added.length, 0);
    f.api.refresh(); f.api.hideBadge(); f.flush(); assert.equal(f.added.length, 0);
    f.api.showResults(); f.api.showBadge(); f.ui._disposed = true; f.flush(); assert.equal(f.added.length, 0);
    f = fixture(); f.current(record('running')); f.api.showResults(); f.api.showBadge();
    // Build roots but leave their deferred add callbacks queued.
    f.queue.shift()(); f.queue.shift()(); f.api.stop(); f.flush(); assert.equal(f.added.length, 0);
    f.api.refresh(); f.api.showBadge(); f.api.showResults(); f.flush(); assert.equal(f.added.length, 0);
    f = fixture(); f.current(record('running')); f.api.showBadge(); f.api.showResults(); f.flush(); f.api.stop(); f.flush(); assert.equal(f.removed.length, 2);
})();
(function busyResults() {
    var f = fixture(), busy = true;
    f.ui.isBusy = function () { return busy; };
    f.api.showResults(); f.flush();
    assert.equal(f.added.length, 0); assert.equal(f.queue.length, 0);
    assert.equal(f.notices[0], '任务执行中，请看底部状态；点击悬浮球「停」可停止');
    busy = false; f.api.showResults(); busy = true; f.flush();
    assert.equal(f.added.length, 0); assert.equal(f.notices.length, 2);
    assert.equal(f.api._resultsPending, false);
    busy = false; f.api.showResults(); f.flush(); assert.equal(f.added.length, 1);
})();
console.log('status-ui: all memory tests passed');
