//! Opt-in assistant backend. The user's Anthropic API key lives only in the OS credential
//! store; every request to `https://api.anthropic.com` is made from here so the webview
//! (whose CSP allows no remote hosts) never sees the network or the key.

use serde::Serialize;
use serde_json::Value;
use std::{sync::OnceLock, time::Duration};

const API_BASE: &str = "https://api.anthropic.com";
const API_VERSION: &str = "2023-06-01";
const SERVICE: &str = "xyz.rpayton.holdmybrief";
const ACCOUNT: &str = "anthropic-api-key";
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);
const MESSAGES_TIMEOUT: Duration = Duration::from_secs(120);

const NO_KEY: &str = "Add an Anthropic API key in AI assistant settings first.";
const REJECTED_KEY: &str = "Anthropic rejected the API key.";
const UNREACHABLE: &str = "Could not reach Anthropic. Check your connection.";
const STORE_FAILED: &str = "Could not access the system credential store.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    configured: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    display_name: String,
}

/// Which endpoint a failed response came from; a 404 means different things for each.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Endpoint {
    Models,
    Messages,
}

// ---------------------------------------------------------------- credential store

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod vault {
    use super::{ACCOUNT, SERVICE, STORE_FAILED};

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| STORE_FAILED.to_string())
    }

    pub fn load() -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(STORE_FAILED.to_string()),
        }
    }

    pub fn save(key: &str) -> Result<(), String> {
        entry()?.set_password(key).map_err(|_| STORE_FAILED.to_string())
    }

    pub fn delete() -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(STORE_FAILED.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod vault {
    const UNSUPPORTED: &str = "Secure key storage is not supported on this platform.";

    pub fn load() -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn save(_key: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn delete() -> Result<(), String> {
        Ok(())
    }
}

/// Keychain calls can block (and may raise an OS prompt), so keep them off the async workers.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| STORE_FAILED.to_string())?
}

async fn require_key() -> Result<String, String> {
    blocking(vault::load).await?.ok_or_else(|| NO_KEY.to_string())
}

// ---------------------------------------------------------------- pure logic

/// Keys are sent as an HTTP header value, so refuse anything that is not visible ASCII.
fn clean_key(raw: &str) -> Result<String, String> {
    let key = raw.trim();
    if key.is_empty() {
        return Err("Enter an Anthropic API key.".to_string());
    }
    if !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("That does not look like an Anthropic API key.".to_string());
    }
    Ok(key.to_string())
}

fn api_error_message(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let message = parsed.get("error")?.get("message")?.as_str()?.trim();
    (!message.is_empty()).then(|| message.to_string())
}

fn status_message(status: u16, body: &str, endpoint: Endpoint) -> String {
    match status {
        401 => REJECTED_KEY.to_string(),
        403 if endpoint == Endpoint::Messages => {
            "This API key is not allowed to use that model.".to_string()
        }
        403 => "This API key is not allowed to use the Anthropic API.".to_string(),
        404 if endpoint == Endpoint::Messages => {
            "That model is not available to this API key.".to_string()
        }
        429 => "Rate limited by Anthropic. Try again in a moment.".to_string(),
        500 | 529 => "Anthropic is overloaded or unavailable. Try again shortly.".to_string(),
        _ => api_error_message(body)
            .unwrap_or_else(|| format!("Anthropic returned an unexpected error (HTTP {status}).")),
    }
}

/// Longest answer one request may ask for; the reader's own requests use 1,024.
const MAX_TOKENS_CAP: u64 = 4096;

