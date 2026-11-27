'use strict';
// Device operations are limited to this application's fixed debug directory.
const fs = require('fs');
const path = require('path');
const pkg = require('./bridge-package');
const ROOT = '/storage/emulated/0/Download/autosgs-logs';
const RECIPES = ROOT + '/recipes';
const VERSION = /^pkg-[0-9]{8}-[0-9]{6}$/;
class BridgeError extends Error { constructor(code, message) { super(message); this.code = code; } }
function die(code, message) { throw new BridgeError(code, message); }
function create(adb, serial, id) {
  function shell(command) { return adb(['-s', serial, 'shell', command]).toString('utf8').replace(/\r/g, ''); }
  function quote(s) { if (!/^[a-zA-Z0-9_./-]+$/.test(s)) die(10, '设备路径包含非法字符'); return "'" + s + "'"; }
  function exists(p) { return shell('if [ -e ' + quote(p) + ' ] || [ -L ' + quote(p) + ' ]; then echo yes; else echo no; fi').trim() === 'yes'; }
  function checked(p, directory) {
    if (!(p === '/storage/emulated/0/Download' || p === ROOT || p.startsWith(ROOT + '/'))) die(10, '路径越界: ' + p);
    let cur = '/storage/emulated/0/Download';
    const parts = p.slice(cur.length).split('/').filter(Boolean);
    for (const part of parts) {
      if (!/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..') die(10, '非法路径段');
      cur += '/' + part;
      const result = shell('if [ -L ' + quote(cur) + ' ]; then echo LINK; elif [ -e ' + quote(cur) + ' ]; then realpath ' + quote(cur) + '; else echo MISSING; fi').trim();
      if (result !== cur) die(10, '路径不存在、链接或 canonical 不符: ' + cur + ' => ' + result);
    }
    if (directory && shell('if [ -d ' + quote(p) + ' ]; then echo yes; else echo no; fi').trim() !== 'yes') die(10, '不是目录: ' + p);
    return p;
  }
  function mkdir(p) { if (!exists(p)) { checked(path.posix.dirname(p), true); shell('mkdir ' + quote(p)); } checked(p, true); }
  function init() {
    const parent = '/storage/emulated/0/Download';
    if (shell('realpath ' + quote(parent)).trim() !== parent) die(4, 'Download canonical 不符');
    mkdir(ROOT); mkdir(RECIPES);
    for (const p of [ROOT + '/.nomedia', RECIPES + '/.nomedia']) {
      if (exists(p)) checked(p); else { checked(path.posix.dirname(p), true); shell('touch ' + quote(p)); checked(p); }
    }
  }
  function root() { try { checked(ROOT, true); checked(RECIPES, true); } catch (e) { die(4, e.message); } }
  function read(p) { checked(p); return shell('cat ' + quote(p)); }
  function pointer() { const s = read(RECIPES + '/current.txt'); if (!/^pkg-\d{8}-\d{6}\n?$/.test(s)) die(8, 'current.txt 损坏'); return s.trim(); }
  function atom(p, value, pattern) {
    if (!pattern.test(value)) die(10, '指针内容无效');
    const tmp = p + '.tmp'; checked(path.posix.dirname(p), true);
    if (exists(tmp)) die(10, '临时文件已存在，拒绝覆盖: ' + tmp);
    if (exists(p)) checked(p);
    let created = false;
    try {
      shell("printf '%s\\n' '" + value + "' > " + quote(tmp));
      created = true;
      if (read(tmp) !== value + '\n') die(6, '临时文件回读不符');
      shell('mv ' + quote(tmp) + ' ' + quote(p));
      created = false;
      if (read(p) !== value + '\n') die(6, '指针回读不符');
    } finally {
      if (created && exists(tmp)) { checked(tmp); shell('rm ' + quote(tmp)); }
    }
  }
  function listing() { return shell('ls -1a ' + quote(RECIPES)).split('\n').filter(x => x && x !== '.' && x !== '..'); }
  function digest(p) {
    checked(p);
    const r = shell('sha256sum ' + quote(p) + ' && wc -c < ' + quote(p)).trim().split('\n');
    const m = /^([0-9a-f]{64})\s/.exec(r[0] || '');
    if (!m || !/^\d+$/.test((r[1] || '').trim())) die(5, '设备哈希读取失败: ' + p);
    return { sha256: m[1], bytes: Number(r[1].trim()) };
  }
  function verify(dir, manifest, manifestHash) {
    checked(dir, true);
    if (manifestHash && digest(dir + '/manifest.json').sha256 !== manifestHash) die(5, 'manifest 回读哈希不符');
    for (const f of manifest.files) {
      const d = digest(dir + '/' + f.path);
      if (d.sha256 !== f.sha256 || d.bytes !== f.bytes) die(5, '回读哈希或长度不符: ' + f.path);
      console.log('sha256 OK ' + f.path + ' ' + d.sha256 + ' bytes=' + d.bytes);
    }
    if (manifestHash) console.log('sha256 OK manifest.json ' + manifestHash);
  }
  function remoteManifest(dir, expected) {
    const m = JSON.parse(read(dir + '/manifest.json'));
    if (m.schema !== 'sgs-workbench/recipe-package' || m.schemaVersion !== 1 || m.packageId !== expected || !Array.isArray(m.files) || !Array.isArray(m.profiles)) die(10, '设备 manifest 无效');
    const profiles = new Set(m.profiles.map(x => x.id)); let last = '';
    for (const f of m.files) {
      pkg.filePath(f.path, profiles);
      if (f.path <= last || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0) die(10, '设备清单无效');
      last = f.path;
    }
    if (!m.files.some(f => f.path === 'recipe.json')) die(10, '设备清单缺少 recipe.json');
    verify(dir, m); return m;
  }
  function prune() {
    root(); const current = pointer(); const list = listing(); const versions = []; let issues = false;
    for (const name of list) {
      if (['current.txt', '.nomedia', 'instance.txt'].includes(name)) continue;
      if (VERSION.test(name)) {
        try { checked(RECIPES + '/' + name, true); versions.push(name); } catch (e) { console.error('prune 跳过: ' + name + ': ' + e.message); issues = true; }
      } else { console.error('prune 保留未知或暂存项: ' + name); issues = true; }
    }
    if (!versions.includes(current)) die(10, '当前包不存在');
    versions.sort().reverse(); const keep = new Set([current, ...versions.filter(v => v !== current).slice(0, 2)]);
    for (const name of versions.filter(v => !keep.has(v))) {
      const dir = RECIPES + '/' + name;
      try {
        const m = remoteManifest(dir, name);
        const paths = m.files.map(f => dir + '/' + f.path).concat(dir + '/manifest.json');
        // Validate every component before the first removal.
        for (const p of paths) checked(p);
        const dirs = new Set();
        for (const f of m.files) { let d = path.posix.dirname(dir + '/' + f.path); while (d !== dir) { dirs.add(d); d = path.posix.dirname(d); } }
        for (const p of paths) { console.log('prune rm ' + p); shell('rm ' + quote(p)); }
        for (const d of [...dirs].sort((a,b) => b.length-a.length).concat(dir)) {
          checked(d, true); console.log('prune rmdir ' + d);
          const r = shell('if rmdir ' + quote(d) + '; then echo OK; else echo FAILED; fi').trim();
          if (r !== 'OK') throw new Error('非空或不能删除: ' + d);
        }
      } catch (e) { console.error('prune 保留 ' + name + ': ' + e.message); issues = true; }
    }
    console.log('recipes entries: ' + listing().join(' '));
    if (issues) die(7, '清理有残留，详见警告');
  }
  function deploy(local, validated) {
    const m = validated.manifest; const dest = RECIPES + '/' + m.packageId;
    const staging = RECIPES + '/.staging-' + m.packageId.slice(4);
    init();
    if (exists(RECIPES + '/current.txt')) console.log('current before: ' + pointer()); else console.log('current before: (missing)');
    if (exists(staging) || exists(dest)) die(6, '目标包或暂存目录已存在');
    try {
      mkdir(staging);
      for (const f of m.files) {
        let d = staging;
        for (const part of f.path.split('/').slice(0,-1)) { d += '/' + part; mkdir(d); }
        adb(['-s', serial, 'push', path.join(local, ...f.path.split('/')), staging + '/' + f.path]);
        checked(staging + '/' + f.path);
      }
      adb(['-s', serial, 'push', path.join(local, 'manifest.json'), staging + '/manifest.json']);
      verify(staging, m, validated.manifestSha256);
    } catch (e) { if (e.code === 10) throw e; die(5, '暂存/回读失败: ' + e.message); }
    try {
      checked(staging, true); shell('mv ' + quote(staging) + ' ' + quote(dest)); checked(dest, true);
      atom(RECIPES + '/current.txt', m.packageId, VERSION);
      atom(ROOT + '/instance.txt', id, /^[a-z0-9-]+$/);
      console.log('current after: ' + pointer());
    } catch (e) { if (e.code === 10) throw e; die(6, '原子切换失败: ' + e.message); }
    prune();
  }
  function rollback() {
    root(); const current = pointer(); console.log('current before: ' + current);
    const candidates = listing().filter(n => VERSION.test(n) && n !== current).sort().reverse();
    let target;
    for (const n of candidates) { try { checked(RECIPES + '/' + n, true); remoteManifest(RECIPES + '/' + n, n); target = n; break; } catch (e) { console.error('回退跳过 ' + n + ': ' + e.message); } }
    if (!target) die(8, '无合法上一版本');
    try { atom(RECIPES + '/current.txt', target, VERSION); } catch (e) { if (e.code === 10) throw e; die(6, e.message); }
    console.log('current after rollback: ' + pointer()); prune();
  }
  return { deploy, rollback };
}
module.exports = { create, BridgeError };
