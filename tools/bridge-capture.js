'use strict';
// Read-only capture inventory and closed-session export. Mutating commands are separate.
const fs = require('fs');
const path = require('path');
const protocol = require('../capture/protocol');
const ROOT = '/storage/emulated/0/Download/autosgs-logs/capture';
const SESSION = /^\d{8}-\d{6}-[a-z0-9]{4}$/;
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function create(adb, serial, instanceId, base) {
  function shell(cmd) { return adb(['-s', serial, 'shell', cmd]).toString('utf8').replace(/\r/g, ''); }
  function quote(p) { if (!/^\/[a-zA-Z0-9_./-]+$/.test(p) || p.split('/').some(x => x === '.' || x === '..')) fail(10, '非法设备路径'); return "'" + p + "'"; }
  function checked(p, directory) {
    if (p !== ROOT && !p.startsWith(ROOT + '/')) fail(10, '设备路径越界');
    let current = '/storage/emulated/0/Download';
    for (const part of p.slice(current.length).split('/').filter(Boolean)) {
      current += '/' + part;
      const result = shell('if [ -L ' + quote(current) + ' ]; then echo LINK; elif [ -e ' + quote(current) + ' ]; then realpath ' + quote(current) + '; else echo MISSING; fi').trim();
      if (result !== current) fail(10, '路径不存在、符号链接或 canonical 不符: ' + current);
    }
    if (directory && shell('if [ -d ' + quote(p) + ' ]; then echo yes; else echo no; fi').trim() !== 'yes') fail(10, '不是目录: ' + p);
  }
  function entries(p) { checked(p, true); return shell('ls -1a ' + quote(p)).split('\n').filter(x => x && x !== '.' && x !== '..'); }
  function manifest(dir, scene, session, discarded) {
    const filename = dir + '/session-manifest.json'; checked(filename, false);
    let m; try { m = JSON.parse(shell('cat ' + quote(filename))); } catch (_) { fail(10, '清单 JSON 无效: ' + filename); }
    if (!m || m.schema !== 'sgs-workbench/capture-session' || m.schemaVersion !== 1 || m.sceneId !== scene || m.sessionId !== session || m.instanceId !== instanceId || !['recording','closed','failed','discarded'].includes(m.state) || (discarded !== (m.state === 'discarded')) || !Array.isArray(m.frames) || m.frameCount !== m.frames.length || !m.frame || m.frame.width !== 960 || m.frame.height !== 540) fail(10, '会话清单无效: ' + filename);
    m.frames.forEach((f, i) => { if (!f || f.seq !== i + 1 || f.file !== String(i + 1).padStart(3, '0') + '.png' || f.width !== 960 || f.height !== 540 || f.geometryMismatch !== false) fail(10, '帧清单无效: ' + filename); });
    return m;
  }
  function recovery() {
    checked(ROOT, true);
    const txPath = '/storage/emulated/0/Download/autosgs-logs/capture-tx.json';
    const raw = shell("if [ -L '" + txPath + "' ]; then echo UNSAFE; elif [ -f '" + txPath + "' ]; then cat '" + txPath + "'; else echo NONE; fi").trim();
    if (raw === 'NONE') return null;
    if (raw === 'UNSAFE') fail(10, '事务文件为符号链接: ' + txPath);
    let tx;
    try { tx = JSON.parse(raw); } catch (_) { return { status: '需人工恢复', transactionPath: txPath, error: '事务文件损坏' }; }
    try {
      protocol.sceneId(tx.sceneId);
      if (!SESSION.test(tx.oldSessionId) || !SESSION.test(tx.newSessionId)) throw new Error('invalid id');
      const scene = ROOT + '/' + tx.sceneId;
      if (tx.oldDir !== scene + '/' + tx.oldSessionId || tx.discardDir !== scene + '/_discard/' + tx.oldSessionId || tx.newDir !== scene + '/' + tx.newSessionId) throw new Error('invalid paths');
      return { status: '事务未完成，若持续存在需人工恢复', transactionPath: txPath, oldDir: tx.oldDir, discardDir: tx.discardDir, newDir: tx.newDir };
    } catch (_) { return { status: '需人工恢复', transactionPath: txPath, error: '事务路径或标识无效' }; }
  }
  function list() {
    const result = [];
    for (const scene of entries(ROOT)) {
      if (scene === '.nomedia') continue;
      try { protocol.sceneId(scene); } catch (_) { console.error('跳过未知条目: ' + scene); continue; }
      const scenePath = ROOT + '/' + scene;
      for (const item of entries(scenePath)) {
        if (item === '_discard') {
          for (const session of entries(scenePath + '/_discard')) {
            if (!SESSION.test(session)) { console.error('跳过未知会话: ' + session); continue; }
            const dir = scenePath + '/_discard/' + session;
            result.push({ dir, discarded: true, manifest: manifest(dir, scene, session, true) });
          }
        } else if (SESSION.test(item)) {
          const dir = scenePath + '/' + item;
          result.push({ dir, discarded: false, manifest: manifest(dir, scene, item, false) });
        } else console.error('跳过未知条目: ' + item);
      }
    }
    return result;
  }
  function pull(scene, session, includeDiscard) {
    protocol.sceneId(scene); if (!SESSION.test(session || '')) fail(2, '非法会话 id');
    const dir = ROOT + '/' + scene + (includeDiscard ? '/_discard/' : '/') + session;
    checked(dir, true); const m = manifest(dir, scene, session, !!includeDiscard);
    if (!(includeDiscard ? m.state === 'discarded' : protocol.canPull(m))) fail(11, '仅允许拉取 closed 会话，作废会话需显式指定');
    const target = path.join(base, '_bridge', instanceId, 'capture', scene, ...(includeDiscard ? ['_discard'] : []), session);
    // Refuse symlinks in every existing ancestor, including the workspace itself.
    const parent = path.dirname(target), absolute = path.resolve(parent), root = path.parse(absolute).root;
    let partPath = root;
    for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
      partPath = path.join(partPath, part);
      try { const st = fs.lstatSync(partPath); if (st.isSymbolicLink() || !st.isDirectory()) fail(10, '本地路径不安全: ' + partPath); }
      catch (e) { if (e.code !== 'ENOENT') throw e; fs.mkdirSync(partPath); }
    }
    try { fs.lstatSync(target); fail(10, '本地会话目录已存在，拒绝覆盖'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    checked(dir + '/session-manifest.json', false);
    for (const f of m.frames) checked(dir + '/' + f.file, false);
    const staging = fs.mkdtempSync(path.join(parent, '.staging-pull-'));
    const written = [];
    try {
      for (const name of ['session-manifest.json', ...m.frames.map(f => f.file)]) {
        const data = adb(['-s', serial, 'exec-out', 'cat', dir + '/' + name]);
        if (name !== 'session-manifest.json' && (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex')) || data.toString('ascii',12,16) !== 'IHDR' || data.readUInt32BE(16) !== 960 || data.readUInt32BE(20) !== 540)) fail(10, 'PNG 校验失败: ' + name);
        if (name === 'session-manifest.json' && JSON.stringify(JSON.parse(data.toString('utf8'))) !== JSON.stringify(m)) fail(10, '会话清单拉取时发生变化');
        fs.writeFileSync(path.join(staging, name), data, { flag: 'wx' }); written.push(name);
      }
      // Recheck the manifest after the final frame to detect concurrent changes.
      if (JSON.stringify(manifest(dir, scene, session, !!includeDiscard)) !== JSON.stringify(m)) fail(10, '会话在拉取期间发生变化');
      try { fs.lstatSync(target); fail(10, '本地会话目录已存在，拒绝覆盖'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      fs.renameSync(staging, target);
    } catch (e) {
      for (const name of written) { try { fs.unlinkSync(path.join(staging, name)); } catch (_) {} }
      try { fs.rmdirSync(staging); } catch (_) {}
      throw e;
    }
    return { directory: target, frameCount: m.frames.length };
  }
  return { list, pull, recovery };
}
module.exports = { create };
