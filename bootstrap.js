// bootstrap.js —— 手机端固定启动器，只需在手机上粘贴/保存一次
// 每次运行都会从电脑拉取最新 main.js 并执行，日志与截图自动回传
auto.waitFor();

var PC = "http://192.168.2.250:8099";
var SRC = "/src/main.js";

try {
    var r = http.get(PC + SRC, { timeout: 10000 });
    if (!r || r.statusCode != 200) {
        toast("拉取失败: " + (r ? r.statusCode : "no response"));
        log("bootstrap: fetch failed");
        exit();
    }
    var code = r.body.string();
    toast("已拉取 " + code.length + " 字节，开始执行");
    log("bootstrap: fetched " + code.length + " bytes");
    sleep(300);
    eval(code);
} catch (e) {
    toast("bootstrap 异常: " + e);
    log("bootstrap error: " + e);
}
