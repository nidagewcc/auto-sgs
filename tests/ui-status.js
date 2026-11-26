'use strict';
// Host-only lifecycle integration: real UI entry points, daily executor and status model.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function test(name, body) {
    body();
    checks++;
    console.log('PASS ' + name);
}
function harness() {
    const queue = [], effects = [], toasts = [], homeCalls = [];
    let home = () => true, shot = () => true, pushLog = () => {};
    const sgs = {
        log: { i() {}, w() {}, e() {} }, tasks: {},
        statusUI: {
            refresh() {}, hideResults() { effects.push('hideResults'); },
            showResults() { effects.push('showResults'); }
        },
        dailyUI: { hide() {} },
        dailyRecovery: { ensureHome(previous, cancelled, first) {
            homeCalls.push({ previous, first });
            assert.strictEqual(typeof cancelled, 'function');
            return home(previous, cancelled, first);
        } },
        pushShot() { effects.push('pushShot'); return shot(); },
        pushLog() { effects.push('pushLog'); return pushLog(); },
        login() { assert.fail('must not automatically log in'); },
        autoLogin() { assert.fail('must not automatically log in'); }
    };
    const context = vm.createContext({ sgs, console, toast(message) { toasts.push(String(message)); },
        // No java/java.util: taskStatus must work entirely in memory.
        threads: { start(fn) {
            const thread = { alive: true, interrupted: false,
                isAlive() { return this.alive; }, interrupt() { this.interrupted = true; },
                execute() { assert(this.alive); try { fn(); } finally { this.alive = false; } }
            };
            queue.push(thread);
            effects.push('queued');
            return thread;
        } },
        sleep() { assert.fail('stop watcher must run only after the worker exits'); }
    });
    for (const file of ['task-status.js', 'daily.js', 'ui.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context, { filename: file });
    }
    const ui = sgs.ui;
    for (const method of ['_paintBall', '_refresh', '_startStatusTick', 'hideDock', 'hidePanel']) ui[method] = function () {};
    ui._post = fn => fn();
    // Stub persistence only; keep daily.run/_result/_finish and every status method real.
    sgs.daily._write = function () {};
    return { sgs, ui, effects, toasts, homeCalls, queue,
        setHome(fn) { home = fn; }, setShot(fn) { shot = fn; }, setPushLog(fn) { pushLog = fn; },
        run() { assert(queue.length, 'expected queued worker'); queue.shift().execute(); },
        current() { return plain(sgs.taskStatus.current()); },
        history() { return plain(sgs.taskStatus.history()); }
    };
}
function assertQueued(h, id) {
    assert.strictEqual(h.current().id, id);
    assert.strictEqual(h.current().status, 'running', 'queued task must already be visible as running');
    assert.strictEqual(h.ui.isBusy(), true);
    assert(h.effects.indexOf('hideResults') < h.effects.indexOf('queued'), 'hide results before scheduling game work');
    h.ui.showTaskResults();
    assert(!h.effects.includes('showResults'), 'busy UI must refuse result window');
}
function assertFinishing(h) {
    h.setPushLog(() => {
        assert.strictEqual(h.current().status, 'finishing', 'log upload is still part of finishing');
        assert.strictEqual(h.history().length, 0, 'no premature terminal history');
        assert.strictEqual(h.ui.isBusy(), true);
    });
}
for (const outcome of [
    { raw: { status: 'success', message: '奖励已领取' }, status: 'success', message: '奖励已领取' },
    { raw: { status: 'failed', message: '原始失败原因：按钮未出现' }, status: 'failed', message: '原始失败原因：按钮未出现' },
    { raw: undefined, status: 'unconfirmed', message: '任务未返回可确认的业务结果，不计入成功' },
    { raw: { status: 'skipped', message: '没有可领取邮件' }, status: 'skipped', message: '没有可领取邮件' }
]) test('single task ' + outcome.status + ', progress, recovery and finishing', () => {
    const h = harness();
    h.sgs.tasks.mail = { run(options) {
        assert.strictEqual(h.effects[0], 'hideResults');
        options.onProgress('领取邮件', '第 2 封');
        assert.strictEqual(h.current().phase, '领取邮件');
        assert(h.current().message.includes('第 2 封'));
        return outcome.raw;
    } };
    assertFinishing(h);
    h.ui.runTask('mail', '邮件');
    assertQueued(h, 'mail');
    h.run();
    assert.strictEqual(h.current().status, outcome.status);
    assert.strictEqual(h.current().message, outcome.message);
    assert.deepStrictEqual(h.homeCalls, [{ previous: null, first: false }, { previous: 'mail', first: false }]);
    assert.strictEqual(h.history().length, 1);
    assert.strictEqual(h.ui.isBusy(), false);
    h.ui.showTaskResults();
    assert(h.effects.includes('showResults'));
});
test('thrown failure preserves original cause', () => {
    const h = harness();
    h.sgs.tasks.mail = { run() { throw new Error('OCR 原始异常 731'); } };
    h.ui.runTask('mail', '邮件'); h.run();
    assert.strictEqual(h.current().status, 'failed');
    assert(h.current().message.includes('OCR 原始异常 731'));
});
test('unconfirmed initial home fails without executing business or login', () => {
    const h = harness(); let calls = 0;
    h.setHome(() => false);
    h.sgs.tasks.mail = { run() { calls++; } };
    h.ui.runTask('mail', '邮件'); h.run();
    assert.strictEqual(calls, 0);
    assert.strictEqual(h.homeCalls.length, 1);
    assert.strictEqual(h.current().status, 'failed');
    assert(h.current().message.includes('未确认主城'));
});
test('failed final home cannot report business success', () => {
    const h = harness();
    h.setHome(previous => previous === null);
    h.sgs.tasks.mail = { run() { return { status: 'success', message: '已领取' }; } };
    h.ui.runTask('mail', '邮件'); h.run();
    assert.strictEqual(h.homeCalls.length, 2);
    assert.strictEqual(h.current().status, 'failed');
    assert(h.current().message.includes('操作后未确认回到主城'));
});
test('stop survives late progress and waits for live worker', () => {
    const h = harness();
    h.sgs.tasks.mail = { run(options) {
        const worker = h.ui._thread;
        h.ui.stopAll();
        assert.strictEqual(worker.interrupted, true);
        assert.strictEqual(worker.isAlive(), true);
        assert.strictEqual(h.current().status, 'stopping');
        options.onProgress('迟到成功', '不能覆盖停止');
        assert.strictEqual(h.current().status, 'stopping');
        assert.strictEqual(h.current().phase, 'stopping');
        h.ui.runTask('shot', '不能并行');
        assert.strictEqual(h.queue.length, 1, 'only stop watcher should have been queued');
        return { status: 'success', message: '迟到结果' };
    } };
    h.setPushLog(() => assert.strictEqual(h.current().status, 'stopping'));
    h.ui.runTask('mail', '邮件');
    h.run();
    h.run(); // watcher sees actual worker exit; no synthetic sleep or early unlock
    assert.strictEqual(h.current().status, 'stopped');
    assert.strictEqual(h.history().length, 1);
    assert.strictEqual(h.ui.isBusy(), false);
});
for (const sent of [false, true]) test('shot push ' + sent + ' is reflected in result', () => {
    const h = harness(); h.setShot(() => sent); assertFinishing(h);
    h.ui.runTask('shot', '截屏回传'); assertQueued(h, 'shot'); h.run();
    assert.strictEqual(h.current().status, sent ? 'success' : 'failed');
    assert.strictEqual(h.homeCalls.length, 0);
    assert.strictEqual(h.effects.filter(x => x === 'pushShot').length, 1);
    if (!sent) {
        assert(h.current().message.includes('未回传'));
        assert(!h.toasts.some(x => /已回传|上传成功/.test(x)));
    }
});
test('real daily report keeps each result and task progress in status history', () => {
    const h = harness();
    const expected = [
        { id: 'mail', status: 'success', message: '邮件已领取' },
        { id: 'junqing', status: 'failed', message: '军情原始失败' },
        { id: 'xiaoqiao', status: 'skipped', message: '今日已完成' },
        { id: 'zhuxian', status: 'unconfirmed', message: '扫荡结果未确认' }
    ];
    for (const result of expected) h.sgs.tasks[result.id] = { run(options) {
        options.onProgress('业务检查', result.message);
        assert.strictEqual(h.current().phase, '业务检查');
        assert(h.current().message.includes(result.message));
        if (result.id === 'zhuxian') assert.strictEqual(options.allowReset, false);
        return { status: result.status, message: result.message };
    } };
    assertFinishing(h);
    h.ui.runDaily('日常', expected.map(x => ({ id: x.id, enabled: true })));
    assertQueued(h, 'daily'); h.run();
    const record = h.current();
    assert.strictEqual(record.status, 'unconfirmed');
    assert.deepStrictEqual(record.items.map(x => ({ id: x.id, status: x.status, message: x.message })), expected);
    assert.deepStrictEqual(record.items, plain(h.ui._dailyReport.items));
    assert.deepStrictEqual(h.history()[0].items, record.items);
    assert.strictEqual(h.ui.isBusy(), false);
});
test('daily stop retains cancelled and pending item results', () => {
    const h = harness(); let nextCalls = 0;
    h.sgs.tasks.mail = { run(options) {
        h.ui.stopAll();
        assert.strictEqual(h.current().status, 'stopping');
        assert.throws(() => options.onProgress('迟到进度', '不能恢复 running'), /日常已停止/);
        assert.strictEqual(h.current().status, 'stopping');
        return { status: 'success', message: '迟到成功' };
    } };
    h.sgs.tasks.junqing = { run() { nextCalls++; } };
    h.setPushLog(() => assert.strictEqual(h.current().status, 'stopping'));
    h.ui.runDaily('停止日常', [{ id: 'mail', enabled: true }, { id: 'junqing', enabled: true }]);
    h.run(); h.run();
    assert.strictEqual(nextCalls, 0);
    assert.strictEqual(h.current().status, 'stopped');
    assert.deepStrictEqual(h.current().items.map(x => x.status), ['cancelled', 'not_run']);
    assert.deepStrictEqual(h.history()[0].items, plain(h.ui._dailyReport.items));
    assert.strictEqual(h.ui.isBusy(), false);
});
test('empty real daily plan is skipped', () => {
    const h = harness(); h.ui.runDaily('空日常', []); h.run();
    assert.strictEqual(h.current().status, 'skipped');
    assert.deepStrictEqual(h.current().items, []);
});
console.log('ui-status: ' + checks + ' tests passed (Node VM, no device)');
