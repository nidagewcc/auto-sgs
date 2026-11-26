# 项目调试与手机文件操作约定

## 截图

- AutoJs6 调试截图统一使用 `sgs.debugShots.save(image, tag)`，存入 `/sdcard/Download/autosgs-logs/screenshots/`，最多保留最近 20 张。
- 使用 ADB 临时截图时也只允许写入本项目调试目录；优先直接拉到电脑 `_shot/` 分析，不写入 DCIM、Pictures、Screenshots 或 Download 根目录。
- 调试根目录和截图子目录使用 `.nomedia`，防止图片持续出现在相册。已有相册缓存可能需要系统刷新后才消失。
- 不为截图验证而盲点游戏或触发元宝消费。

## 清理

- 用户的私人照片、相册和其他应用数据不属于项目清理范围。禁止为本项目执行针对 DCIM、Pictures、Screenshots、整个 Download、整个存储空间或全局媒体库的删除。
- 自动轮转只处理截图专用目录下本程序生成的 `dbg_时间戳_序号_标签.png` 普通文件，不递归，不跟随符号链接，不删除未知命名文件。
- 清理历史调试图先使用 `tools/archive-phone-debug.js --archive --serial 指定设备` 备份；审阅 manifest 后再用 `--clean --serial 同一设备 --manifest 清单路径`。工具只允许固定项目目录中的已知历史命名，逐文件验证备份哈希、设备哈希和设备截图尺寸后删除。
- 禁止用 `rm -r`、通配符或全局 MediaStore 删除来代替逐个已核实文件的清理。不删除日志、配置、模板、用户图片或备份。
- 本机 `_shot/` 可能包含手机未同步代码的备份和图片恢复清单，不能当作可随意清空的临时目录。

## 构建与验证

- 修改源模块或运行器后运行 `node tools/build.js`，并检查 `node --check build/bundle.js`。
- 提交前运行 `node tests/regression.js` 及相关专项测试。
- 手机部署前先备份并比较实际运行脚本，避免覆盖手机上尚未同步的功能。只针对明确授权的设备操作，不凭设备列表顺序选择手机。
