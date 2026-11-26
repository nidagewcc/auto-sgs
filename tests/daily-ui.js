// 离线验证设置 UI；Android View 和文件持久化均为内存桩，不连接设备。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');

function fixture(options = {}) {
    const queue = [], writes = [], store = {}, notices = [], attached = [], removed = [];
    let busy = false, panels = 0;
    function View() { this.children = []; }
    ['Orientation', 'Padding', 'Background', 'Elevation', 'Gravity', 'Clickable', 'FillViewport', 'TextColor', 'Enabled', 'Alpha'].forEach(name => {
        View.prototype['set' + name] = function (...values) { this[name] = values.length === 1 ? values[0] : values; };
    });
    View.prototype.setLayoutParams = function (lp) { this.lp = lp; };
    View.prototype.addView = function (view) { this.children.push(view); };
    View.prototype.removeAllViews = function () { this.children = []; };
    View.prototype.setOnClickListener = function (listener) { this.click = listener.onClick; };
    View.prototype.setText = function (text) { this.text = text; };
    function LayoutParams(width, height, weight) { Object.assign(this, { width, height, weight }); }
    LayoutParams.prototype.setMargins = function (...values) { this.margins = values; };
    function LinearLayout() { View.call(this); }
    LinearLayout.prototype = Object.create(View.prototype);
    LinearLayout.LayoutParams = LayoutParams;
    LinearLayout.VERTICAL = 1;
    LinearLayout.HORIZONTAL = 0;
    function ScrollView() { View.call(this); }
    ScrollView.prototype = Object.create(View.prototype);
    const ui = {
        _ctx: { getResources: () => ({ getDisplayMetrics: () => ({ heightPixels: options.height || 360 }) }) },
        C: { danger: 'danger', sub: 'sub', text: 'text', gold: 'gold', ok: 'ok', busy: 'busy' },
        isBusy: () => busy,
        _post: fn => queue.push(fn),
        hideDock() { this.dockHidden = true; },
        hidePanel() { this.panelHidden = true; },
        showPanel() { panels++; },
        _shape() {},
        px: value => value * (options.density || 1),
        _lp: (width, height) => ({ width, height }),
        _tv(text, size, color, bold) { const view = new View(); Object.assign(view, { text, size, TextColor: color, bold }); return view; },
        _margins() {},
        hex: value => value,
        _attachWindow(view, lp, kind, field) { attached.push({ view, lp, kind, field }); },
        _removeWindow(view) { assert.strictEqual(this.dailySettingsView, null); removed.push(view); }
    };
    const context = {
        sgs: { ui, log: { w() {}, i() {}, e() {} } },
        toast: text => notices.push(text),
        files: {
            exists: file => Object.prototype.hasOwnProperty.call(store, file),
            read: file => store[file],
            ensureDir() {},
            write(file, text) { writes.push({ file, text }); store[file] = text; }
        },
        java: { io: { File: function (file) {
            this.getCanonicalPath = () => file.replace('/sdcard/', '/storage/emulated/0/');
            this.renameTo = target => { store[target.file] = store[file]; delete store[file]; return true; };
            this.file = file;
        } } },
        android: {
            widget: { LinearLayout, ScrollView },
            view: { Gravity: { CENTER: 1, LEFT: 2, CENTER_VERTICAL: 4, RIGHT: 8 }, View: { OnClickListener: function (listener) { return listener; } } }
        }
    };
    vm.createContext(context);
    vm.runInContext(source('daily.js'), context, { filename: 'daily.js' });
    vm.runInContext(source('daily-ui.js'), context, { filename: 'daily-ui.js' });
    const daily = context.sgs.daily, api = context.sgs.dailyUI;
    let saves = 0;
    const save = daily.savePlan;
    daily.savePlan = function (plan) { saves++; return save.call(this, plan); };
    function drain() { while (queue.length) queue.shift()(); }
    function open() { api.show(); drain(); return ui.dailySettingsView; }
    function all(root, predicate) {
        return (predicate(root) ? [root] : []).concat(...root.children.map(child => all(child, predicate)));
    }
    function text(root, value) {
        const found = all(root, view => view.text === value);
        assert.strictEqual(found.length, 1, '唯一按钮/文本：' + value);
        return found[0];
    }
    function cards(root) {
        return all(root, view => view.children.length === 3 && view.children[0].text && /^[☑☐] /.test(view.children[0].text));
    }
    return { ui, daily, api, writes, store, attached, removed, notices, drain, open, text, cards, all, ScrollView,
        setBusy(value) { busy = value; }, get panels() { return panels; }, get saves() { return saves; } };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

// 不同条目和方向必须捕获各自的位置；保存经真实 daily.savePlan 写入内存文件。
{
    const f = fixture(), root = f.open();
    assert(f.ui.dockHidden && f.ui.panelHidden);
    assert.strictEqual(f.cards(root).length, 5);
    f.cards(root)[1].children[2].children[0].click();
    assert.strictEqual(f.cards(root)[0].children[1].text, f.daily.info('xiaoqiao').description);
    f.cards(root)[3].children[2].children[1].click();
    assert.strictEqual(f.cards(root)[4].children[1].text, f.daily.info('junqing').description);
    f.cards(root)[2].children[0].click(); // 玩家信息：开启
    f.cards(root)[1].children[0].click(); // 邮件：关闭；独立勾选闭包
    assert.strictEqual(f.writes.length, 0);
    f.text(root, '保存').click();
    assert.strictEqual(f.saves, 1);
    assert.strictEqual(f.writes.length, 1);
    const plan = plain(f.daily.loadPlan());
    assert.deepStrictEqual(plan.map(item => item.id), ['xiaoqiao', 'mail', 'playerinfo', 'zhuxian', 'junqing']);
    assert.deepStrictEqual(plan.map(item => item.enabled), [true, false, true, false, false]);
    assert.strictEqual(f.ui.dailySettingsView, null);
    assert.deepStrictEqual(f.removed, [root]);
    assert.strictEqual(f.panels, 1);
    // 已移除的窗口回调不能再次保存。
    f.text(root, '保存').click();
    assert.strictEqual(f.saves, 1);
}
// 恢复默认和取消不写文件，已有配置保持原样。
{
    const f = fixture();
    const original = f.daily.defaultPlan().reverse();
    original.forEach(item => { item.enabled = false; });
    f.store[f.daily.FILE] = JSON.stringify({ version: 1, items: original });
    const before = f.store[f.daily.FILE], root = f.open();
    f.cards(root)[0].children[0].click();
    f.text(root, '恢复默认（仅修改草稿）').click();
    assert(f.cards(root)[0].children[0].text.includes('邮件'));
    assert(f.cards(root)[0].children[0].text.startsWith('☑'));
    assert.strictEqual(f.writes.length, 0);
    f.text(root, '取消').click();
    assert.strictEqual(f.saves, 0);
    assert.strictEqual(f.store[f.daily.FILE], before);
}
// 损坏配置有醒目提示，仅明确保存才替换为默认方案。
{
    const f = fixture();
    f.store[f.daily.FILE] = '{bad-json';
    let root = f.open();
    const warnings = f.all(root, view => typeof view.text === 'string' && view.text.includes('配置损坏'));
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].TextColor, f.ui.C.danger);
    assert.strictEqual(warnings[0].bold, true);
    assert(warnings[0].text.includes('尚未修复'));
    assert.strictEqual(f.writes.length, 0);
    f.text(root, '取消').click();
    assert.strictEqual(f.store[f.daily.FILE], '{bad-json');
    root = f.open();
    f.text(root, '保存').click();
    assert.deepStrictEqual(plain(f.daily.loadPlan()), plain(f.daily.defaultPlan()));
    assert.strictEqual(f.writes.length, 1);
}
// 忙碌时拒绝打开；打开之后变忙也不能勾选、排序、恢复默认或保存。
{
    const f = fixture();
    f.setBusy(true); assert.strictEqual(f.open(), undefined);
    f.setBusy(false); const root = f.open();
    const before = f.cards(root).map(card => card.children[0].text);
    f.setBusy(true);
    f.cards(root)[0].children[0].click();
    f.cards(root)[1].children[2].children[0].click();
    f.text(root, '恢复默认（仅修改草稿）').click();
    f.text(root, '保存').click();
    assert.deepStrictEqual(f.cards(root).map(card => card.children[0].text), before);
    assert.strictEqual(f.saves, 0);
    assert.strictEqual(f.writes.length, 0);
    f.text(root, '取消').click();
    assert.strictEqual(f.ui.dailySettingsView, null);
}
// 排队创建遇到 hide、dispose 或新任务启动，都不能留下设置窗口。
for (const reason of ['hide', 'dispose', 'busy']) {
    const f = fixture(); f.api.show();
    if (reason === 'hide') f.api.hide();
    if (reason === 'dispose') f.ui._disposed = true;
    if (reason === 'busy') f.setBusy(true);
    f.drain();
    assert(!f.ui.dailySettingsView, reason);
    assert.strictEqual(f.attached.length, 0);
}
// 多次 show 只创建一个窗口，固定顶部控件，滚动列表适配横屏与高度上限。
for (const settings of [{ height: 360, density: 1, expected: 328 }, { height: 2000, density: 2, expected: 1200 }]) {
    const f = fixture(settings); f.api.show(); f.api.show(); f.drain(); f.api.show(); f.drain();
    assert.strictEqual(f.attached.length, 1);
    const window = f.attached[0], root = window.view;
    assert.strictEqual(window.kind, 'daily-settings');
    assert.strictEqual(window.field, 'dailySettingsView');
    assert.strictEqual(window.lp.width, 290 * settings.density);
    assert.strictEqual(window.lp.height, settings.expected);
    const scroll = f.all(root, view => view instanceof f.ScrollView);
    assert.strictEqual(scroll.length, 1);
    assert.strictEqual(scroll[0].FillViewport, true);
    assert.strictEqual(scroll[0].lp.height, 0);
    assert.strictEqual(scroll[0].lp.weight, 1);
    assert(f.text(root.children[1], '保存'));
    assert(f.text(root.children[1], '取消'));
    assert.strictEqual(f.cards(scroll[0]).length, 5);
}
console.log('daily-ui: all offline interaction checks passed');
