'use strict';

// Run on the host only: node tests/overlays.js. Android, queues and engines are in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sources = Object.fromEntries(['ui', 'lifecycle'].map(name => [name,
    fs.readFileSync(path.join(__dirname, '..', 'src', name + '.js'), 'utf8')]));

function harness() {
    const queue = [], roots = [], added = [], removed = [], logs = [], timers = new Set();
    const exits = [];
    let mainThread = true, interrupted = false, restored = 0, awaits = 0, failAdds = 0;
    const mainLooper = {};
    class View {
        constructor() { this.attached = false; this.children = []; }
        setTag(value) { this.tag = value; }
        getTag() { return this.tag; }
        setLayoutParams(value) { this.lp = value; }
        getLayoutParams() { return this.lp; }
        setBackground(value) { this.bg = value; }
        getBackground() { return this.bg; }
        isAttachedToWindow() { return this.attached; }
        addView(value) { this.children.push(value); }
    }
    for (const method of ['setTextSize', 'setTypeface', 'setGravity', 'setIncludeFontPadding',
        'setElevation', 'setOnTouchListener', 'setAlpha', 'setOrientation', 'setPadding',
        'setClickable', 'setOnClickListener', 'setBackgroundColor', 'setMaxLines']) {
        View.prototype[method] = function () {};
    }
    class TextView extends View {
        setText(value) { this.text = value; }
        getText() { return this.text; }
        setTextColor(value) { this.textColor = value; }
        getCurrentTextColor() { return this.textColor; }
    }
    class LinearLayout extends View {}
    class LayoutParams {
        constructor(width, height) { this.width = width; this.height = height; }
        setTitle(value) { this.title = value; }
        setMargins() {}
    }
    Object.assign(LayoutParams, { TYPE_APPLICATION_OVERLAY: 2038, FLAG_NOT_FOCUSABLE: 8,
        FLAG_LAYOUT_NO_LIMITS: 512, FLAG_HARDWARE_ACCELERATED: 16777216 });
    LinearLayout.LayoutParams = LayoutParams;
    Object.assign(LinearLayout, { VERTICAL: 1, HORIZONTAL: 0 });
    class GradientDrawable {
        setShape(value) { this.shape = value; }
        getShape() { return this.shape; }
        setColor(value) { this.color = value; }
        getColor() { return { getDefaultColor: () => this.color }; }
        setCornerRadius() {}
        setStroke() {}
    }
    Object.assign(GradientDrawable, { OVAL: 1, RECTANGLE: 0 });
    function wrapper(value) { return value; }
    View.OnTouchListener = wrapper;
    View.OnClickListener = wrapper;
    function step() {
        assert.ok(queue.length, 'expected a pending main-thread callback');
        const previous = mainThread;
        mainThread = true;
        try { queue.shift().run(); } finally { mainThread = previous; }
    }
    function drain() {
        let budget = 1000;
        while (queue.length) { assert.ok(--budget, 'main queue did not settle'); step(); }
    }
    const wm = {
        addView(view, lp) {
            if (failAdds) { failAdds--; throw new Error('simulated attach failure'); }
            assert.equal(view.attached, false, 'cannot attach a view twice');
            view.lp = lp; view.attached = true; roots.push(view); added.push(view);
        },
        removeViewImmediate(view) {
            assert.equal(mainThread, true, 'removal must run on the main thread');
            assert.equal(view.attached, true);
            view.attached = false; roots.splice(roots.indexOf(view), 1); removed.push(view);
        },
        updateViewLayout(view, lp) { view.lp = lp; }
    };
    const sandbox = {
        sgs: { log: Object.fromEntries(['i', 'w', 'e'].map(level => [level, message => logs.push([level, message])])) },
        context: { getResources: () => ({ getDisplayMetrics: () => ({ density: 2, heightPixels: 1280 }) }), getSystemService: () => wm },
        android: {
            content: { Context: { WINDOW_SERVICE: 'window' } },
            os: { Looper: { getMainLooper: () => mainLooper, myLooper: () => mainThread ? mainLooper : {} },
                Handler: class { post(runnable) { queue.push(runnable); return true; } } },
            view: { View, WindowManager: { LayoutParams }, Gravity: {},
                inspector: { WindowInspector: { getGlobalWindowViews: () => ({ size: () => roots.length, get: i => roots[i] }) } } },
            widget: { TextView, LinearLayout, ScrollView: class extends View { setFillViewport() {} } },
            graphics: { drawable: { GradientDrawable }, PixelFormat: {}, Typeface: {} }
        },
        java: {
            lang: { Runnable: wrapper, Thread: {
                interrupted() { const value = interrupted; interrupted = false; return value; },
                currentThread: () => ({ interrupt() { restored++; interrupted = true; } })
            } },
            util: { concurrent: { TimeUnit: { MILLISECONDS: 'ms' }, CountDownLatch: class {
                constructor(count) { this.count = count; }
                countDown() { this.count--; }
                await(timeout, unit) {
                    assert.equal(timeout, 3000); assert.equal(unit, 'ms'); awaits++;
                    drain(); return this.count === 0;
                }
            } } },
            io: { File: class { constructor(source) { this.source = source; }
                getCanonicalPath() { return path.posix.normalize(this.source); } } }
        },
        events: { on(name, callback) { assert.equal(name, 'exit'); exits.push(callback); } },
        setInterval(callback) { const timer = { callback }; timers.add(timer); return timer; },
        clearInterval(timer) { assert.ok(timers.delete(timer)); }
    };
    vm.createContext(sandbox);
    vm.runInContext(sources.ui, sandbox, { filename: 'src/ui.js' });
    vm.runInContext(sources.lifecycle, sandbox, { filename: 'src/lifecycle.js' });
    const ui = sandbox.sgs.ui;
    function legacy(overrides = {}) {
        ui._init();
        const view = overrides.nonText ? new View() : new TextView();
        if (view instanceof TextView) { view.setText('三'); view.setTextColor(ui.hex('FFF2E2C0')); }
        view.setBackground(ui._shape(ui.C.bg, null, 0, -1));
        view.lp = ui._lp(ui.px(54), ui.px(54), 0, 0);
        if (overrides.mutate) overrides.mutate(view);
        view.attached = true; roots.push(view);
        return view;
    }
    return { ui, sandbox, roots, added, removed, logs, timers, exits, queue, step, drain, legacy,
        failNextAdd() { failAdds++; },
        worker(interrupt = false) { mainThread = false; interrupted = interrupt; },
        syncStats: () => ({ restored, awaits }) };
}

