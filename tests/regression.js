// Run: node tests/regression.js. No Android device or real clicks required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, context) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}
function test(name, fn) {
    fn();
    console.log('PASS ' + name);
}
function junqingEnv() {
    let screen = 'home';
    let captures = 0;
    const logs = { i() {}, w() {}, e() {} };
    const v = {
        frame(force) { assert.equal(force, true); captures++; return { screen }; },
        ocrRect(rect, img) { return img.screen === 'panel' ? '敌军入侵，十万火急' : ''; },
        tapImage() { screen = 'panel'; return true; },
        clickPointAt() { screen = 'home'; },
        waitImage() { return screen === 'home' ? { x: 1, y: 1 } : null; }
    };
    const ctx = { sgs: { vision: v, log: logs, TIMEOUT: { page: 8000, ui: 3000 }, ANCHOR: {} }, sleep() {} };
    load('src/tasks/junqing.js', ctx);
    return { task: ctx.sgs.tasks.junqing, v, setScreen(value) { screen = value; }, captures: () => captures };
}

test('junqing reads a fresh frame for every panel check', () => {
    const env = junqingEnv();
    assert.equal(env.task._panelOpen(), false);
    env.setScreen('panel');
    assert.equal(env.task._panelOpen(), true);
    env.setScreen('home');
    assert.equal(env.task._panelOpen(), false);
    assert.equal(env.captures(), 3);
});
test('junqing respects a supplied frame without capturing again', () => {
    const env = junqingEnv();
    assert.equal(env.task._panelOpen({ screen: 'panel' }), true);
    assert.equal(env.captures(), 0);
});
test('junqing does not OCR a missing frame', () => {
    const env = junqingEnv();
    env.v.frame = () => null;
    env.v.ocrRect = () => { throw new Error('OCR must not run'); };
    assert.equal(env.task._panelOpen(), false);
});
test('junqing observes opening and closing after clicks', () => {
    const env = junqingEnv();
    env.task._dismissReward = () => true;
    env.task._doneCount = () => 3;
    env.task.run();
    assert.equal(env.task._panelOpen(), false);
});

function uiEnv() {
    const pending = [];
    let sleeps = 0;
    let alive = true;
    let interrupted = false;
    const ctx = {
        sgs: { log: { i() {}, w() {}, e() {} } },
        threads: { start(fn) { pending.push(fn); return {}; } },
        sleep() { sleeps++; },
        toast() {}
    };
    load('src/ui.js', ctx);
    const ui = ctx.sgs.ui;
    ui._paintBall = () => {};
    ui._post = (fn) => fn();
    ui._refresh = () => {};
    const th = { isAlive: () => alive, interrupt() { interrupted = true; } };
    ui._thread = th;
    ui._token = {};
    ui._t0 = Date.now();
    return { ui, th, pending, finish() { alive = false; }, sleeps: () => sleeps, interrupted: () => interrupted };
}

test('stop returns without sleeping and keeps the live thread locked', () => {
    const env = uiEnv();
    env.ui.stopAll();
    assert.equal(env.sleeps(), 0);
    assert.equal(env.interrupted(), true);
    assert.equal(env.ui._thread, env.th);
    assert.equal(env.ui.isBusy(), true);
    assert.equal(env.ui._lastResult, '正在停止');
    env.ui.runTask('mail', 'mail');
    assert.equal(env.pending.length, 1, 'only the exit watcher may have started');
});
test('stop releases state once the task actually exits', () => {
    const env = uiEnv();
    env.ui.stopAll();
    env.finish();
    env.pending[0]();
    assert.equal(env.ui._thread, null);
    assert.equal(env.ui.isBusy(), false);
    assert.equal(env.ui._lastResult, '已手动停止');
});
test('old exit watcher cannot erase a newer task', () => {
    const env = uiEnv();
    env.ui.stopAll();
    env.finish();
    const next = { isAlive: () => true };
    env.ui._thread = next;
    env.ui._lastResult = 'new task';
    env.pending[0]();
    assert.equal(env.ui._thread, next);
    assert.equal(env.ui._lastResult, 'new task');
});
test('uncertain thread exit keeps the thread reference', () => {
    const env = uiEnv();
    env.ui.stopAll();
    env.th.isAlive = () => { throw new Error('thread status unavailable'); };
    env.pending[0]();
    assert.equal(env.ui._thread, env.th);
    assert.equal(env.ui._lastResult, '正在停止');
});
