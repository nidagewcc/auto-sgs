// config.js —— 常量与 ROI（坐标与 EC 版一致，横屏 2772x1280）
sgs = (typeof sgs === "undefined") ? {} : sgs;

// 电脑端服务地址：只有手机上明确写了 pc.txt 才启用。
// 空字符串 = 整套 HTTP 回传/远程指令关闭，只写本地 run.log。
// （AutoX 时代靠电脑 8099 收日志发指令，现在用 adb + autotask.txt 就够，不必强制开机）
sgs.PC = (function () {
    try {
        var f = "/sdcard/Download/autosgs-logs/pc.txt";
        if (!files.exists(f)) return "";
        var t = String(files.read(f)).trim();
        if (!t) return "";
        if (t.indexOf("http") !== 0) t = "http://" + t;
        if (t.indexOf(":", 8) < 0) t = t + ":8099";
        return t;
    } catch (e) { return ""; }
})();
sgs.SCREEN = { width: 2772, height: 1280 };

// ROI 统一用 [左, 上, 右, 下]
sgs.ROI = {
    playerInfo: {
        nickname: [235, 10, 480, 75],
        level: [1090, 500, 1280, 570],
        combat_power: [320, 120, 500, 192],
        physical: [1430, 0, 1780, 75],
        energy: [1780, 0, 2100, 75],
        sycee: [2210, 0, 2430, 75],
        jade: [2530, 0, 2772, 75]
    }
};

sgs.ANCHOR = { image: "common/anchor-zhengzhan.png", region: [2400, 980, 2772, 1280] };

// 主城兜底判定：暗色遮罩下模板匹配会掉分，改看底部菜单文字
sgs.HOME_TEXT = { text: "征战", region: [2560, 1150, 2772, 1250] };

// 异常页 / 登录流程的 ROI 与点击点（2772x1280）
sgs.PAGES = {
    relogin: { text: "重新登录", region: [1050, 800, 1900, 930], point: [1437, 862] },
    notice: { text: "孤知道了", region: [1000, 990, 1900, 1120], point: [1432, 1051] },
    login: { text: "进入游戏", region: [1050, 900, 1900, 1040], point: [1432, 970] },
    adDismiss: { point: [1964, 97] },
    offline: { text: "网络", region: [1000, 700, 1900, 830] }
};
sgs.THRESHOLD = { image: 0.8, weak: 0.7 };
sgs.TIMEOUT = { ui: 3000, page: 8000, task: 300000 };
sgs.LOG_DIR = "/sdcard/Download/autosgs-logs/";