let passed = 0;
function test(name, fn) {
    fn(); passed++;
    console.log('ok ' + passed + ' - ' + name);
}
function clean(h) {
    assert.equal(h.roots.length, 0);
    assert.equal(h.ui._views.length, 0);
    assert.equal(h.timers.size, 0);
}

test('repeated queued showBall creates and attaches exactly one ball', () => {
    const h = harness();
    for (let i = 0; i < 12; i++) h.ui.showBall();
    assert.equal(h.added.length, 0);
    h.drain();
    assert.equal(h.added.length, 1); assert.equal(h.roots[0], h.ui.ballView);
    assert.equal(h.ui._views.length, 1);
    assert.equal(h.ui.ballView.getTag(), 'auto-sgs:ball');
    assert.equal(h.ui.ballLp.title, 'auto-sgs:ball');
});

test('hide after creation but before queued attach leaves no window', () => {
    const h = harness(); h.ui.showBall(); h.step();
    assert.ok(h.ui.ballView); assert.equal(h.added.length, 0);
    h.ui.hideBall(); h.drain();
    assert.equal(h.added.length, 0); assert.equal(h.ui.ballView, null); clean(h);
});

test('show/hide/show invalidates the old pending view and attaches only the replacement', () => {
    const h = harness(); h.ui.showBall(); h.step(); const first = h.ui.ballView;
    h.ui.hideBall(); h.ui.showBall(); h.drain();
    assert.equal(first.attached, false); assert.notEqual(h.ui.ballView, first);
    assert.equal(h.added.length, 1); assert.equal(h.roots.length, 1);
    assert.equal(h.ui._views.length, 1); assert.equal(h.roots[0], h.ui.ballView);
});

