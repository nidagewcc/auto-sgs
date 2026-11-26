// Run: node tests/debugshots.js. All Android storage operations use memory only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = '/sdcard/Download/autosgs-logs/';
const DIR = ROOT + 'screenshots/';
const NOW = 1730000000000;
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'debugshots.js'), 'utf8');
const normalize = (p) => path.posix.normalize(String(p)).replace(/\/$/, '');
const owned = (time, seq = 1, tag = 'shot') => `dbg_${time}_${seq}_${tag}.png`;
let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log('PASS ' + name);
}

function environment() {
    const nodes = new Map();
    const calls = { removed: [], written: [], saved: [], listed: [], warnings: [], locks: 0, unlocks: 0 };
    const failures = {};
    let held = false;
    function add(p, type = 'file', content = '', target) {
        nodes.set(normalize(p), { type, content, target });
    }
    function canonical(p, depth = 0) {
        assert.ok(depth < 20, 'symlink cycle in fixture');
        const normalized = normalize(p);
        const parts = normalized.split('/');
        for (let i = 1; i <= parts.length; i++) {
            const prefix = parts.slice(0, i).join('/');
            const node = nodes.get(prefix);
            if (node && node.type === 'symlink') {
                return canonical(node.target + '/' + parts.slice(i).join('/'), depth + 1);
            }
        }
        return normalized.replace(/^\/sdcard(?=\/|$)/, '/storage/emulated/0');
    }
    function resolvedNode(p) {
        const direct = nodes.get(normalize(p));
        if (direct && direct.type !== 'symlink') return direct;
        const physical = canonical(p);
        for (const [key, value] of nodes) {
            if (value.type !== 'symlink' && canonical(key) === physical) return value;
        }
        return undefined;
    }
    function File(parent, child) {
        this.path = child === undefined ? String(parent) : String(parent) + '/' + child;
    }
    File.prototype.getCanonicalPath = function () { return canonical(this.path); };
    File.prototype.isFile = function () { return resolvedNode(this.path)?.type === 'file'; };
    File.prototype.isDirectory = function () { return resolvedNode(this.path)?.type === 'directory'; };
    const files = {
        ensureDir(p) { if (failures.ensureDir) throw new Error('ensureDir failed'); add(p, 'directory'); },
        exists(p) { return nodes.has(normalize(p)); },
        write(p, content) { calls.written.push(p); add(p, 'file', content); },
        listDir(p, filter) {
            calls.listed.push(p);
            if (failures.listDir) throw new Error('listDir failed');
            const prefix = normalize(p) + '/';
            return [...nodes.keys()].filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map(key => key.slice(prefix.length)).filter(name => !filter || filter(name));
        },
        remove(p) {
            calls.removed.push(p);
            if (failures.remove) throw new Error('remove failed');
            assert.equal(nodes.get(normalize(p))?.type, 'file', 'remove must target a regular fixture file');
            return nodes.delete(normalize(p));
        }
    };
    class FixedDate extends Date { constructor() { super(NOW); } static now() { return NOW; } }
    const context = {
        sgs: { log: { w(message) { calls.warnings.push(String(message)); } } },
        java: { io: { File } }, files, Date: FixedDate,
        images: { save(img, p) {
            assert.equal(held, true, 'image writes must hold the lock');
            if (failures.save) throw new Error('image save failed');
            calls.saved.push(p); add(p, 'file', img);
        } },
        threads: { lock() { return {
            lock() { assert.equal(held, false); held = true; calls.locks++; },
            unlock() { assert.equal(held, true); held = false; calls.unlocks++; }
        }; } }
    };
    vm.runInNewContext(source, context, { filename: 'src/debugshots.js' });
    return { shots: context.sgs.debugShots, nodes, calls, failures, add, held: () => held };
}
function assertReleased(env) {
    assert.equal(env.held(), false);
    assert.equal(env.calls.locks, env.calls.unlocks);
}

test('fixed storage contract and init creates both .nomedia markers without overwriting', () => {
    const env = environment();
    assert.equal(env.shots.ROOT, ROOT);
    assert.equal(env.shots.DIR, DIR);
    assert.equal(env.shots.KEEP, 20);
    env.add(ROOT + '.nomedia', 'file', 'existing root marker');
    env.add(DIR + '.nomedia', 'file', 'existing screenshots marker');
    env.shots.init();
    assert.deepEqual(env.calls.written, []);
    assert.equal(env.nodes.get(normalize(ROOT + '.nomedia')).content, 'existing root marker');
    assert.equal(env.nodes.get(normalize(DIR + '.nomedia')).content, 'existing screenshots marker');
    const fresh = environment();
    fresh.shots.init();
    assert.deepEqual(fresh.calls.written, [ROOT + '.nomedia', DIR + '.nomedia']);
    fresh.shots.init();
    assert.equal(fresh.calls.written.length, 2);
});

