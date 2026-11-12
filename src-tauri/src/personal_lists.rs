use crate::identity::{EventTemplate, IdentityHost};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
pub mod macos;

#[derive(Serialize)]
pub struct SyncResponse {
    status: u16,
    body: serde_json::Value,
}

fn endpoint(base: &str, community: &str, cursor: Option<&str>) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base).map_err(|_| "Invalid sync URL")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("Sync needs a secure URL".into());
    }
    let origin = reqwest::Url::parse(community).map_err(|_| "Invalid community")?;
    if community.len() > 512 || !matches!(origin.scheme(), "https" | "wss") {
        return Err("Invalid community".into());
    }
    url.set_path("/items");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut().append_pair("community", community);
    if let Some(cursor) = cursor {
        if cursor.len() > 100
            || !cursor
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err("Invalid cursor".into());
        }
        url.query_pairs_mut().append_pair("cursor", cursor);
    }
    Ok(url)
}

#[tauri::command]
pub async fn personal_lists_request<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    host: tauri::State<'_, IdentityHost>,
    viewer: String,
    community: String,
    cursor: Option<String>,
    item: Option<serde_json::Value>,
) -> Result<SyncResponse, String> {
    if window.label() != "main" || host.viewer().await? != viewer {
        return Err("Sign in again to sync".into());
    }
    let base =
        option_env!("BUZZ_PERSONAL_LISTS_URL").ok_or("This build has no personal sync server")?;
    let url = endpoint(base, &community, cursor.as_deref())?;
    let body = item.map(|value| value.to_string());
    if body.as_ref().is_some_and(|value| value.len() > 16384) {
        return Err("Item is too large".into());
    }
    let method = if body.is_some() { "POST" } else { "GET" };
    let mut tags = vec![
        vec!["u".into(), url.to_string()],
        vec!["method".into(), method.into()],
    ];
    if let Some(body) = &body {
        tags.push(vec![
            "payload".into(),
            format!("{:x}", Sha256::digest(body.as_bytes())),
        ]);
    }
    let signed = host
        .sign(EventTemplate {
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| "Check your system clock")?
                .as_secs(),
            kind: 27235,
            tags,
            content: String::new(),
        })
        .await?;
    if signed.get("pubkey").and_then(serde_json::Value::as_str) != Some(viewer.as_str()) {
        return Err("Account changed. Try again".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not start sync")?;
    let mut request = client
        .request(
            if body.is_some() {
                reqwest::Method::POST
            } else {
                reqwest::Method::GET
            },
            url,
        )
        .header(
            "Authorization",
            format!("Nostr {}", STANDARD.encode(signed.to_string())),
        )
        .header("Content-Type", "application/json");
    if let Some(body) = body {
        request = request.body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Cannot reach sync server. Try again")?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read sync reply")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Sync reply is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if host.viewer().await? != viewer {
        return Err("Account changed. Try again".into());
    }
    let body = serde_json::from_slice(&bytes).map_err(|_| "Invalid sync reply")?;
    Ok(SyncResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::endpoint;

    #[test]
    fn sync_url_is_secure_and_query_values_are_encoded() {
        assert!(endpoint("http://sync.example", "wss://relay.example", None).is_err());
        assert!(endpoint("https://user@sync.example", "wss://relay.example", None).is_err());
        assert!(endpoint("https://sync.example", "file:///tmp", None).is_err());
        assert!(endpoint("https://sync.example", "wss://relay.example", Some("a&b")).is_err());
        let url = endpoint(
            "https://sync.example/old?x=1",
            "wss://relay.example",
            Some("a-b"),
        )
        .unwrap();
        assert_eq!(url.path(), "/items");
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            vec![
                ("community".into(), "wss://relay.example".into()),
                ("cursor".into(), "a-b".into())
            ]
        );
    }
}
