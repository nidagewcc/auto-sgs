'use strict';
// Pure session transitions. Persistence and UI code must serialize calls to this module.
(function (root) {
  function start(scene, instance, session, time) {
    return { schema: 'sgs-workbench/capture-session', schemaVersion: 1,
      sceneId: scene, instanceId: instance, sessionId: session, state: 'recording',
      frame: { width: 960, height: 540 }, startedAt: time, endedAt: null,
      frameCount: 0, frames: [], lastError: null, discardReason: null };
  }
  function copy(m) { return JSON.parse(JSON.stringify(m)); }
  function append(m, time) {
    if (!m || m.state !== 'recording') throw new Error('会话不在录制中');
    var result = copy(m), seq = result.frames.length + 1;
    if (seq > 999) throw new Error('会话帧数达到上限');
    var file = ('00' + seq).slice(-3) + '.png';
    result.frames.push({ seq: seq, file: file, savedAt: time, width: 960, height: 540, geometryMismatch: false });
    result.frameCount = seq;
    return result;
  }
  function fail(m, reason, time) {
    if (!m || m.state !== 'recording') throw new Error('会话不在录制中');
    var result = copy(m); result.state = 'failed'; result.lastError = reason; result.endedAt = time; return result;
  }
  function close(m, time) {
    if (!m || m.state !== 'recording') throw new Error('会话不在录制中');
    var result = copy(m); result.state = 'closed'; result.endedAt = time; return result;
  }
  function discard(m, time) {
    if (!m || (m.state !== 'recording' && m.state !== 'failed')) throw new Error('会话不可重录');
    var result = copy(m); result.discardReason = m.state === 'failed' ? 'failed-retry' : 'user-retry';
    result.state = 'discarded'; result.endedAt = time; return result;
  }
  var api = { start: start, append: append, fail: fail, close: close, discard: discard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.captureState = api;
})(this);
