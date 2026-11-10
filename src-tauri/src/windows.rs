use std::sync::atomic::{AtomicBool, Ordering};

use crate::{Shared, WindowState};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

/// Set while we destroy the library window in order to dock it, so the close
/// event puts the drawer back instead of dismissing it.
static LIBRARY_DOCKING: AtomicBool = AtomicBool::new(false);

/// Smallest OUTER logical size the reader is allowed to shrink to: the PRD's
/// minimum usable window, which describes the outer window on every platform.
const MIN_OUTER_WIDTH: f64 = 360.0;
const MIN_OUTER_HEIGHT: f64 = 420.0;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// How much larger a window's outer frame is than its content area, in logical
/// pixels. Size setters and size constraints operate on content, while the
/// presets and everything persisted are outer dimensions. Measured rather than
/// assumed: the Windows reader is undecorated (see `restore`), but a system
/// that still adds a border is handled the same way.
#[cfg(not(target_os = "macos"))]
fn frame(window: &WebviewWindow) -> Result<(f64, f64), String> {
    let scale = window.scale_factor().map_err(err)?;
    let outer = window.outer_size().map_err(err)?;
    let inner = window.inner_size().map_err(err)?;
    Ok((
        outer.width.saturating_sub(inner.width) as f64 / scale,
        outer.height.saturating_sub(inner.height) as f64 / scale,
    ))
}

/// The macOS window uses an overlay title bar (`titleBarStyle: "Overlay"` in
/// tauri.conf.json): the content view fills the whole frame and the traffic
/// lights are drawn over the toolbar, so outer and content sizes are the same.
/// Returned as a constant rather than measured because AppKit only reports the
/// frame while the window server is running.
#[cfg(target_os = "macos")]
fn frame(_window: &WebviewWindow) -> Result<(f64, f64), String> {
    Ok((0.0, 0.0))
}

/// Converts a desired OUTER logical size into the content size that `set_size`
/// and the size constraints need. This is the single place the outer/inner
/// contract crosses platform-specific window behaviour; see `tests` below.
fn content_size(outer_width: f64, outer_height: f64, border: (f64, f64)) -> (f64, f64) {
    let (border_x, border_y) = border;
    (
        (outer_width - border_x).max(1.0),
        (outer_height - border_y).max(1.0),
    )
}

/// Recovers the OUTER size to persist from what the window reports. The system
/// normally already includes the decorations in the outer size; a session that
/// reports outer and inner as identical despite a known border (a window server
/// that never composed the frame) does not, and there the border has to be
/// added back so presets keep their intended size.
fn outer_logical(
    outer: LogicalSize<f64>,
    inner: Option<LogicalSize<f64>>,
    border: (f64, f64),
) -> (f64, f64) {
    let reported_content = inner.is_some_and(|inner| {
        (outer.width - inner.width).abs() < 1.0 && (outer.height - inner.height).abs() < 1.0
    });
    if reported_content && border.0 + border.1 > 0.0 {
        (outer.width + border.0, outer.height + border.1)
    } else {
        (outer.width, outer.height)
    }
}

fn set_outer(window: &WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let border = frame(window)?;
    let (width, height) = content_size(width, height, border);
    window.set_size(LogicalSize::new(width, height)).map_err(err)
}

fn apply_lock(window: &WebviewWindow, target: &WindowState) -> Result<(), String> {
    // Tauri size setters and constraints refer to client dimensions; the persisted
    // contract is outer dimensions. Recompute the border after changing styles.
    window.set_max_size(None::<LogicalSize<f64>>).map_err(err)?;
    window.set_min_size(None::<LogicalSize<f64>>).map_err(err)?;
    window.set_maximizable(!target.locked).map_err(err)?;
    window.set_resizable(!target.locked).map_err(err)?;
    let (border_x, border_y) = frame(window)?;
    if target.locked {
        let (width, height) = content_size(target.width, target.height, (border_x, border_y));
        let size = LogicalSize::new(width, height);
        window.set_min_size(Some(size)).map_err(err)?;
        window.set_max_size(Some(size)).map_err(err)?;
    } else {
        // Small displays are allowed to use their entire available area.
        let monitor = window.current_monitor().map_err(err)?;
        let (max_w, max_h) = monitor
            .map(|m| {
                (
                    m.work_area().size.width as f64 / m.scale_factor(),
                    m.work_area().size.height as f64 / m.scale_factor(),
                )
            })
            .unwrap_or((360.0, 420.0));
        // The minimum is an outer size, like every other dimension here.
        let (width, height) = content_size(
            MIN_OUTER_WIDTH.min(max_w),
            MIN_OUTER_HEIGHT.min(max_h),
            (border_x, border_y),
        );
        window
            .set_min_size(Some(LogicalSize::new(width, height)))
            .map_err(err)?;
    }
    set_outer(window, target.width, target.height)
}