test('dispose before queued attach blocks all pending and subsequent additions', () => {
    const h = harness(); h.ui.showBall(); h.step(); h.ui.showDock(); h.ui.showPanel();
    assert.equal(h.added.length, 0); h.ui.dispose(); h.drain();
    h.ui.showBall(); h.ui.showDock(); h.ui.showPanel(); h.drain();
    assert.equal(h.added.length, 0); clean(h);
});

test('dispose synchronously removes attached ball, dock and panel and cancels refresh timer', () => {
    const h = harness(); h.ui.showBall(); h.drain(); h.ui.showDock(); h.ui.showPanel(); h.drain();
    assert.equal(h.roots.length, 3); assert.equal(h.timers.size, 1);
    h.ui.dispose();
    assert.equal(h.queue.length, 0, 'main-thread cleanup must be synchronous');
    assert.equal(h.removed.length, 3); clean(h);
    for (const field of ['ballView', 'ballLp', 'dockView', 'panelView', '_statusTv', '_logTv']) assert.equal(h.ui[field], null);
    h.ui.dispose(); assert.equal(h.removed.length, 3);
});

test('registered events exit callback invokes dispose and removes windows', () => {
    const h = harness(); h.ui.showBall(); h.drain();
    assert.equal(h.exits.length, 1);
    const original = h.ui.dispose; let calls = 0;
    h.ui.dispose = function () { calls++; return original.call(this); };
    h.exits[0](); assert.equal(calls, 1); assert.equal(h.ui._disposed, true); clean(h);
});

test('failed attach clears reservation and the next show retries successfully', () => {
    const h = harness(); h.failNextAdd(); h.ui.showBall(); h.drain();
    assert.equal(h.ui.ballView, null); clean(h);
    assert.ok(h.logs.some(([level, message]) => level === 'e' && message.includes('添加悬浮窗失败')));
    h.ui.showBall(); h.drain(); assert.equal(h.added.length, 1); assert.equal(h.roots.length, 1);
});

test('orphan recovery requires every legacy fingerprint component and preserves owned live views', () => {
    const h = harness();
    const matches = [h.legacy(), h.legacy({ mutate(v) { v.bg.setColor(h.ui.hex(h.ui.C.ballOn)); } })];
    const preserved = [
        h.legacy({ mutate(v) { v.lp.type = 2002; } }),
        h.legacy({ nonText: true }),
        h.legacy({ mutate(v) { v.setText('四'); } }),
        h.legacy({ mutate(v) { v.lp.width--; } }),
        h.legacy({ mutate(v) { v.lp.height--; } }),
        h.legacy({ mutate(v) { v.bg = {}; } }),
        h.legacy({ mutate(v) { v.bg.setShape(0); } }),
        h.legacy({ mutate(v) { v.bg.setColor(h.ui.hex(h.ui.C.ballOff)); } }),
        h.legacy({ mutate(v) { v.setTextColor(0); } }),
        h.legacy({ mutate(v) { v.bg.getColor = () => null; } }),
        h.legacy({ mutate(v) { v.lp = null; } })
    ];
    h.ui.showBall(); h.drain(); preserved.push(h.ui.ballView);
    for (const kind of ['ball', 'dock', 'panel']) matches.push(h.legacy({ nonText: true, mutate(v) { v.setTag('auto-sgs:' + kind); } }));
    preserved.push(h.legacy({ nonText: true, mutate(v) { v.setTag('auto-sgs:unknown'); } }));
    preserved.push(h.legacy({ nonText: true, mutate(v) { v.setTag('auto-sgs:ball'); v.lp.type = 1; } }));
    assert.equal(h.ui.recoverOrphans(), matches.length);
    for (const view of matches) assert.equal(view.attached, false);
    for (const view of preserved) assert.equal(view.attached, true);
    assert.equal(h.roots.length, preserved.length);
    assert.equal(h.ui._views.length, 1); assert.equal(h.ui._views[0], h.ui.ballView);
    assert.equal(h.ui.recoverOrphans(), 0);
});

