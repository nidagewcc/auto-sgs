// config.js —— 常量与 ROI（坐标与 EC 版一致，横屏 2772x1280）
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.PC = "http://192.168.2.250:8099";
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
sgs.THRESHOLD = { image: 0.8, weak: 0.7 };
sgs.TIMEOUT = { ui: 3000, page: 8000, task: 300000 };
sgs.LOG_DIR = "/sdcard/Download/autosgs-logs/";
