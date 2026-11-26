'use strict';
// Host-only: no Android, screenshots, clicks, package launches or device connections.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function harness(frames, options = {}) {
    const calls = { taps: [], captures: 0, ensure: 0, sleeps: 0, queries: [] };
    let now = 0, index = 0, cancelled = false;
    function Clock() { this.getTime = () => now; }
    const ctx = vm.createContext({ Date: Clock, sgs: {},
        currentPackage: () => { if (options.packageError) throw new Error('accessibility unavailable'); return Object.hasOwn(options, 'pkg') ? options.pkg : 'com.sanguosha.mjz.mi'; },
        sleep(ms) { now += ms; calls.sleeps++; if (options.cancelSleep) cancelled = true; }
    });
    for (const file of ['config', 'tasks/mail', 'tasks/xiaoqiao', 'tasks/junqing', 'tasks/zhuxian', 'tasks/playerinfo']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'src', file + '.js'), 'utf8'), ctx);
    }
    const s = ctx.sgs;
    function image(spec) {
        if (spec === null) return null;
        return Object.assign({ getWidth: () => 2772, getHeight: () => 1280, texts: {}, hits: {} }, spec);
    }
    const imgs = frames.map(image);
    s.game = { PKG: 'com.sanguosha.mjz.mi', ensure(ms) {
        assert.equal(ms, 120000); calls.ensure++;
        if (options.ensure) return options.ensure(s, calls);
        return true;
    } };
    s.vision = {
        frame(force) {
            assert.equal(force, true, 'captures must be fresh'); calls.captures++;
            if (options.cancelCapture) cancelled = true;
            return imgs[Math.min(index++, imgs.length - 1)];
        },
        ocrRect(rect, im) { assert.ok(im, 'OCR must use explicit live frame'); return im.texts[String(rect)] || ''; },
        find(name, threshold, rect, im) {
            assert.ok(im, 'image search must use explicit live frame');
            assert.ok(rect, 'no full screen image fallback');
            assert.ok(threshold >= 0.85); calls.queries.push(name);
            return im.hits[name] || null;
        },
        tap(x, y) { calls.taps.push([x, y]); if (options.cancelTap) cancelled = true; },
        isHome() { throw new Error('unsafe isHome fallback'); }
    };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/daily-recovery.js'), 'utf8'), ctx);
    return { s, calls, imgs, check: () => cancelled, cancel: () => { cancelled = true; } };
}
function home() {
    return { hits: { 'common/anchor-zhengzhan.png': { x: 2625, y: 1150 } },
        texts: { '1430,0,1780,75': '体力 150/150', '1780,0,2100,75': '精力32/30' } };
}
let count = 0;
function test(name, fn) { fn(); count++; console.log('ok - ' + name); }
function cancelled(fn) { assert.throws(fn, e => e.cancelled === true); }