test('orphan recovery preserves a registered Java view exposed through an equivalent wrapper', () => {
    const h = harness(); h.ui.showBall(); h.drain();
    const original = h.ui.ballView;
    // WindowInspector may create a new JS wrapper around the same Java object.
    const alias = Object.create(original);
    original.equals = value => value === original || value === alias;
    alias.equals = value => value === original || value === alias;
    assert.notEqual(alias, original);
    h.roots[0] = alias;
    assert.equal(h.ui.recoverOrphans(), 0);
    assert.equal(h.removed.length, 0);
    assert.equal(h.ui._views.length, 1);
    assert.equal(h.ui._views[0], original);
    assert.equal(alias.isAttachedToWindow(), true);
});

test('more than 64 matching orphans removes none, including an otherwise valid first candidate', () => {
    const h = harness(); for (let i = 0; i < 65; i++) h.legacy();
    assert.equal(h.ui.recoverOrphans(), 0); assert.equal(h.removed.length, 0);
    assert.equal(h.roots.length, 65); assert.ok(h.roots.every(v => v.attached));
    assert.ok(h.logs.some(([level, message]) => level === 'w' && message.includes('匹配数量异常')));
});

test('exactly 64 matching orphans are within the recovery limit', () => {
    const h = harness(); for (let i = 0; i < 64; i++) h.legacy();
    assert.equal(h.ui.recoverOrphans(), 64); assert.equal(h.removed.length, 64); clean(h);
});

test('worker cleanup drains main handler through latch and restores interrupted status', () => {
    const h = harness(); h.ui.showBall(); h.drain(); h.worker(true);
    h.ui.dispose(); clean(h); assert.equal(h.removed.length, 1);
    assert.deepEqual(h.syncStats(), { restored: 1, awaits: 1 });
});

test('lifecycle stops only canonical absolute project sources, preserving self and unrelated scripts', () => {
    const h = harness(), stopped = [];
    const main = h.sandbox.sgs.lifecycle.MAIN;
    function engine(id, source) { return { getId: () => id, getSource: () => source, forceStop() { stopped.push(id); } }; }
    const mine = engine(1, main);
    const all = [mine, engine(1, main), engine(2, main),
        engine(3, '/storage/emulated/0/脚本/auto-sgs/sub/../_main.js'),
        engine(4, '_main.js'), engine(5, 'auto-sgs/_main.js'),
        engine(6, '/storage/emulated/0/脚本/other/_main.js'),
        engine(7, '/storage/emulated/0/脚本/auto-sgs/_main.js.bak'),
        engine(8, '/storage/emulated/0/脚本/auto-sgs/helper.js'),
        engine(9, 'file://' + main), engine(10, 'D:\\auto-sgs\\_main.js'),
        { getId: () => 11, getSource() { throw new Error('unavailable source'); } }];
    h.sandbox.engines = { myEngine: () => mine, all: () => all };
    assert.equal(h.sandbox.sgs.lifecycle.stopOtherEngines(), 2);
    assert.deepEqual(stopped, [2, 3]);
});

test('lifecycle supports getEngine wrappers for self and listed engines and continues past bad entries', () => {
    const h = harness(), stopped = [], main = h.sandbox.sgs.lifecycle.MAIN;
    const engine = (id, source) => ({ getId: () => id, getSource: () => source, forceStop() { stopped.push(id); } });
    const wrap = value => ({ getEngine: () => value });
    const mine = engine(1, main);
    h.sandbox.engines = { myEngine: () => wrap(mine), all: () => [wrap(mine), {},
        wrap(engine(2, main)), wrap(engine(3, '/unrelated/_main.js')), engine(4, main)] };
    assert.equal(h.sandbox.sgs.lifecycle.stopOtherEngines(), 2);
    assert.deepEqual(stopped, [2, 4]);
    assert.ok(h.logs.some(([level]) => level === 'w'));
});

console.log('\n' + passed + ' overlay/lifecycle tests passed (host-only mocks; no device or file deletion).');
