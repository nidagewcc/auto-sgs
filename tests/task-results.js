'use strict';

// Host-only contract tests: execute the actual task modules with virtual vision/time.
// No AutoJs, ADB, screenshots, device connections, or source rewriting.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function test(name, body) {
    try { body(); passed++; console.log('ok - ' + name); }
    catch (error) { console.error('FAIL - ' + name); throw error; }
}
function load(id) {
    let now = 0;
    const clicks = [];
    const image = { recycle() {} };
    const vision = {
        frame: () => image,
        find: () => null,
        hasText: () => false,
        ocrRect: () => '',
        hasImage: () => false,
        waitImage: () => ({ x: 10, y: 20 }),
        waitText: () => true,
        isHome: () => true,
        tapImage(template) { clicks.push(['image', template]); return true; },
        clickPointAt(x, y) { clicks.push(['point', x, y]); },
        clickRect(rect) { clicks.push(['rect', rect.x, rect.y]); },
        tapRect(rect) { clicks.push(['tapRect', Array.from(rect)]); }
    };
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const sgs = {
        tasks: {}, vision, debugShots: { save: () => null },
        log: { i() {}, w() {}, e() {} },
        TIMEOUT: { page: 1400, ui: 1400 }, ANCHOR: { image: 'home', region: [0, 0, 1, 1] }
    };
    const context = vm.createContext({
        sgs, Date: Clock,
        sleep(ms) { assert(Number.isFinite(ms) && ms >= 0); now += Math.max(ms, 1); },
        images: { clip: () => image, findColor: () => null }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/tasks', id + '.js'), 'utf8'), context,
        { filename: 'src/tasks/' + id + '.js' });
    return { task: sgs.tasks[id], vision, clicks, context };
}
function result(value, status) {
    assert(value && typeof value === 'object');
    assert.strictEqual(value.status, status);
    assert.strictEqual(typeof value.message, 'string');
    assert(value.message.length > 0);
}
function pointCount(f, point) {
    return f.clicks.filter(c => c[0] === 'point' && c[1] === point[0] && c[2] === point[1]).length;
}
const cancelled = new Error('test cancellation');
function expectCancelled(run) { assert.throws(run, error => error === cancelled); }

for (const id of ['mail', 'xiaoqiao', 'junqing', 'zhuxian']) {
    test(id + ': initial options.checkCancelled prevents all clicks', () => {
        const f = load(id);
        expectCancelled(() => f.task.run({ checkCancelled() { throw cancelled; } }));
        assert.deepStrictEqual(f.clicks, []);
    });
}

for (const evidence of ['reward-template', 'reward-text', 'empty', 'none']) {
    test('mail: ' + evidence + ' determines result, clicking alone proves nothing', () => {
        const f = load('mail');
        f.vision.find = template => evidence === 'reward-template' && template === f.task.REWARD ? { x: 1, y: 2 } : null;
        f.vision.hasText = text => evidence === 'reward-text' && text === '恭喜获得';
        f.vision.ocrRect = () => evidence === 'empty' ? '暂 无 可 领 取 的 附 件' : '';
        result(f.task.run(), evidence.startsWith('reward') ? 'success' : evidence === 'empty' ? 'skipped' : 'unconfirmed');
        assert.strictEqual(f.clicks.filter(c => c[0] === 'image' && c[1] === f.task.CLAIM).length, 2);
    });
}
test('mail: cancellation after navigation prevents claim', () => {
    const f = load('mail');
    let ready = false;
    f.vision.waitImage = () => { ready = true; return {}; };
    expectCancelled(() => f.task.run({ checkCancelled() { if (ready) throw cancelled; } }));
    assert(!f.clicks.some(c => c[0] === 'image' && c[1] === f.task.CLAIM));
});

function xiaoqiao(mode, completionAfterReward) {
    const f = load('xiaoqiao');
    let state = mode;
    // Only navigation is stubbed; real run, reward recognition, color completion,
    // and _closeResult execute against a virtual screen that changes on clicks.
    f.task._openPanel = () => {};
    f.task._openDailyTab = () => ({ x: 1901, y: 941 });
    f.vision.hasText = text => text === '恭喜获得' && state === 'reward';
    f.context.images.findColor = () => state === 'done' ? { x: 1, y: 1 } : null;
    const click = f.vision.clickPointAt;
    f.vision.clickPointAt = (x, y) => {
        click(x, y);
        if (x === f.task.BLANK_TAP[0] && y === f.task.BLANK_TAP[1]) state = completionAfterReward ? 'done' : 'home';
        if (x === f.task.RESULT_CLOSE[0] && y === f.task.RESULT_CLOSE[1]) state = 'home';
    };
    return f;
}
for (const completed of [true, false]) {
    test('xiaoqiao: reward close completion=' + completed, () => {
        const f = xiaoqiao('reward', completed);
        result(f.task.run(), completed ? 'success' : 'unconfirmed');
        assert.strictEqual(pointCount(f, f.task.BLANK_TAP), 1);
        assert.strictEqual(pointCount(f, f.task.RESULT_CLOSE), completed ? 1 : 0);
        assert(f.clicks.some(c => c[0] === 'rect' && c[1] === 1901 && c[2] === 941));
    });
}
test('xiaoqiao: direct completion green bar succeeds', () => {
    const f = xiaoqiao('done', false);
    result(f.task.run(), 'success');
    assert.strictEqual(pointCount(f, f.task.RESULT_CLOSE), 1);
});
test('xiaoqiao: completion green bar with guild result dialog closes dialog before home', () => {
    const f = xiaoqiao('done', false);
    let closed = false;
    f.vision.hasText = (text, region) => {
        if (text === '军团一键援助' && region === f.task.RESULT_TITLE_REGION) return !closed;
        return false;
    };
    const click = f.vision.clickPointAt;
    f.vision.clickPointAt = (x, y) => {
        click(x, y);
        if (x === f.task.RESULT_CLOSE[0] && y === f.task.RESULT_CLOSE[1]) closed = true;
    };
    const r = f.task.run();
    result(r, 'success');
    assert.strictEqual(closed, true);
    assert.strictEqual(pointCount(f, f.task.RESULT_CLOSE), 1);
});
test('xiaoqiao: result dialog that remains open fails instead of false success', () => {
    const f = xiaoqiao('done', false);
    f.vision.hasText = (text, region) => text === '军团一键援助' && region === f.task.RESULT_TITLE_REGION;
    assert.throws(() => f.task.run(), /小乔结果弹窗未能关闭/);
});
test('xiaoqiao: cancellation after locating 开启 prevents spending click', () => {
    const f = xiaoqiao('home', false);
    let ready = false;
    f.task._openDailyTab = () => { ready = true; return { x: 1901, y: 941 }; };
    expectCancelled(() => f.task.run({ checkCancelled() { if (ready) throw cancelled; } }));
    assert.deepStrictEqual(f.clicks, []);
});
test('xiaoqiao: cancellation after 再次执行 confirmation recognition prevents confirm', () => {
    const f = xiaoqiao('home', false);
    let confirmReady = false;
    f.vision.hasText = text => text === '再次执行';
    f.vision.waitText = () => { confirmReady = true; return true; };
    expectCancelled(() => f.task.run({ checkCancelled() { if (confirmReady) throw cancelled; } }));
    assert.strictEqual(f.clicks.filter(c => c[0] === 'rect').length, 1);
    assert(!f.clicks.some(c => c[0] === 'tapRect'));
});

test('junqing: genuinely missing entry skips without challenge', () => {
    const f = load('junqing');
    f.vision.tapImage = template => { assert.strictEqual(template, f.task.ENTRY); return false; };
    result(f.task.run(), 'skipped');
    assert.deepStrictEqual(f.clicks, []);
});
for (const done of [1, 2, 3]) {
    test('junqing: ' + done + '/3 killed evidence', () => {
        const f = load('junqing');
        let closed = false;
        f.task._openPanel = () => true;
        f.vision.ocrRect = () => closed ? '' : '敌军入侵，十万火急';
        f.vision.hasText = (text, region) => text === '击杀' && f.task.DONE_REGIONS.indexOf(region) < done;
        f.vision.find = template => template === f.task.ONECLICK ? { x: 2550, y: 1234 } : null;
        const click = f.vision.clickPointAt;
        f.vision.clickPointAt = (x, y) => { click(x, y); if (x === f.task.CLOSE_X[0] && y === f.task.CLOSE_X[1]) closed = true; };
        result(f.task.run(), done === 3 ? 'success' : 'unconfirmed');
        assert.strictEqual(pointCount(f, [2550, 1234]), 1);
    });
}
test('junqing: cancellation after panel navigation prevents challenge', () => {
    const f = load('junqing');
    let ready = false;
    f.task._openPanel = () => { ready = true; return true; };
    expectCancelled(() => f.task.run({ checkCancelled() { if (ready) throw cancelled; } }));
    assert.deepStrictEqual(f.clicks, []);
});

test('junqing: cancellation during native image matching prevents spending click', () => {
    const f = load('junqing');
    let stopped = false;
    f.task._openPanel = () => true;
    f.vision.find = () => { stopped = true; return { x: 2550, y: 1234 }; };
    expectCancelled(() => f.task.run({ checkCancelled() { if (stopped) throw cancelled; } }));
    assert.deepStrictEqual(f.clicks, []);
});

function zhuxian(attempts, rewardText) {
    const f = load('zhuxian');
    let reset = false, diagnostics = 0;
    f.context.sgs.debugShots = { save: () => { diagnostics++; return '/debug/report.png'; } };
    f.vision.hasText = text => ['主线副本', '排行榜', '扫荡', '重置副本'].includes(text);
    f.vision.ocrRect = region => {
        if (region === f.task.ATTEMPT_REGION) return '次数 ' + (reset ? 5 : attempts) + '/5';
        if (rewardText && region === f.task.REPORT_SUM_REGION) return rewardText;
        return '';
    };
    Object.defineProperty(f, 'diagnostics', { get: () => diagnostics });
    f.task._waitPanel = () => true;
    f.task._waitReport = () => 'report';
    f.task._panelOpen = () => false;
    const click = f.vision.clickPointAt;
    f.vision.clickPointAt = (x, y) => {
        click(x, y);
        if (x === f.task.RESET_CONFIRM[0] && y === f.task.RESET_CONFIRM[1]) reset = true;
    };
    return f;
}
test('zhuxian: options.allowReset=false overrides object true at zero attempts', () => {
    const f = zhuxian(0, '总计获得');
    assert.strictEqual(f.task.allowReset, true);
    const r = f.task.run({ allowReset: false });
    result(r, 'skipped');
    assert.strictEqual(r.reset, false);
    assert.strictEqual(r.attemptsBefore, 0);
    assert.strictEqual(r.swept, 0);
    assert.strictEqual(pointCount(f, f.task.ENTER_ZHENGZHAN), 1);
    assert.strictEqual(pointCount(f, f.task.BOSS_BODY), 1);
    assert.strictEqual(pointCount(f, f.task.SWEEP_BTN), 0);
    assert.strictEqual(pointCount(f, f.task.RESET_CONFIRM), 0);
});
for (const rewardText of ['总计获得', '累计获得', '共获得', '']) {
    test('zhuxian: existing attempts with report evidence=' + JSON.stringify(rewardText), () => {
        const f = zhuxian(3, rewardText);
        const r = f.task.run({ allowReset: false });
        result(r, rewardText ? 'success' : 'unconfirmed');
        assert.strictEqual(r.swept, 3);
        assert.strictEqual(r.attemptsBefore, 3);
        assert.strictEqual(r.reset, false);
        assert.strictEqual(pointCount(f, f.task.SWEEP_BTN), 1);
        assert.strictEqual(pointCount(f, f.task.RESET_CONFIRM), 0);
    });
}
test('zhuxian: recognizes shifted reward text in wide or body regions without accepting unrelated text', () => {
    for (const [region, keyword] of [
        ['REPORT_SUM_WIDE_REGION', '累计获得'],
        ['REPORT_BODY_REGION', '共获得']
    ]) {
        const f = zhuxian(3, '');
        f.vision.ocrRect = r => r === f.task.ATTEMPT_REGION ? '次数 3/5' : r === f.task[region] ? keyword : '';
        const r = f.task.run({ allowReset: false });
        result(r, 'success');
    }
    const f = zhuxian(3, '');
    f.vision.ocrRect = r => r === f.task.ATTEMPT_REGION ? '次数 3/5' : r === f.task.REPORT_BODY_REGION ? '战报奖励' : '';
    result(f.task.run({ allowReset: false }), 'unconfirmed');
});
test('zhuxian: unconfirmed report saves one diagnostic frame and preserves OCR evidence', () => {
    const f = zhuxian(3, '');
    const r = f.task.run({ allowReset: false });
    assert.strictEqual(f.diagnostics, 1);
    assert.match(r.message, /收益汇总未确认/);
});
for (const target of ['reset-button', 'reset-confirm', 'sweep']) {
    test('zhuxian: cancellation immediately before ' + target, () => {
        const f = zhuxian(target === 'sweep' ? 3 : 0, '总计获得');
        let cancel = false;
        const ocr = f.vision.ocrRect;
        f.vision.ocrRect = region => {
            const text = ocr(region);
            if (target === 'reset-button' && region === f.task.ATTEMPT_REGION) cancel = true;
            return text;
        };
        const hasText = f.vision.hasText;
        f.vision.hasText = (text, region) => {
            if ((target === 'reset-confirm' && text === '重置副本') || (target === 'sweep' && text === '扫荡')) cancel = true;
            return hasText(text, region);
        };
        expectCancelled(() => f.task.run({ checkCancelled() { if (cancel) throw cancelled; } }));
        assert.strictEqual(pointCount(f, f.task.SWEEP_BTN), target === 'reset-confirm' ? 1 : 0);
        assert.strictEqual(pointCount(f, f.task.RESET_CONFIRM), 0);
    });
}
console.log('Passed ' + passed + ' task result/cancellation tests (virtual time and vision only).');
