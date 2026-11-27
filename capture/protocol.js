'use strict';
// Pure capture protocol rules; no device or UI side effects.
(function (root) {
  function failure(code, message) { var e = new Error(message); e.code = code; throw e; }
  function sceneId(s) {
    if (typeof s !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(s) || s === '_discard') failure(2, '非法场景 id');
    return s;
  }
  function parse(token) {
    var m = /^capture:([a-z0-9_-]{1,64}):(start|stop|retry):(r\d{13}[0-9a-f]{4})$/.exec(token || '');
    if (!m) return null;
    try { sceneId(m[1]); } catch (_) { return null; }
    return { scene: m[1], command: m[2], rid: m[3] };
  }
  function slot(existing, proposed) {
    if (!parse(proposed)) failure(2, '非法采集令牌');
    if (existing == null) return 'write';
    failure(2, '采集令牌槽已占用: ' + existing);
  }
  function heartbeat(value, now) {
    if (!/^\d{13}$/.test(String(value || ''))) failure(9, '采集引擎离线，请在 AutoJs6 手动启动');
    var age = now - Number(value);
    if (age < -2000 || age > 10000) failure(9, '采集引擎离线，请在 AutoJs6 手动启动');
  }
  function canRetry(manifest, scene) {
    return !!manifest && manifest.sceneId === scene && (manifest.state === 'failed' || manifest.state === 'recording');
  }
  function canPull(manifest) { return !!manifest && manifest.state === 'closed'; }
  var api = { sceneId: sceneId, parse: parse, slot: slot, heartbeat: heartbeat, canRetry: canRetry, canPull: canPull };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.captureProtocol = api;
})(this);