test('normal home requires two fresh frames and no taps', () => {
    const h = harness([home(), home()]);
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check, false), true);
    assert.equal(h.calls.captures, 2); assert.deepEqual(h.calls.taps, []);
});
test('homeReady captures a new frame; supplied image reuses same frame', () => {
    const h = harness([home()]); assert.equal(h.s.dailyRecovery.homeReady(), true);
    assert.equal(h.s.dailyRecovery.homeReady(h.imgs[0]), true); assert.equal(h.calls.captures, 1);
});
test('masked home background without resource fractions is rejected', () => {
    const f = home(); f.texts = {};
    const h = harness([f]); assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), false);
    assert.deepEqual(h.calls.taps, []);
});
test('recognized mail overlay excludes otherwise valid home and taps actual CLOSE only', () => {
    const f = home(); Object.assign(f.hits, { 'daily_task/quanbulingqu.png': { x: 700, y: 1050 },
        'daily_task/close.png': { x: 2391, y: 197 } });
    const h = harness([f, home(), home()]);
    assert.equal(h.s.dailyRecovery.homeReady(h.imgs[0]), false);
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), true);
    assert.deepEqual(h.calls.taps, [[2391, 197]]);
});
test('mail close alone never authorizes a click', () => {
    const h = harness([{ hits: { 'daily_task/close.png': { x: 2300, y: 200 } } }]);
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), false); assert.deepEqual(h.calls.taps, []);
});
test('unknown page returns false without back clicks', () => {
    const h = harness([{}]); assert.equal(h.s.dailyRecovery.ensureHome('zhuxian', h.check), false);
    assert.deepEqual(h.calls.taps, []);
});
test('null screenshot stops, including initial mode', () => {
    const h = harness([null]); assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check, true), false);
    assert.equal(h.calls.ensure, 0); assert.deepEqual(h.calls.taps, []);
});
test('again dialog never confirms and rejects missing cancellation label', () => {
    const f = home(); f.texts['875,530,1870,675'] = '是否再次执行';
    f.texts['1430,800,1800,925'] = '确认';
    const h = harness([f]); assert.equal(h.s.dailyRecovery.ensureHome('xiaoqiao', h.check), false);
    assert.deepEqual(h.calls.taps, []);
});
test('again dialog clicks only positively identified cancel button', () => {
    const f = { texts: { '875,530,1870,675': '再次执行', '950,800,1320,925': '取消' } };
    const h = harness([f, home(), home()]); assert.equal(h.s.dailyRecovery.ensureHome('xiaoqiao', h.check), true);
    assert.deepEqual(h.calls.taps, [[1135, 862.5]]);
});
test('cancellation before capture throws own cancelled error', () => {
    const h = harness([home()]); h.cancel(); cancelled(() => h.s.dailyRecovery.ensureHome('mail', h.check));
    assert.equal(h.calls.captures, 0); assert.deepEqual(h.calls.taps, []);
});
test('cancellation during capture forbids any click', () => {
    const h = harness([{}], { cancelCapture: true }); cancelled(() => h.s.dailyRecovery.ensureHome('mail', h.check));
    assert.deepEqual(h.calls.taps, []);
});
test('cancellation during OCR forbids the identified close click', () => {
    const h = harness([{ hits: { 'daily_task/quanbulingqu.png': { x: 700, y: 1050 }, 'daily_task/close.png': { x: 2391, y: 197 } } }]);
    const old = h.s.vision.ocrRect; h.s.vision.ocrRect = function (r, im) { h.cancel(); return old(r, im); };
    cancelled(() => h.s.dailyRecovery.ensureHome('mail', h.check)); assert.deepEqual(h.calls.taps, []);
});
test('cancellation after sleep prevents second capture', () => {
    const h = harness([home()], { cancelSleep: true }); cancelled(() => h.s.dailyRecovery.ensureHome('mail', h.check));
    assert.equal(h.calls.captures, 1); assert.deepEqual(h.calls.taps, []);
});
test('initial true and false both reject unknown pages without invoking game.ensure', () => {
    for (const initial of [true, false]) {
        const h = harness([{}, home(), home()]);
        assert.equal(h.s.dailyRecovery.ensureHome(null, h.check, initial), false);
        assert.equal(h.calls.ensure, 0); assert.equal(h.calls.captures, 1);
        assert.deepEqual(h.calls.taps, []);
    }
});
test('initial healthy home skips ensure entirely', () => {
    const h = harness([home()]); assert.equal(h.s.dailyRecovery.ensureHome(null, h.check, true), true);
    assert.equal(h.calls.ensure, 0);
});
test('initial true never replaces global vision primitives or invokes game.ensure', () => {
    const h = harness([{}], { ensure() { throw new Error('automatic login forbidden'); } });
    const tap = h.s.vision.tap, frame = h.s.vision.frame;
    assert.equal(h.s.dailyRecovery.ensureHome(null, h.check, true), false);
    assert.equal(h.calls.ensure, 0); assert.deepEqual(h.calls.taps, []);
    assert.equal(h.s.vision.tap, tap); assert.equal(h.s.vision.frame, frame);
});
test('external app refuses later recovery before capture or ensure', () => {
    const h = harness([home()], { pkg: 'other.app' });
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), false);
    assert.equal(h.calls.captures, 0); assert.equal(h.calls.ensure, 0); assert.deepEqual(h.calls.taps, []);
});
test('task-specific recovery refuses wrong last task', () => {
    const h = harness([{ texts: { '1820,390,2090,535': '日常功能' } }]);
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), false); assert.deepEqual(h.calls.taps, []);
});
test('recognized assistant tab safely closes panel', () => {
    const h = harness([{ texts: { '1820,390,2090,535': '日常功能' } }, home(), home()]);
    assert.equal(h.s.dailyRecovery.ensureHome('xiaoqiao', h.check), true); assert.deepEqual(h.calls.taps, [[2127, 235]]);
});
test('recognized junqing title safely closes panel', () => {
    const h = harness([{ texts: { '700,240,2100,350': '敌军入侵，十万火急' } }, home(), home()]);
    assert.equal(h.s.dailyRecovery.ensureHome('junqing', h.check), true); assert.deepEqual(h.calls.taps, [[2410, 174]]);
});
test('recognized report, attempts, and map unwind one identified page per frame', () => {
    const h = harness([{ texts: { '1150,85,1650,180': '扫荡战报' } },
        { texts: { '950,415,1260,500': '次数：3/5' } },
        { texts: { '1820,10,2090,95': '主线副本' } }, home(), home()]);
    assert.equal(h.s.dailyRecovery.ensureHome('zhuxian', h.check), true);
    assert.deepEqual(h.calls.taps, [[2205, 215], [2205, 215], [110, 70]]);
});
test('resource fractions plus known purchase dialog still refuses recovery', () => {
    const f = home(); f.texts['900,500,1900,800'] = '是否花费20元宝';
    f.texts['950,415,1260,500'] = '次数0/5';
    const h = harness([f]); assert.equal(h.s.dailyRecovery.ensureHome('zhuxian', h.check), false);
    assert.deepEqual(h.calls.taps, []);
});
test('login relogin notice and offline pages require manual intervention in both initial modes', () => {
    for (const initial of [true, false]) {
        for (const [rect, label] of [
            ['1000,890,1900,1120', '进入游戏'], ['1050,800,1900,930', '重新登录'],
            ['1000,990,1900,1120', '孤知道了'], ['1000,700,1900,830', '网络'],
            ['800,890,1500,1000', '我已阅读并同意']
        ]) {
            const f = home(); f.texts[rect] = label;
            // Even a known assistant panel in the background cannot authorize a click.
            f.texts['1820,390,2090,535'] = '日常功能';
            const h = harness([f]);
            assert.equal(h.s.dailyRecovery.ensureHome('xiaoqiao', h.check, initial), false);
            assert.equal(h.calls.ensure, 0); assert.deepEqual(h.calls.taps, []);
        }
    }
});
test('repeated recognized panel is bounded', () => {
    const h = harness([{ texts: { '1820,390,2090,535': '日常功能' } }]);
    assert.equal(h.s.dailyRecovery.ensureHome('xiaoqiao', h.check), false);
    assert.equal(h.calls.taps.length, 12);
});
test('portrait screenshots cannot qualify as home', () => {
    const f = home(); f.getWidth = () => 1280; f.getHeight = () => 2772;
    const h = harness([f]); assert.equal(h.s.dailyRecovery.homeReady(h.imgs[0]), false);
});
test('nonconsecutive home frames never count as stable success', () => {
    const h = harness([home(), {}]);
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), false); assert.deepEqual(h.calls.taps, []);
});
test('wrong landscape aspect cannot qualify or authorize recovery clicks', () => {
    const f = home(); f.getWidth = () => 1400;
    const h = harness([f]); assert.equal(h.s.dailyRecovery.homeReady(h.imgs[0]), false);
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check), false); assert.deepEqual(h.calls.taps, []);
});
test('cancellation during final fraction OCR cannot return success', () => {
    const h = harness([home()]); const old = h.s.vision.ocrRect;
    h.s.vision.ocrRect = function (r, im) {
        if (h.calls.captures === 2 && String(r) === '1780,0,2100,75') h.cancel();
        return old(r, im);
    };
    cancelled(() => h.s.dailyRecovery.ensureHome('mail', h.check)); assert.deepEqual(h.calls.taps, []);
});
test('unknown foreground package cannot authorize a task or recovery click', () => {
    const h = harness([home(), home()], { pkg: '' });
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check, false), false);
    assert.equal(h.calls.captures, 0); assert.deepEqual(h.calls.taps, []);
});
test('foreground lookup failure cannot authorize a task or recovery click', () => {
    const h = harness([home(), home()], { packageError: true });
    assert.equal(h.s.dailyRecovery.ensureHome('mail', h.check, false), false);
    assert.equal(h.calls.captures, 0); assert.deepEqual(h.calls.taps, []);
});
test('SDK other app and unknown foreground refuse both initial modes before capturing or clicking', () => {
    for (const initial of [true, false]) {
        for (const options of [{ pkg: 'com.xiaomi.gamecenter.sdk.service' }, { pkg: 'com.miui.gallery' },
            { pkg: 'other.app' }, { pkg: '' }, { pkg: null }, { pkg: undefined }, { packageError: true }]) {
            const h = harness([home()], options);
            assert.equal(h.s.dailyRecovery.ensureHome(null, h.check, initial), false);
            assert.equal(h.calls.captures, 0); assert.equal(h.calls.ensure, 0);
            assert.deepEqual(h.calls.taps, []);
        }
    }
});
test('foreground switch during recognition prevents both home success and known close click', () => {
    for (const initial of [true, false]) {
        const options = {};
        const h = harness([{ texts: { '1820,390,2090,535': '日常功能' } }], options);
        const old = h.s.vision.ocrRect;
        h.s.vision.ocrRect = function (r, im) { options.pkg = 'other.app'; return old(r, im); };
        assert.equal(h.s.dailyRecovery.ensureHome('xiaoqiao', h.check, initial), false);
        assert.equal(h.calls.ensure, 0); assert.deepEqual(h.calls.taps, []);
    }
});
console.log('daily-recovery: ' + count + ' tests passed');
