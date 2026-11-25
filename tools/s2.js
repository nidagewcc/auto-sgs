// s2.js —— 前台判断能力探测
var out = [];
function p(s) { out.push(s); log(s); }

p("auto.state() = " + (function () { try { return auto.state(); } catch (e) { return "ERR " + e; } })());
p("currentPackage() = \"" + (function () { try { return currentPackage(); } catch (e) { return "ERR " + e; } })() + "\"");
p("currentActivity() = \"" + (function () { try { return currentActivity(); } catch (e) { return "ERR " + e; } })() + "\"");

try {
    var o = shell("dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity'");
    p("shell code=" + o.code);
    p("shell out=" + String(o.result).substring(0, 300));
} catch (e) { p("shell 失败 " + e); }

try {
    var o2 = shell("pidof com.sanguosha.mjz.mi");
    p("pidof code=" + o2.code + " out=" + String(o2.result).trim());
} catch (e) { p("pidof 失败 " + e); }

files.write("/sdcard/Download/autosgs-logs/s2.txt", out.join("\n"));
toast("s2 done");
