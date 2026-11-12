use block2::RcBlock;
use objc2_foundation::{NSArray, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationStatus, UNMutableNotificationContent, UNNotificationRequest,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static LOCK: Mutex<()> = Mutex::new(());
static CLOSED: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    id: String,
    due: u64,
}

fn pending(prefix: &str) -> Result<Vec<String>, String> {
    let prefix = prefix.to_owned();
    let (send, receive) = mpsc::channel();
    let completion = RcBlock::new(
        move |requests: std::ptr::NonNull<NSArray<UNNotificationRequest>>| {
            let ids = unsafe { requests.as_ref() }
                .iter()
                .map(|request| request.identifier().to_string())
                .filter(|id| id.starts_with(&prefix))
                .collect();
            let _ = send.send(ids);
        },
    );
    UNUserNotificationCenter::currentNotificationCenter()
        .getPendingNotificationRequestsWithCompletionHandler(&completion);
    receive
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Cannot read scheduled reminders".into())
}

fn remove(ids: &[String]) {
    let ids: Vec<_> = ids.iter().map(|id| NSString::from_str(id)).collect();
    let ids = NSArray::from_retained_slice(&ids);
    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.removePendingNotificationRequestsWithIdentifiers(&ids);
    center.removeDeliveredNotificationsWithIdentifiers(&ids);
}

pub fn close() -> Result<(), String> {
    CLOSED.store(true, Ordering::SeqCst);
    let _lock = LOCK.lock().map_err(|_| "Reminder lock failed")?;
    if crate::dock::bundled() {
        remove(&pending("buzz-personal:")?);
    }
    Ok(())
}

fn schedule(scope: String, tasks: Vec<Task>) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|_| "Reminder lock failed")?;
    if CLOSED.load(Ordering::SeqCst) {
        return Err("Buzz is signing out".into());
    }
    if !crate::dock::bundled() {
        return Err("Reminders need the installed macOS app".into());
    }
    let prefix = format!("buzz-personal:{:x}:", Sha256::digest(scope.as_bytes()));
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Check your system clock")?
        .as_secs();
    let tasks: Vec<_> = tasks.into_iter().filter(|task| task.due > now).collect();
    if tasks.len() > 64 {
        return Err("Keep at most 64 future reminders on this Mac".into());
    }
    if tasks.iter().any(|task| {
        task.id.len() > 100
            || task.id.is_empty()
            || !task
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            || task.due > 253402300799
    }) {
        return Err("Invalid reminder".into());
    }
    let all = pending("buzz-personal:")?;
    let existing: Vec<_> = all
        .iter()
        .filter(|id| id.starts_with(&prefix))
        .cloned()
        .collect();
    if all.len() - existing.len() + tasks.len() > 64 {
        return Err("Keep at most 64 future reminders on this Mac".into());
    }
    let wanted: Vec<_> = tasks
        .iter()
        .map(|task| format!("{prefix}{}:{}", task.id, task.due))
        .collect();
    remove(
        &existing
            .iter()
            .filter(|id| !wanted.contains(id))
            .cloned()
            .collect::<Vec<_>>(),
    );
    if tasks.is_empty() {
        return Ok(());
    }
    if !matches!(
        crate::dock::notification_permission()?,
        UNAuthorizationStatus::Authorized
            | UNAuthorizationStatus::Provisional
            | UNAuthorizationStatus::Ephemeral
    ) {
        return Err("Allow Buzz notifications in System Settings, then refresh".into());
    }
    for (task, id) in tasks.iter().zip(wanted) {
        if existing.contains(&id) {
            continue;
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str("To-do reminder"));
        content.setBody(&NSString::from_str("Open Buzz to see your task."));
        let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(
            (task.due - now).max(1) as f64,
            false,
        );
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&id),
            &content,
            Some(&trigger),
        );
        let (send, receive) = mpsc::channel();
        let completion = RcBlock::new(move |error: *mut NSError| {
            let _ = send.send(error.is_null());
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&completion));
        if !receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Reminder scheduling timed out")?
        {
            return Err("macOS could not schedule a reminder".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn personal_lists_schedule<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    host: tauri::State<'_, crate::identity::IdentityHost>,
    viewer: String,
    community: String,
    tasks: Vec<Task>,
) -> Result<(), String> {
    if window.label() != "main" || host.viewer().await? != viewer {
        return Err("Sign in again to set reminders".into());
    }
    if community.len() > 512 || tasks.len() > 10000 {
        return Err("Too many reminders".into());
    }
    tauri::async_runtime::spawn_blocking(move || schedule(format!("{community}:{viewer}"), tasks))
        .await
        .map_err(|_| "Reminder scheduling failed")?
}