/// Rebuilds the request from an allow-list, so this command (the webview's only route to the
/// network) cannot be used as a general proxy for the user's key: no streaming, no server-side
/// tools such as web search (they carry a `type`), and a bounded `max_tokens`.
fn sanitize_request(body: Value) -> Result<Value, String> {
    let object = body
        .as_object()
        .ok_or_else(|| "The assistant request must be a JSON object.".to_string())?;
    let mut clean = serde_json::Map::new();
    for key in ["model", "system", "messages", "tools", "tool_choice"] {
        if let Some(value) = object.get(key) {
            clean.insert(key.to_string(), value.clone());
        }
    }
    if let Some(tools) = clean.get("tools").and_then(Value::as_array) {
        if tools.iter().any(|tool| tool.get("type").is_some() || tool.get("name").is_none()) {
            return Err("The assistant may only use the reader's own tools.".to_string());
        }
    }
    let requested = object.get("max_tokens").and_then(Value::as_u64).unwrap_or(1024);
    clean.insert("max_tokens".to_string(), Value::from(requested.clamp(1, MAX_TOKENS_CAP)));
    Ok(Value::Object(clean))
}

fn parse_models(body: &Value) -> Vec<ModelInfo> {
    body.get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?.to_string();
                    let display_name = item
                        .get("display_name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.is_empty())
                        .map_or_else(|| id.clone(), str::to_string);
                    Some(ModelInfo { id, display_name })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------- HTTP

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("hold-my-brief/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| UNREACHABLE.to_string())?;
    Ok(CLIENT.get_or_init(|| built))
}

/// The single place the key leaves this module: one header on one request to `API_BASE`.
async fn call(
    key: &str,
    endpoint: Endpoint,
    request: reqwest::RequestBuilder,
    timeout: Duration,
) -> Result<Value, String> {
    let mut secret = reqwest::header::HeaderValue::from_str(key)
        .map_err(|_| "That does not look like an Anthropic API key.".to_string())?;
    secret.set_sensitive(true);
    let response = request
        .header("x-api-key", secret)
        .header("anthropic-version", API_VERSION)
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
    let status = response.status();
    if status.is_success() {
        return response
            .json::<Value>()
            .await
            .map_err(|_| "Anthropic sent a response the app could not read.".to_string());
    }
    let body = response.text().await.unwrap_or_default();
    Err(status_message(status.as_u16(), &body, endpoint))
}

async fn fetch_models(key: &str, limit: u32) -> Result<Value, String> {
    let request = client()?.get(format!("{API_BASE}/v1/models?limit={limit}"));
    call(key, Endpoint::Models, request, MODELS_TIMEOUT).await
}

async fn post_message(key: &str, body: &Value) -> Result<Value, String> {
    let request = client()?.post(format!("{API_BASE}/v1/messages")).json(body);
    call(key, Endpoint::Messages, request, MESSAGES_TIMEOUT).await
}

// ---------------------------------------------------------------- commands

async fn status() -> Result<AssistantStatus, String> {
    Ok(AssistantStatus {
        configured: blocking(vault::load).await?.is_some(),
    })
}

#[tauri::command]
pub async fn assistant_status() -> Result<AssistantStatus, String> {
    status().await
}

#[tauri::command]
pub async fn assistant_set_key(key: String) -> Result<AssistantStatus, String> {
    let key = clean_key(&key)?;
    fetch_models(&key, 1).await?;
    blocking(move || vault::save(&key)).await?;
    Ok(AssistantStatus { configured: true })
}

#[tauri::command]
pub async fn assistant_forget_key() -> Result<AssistantStatus, String> {
    blocking(vault::delete).await?;
    status().await
}

#[tauri::command]
pub async fn assistant_models() -> Result<Vec<ModelInfo>, String> {
    let key = require_key().await?;
    Ok(parse_models(&fetch_models(&key, 100).await?))
}

#[tauri::command]
pub async fn assistant_send(body: Value) -> Result<Value, String> {
    let body = sanitize_request(body)?;
    let key = require_key().await?;
    post_message(&key, &body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_are_trimmed_and_must_be_header_safe() {
        assert_eq!(clean_key("  sk-ant-abc \n").unwrap(), "sk-ant-abc");
        assert!(clean_key("   ").is_err());
        assert!(clean_key("sk-ant\nx-evil: 1").is_err());
        assert!(clean_key("sk ant").is_err());
        assert!(clean_key("sk-ant-é").is_err());
    }

    #[test]
    fn statuses_map_to_short_messages() {
        let m = Endpoint::Messages;
        assert_eq!(status_message(401, "", m), "Anthropic rejected the API key.");
        assert_eq!(status_message(403, "", m), "This API key is not allowed to use that model.");
        assert_eq!(status_message(403, "", Endpoint::Models), "This API key is not allowed to use the Anthropic API.");
        assert_eq!(status_message(404, "", m), "That model is not available to this API key.");
        assert_eq!(status_message(429, "", m), "Rate limited by Anthropic. Try again in a moment.");
        for code in [500, 529] {
            assert_eq!(
                status_message(code, "", m),
                "Anthropic is overloaded or unavailable. Try again shortly."
            );
        }
    }

    #[test]
    fn a_models_404_is_not_reported_as_a_missing_model() {
        assert_eq!(
            status_message(404, "", Endpoint::Models),
            "Anthropic returned an unexpected error (HTTP 404)."
        );
    }

    #[test]
    fn other_statuses_surface_the_api_message_when_present() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: Field required"}}"#;
        assert_eq!(status_message(400, body, Endpoint::Messages), "max_tokens: Field required");
        assert_eq!(
            status_message(400, "<html>bad</html>", Endpoint::Messages),
            "Anthropic returned an unexpected error (HTTP 400)."
        );
        assert_eq!(
            status_message(400, r#"{"error":{"message":"  "}}"#, Endpoint::Messages),
            "Anthropic returned an unexpected error (HTTP 400)."
        );
    }

    #[test]
    fn requests_are_rebuilt_from_an_allow_list() {
        assert!(sanitize_request(json!("hi")).is_err());
        assert!(sanitize_request(json!([1])).is_err());
        assert!(sanitize_request(Value::Null).is_err());
        let cleaned = sanitize_request(json!({
            "model": "m", "max_tokens": 8, "stream": true, "metadata": {"user_id": "x"},
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"name": "go_to", "description": "d", "input_schema": {"type": "object"}}]
        }))
        .unwrap();
        assert!(cleaned.get("stream").is_none());
        assert!(cleaned.get("metadata").is_none());
        assert_eq!(cleaned["model"], "m");
        assert_eq!(cleaned["max_tokens"], 8);
        assert_eq!(cleaned["messages"][0]["content"], "hi");
        assert_eq!(cleaned["tools"][0]["name"], "go_to");
    }

    #[test]
    fn server_tools_are_refused_and_max_tokens_is_capped() {
        let web = json!({"model": "m", "messages": [], "tools": [{"type": "web_search_20250305", "name": "web_search"}]});
        assert!(sanitize_request(web).is_err());
        let greedy = sanitize_request(json!({"model": "m", "messages": [], "max_tokens": 1_000_000})).unwrap();
        assert_eq!(greedy["max_tokens"], MAX_TOKENS_CAP);
        let missing = sanitize_request(json!({"model": "m", "messages": []})).unwrap();
        assert_eq!(missing["max_tokens"], 1024);
    }

    #[test]
    fn models_keep_api_order_and_fall_back_to_the_id() {
        let body = json!({"data": [
            {"id": "claude-b", "display_name": "Claude B", "type": "model"},
            {"id": "claude-a"},
            {"display_name": "no id"},
            {"id": "claude-c", "display_name": ""}
        ]});
        assert_eq!(
            parse_models(&body),
            vec![
                ModelInfo { id: "claude-b".into(), display_name: "Claude B".into() },
                ModelInfo { id: "claude-a".into(), display_name: "claude-a".into() },
                ModelInfo { id: "claude-c".into(), display_name: "claude-c".into() },
            ]
        );
        assert!(parse_models(&json!({})).is_empty());
    }
}
