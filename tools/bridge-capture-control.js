'use strict';
const fs = require('fs');
const path = require('path');
const protocol = require('../capture/protocol');
const ROOT = '/storage/emulated/0/Download/autosgs-logs';
const TASK = ROOT + '/capture-task.txt';
const HEARTBEAT = ROOT + '/capture-heartbeat.txt';
const RECEIPTS = ROOT + '/capture-receipts';
const crypto = require('crypto');
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function create(adb, serial, instanceId, base, inventory) {
  function shell(cmd) { return adb(['-s', serial, 'shell', cmd]).toString('utf8').replace(/\r/g, ''); }
  function safeRoot() {
    let p = '/storage/emulated/0/Download';
    for (const segment of ['autosgs-logs']) {
      p += '/' + segment;
      if (shell("if [ -L '" + p + "' ]; then echo BAD; elif [ -d '" + p + "' ]; then realpath '" + p + "'; else echo BAD; fi").trim() !== p) fail(10, '项目目录不安全');
    }
    for (const file of [HEARTBEAT, TASK, RECEIPTS]) {
      if (shell("if [ -L '" + file + "' ]; then echo BAD; else echo OK; fi").trim() !== 'OK') fail(10, '控制文件为符号链接');
    }
  }
  function current() { return inventory.list().filter(x => !x.discarded && (x.manifest.state === 'recording' || x.manifest.state === 'failed')); }
  function run(action, scene) {
    if (!['start', 'stop', 'retry'].includes(action)) fail(2, '不支持的采集命令');
    if (action !== 'stop') protocol.sceneId(scene);
    const lockDir = path.join(base, '_bridge', instanceId); fs.mkdirSync(lockDir, { recursive: true });
    const lock = path.join(lockDir, 'capture.lock'); let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (_) { fail(10, '采集命令正在执行'); }
    try {
      safeRoot();
      const heartbeat = shell("if [ -f '" + HEARTBEAT + "' ]; then cat '" + HEARTBEAT + "'; fi").trim();
      protocol.heartbeat(heartbeat, Date.now());
      const before = current();
      if (action === 'start' && before.length) fail(8, '已有进行中或失败的会话');
      if (action === 'stop' && before.length !== 1) fail(8, '没有唯一的活动会话');
      if (action === 'retry' && (before.length !== 1 || !protocol.canRetry(before[0].manifest, scene))) fail(8, '没有唯一的可重录会话');
      if (action === 'stop') scene = before[0].manifest.sceneId;
      protocol.sceneId(scene);
      const rid = 'r' + String(Date.now()) + crypto.randomBytes(2).toString('hex');
      const token = 'capture:' + scene + ':' + action + ':' + rid;
      const receiptPath = RECEIPTS + '/' + rid + '.json';
      const slot = shell("if [ -f '" + TASK + "' ]; then printf 'PRESENT:'; cat '" + TASK + "'; else printf 'EMPTY'; fi");
      if (slot !== 'EMPTY') fail(2, '采集令牌槽已占用: ' + slot.slice(8));
      function readReceipt() {
        const value = shell("if [ -L '" + RECEIPTS + "' ] || [ -L '" + receiptPath + "' ]; then echo UNSAFE; elif [ -f '" + receiptPath + "' ]; then cat '" + receiptPath + "'; fi");
        if (value.trim() === 'UNSAFE') fail(10, '回执路径为符号链接');
        return value;
      }
      // All bridge writers use the same device-side mkdir lock. Publish a complete
      // temporary file by rename only while the slot is empty; stale locks fail closed.
      const lockPath = ROOT + '/capture-task.publish-lock';
      const tempPath = ROOT + '/capture-task.publish-tmp';
      const command = "if mkdir '" + lockPath + "' 2>/dev/null; then " +
        "if [ -e '" + TASK + "' ] || [ -L '" + TASK + "' ]; then echo OCCUPIED; " +
        "elif [ -e '" + tempPath + "' ] || [ -L '" + tempPath + "' ]; then echo UNSAFE; " +
        "elif (set -C; printf '%s' '" + token + "' > '" + tempPath + "') 2>/dev/null && mv '" + tempPath + "' '" + TASK + "'; then echo WRITTEN; else echo UNSAFE; fi; " +
        "rmdir '" + lockPath + "' 2>/dev/null || echo UNSAFE; else echo LOCKED; fi";
      const written = shell(command).trim();
      if (written === 'OCCUPIED' || written === 'LOCKED') fail(2, '令牌槽被占用或发布中，未覆盖');
      if (written !== 'WRITTEN') fail(10, '令牌发布失败，请检查残留临时文件或锁');
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        const rawReceipt = readReceipt();
        if (rawReceipt) {
          let receipt;
          try { receipt = JSON.parse(rawReceipt); } catch (_) { fail(4, '采集回执损坏；心跳=' + heartbeat); }
          if (receipt.rid !== rid || receipt.token !== token || receipt.command !== action || receipt.sceneId !== scene) fail(4, '采集回执不匹配');
          const removed = shell("if [ -L '" + receiptPath + "' ]; then echo BAD; elif rm '" + receiptPath + "'; then echo OK; else echo BAD; fi").trim();
          if (removed !== 'OK') fail(10, '无法安全取走回执');
          if (receipt.result !== 'ok') fail(4, '采集引擎执行失败: ' + String(receipt.error || 'unknown') + '；心跳=' + heartbeat);
          return receipt;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      }
      fail(4, '等待采集引擎回执超时；最近心跳=' + shell("if [ -f '" + HEARTBEAT + "' ]; then cat '" + HEARTBEAT + "'; fi").trim());
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  return { run };
}
module.exports = { create };
