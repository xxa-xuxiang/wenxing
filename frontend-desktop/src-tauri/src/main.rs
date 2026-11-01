// 问星 — Tauri 桌面壳（云端交付版）
// 后端已上云，壳仅承载前端页面；API 地址由前端 apiBase 解析
// （设备级自定义 > 构建注入 VITE_API_BASE > 本地 3001-3003 兜底）
//
// v1.5 新增取词通道：
//   1) 全局快捷键 Ctrl+Shift+T → 唤起桌宠窗口并通知前端开始翻译
//   2) grab_selection：快照剪贴板 → 模拟 Ctrl+C → 轮询比对取选区 → 写回原剪贴板
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::thread::sleep;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// 读取剪贴板文本
#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.get_text().map_err(|e| e.to_string())
}

/// 写入剪贴板文本
#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

/// 模拟 Ctrl+C：先放开用户按住的 Shift/Ctrl，避免组合键状态污染
#[cfg(windows)]
fn send_ctrl_c() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_SHIFT,
    };

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    let seq = [
        key(VK_SHIFT, true),
        key(VK_CONTROL, true),
        key(VK_CONTROL, false),
        key(VIRTUAL_KEY(b'C' as u16), false),
        key(VIRTUAL_KEY(b'C' as u16), true),
        key(VK_CONTROL, true),
    ];
    unsafe {
        SendInput(&seq, std::mem::size_of::<INPUT>() as i32);
    }
}

/// 抓取当前选区：先存剪贴板原文 → 模拟 Ctrl+C → 轮询等新文本；失败返回空串且写回原文
fn grab_selection_text() -> String {
    let mut cb = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let original = cb.get_text().unwrap_or_default();

    // 等用户松开热键，否则模拟的 Ctrl+C 会被 Shift 修饰成 Ctrl+Shift+C
    sleep(Duration::from_millis(120));

    #[cfg(windows)]
    {
        send_ctrl_c();
        for _ in 0..12 {
            sleep(Duration::from_millis(40));
            if let Ok(text) = cb.get_text() {
                let hit = text.trim().to_string();
                if !hit.is_empty() && hit != original {
                    if !original.is_empty() {
                        let _ = cb.set_text(original);
                    }
                    return hit;
                }
            }
        }
        // 没抓到新内容：尽量把剪贴板恢复成快照
        if !original.is_empty() {
            let _ = cb.set_text(original);
        }
        String::new()
    }

    #[cfg(not(windows))]
    {
        String::new()
    }
}

/// 供前端调用的取词命令（右键菜单等已聚焦桌宠的场景，通常抓不到内容）
#[tauri::command]
fn grab_selection() -> Result<String, String> {
    Ok(grab_selection_text())
}

/// 单实例通信端口：首个实例监听，后续启动连上它请求显示窗口
const INSTANCE_PORT: u16 = 49872;

enum InstanceRole {
    /// 首个实例：持有监听端口
    Primary(std::net::TcpListener),
    /// 已有实例在运行：通知它把窗口拉到前台，本进程退出
    Secondary,
    /// 端口被无关程序占用：跳过单实例保护，照常启动
    Bypass,
}

/// 判定本进程是否是首个实例。用本地端口而非文件锁：
/// 文件锁在异常退出/权限异常时会把新进程直接挡掉（表现为双击“闪退”）
fn claim_instance() -> InstanceRole {
    match std::net::TcpListener::bind(("127.0.0.1", INSTANCE_PORT)) {
        Ok(listener) => InstanceRole::Primary(listener),
        Err(_) => {
            if std::net::TcpStream::connect(("127.0.0.1", INSTANCE_PORT)).is_ok() {
                InstanceRole::Secondary
            } else {
                InstanceRole::Bypass
            }
        }
    }
}

/// WebView2 用户数据目录（与 tauri 默认位置一致：%LOCALAPPDATA%\<identifier>\EBWebView）
#[cfg(windows)]
fn webview_data_dir() -> Option<std::path::PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(
        std::path::Path::new(&base)
            .join("com.wenxing.app")
            .join("EBWebView"),
    )
}

/// 上一次异常退出可能把数据目录锁死（创建 WebView 报 0x800700AA）。
/// 把它改名挪开，下次启动会生成全新的数据目录，代价是需重新登录一次。
#[cfg(windows)]
fn rotate_webview_data_dir() {
    let Some(dir) = webview_data_dir() else { return };
    if !dir.exists() {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = dir.with_file_name(format!("EBWebView.bak-{stamp}"));
    if std::fs::rename(&dir, &backup).is_ok() {
        eprintln!("[问星] 旧的 WebView2 数据目录已挪开：{}", backup.display());
    }
}

/// 创建主窗口：先重试几次（上一个实例刚退出时目录可能短暂被占用），
/// 仍失败则挪开旧数据目录再建，避免第一次双击就白屏退出。
fn create_main_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    for attempt in 1..=4 {
        let result = tauri::WebviewWindowBuilder::new(
            app,
            "main",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 640.0)
        .center()
        .decorations(false)
        .build();

        match result {
            Ok(_) => return Ok(()),
            Err(err) => {
                eprintln!("[问星] 主窗口创建失败（第 {attempt} 次）：{err}");
                if attempt >= 2 {
                    #[cfg(windows)]
                    rotate_webview_data_dir();
                }
                sleep(Duration::from_millis(1200));
            }
        }
    }
    Err("主窗口创建失败".into())
}

fn main() {
    // 重复双击：通知已运行的实例显示主窗口，自己退出
    let role = claim_instance();
    if matches!(role, InstanceRole::Secondary) {
        return;
    }
    let primary_listener = match role {
        InstanceRole::Primary(listener) => Some(listener),
        _ => None,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let app = app.clone();
                    // 取词会 sleep 数百毫秒，放后台线程避免阻塞事件循环
                    std::thread::spawn(move || {
                        // 必须先取词再聚焦桌宠：聚焦会切走前台窗口，Ctrl+C 就发错对象了
                        let text = grab_selection_text();
                        if let Some(pet) = app.get_webview_window("pet") {
                            let _ = pet.show();
                            let _ = pet.set_focus();
                        }
                        // 前端在桌宠窗口内监听：payload 即选区文本（可能为空）
                        let _ = app.emit_to("pet", "pet-translate-hotkey", text);
                    });
                })
                .build(),
        )
        .setup(move |app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            // 主窗口在运行时创建：WebView2 数据目录被上一次异常退出占用时
            // 可以重试并把旧目录挪开，而不是在 Builder 阶段直接 panic 退出
            create_main_window(app)?;

            // 监听后续启动请求：还原并聚焦主窗口（窗口可能还在初始化，最多等 10 秒）
            if let Some(listener) = primary_listener {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    for _ in listener.incoming() {
                        for _ in 0..40 {
                            if let Some(win) = handle.get_webview_window("main") {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(250));
                        }
                    }
                });
            }

            let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyT);
            if let Err(e) = app.global_shortcut().register(hotkey) {
                // 热键被其他软件占用时不阻断启动，右键菜单仍有翻译入口
                eprintln!("[问星] 全局快捷键 Ctrl+Shift+T 注册失败：{e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_clipboard,
            write_clipboard,
            grab_selection
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}