fn constrain(
    window: &WebviewWindow,
    saved: &mut WindowState,
    prefer_saved_monitor: bool,
) -> Result<bool, String> {
    let monitors = window.available_monitors().map_err(err)?;
    let selected = if prefer_saved_monitor {
        monitors
            .iter()
            .find(|m| m.name() == saved.monitor.as_ref())
            .cloned()
    } else {
        window.current_monitor().map_err(err)?
    };
    let Some(monitor) = selected
        .or(window.primary_monitor().map_err(err)?)
        .or_else(|| monitors.first().cloned())
    else {
        return Ok(false);
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let old_size = (saved.width, saved.height);
    // Saved sizes are outer. An unlocked window never drops below the minimum; a
    // locked one keeps its size unless the work area is now smaller, where it
    // shrinks only as far as needed (PRD WIN-07).
    if !saved.locked {
        saved.width = saved.width.max(MIN_OUTER_WIDTH);
        saved.height = saved.height.max(MIN_OUTER_HEIGHT);
    }
    saved.width = saved.width.min(area.size.width as f64 / scale);
    saved.height = saved.height.min(area.size.height as f64 / scale);
    let width = (saved.width * scale).round() as i32;
    let height = (saved.height * scale).round() as i32;
    let left = area.position.x;
    let top = area.position.y;
    let right = left + area.size.width as i32;
    let bottom = top + area.size.height as i32;
    saved.x = Some(
        saved
            .x
            .unwrap_or(left + 32)
            .clamp(left, (right - width).max(left)),
    );
    saved.y = Some(
        saved
            .y
            .unwrap_or(top + 32)
            .clamp(top, (bottom - height).max(top)),
    );
    saved.monitor = monitor.name().cloned();
    Ok((old_size.0 - saved.width).abs() > 1.0 || (old_size.1 - saved.height).abs() > 1.0)
}

pub fn restore(window: &WebviewWindow) -> Result<(), String> {
    // Windows: the reader draws its own minimize, maximize and close buttons at the right end of
    // its toolbar (src/main.ts), so the native caption goes. The window keeps its resize border and
    // shadow. This runs before the window is first shown, and before any size is measured, so the
    // frame below already reflects the undecorated window.
    #[cfg(target_os = "windows")]
    window.set_decorations(false).map_err(err)?;
    let shared = window.state::<Shared>();
    let mut saved = shared
        .lock()
        .map_err(|_| "Window state is unavailable")?
        .saved
        .window
        .clone();
    let recovered = constrain(window, &mut saved, true)?;
    // Position first so client/outer conversion uses the destination monitor DPI.
    window
        .set_position(PhysicalPosition::new(
            saved.x.unwrap_or(0),
            saved.y.unwrap_or(0),
        ))
        .map_err(err)?;
    window.set_always_on_top(saved.pinned).map_err(err)?;
    apply_lock(window, &saved)?;
    let mut store = shared.lock().map_err(|_| "Window state is unavailable")?;
    store.saved.window = saved;
    store.dirty = true;
    if recovered {
        store.warning = Some("The reader was resized to fit the available display. Your size-lock setting was preserved.".into());
    }
    Ok(())
}

/// Outer logical frame of an undocked library window. `main` is the reader's
/// outer origin and size. `side` is where the drawer was, so the window tears
/// off that way. `work`, when known, is the monitor work area in the same
/// coordinates; a side that would land off it flips, then clamps.
pub fn place_library(
    main: (f64, f64, f64, f64),
    side: &str,
    width: f64,
    gap: f64,
    work: Option<(f64, f64, f64, f64)>,
) -> (f64, f64, f64, f64) {
    let (mx, my, mw, mh) = main;
    let width = width.clamp(240.0, 640.0);
    let height = mh.max(420.0);
    let left = mx - width - gap;
    let right = mx + mw + gap;
    let preferred = if side == "right" { right } else { left };
    let alternate = if side == "right" { left } else { right };
    let (x, y) = match work {
        Some((wx, wy, ww, wh)) => {
            let fits = |origin: f64| origin >= wx - 1.0 && origin + width <= wx + ww + 1.0;
            let x = if fits(preferred) {
                preferred
            } else if fits(alternate) {
                alternate
            } else {
                preferred.clamp(wx, (wx + ww - width).max(wx))
            };
            (x, my.clamp(wy, (wy + wh - height).max(wy)))
        }
        None => (preferred, my),
    };
    (x, y, width, height)
}

fn reader_frame(window: &WebviewWindow) -> Result<(f64, f64, f64, f64), String> {
    let scale = window.scale_factor().map_err(err)?;
    let pos = window.outer_position().map_err(err)?;
    let size = window.outer_size().map_err(err)?;
    Ok((
        pos.x as f64 / scale,
        pos.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

fn work_area(window: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let monitor = window.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    Some((
        area.position.x as f64 / scale,
        area.position.y as f64 / scale,
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
    ))
}

fn move_library(library: &WebviewWindow, app: &AppHandle, width: f64, side: &str) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("The reader window is missing.")?;
    let (x, y, width, height) = place_library(reader_frame(&main)?, side, width, 8.0, work_area(&main));
    library.set_position(LogicalPosition::new(x, y)).map_err(err)?;
    library.set_size(LogicalSize::new(width, height)).map_err(err)?;
    Ok(())
}

/// Tears the library off into its own window, focuses that window, or docks it
/// back. `width` of 0 focuses without moving. `restore` puts the drawer back
/// when docking; closing the window from its own caption does not.
/// Arguments are flat, the same way `set_pin` takes `enabled`: a struct parameter
/// would require the frontend to wrap them under `request`.
#[tauri::command]
pub async fn set_library_window(undocked: bool, restore: bool, width: f64, side: String, app: AppHandle) -> Result<(), String> {
    if !undocked {
        if let Some(library) = app.get_webview_window("library") {
            if restore {
                LIBRARY_DOCKING.store(true, Ordering::SeqCst);
            }
            library.destroy().map_err(err)?;
        } else if restore {
            let _ = app.emit("library-window", serde_json::json!({ "undocked": false, "restore": true }));
        }
        return Ok(());
    }
    if let Some(library) = app.get_webview_window("library") {
        if width > 0.0 {
            move_library(&library, &app, width, &side)?;
        }
        let _ = library.unminimize();
        library.show().map_err(err)?;
        library.set_focus().map_err(err)?;
        let _ = app.emit("library-window", serde_json::json!({ "undocked": true, "restore": false }));
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("The reader window is missing.")?;
    let (x, y, placed_width, height) = place_library(reader_frame(&main)?, &side, width, 8.0, work_area(&main));
    let pinned = app.state::<Shared>().lock().map(|store| store.saved.window.pinned).unwrap_or(false);
    let mut builder = WebviewWindowBuilder::new(&app, "library", WebviewUrl::App("library.html".into()))
        .title("Library — Hold My Brief")
        .inner_size(placed_width, height)
        .min_inner_size(280.0, 420.0)
        .position(x, y)
        .resizable(true)
        .focused(true)
        .always_on_top(pinned);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(LogicalPosition::new(14.0, 16.0));
    }
    #[cfg(target_os = "windows")]
    {
        builder = builder.decorations(false);
    }
    builder.build().map_err(err)?;
    let _ = app.emit("library-window", serde_json::json!({ "undocked": true, "restore": false }));
    Ok(())
}

/// The library window asked the reader to open a document. The reader owns the page.
#[tauri::command]
pub fn open_from_library(path: String, app: AppHandle) -> Result<(), String> {
    if path.is_empty() {
        return Err("That document is not in the library.".into());
    }
    app.emit("library-open", path).map_err(err)?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

/// A library window that closed on its own (caption, not Dock) dismisses the
/// panel. Docking sets `LIBRARY_DOCKING` first so the drawer comes back.
pub fn note_library_closed(window: &Window, event: &WindowEvent) {
    if window.label() != "library" || !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    let restore = LIBRARY_DOCKING.swap(false, Ordering::SeqCst);
    let _ = window.app_handle().emit("library-window", serde_json::json!({ "undocked": false, "restore": restore }));
}

#[tauri::command]
pub fn set_pin(
    enabled: bool,
    window: WebviewWindow,
    state: State<'_, Shared>,
) -> Result<WindowState, String> {
    window.set_always_on_top(enabled).map_err(err)?;
    if let Some(library) = window.app_handle().get_webview_window("library") {
        let _ = library.set_always_on_top(enabled);
    }
    let mut store = state.lock().map_err(|_| "Window state is unavailable")?;
    store.saved.window.pinned = enabled;
    let _ = window.emit("window-state", store.saved.window.clone());
    store.persist()?;
    Ok(store.saved.window.clone())
}

#[tauri::command]
pub fn set_lock(
    enabled: bool,
    window: WebviewWindow,
    state: State<'_, Shared>,
) -> Result<WindowState, String> {
    // Restoring a maximized window first prevents locking an OS maximize state.
    if window.is_maximized().map_err(err)? {
        window.unmaximize().map_err(err)?;
    }
    let scale = window.scale_factor().map_err(err)?;
    let size = window.outer_size().map_err(err)?.to_logical::<f64>(scale);
    let mut saved = state
        .lock()
        .map_err(|_| "Window state is unavailable")?
        .saved
        .window
        .clone();
    saved.width = size.width;
    saved.height = size.height;
    saved.locked = enabled;
    {
        let mut store = state.lock().map_err(|_| "Window state is unavailable")?;
        store.saved.window = saved.clone();
    }
    apply_lock(&window, &saved)?;
    let _ = window.emit("window-state", saved.clone());
    state
        .lock()
        .map_err(|_| "Window state is unavailable")?
        .persist()?;
    Ok(saved)
}

#[tauri::command]
pub fn set_preset(
    preset: String,
    window: WebviewWindow,
    state: State<'_, Shared>,
) -> Result<WindowState, String> {
    let mut saved = state
        .lock()
        .map_err(|_| "Window state is unavailable")?
        .saved
        .window
        .clone();
    if saved.locked {
        return Err("Size is locked. Unlock size before choosing a window preset.".into());
    }
    (saved.width, saved.height) = match preset.as_str() {
        "compact" => (420.0, 620.0),
        "reading" => (760.0, 900.0),
        _ => return Err("Unknown window preset.".into()),
    };
    constrain(&window, &mut saved, false)?;
    if window.is_maximized().map_err(err)? {
        window.unmaximize().map_err(err)?;
    }
    apply_lock(&window, &saved)?;
    window
        .set_position(PhysicalPosition::new(
            saved.x.unwrap_or(0),
            saved.y.unwrap_or(0),
        ))
        .map_err(err)?;
    let mut store = state.lock().map_err(|_| "Window state is unavailable")?;
    store.saved.window = saved.clone();
    store.persist()?;
    Ok(saved)
}

pub fn handle_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if !matches!(
        event,
        WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
    ) {
        return;
    }
    let Some(shared) = window.try_state::<Shared>() else {
        return;
    };
    let Some(webview) = window.app_handle().get_webview_window("main") else {
        return;
    };
    let Ok(mut saved) = shared.lock().map(|store| store.saved.window.clone()) else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(outer) = window.outer_size() else {
        return;
    };
    if outer.width == 0 || outer.height == 0 {
        return;
    }
    if let Ok(position) = window.outer_position() {
        saved.x = Some(position.x);
        saved.y = Some(position.y);
    }
    let mut recovered = false;
    if saved.locked {
        recovered = constrain(&webview, &mut saved, false).unwrap_or(false);
        let observed = outer.to_logical::<f64>(scale);
        if (observed.width - saved.width).abs() > 1.0
            || (observed.height - saved.height).abs() > 1.0
        {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }
            // Enforce after OS-initiated resize routes, including snap and DPI changes.
            // Windows acceptance still requires measuring all Win+Arrow routes.
            let _ = apply_lock(&webview, &saved);
        }
        if recovered {
            let _ = window.set_position(PhysicalPosition::new(
                saved.x.unwrap_or(0),
                saved.y.unwrap_or(0),
            ));
        }
    } else if !window.is_maximized().unwrap_or(false) {
        // Persist the outer size, which is the contract.
        let inner = window
            .inner_size()
            .map(|size| size.to_logical::<f64>(scale))
            .ok();
        let (width, height) = outer_logical(
            outer.to_logical::<f64>(scale),
            inner,
            frame(&webview).unwrap_or((0.0, 0.0)),
        );
        saved.width = width;
        saved.height = height;
        if let Ok(Some(monitor)) = window.current_monitor() {
            saved.monitor = monitor.name().cloned();
        }
    }
    let mut warning = None;
    if let Ok(mut store) = shared.lock() {
        store.saved.window = saved.clone();
        store.dirty = true;
        if recovered {
            warning = Some(
                "The reader was resized to fit the available display. Size remains locked."
                    .to_string(),
            );
            store.warning = warning.clone();
        }
    }
    let _ = window.emit("window-state", saved);
    if let Some(warning) = warning {
        let _ = window.emit("reader-warning", warning);
    }
}

#[cfg(test)]
mod tests {
    use super::{content_size, outer_logical, place_library, LogicalSize};

    /// The presets and every persisted size are OUTER logical pixels, while
    /// `set_size` and the size constraints take content dimensions. After the
    /// conversion the window must still land on the documented outer size.
    #[test]
    fn presets_keep_their_outer_size() {
        // macOS: the overlay title bar sits inside the content, so nothing is subtracted.
        let mac = (0.0, 0.0);
        assert_eq!(content_size(420.0, 620.0, mac), (420.0, 620.0));
        assert_eq!(content_size(760.0, 900.0, mac), (760.0, 900.0));

        // A decorated window (borders on every side and a caption) loses them from the content.
        let win = (16.0, 39.0);
        assert_eq!(content_size(420.0, 620.0, win), (404.0, 581.0));
        let (w, h) = content_size(420.0, 620.0, win);
        assert_eq!((w + win.0, h + win.1), (420.0, 620.0));
    }

    /// What `handle_event` persists must be an OUTER size even when the session
    /// reports outer and inner as identical.
    #[test]
    fn persisted_size_is_outer() {
        let size = |w, h| LogicalSize::new(w, h);
        // macOS reports the overlay window's content and frame as the same size.
        assert_eq!(outer_logical(size(420.0, 620.0), Some(size(420.0, 620.0)), (0.0, 0.0)), (420.0, 620.0));
        // A decorated window reports its outer size already, borders included.
        assert_eq!(outer_logical(size(420.0, 620.0), Some(size(404.0, 581.0)), (16.0, 39.0)), (420.0, 620.0));
        // A session that reports both as the content size despite a known border gets it added back.
        assert_eq!(outer_logical(size(404.0, 581.0), Some(size(404.0, 581.0)), (16.0, 39.0)), (420.0, 620.0));
        // Without an inner size there is nothing to correct against.
        assert_eq!(outer_logical(size(404.0, 581.0), None, (16.0, 39.0)), (404.0, 581.0));
    }

    /// A border larger than the request must not produce a zero or negative
    /// content size: the OS rejects those.
    #[test]
    fn tiny_requests_stay_positive() {
        assert_eq!(content_size(10.0, 10.0, (16.0, 39.0)), (1.0, 1.0));
        assert_eq!(content_size(0.0, 0.0, (0.0, 0.0)), (1.0, 1.0));
    }

    #[test]
    fn library_tears_off_the_side_it_was_docked() {
        let main = (800.0, 40.0, 420.0, 620.0);
        assert_eq!(place_library(main, "left", 270.0, 8.0, None), (522.0, 40.0, 270.0, 620.0));
        assert_eq!(place_library(main, "right", 270.0, 8.0, None), (1228.0, 40.0, 270.0, 620.0));
    }

    #[test]
    fn library_flips_when_its_side_is_off_the_work_area() {
        let main = (40.0, 40.0, 420.0, 620.0);
        let work = Some((0.0, 0.0, 1440.0, 900.0));
        // Left of x=40 does not fit a 270 px window; the right side does.
        assert_eq!(place_library(main, "left", 270.0, 8.0, work).0, 468.0);
        // Right of a window already at the right edge flips back to the left.
        let crowded = (1200.0, 40.0, 420.0, 620.0);
        assert_eq!(place_library(crowded, "right", 270.0, 8.0, work).0, 922.0);
    }

    #[test]
    fn library_clamps_when_neither_side_fits() {
        let main = (10.0, 10.0, 1400.0, 800.0);
        let work = Some((0.0, 0.0, 1440.0, 900.0));
        let (x, y, width, height) = place_library(main, "left", 270.0, 8.0, work);
        assert_eq!((x, y, width, height), (0.0, 10.0, 270.0, 800.0));
    }
}