test('prune keeps the newest 20 owned files and preserves personal, unknown, nested and symlink entries', () => {
    const env = environment();
    const names = Array.from({ length: 25 }, (_, i) => owned(NOW - 1000 + i));
    // Reverse insertion order ensures retention depends on names, not list ordering.
    names.slice().reverse().forEach(name => env.add(DIR + name));
    const preserved = ['vacation.png', 'IMG_20260101.jpg', 'unknown.txt', 'dbg_short_1_shot.png',
        owned(NOW, 1, 'bad.tag'), owned(NOW, 2)];
    preserved.slice(0, -1).forEach(name => env.add(DIR + name));
    env.add(DIR + preserved.at(-1), 'directory');
    env.add(DIR + preserved.at(-1) + '/' + owned(NOW - 9000));
    const linkFile = DIR + owned(NOW - 8000);
    env.add('/sdcard/DCIM/private.png', 'file', 'private');
    env.add(linkFile, 'symlink', '', '/sdcard/DCIM/private.png');
    const linkDir = DIR + owned(NOW - 7000);
    env.add('/sdcard/DCIM/private-album', 'directory');
    env.add(linkDir, 'symlink', '', '/sdcard/DCIM/private-album');
    env.shots._prune();
    assert.deepEqual(env.calls.removed.slice().sort(), names.slice(0, 5).map(name => DIR + name).sort());
    names.forEach((name, i) => assert.equal(env.nodes.has(normalize(DIR + name)), i >= 5));
    preserved.forEach(name => assert.ok(env.nodes.has(normalize(DIR + name)), name));
    assert.ok(env.nodes.has(normalize(linkFile)));
    assert.ok(env.nodes.has(normalize(linkDir)));
    assert.ok(env.nodes.has('/sdcard/DCIM/private.png'));
    assert.ok(env.nodes.has(normalize(DIR + preserved.at(-1) + '/' + owned(NOW - 9000))));
    assert.deepEqual(env.calls.listed, [DIR], 'must not traverse subdirectories');
});

test('save sanitizes traversal tags, keeps new screenshots and releases its lock', () => {
    const env = environment();
    for (let i = 0; i < 20; i++) env.add(DIR + owned(NOW - 100 + i));
    const saved = env.shots.save({ pixels: true }, '../../DCIM\\private/photo.png' + 'x'.repeat(60));
    assert.ok(saved.startsWith(DIR));
    assert.match(saved.slice(DIR.length), /^dbg_1730000000000_1_[A-Za-z0-9_-]{1,40}\.png$/);
    assert.equal(saved.slice(DIR.length).includes('..'), false);
    assert.deepEqual(env.calls.saved, [saved]);
    assert.deepEqual(env.calls.removed, [DIR + owned(NOW - 100)]);
    assert.ok(env.nodes.has(normalize(saved)));
    assertReleased(env);
});

test('same-millisecond sequence order and collisions preserve the newest 20', () => {
    const env = environment();
    for (let i = 1; i <= 21; i++) env.add(DIR + owned(NOW, i));
    env.shots._prune();
    assert.deepEqual(env.calls.removed, [DIR + owned(NOW, 1)]);
    env.add(DIR + owned(NOW, 1));
    const saved = env.shots.save({}, 'shot');
    assert.equal(saved, DIR + owned(NOW, 22));
    assert.ok(env.nodes.has(normalize(saved)));
    assert.equal([...env.nodes.keys()].filter(p => /^dbg_/.test(path.posix.basename(p))).length, 20);
    assertReleased(env);
});

test('symlink screenshot directories reject init, save and prune before any storage mutation', () => {
    const env = environment();
    env.add('/sdcard/DCIM', 'directory');
    env.add(DIR, 'symlink', '', '/sdcard/DCIM');
    assert.throws(() => env.shots.init(), /目录/);
    assert.throws(() => env.shots._prune(), /目录/);
    assert.equal(env.shots.save({}, 'shot'), null);
    assert.deepEqual(env.calls.saved, []);
    assert.deepEqual(env.calls.written, []);
    assert.deepEqual(env.calls.removed, []);
    assert.deepEqual(env.calls.listed, []);
    assertReleased(env);
});

test('symlink root directory and .nomedia targets are rejected', () => {
    for (const entry of [ROOT, ROOT + '.nomedia', DIR + '.nomedia']) {
        const env = environment();
        env.add(entry, 'symlink', '', '/sdcard/DCIM/elsewhere');
        assert.equal(env.shots.save({}, 'shot'), null, entry);
        assert.deepEqual(env.calls.saved, []);
        assert.deepEqual(env.calls.removed, []);
        assertReleased(env);
    }
});

for (const failure of ['ensureDir', 'save', 'listDir', 'remove']) {
    test('save releases the lock when ' + failure + ' throws', () => {
        const env = environment();
        for (let i = 0; i < 21; i++) env.add(DIR + owned(NOW - 100 + i));
        env.failures[failure] = true;
        assert.equal(env.shots.save({}, 'shot'), null);
        assert.equal(env.calls.locks, 1);
        assertReleased(env);
        assert.ok(env.calls.warnings.length > 0);
        env.failures[failure] = false;
        assert.ok(env.shots.save({}, 'recovery'));
        assertReleased(env);
    });
}

test('missing images do not acquire the lock or touch storage', () => {
    const env = environment();
    assert.equal(env.shots.save(null, 'shot'), null);
    assert.equal(env.calls.locks, 0);
    assert.equal(env.nodes.size, 0);
});

console.log(`debugshots: ${passed} tests passed (memory filesystem only)`);
