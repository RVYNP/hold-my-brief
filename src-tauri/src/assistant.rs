//! Opt-in assistant backend. The user's API key (Anthropic, OpenRouter or OpenAI, one at a
//! time) lives only in the OS credential store; every request to the provider is made from
//! here so the webview (whose CSP allows no remote hosts) never sees the network or the key.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{sync::OnceLock, time::Duration};

const SERVICE: &str = "xyz.rpayton.holdmybrief";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const OPENROUTER_REFERER: &str = "https://github.com/RVYNP/hold-my-brief";
const OPENROUTER_TITLE: &str = "Hold My Brief";
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);
const MESSAGES_TIMEOUT: Duration = Duration::from_secs(120);

const NO_KEY: &str = "Add an API key in AI assistant settings first.";
const STORE_FAILED: &str = "Could not access the system credential store.";

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    OpenRouter,
    OpenAi,
}

impl Provider {
    const ALL: [Provider; 3] = [Provider::Anthropic, Provider::OpenRouter, Provider::OpenAi];

    fn name(self) -> &'static str {
        match self {
            Provider::Anthropic => "Anthropic",
            Provider::OpenRouter => "OpenRouter",
            Provider::OpenAi => "OpenAI",
        }
    }

    /// Keychain account. Anthropic keeps the name it had before other providers existed.
    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic-api-key",
            Provider::OpenRouter => "openrouter-api-key",
            Provider::OpenAi => "openai-api-key",
        }
    }

    fn base(self) -> &'static str {
        match self {
            Provider::Anthropic => "https://api.anthropic.com",
            Provider::OpenRouter => "https://openrouter.ai/api/v1",
            Provider::OpenAi => "https://api.openai.com/v1",
        }
    }

    /// Cheapest authenticated GET, used to check a key before it is stored.
    fn validate_url(self) -> String {
        match self {
            Provider::Anthropic => format!("{}/v1/models?limit=1", self.base()),
            Provider::OpenRouter => format!("{}/key", self.base()),
            Provider::OpenAi => format!("{}/models", self.base()),
        }
    }

    fn models_url(self) -> String {
        match self {
            Provider::Anthropic => format!("{}/v1/models?limit=100", self.base()),
            Provider::OpenRouter | Provider::OpenAi => format!("{}/models", self.base()),
        }
    }

    fn chat_url(self) -> String {
        match self {
            Provider::Anthropic => format!("{}/v1/messages", self.base()),
            Provider::OpenRouter | Provider::OpenAi => format!("{}/chat/completions", self.base()),
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    configured: bool,
    provider: Option<Provider>,
}

impl AssistantStatus {
    fn of(active: Option<Provider>) -> Self {
        Self { configured: active.is_some(), provider: active }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    display_name: String,
}

/// Which endpoint a failed response came from; a 404 means different things for each.
/// Key validation counts as `Models`.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Endpoint {
    Models,
    Messages,
}

// ---------------------------------------------------------------- credential store

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod vault {
    use super::{Provider, SERVICE, STORE_FAILED};

    fn entry(provider: Provider) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, provider.account()).map_err(|_| STORE_FAILED.to_string())
    }

    pub fn load(provider: Provider) -> Result<Option<String>, String> {
        match entry(provider)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(STORE_FAILED.to_string()),
        }
    }

    pub fn save(provider: Provider, key: &str) -> Result<(), String> {
        entry(provider)?.set_password(key).map_err(|_| STORE_FAILED.to_string())
    }

    pub fn delete(provider: Provider) -> Result<(), String> {
        match entry(provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(STORE_FAILED.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod vault {
    use super::Provider;

    const UNSUPPORTED: &str = "Secure key storage is not supported on this platform.";

    pub fn load(_provider: Provider) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn save(_provider: Provider, _key: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
    pub fn delete(_provider: Provider) -> Result<(), String> {
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

/// The provider whose key is stored. Saving removes the other keys, so normally at most one
/// exists; if several somehow do, the first in `Provider::ALL` wins.
fn select_active(stored: Vec<(Provider, Option<String>)>) -> Option<(Provider, String)> {
    stored.into_iter().find_map(|(provider, key)| key.map(|key| (provider, key)))
}

fn load_active() -> Result<Option<(Provider, String)>, String> {
    let mut stored = Vec::with_capacity(Provider::ALL.len());
    for provider in Provider::ALL {
        stored.push((provider, vault::load(provider)?));
    }
    Ok(select_active(stored))
}

/// Stores the new key first, so a failure never leaves the user with no key at all.
fn store_exclusive(provider: Provider, key: &str) -> Result<(), String> {
    vault::save(provider, key)?;
    for other in Provider::ALL.into_iter().filter(|other| *other != provider) {
        vault::delete(other)?;
    }
    Ok(())
}

fn delete_all() -> Result<(), String> {
    for provider in Provider::ALL {
        vault::delete(provider)?;
    }
    Ok(())
}

async fn require_active() -> Result<(Provider, String), String> {
    blocking(load_active).await?.ok_or_else(|| NO_KEY.to_string())
}

// ---------------------------------------------------------------- pure logic

/// Keys are sent as an HTTP header value, so refuse anything that is not visible ASCII.
fn clean_key(provider: Provider, raw: &str) -> Result<String, String> {
    let key = raw.trim();
    if key.is_empty() {
        return Err(format!("Enter an {} API key.", provider.name()));
    }
    if !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(not_a_key(provider));
    }
    Ok(key.to_string())
}

fn not_a_key(provider: Provider) -> String {
    format!("That does not look like an {} API key.", provider.name())
}

fn api_error_message(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let message = parsed.get("error")?.get("message")?.as_str()?.trim();
    (!message.is_empty()).then(|| message.to_string())
}

fn status_message(provider: Provider, status: u16, body: &str, endpoint: Endpoint) -> String {
    let name = provider.name();
    match status {
        401 => format!("{name} rejected the API key."),
        403 if endpoint == Endpoint::Messages => {
            "This API key is not allowed to use that model.".to_string()
        }
        403 => format!("This API key is not allowed to use the {name} API."),
        404 if endpoint == Endpoint::Messages => {
            "That model is not available to this API key.".to_string()
        }
        429 => format!("Rate limited by {name}. Try again in a moment."),
        500 | 529 => format!("{name} is overloaded or unavailable. Try again shortly."),
        502 | 503 if provider != Provider::Anthropic => {
            format!("{name} is overloaded or unavailable. Try again shortly.")
        }
        _ => api_error_message(body)
            .unwrap_or_else(|| format!("{name} returned an unexpected error (HTTP {status}).")),
    }
}

/// Longest answer one request may ask for; the reader's own requests use 1,024.
const MAX_TOKENS_CAP: u64 = 4096;
const DEFAULT_MAX_TOKENS: u64 = 1024;

fn capped_max_tokens(object: &Map<String, Value>) -> Value {
    let requested = object.get("max_tokens").and_then(Value::as_u64).unwrap_or(DEFAULT_MAX_TOKENS);
    Value::from(requested.clamp(1, MAX_TOKENS_CAP))
}

fn request_object(body: &Value) -> Result<&Map<String, Value>, String> {
    body.as_object().ok_or_else(|| "The assistant request must be a JSON object.".to_string())
}

/// Rebuilds the Anthropic request from an allow-list, so this command (the webview's only
/// route to the network) cannot be used as a general proxy for the user's key: no streaming,
/// no server-side tools such as web search (they carry a `type`), and a bounded `max_tokens`.
fn sanitize_request(body: Value) -> Result<Value, String> {
    let object = request_object(&body)?;
    let mut clean = Map::new();
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
    clean.insert("max_tokens".to_string(), capped_max_tokens(object));
    Ok(Value::Object(clean))
}

const ONLY_OWN_TOOLS: &str = "The assistant may only use the reader's own tools.";
const CHAT_ROLES: [&str; 4] = ["system", "user", "assistant", "tool"];
const CHAT_MESSAGE_FIELDS: [&str; 4] = ["content", "tool_calls", "tool_call_id", "name"];

fn sanitize_chat_message(message: &Value) -> Result<Value, String> {
    let object = message
        .as_object()
        .ok_or_else(|| "Each assistant message must be a JSON object.".to_string())?;
    let role = object
        .get("role")
        .and_then(Value::as_str)
        .filter(|role| CHAT_ROLES.contains(role))
        .ok_or_else(|| "The assistant message has an unsupported role.".to_string())?;
    let mut clean = Map::new();
    clean.insert("role".to_string(), Value::from(role));
    for field in CHAT_MESSAGE_FIELDS {
        if let Some(value) = object.get(field) {
            clean.insert(field.to_string(), value.clone());
        }
    }
    Ok(Value::Object(clean))
}

/// Only plain function tools survive; anything else (OpenRouter server tools such as
/// `openrouter:web_search`, OpenAI built-ins) is refused rather than forwarded.
fn sanitize_chat_tool(tool: &Value) -> Result<Value, String> {
    let function = tool
        .get("function")
        .and_then(Value::as_object)
        .filter(|_| tool.get("type").and_then(Value::as_str) == Some("function"))
        .ok_or_else(|| ONLY_OWN_TOOLS.to_string())?;
    let name = function
        .get("name")
        .filter(|name| name.is_string())
        .ok_or_else(|| ONLY_OWN_TOOLS.to_string())?;
    let mut clean = Map::new();
    clean.insert("name".to_string(), name.clone());
    for field in ["description", "parameters"] {
        if let Some(value) = function.get(field) {
            clean.insert(field.to_string(), value.clone());
        }
    }
    Ok(serde_json::json!({ "type": "function", "function": clean }))
}

fn sanitize_chat_tool_choice(choice: &Value) -> Result<Value, String> {
    if let Some(mode) = choice.as_str() {
        return if ["auto", "none", "required"].contains(&mode) {
            Ok(choice.clone())
        } else {
            Err(ONLY_OWN_TOOLS.to_string())
        };
    }
    let name = choice
        .get("function")
        .and_then(|function| function.get("name"))
        .filter(|name| name.is_string())
        .filter(|_| choice.get("type").and_then(Value::as_str) == Some("function"))
        .ok_or_else(|| ONLY_OWN_TOOLS.to_string())?;
    Ok(serde_json::json!({ "type": "function", "function": { "name": name } }))
}

/// Chat Completions counterpart of `sanitize_request`, for OpenRouter and OpenAI. Also refuses
/// the ways OpenRouter turns on server-side web search (`:online` models, `plugins`).
fn sanitize_chat_request(provider: Provider, body: Value) -> Result<Value, String> {
    let object = request_object(&body)?;
    if object.get("stream").is_some_and(|stream| !matches!(stream, Value::Null | Value::Bool(false))) {
        return Err("The assistant does not support streaming responses.".to_string());
    }
    if object.contains_key("plugins") {
        return Err("The assistant may not use provider plugins.".to_string());
    }
    let model = object
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.is_empty())
        .ok_or_else(|| "The assistant request needs a model.".to_string())?;
    if model.to_ascii_lowercase().ends_with(":online") {
        return Err("Web search models are not available to the assistant.".to_string());
    }
    let messages = object
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| "The assistant request needs a message list.".to_string())?
        .iter()
        .map(sanitize_chat_message)
        .collect::<Result<Vec<_>, _>>()?;

    let mut clean = Map::new();
    clean.insert("model".to_string(), Value::from(model));
    clean.insert("messages".to_string(), Value::Array(messages));
    if let Some(tools) = object.get("tools") {
        let tools = tools.as_array().ok_or_else(|| ONLY_OWN_TOOLS.to_string())?;
        let tools = tools.iter().map(sanitize_chat_tool).collect::<Result<Vec<_>, _>>()?;
        clean.insert("tools".to_string(), Value::Array(tools));
    }
    if let Some(choice) = object.get("tool_choice") {
        clean.insert("tool_choice".to_string(), sanitize_chat_tool_choice(choice)?);
    }
    let limit_field = match provider {
        Provider::OpenAi => "max_completion_tokens",
        _ => "max_tokens",
    };
    clean.insert(limit_field.to_string(), capped_max_tokens(object));
    Ok(Value::Object(clean))
}

fn sanitize(provider: Provider, body: Value) -> Result<Value, String> {
    match provider {
        Provider::Anthropic => sanitize_request(body),
        Provider::OpenRouter | Provider::OpenAi => sanitize_chat_request(provider, body),
    }
}

fn model_items(body: &Value) -> impl Iterator<Item = &Value> {
    body.get("data").and_then(Value::as_array).into_iter().flatten()
}

fn non_empty_str<'a>(item: &'a Value, field: &str) -> Option<&'a str> {
    item.get(field).and_then(Value::as_str).filter(|value| !value.is_empty())
}

fn parse_anthropic_models(body: &Value) -> Vec<ModelInfo> {
    model_items(body)
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.to_string();
            let display_name = non_empty_str(item, "display_name").map_or_else(|| id.clone(), str::to_string);
            Some(ModelInfo { id, display_name })
        })
        .collect()
}

fn parse_openrouter_models(body: &Value) -> Vec<ModelInfo> {
    model_items(body)
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?;
            let can_call_tools = item
                .get("supported_parameters")
                .and_then(Value::as_array)
                .is_some_and(|params| params.iter().any(|param| param.as_str() == Some("tools")));
            if !can_call_tools || id.to_ascii_lowercase().ends_with(":online") {
                return None;
            }
            let display_name = non_empty_str(item, "name").unwrap_or(id);
            Some(ModelInfo { id: id.to_string(), display_name: display_name.to_string() })
        })
        .collect()
}

/// OpenAI's `/models` has no capability flags, so chat models are recognised by id.
fn is_openai_chat_model(id: &str) -> bool {
    const EXCLUDED: [&str; 9] = [
        "audio", "realtime", "transcribe", "tts", "image", "search", "embedding", "moderation",
        "instruct",
    ];
    let id = id.to_ascii_lowercase();
    let mut after_o = id.strip_prefix('o').map(str::bytes);
    let reasoning_family = after_o.as_mut().and_then(Iterator::next).is_some_and(|b| b.is_ascii_digit());
    (id.starts_with("gpt-") || reasoning_family) && !EXCLUDED.iter().any(|word| id.contains(word))
}

/// OpenAI returns models in no useful order, so sort by id for a stable picker.
fn parse_openai_models(body: &Value) -> Vec<ModelInfo> {
    let mut models: Vec<ModelInfo> = model_items(body)
        .filter_map(|item| item.get("id")?.as_str())
        .filter(|id| is_openai_chat_model(id))
        .map(|id| ModelInfo { id: id.to_string(), display_name: id.to_string() })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);
    models
}

fn parse_models(provider: Provider, body: &Value) -> Vec<ModelInfo> {
    match provider {
        Provider::Anthropic => parse_anthropic_models(body),
        Provider::OpenRouter => parse_openrouter_models(body),
        Provider::OpenAi => parse_openai_models(body),
    }
}

// ---------------------------------------------------------------- HTTP

fn client(provider: Provider) -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("hold-my-brief/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| unreachable_message(provider))?;
    Ok(CLIENT.get_or_init(|| built))
}

fn unreachable_message(provider: Provider) -> String {
    format!("Could not reach {}. Check your connection.", provider.name())
}

/// The single place the key leaves this module: one auth header on one request to the
/// provider's own base URL.
async fn call(
    provider: Provider,
    key: &str,
    endpoint: Endpoint,
    request: reqwest::RequestBuilder,
    timeout: Duration,
) -> Result<Value, String> {
    let sensitive = |value: &str| {
        reqwest::header::HeaderValue::from_str(value)
            .map(|mut secret| {
                secret.set_sensitive(true);
                secret
            })
            .map_err(|_| not_a_key(provider))
    };
    let request = match provider {
        Provider::Anthropic => request
            .header("x-api-key", sensitive(key)?)
            .header("anthropic-version", ANTHROPIC_VERSION),
        Provider::OpenRouter => request
            .header(reqwest::header::AUTHORIZATION, sensitive(&format!("Bearer {key}"))?)
            .header("HTTP-Referer", OPENROUTER_REFERER)
            .header("X-Title", OPENROUTER_TITLE),
        Provider::OpenAi => {
            request.header(reqwest::header::AUTHORIZATION, sensitive(&format!("Bearer {key}"))?)
        }
    };
    let response = request
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| unreachable_message(provider))?;
    let status = response.status();
    if status.is_success() {
        return response
            .json::<Value>()
            .await
            .map_err(|_| format!("{} sent a response the app could not read.", provider.name()));
    }
    let body = response.text().await.unwrap_or_default();
    Err(status_message(provider, status.as_u16(), &body, endpoint))
}

async fn validate_key(provider: Provider, key: &str) -> Result<(), String> {
    let request = client(provider)?.get(provider.validate_url());
    call(provider, key, Endpoint::Models, request, MODELS_TIMEOUT).await.map(|_| ())
}

async fn fetch_models(provider: Provider, key: &str) -> Result<Value, String> {
    let request = client(provider)?.get(provider.models_url());
    call(provider, key, Endpoint::Models, request, MODELS_TIMEOUT).await
}

async fn post_chat(provider: Provider, key: &str, body: &Value) -> Result<Value, String> {
    let request = client(provider)?.post(provider.chat_url()).json(body);
    call(provider, key, Endpoint::Messages, request, MESSAGES_TIMEOUT).await
}

// ---------------------------------------------------------------- commands

async fn status() -> Result<AssistantStatus, String> {
    let active = blocking(load_active).await?;
    Ok(AssistantStatus::of(active.map(|(provider, _)| provider)))
}

#[tauri::command]
pub async fn assistant_status() -> Result<AssistantStatus, String> {
    status().await
}

#[tauri::command]
pub async fn assistant_set_key(provider: Provider, key: String) -> Result<AssistantStatus, String> {
    let key = clean_key(provider, &key)?;
    validate_key(provider, &key).await?;
    blocking(move || store_exclusive(provider, &key)).await?;
    Ok(AssistantStatus::of(Some(provider)))
}

#[tauri::command]
pub async fn assistant_forget_key() -> Result<AssistantStatus, String> {
    blocking(delete_all).await?;
    status().await
}

#[tauri::command]
pub async fn assistant_models() -> Result<Vec<ModelInfo>, String> {
    let (provider, key) = require_active().await?;
    Ok(parse_models(provider, &fetch_models(provider, &key).await?))
}

#[tauri::command]
pub async fn assistant_send(body: Value) -> Result<Value, String> {
    let (provider, key) = require_active().await?;
    let body = sanitize(provider, body)?;
    post_chat(provider, &key, &body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const A: Provider = Provider::Anthropic;
    const R: Provider = Provider::OpenRouter;
    const O: Provider = Provider::OpenAi;

    #[test]
    fn keys_are_trimmed_and_must_be_header_safe() {
        assert_eq!(clean_key(A, "  sk-ant-abc \n").unwrap(), "sk-ant-abc");
        assert!(clean_key(A, "   ").is_err());
        assert!(clean_key(A, "sk-ant\nx-evil: 1").is_err());
        assert!(clean_key(A, "sk ant").is_err());
        assert!(clean_key(A, "sk-ant-é").is_err());
        assert_eq!(clean_key(A, "").unwrap_err(), "Enter an Anthropic API key.");
        assert_eq!(clean_key(R, "a b").unwrap_err(), "That does not look like an OpenRouter API key.");
        assert_eq!(clean_key(O, "").unwrap_err(), "Enter an OpenAI API key.");
    }

    #[test]
    fn statuses_map_to_short_messages() {
        let m = Endpoint::Messages;
        assert_eq!(status_message(A, 401, "", m), "Anthropic rejected the API key.");
        assert_eq!(status_message(A, 403, "", m), "This API key is not allowed to use that model.");
        assert_eq!(status_message(A, 403, "", Endpoint::Models), "This API key is not allowed to use the Anthropic API.");
        assert_eq!(status_message(A, 404, "", m), "That model is not available to this API key.");
        assert_eq!(status_message(A, 429, "", m), "Rate limited by Anthropic. Try again in a moment.");
        for code in [500, 529] {
            assert_eq!(
                status_message(A, code, "", m),
                "Anthropic is overloaded or unavailable. Try again shortly."
            );
        }
        assert_eq!(status_message(A, 503, "", m), "Anthropic returned an unexpected error (HTTP 503).");
    }

    #[test]
    fn other_providers_are_named_in_their_errors() {
        let m = Endpoint::Messages;
        assert_eq!(status_message(R, 401, "", Endpoint::Models), "OpenRouter rejected the API key.");
        assert_eq!(status_message(O, 401, "", Endpoint::Models), "OpenAI rejected the API key.");
        assert_eq!(status_message(R, 403, "", Endpoint::Models), "This API key is not allowed to use the OpenRouter API.");
        assert_eq!(status_message(O, 403, "", m), "This API key is not allowed to use that model.");
        assert_eq!(status_message(O, 429, "", m), "Rate limited by OpenAI. Try again in a moment.");
        for code in [500, 502, 503, 529] {
            assert_eq!(
                status_message(R, code, "", m),
                "OpenRouter is overloaded or unavailable. Try again shortly."
            );
        }
        assert_eq!(unreachable_message(O), "Could not reach OpenAI. Check your connection.");
        assert_eq!(unreachable_message(A), "Could not reach Anthropic. Check your connection.");
        assert_eq!(
            status_message(R, 402, r#"{"error":{"code":402,"message":"Insufficient credits"}}"#, m),
            "Insufficient credits"
        );
    }

    #[test]
    fn a_models_404_is_not_reported_as_a_missing_model() {
        assert_eq!(
            status_message(A, 404, "", Endpoint::Models),
            "Anthropic returned an unexpected error (HTTP 404)."
        );
    }

    #[test]
    fn other_statuses_surface_the_api_message_when_present() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: Field required"}}"#;
        assert_eq!(status_message(A, 400, body, Endpoint::Messages), "max_tokens: Field required");
        assert_eq!(
            status_message(A, 400, "<html>bad</html>", Endpoint::Messages),
            "Anthropic returned an unexpected error (HTTP 400)."
        );
        assert_eq!(
            status_message(A, 400, r#"{"error":{"message":"  "}}"#, Endpoint::Messages),
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

    fn chat_body() -> Value {
        json!({
            "model": "anthropic/claude-sonnet-4",
            "max_tokens": 8,
            "stream": false,
            "temperature": 2, "user": "me", "web_search_options": {}, "provider": {"order": ["x"]},
            "messages": [
                {"role": "system", "content": "be brief", "cache_control": {"type": "ephemeral"}},
                {"role": "user", "content": "hi", "extra": 1},
                {"role": "assistant", "content": null, "tool_calls": [{"id": "c1", "type": "function",
                    "function": {"name": "go_to", "arguments": "{}"}}]},
                {"role": "tool", "tool_call_id": "c1", "name": "go_to", "content": "ok"}
            ],
            "tools": [{"type": "function", "strict": true, "function": {
                "name": "go_to", "description": "d", "parameters": {"type": "object"}, "strict": true}}],
            "tool_choice": "auto"
        })
    }

    #[test]
    fn chat_requests_are_rebuilt_from_an_allow_list() {
        assert!(sanitize_chat_request(R, json!("hi")).is_err());
        assert!(sanitize_chat_request(R, Value::Null).is_err());
        let cleaned = sanitize_chat_request(R, chat_body()).unwrap();
        let mut keys: Vec<_> = cleaned.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["max_tokens", "messages", "model", "tool_choice", "tools"]);
        assert_eq!(cleaned["model"], "anthropic/claude-sonnet-4");
        assert_eq!(cleaned["max_tokens"], 8);
        assert_eq!(cleaned["tool_choice"], "auto");
        assert_eq!(
            cleaned["messages"],
            json!([
                {"role": "system", "content": "be brief"},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": null, "tool_calls": [{"id": "c1", "type": "function",
                    "function": {"name": "go_to", "arguments": "{}"}}]},
                {"role": "tool", "tool_call_id": "c1", "name": "go_to", "content": "ok"}
            ])
        );
        assert_eq!(
            cleaned["tools"],
            json!([{"type": "function", "function": {
                "name": "go_to", "description": "d", "parameters": {"type": "object"}}}])
        );
    }

    #[test]
    fn chat_requests_refuse_streaming_plugins_and_online_models() {
        for provider in [R, O] {
            let mut streaming = chat_body();
            streaming["stream"] = json!(true);
            assert!(sanitize_chat_request(provider, streaming).is_err());
            let mut plugins = chat_body();
            plugins["plugins"] = json!([{"id": "web"}]);
            assert!(sanitize_chat_request(provider, plugins).is_err());
            for model in ["openai/gpt-4o:online", "x/y:ONLINE"] {
                let mut online = chat_body();
                online["model"] = json!(model);
                assert!(sanitize_chat_request(provider, online).is_err(), "{model}");
            }
            let mut nitro = chat_body();
            nitro["model"] = json!("openai/gpt-4o:nitro");
            assert!(sanitize_chat_request(provider, nitro).is_ok());
            let mut no_model = chat_body();
            no_model.as_object_mut().unwrap().remove("model");
            assert!(sanitize_chat_request(provider, no_model).is_err());
        }
        let mut quiet = chat_body();
        quiet.as_object_mut().unwrap().remove("stream");
        assert!(sanitize_chat_request(R, quiet).is_ok());
    }

    #[test]
    fn chat_messages_need_a_known_role() {
        for bad in [json!({"content": "x"}), json!({"role": "developer", "content": "x"}), json!("hi")] {
            let mut body = chat_body();
            body["messages"] = json!([bad]);
            assert!(sanitize_chat_request(O, body).is_err());
        }
        let mut no_messages = chat_body();
        no_messages.as_object_mut().unwrap().remove("messages");
        assert!(sanitize_chat_request(O, no_messages).is_err());
    }

    #[test]
    fn chat_tools_must_be_plain_functions() {
        let refused = [
            json!({"type": "openrouter:web_search"}),
            json!({"type": "web_search_preview"}),
            json!({"type": "function"}),
            json!({"function": {"name": "go_to"}}),
            json!({"type": "function", "function": {"description": "no name"}}),
            json!({"type": "function", "function": {"name": 5}}),
            json!({"name": "go_to", "input_schema": {}}),
        ];
        for tool in refused {
            let mut body = chat_body();
            body["tools"] = json!([tool.clone()]);
            assert!(sanitize_chat_request(R, body).is_err(), "{tool}");
        }
        let mut not_a_list = chat_body();
        not_a_list["tools"] = json!({"type": "function"});
        assert!(sanitize_chat_request(R, not_a_list).is_err());

        let mut bare = chat_body();
        bare["tools"] = json!([{"type": "function", "function": {"name": "go_to"}}]);
        assert_eq!(
            sanitize_chat_request(R, bare).unwrap()["tools"],
            json!([{"type": "function", "function": {"name": "go_to"}}])
        );
    }

    #[test]
    fn chat_tool_choice_is_limited_to_the_reader_tools() {
        for choice in [json!("auto"), json!("none"), json!("required")] {
            let mut body = chat_body();
            body["tool_choice"] = choice.clone();
            assert_eq!(sanitize_chat_request(R, body).unwrap()["tool_choice"], choice);
        }
        let mut forced = chat_body();
        forced["tool_choice"] = json!({"type": "function", "function": {"name": "go_to", "x": 1}, "y": 2});
        assert_eq!(
            sanitize_chat_request(R, forced).unwrap()["tool_choice"],
            json!({"type": "function", "function": {"name": "go_to"}})
        );
        for choice in [json!("anything"), json!({"type": "web_search"}), json!(7)] {
            let mut body = chat_body();
            body["tool_choice"] = choice.clone();
            assert!(sanitize_chat_request(R, body).is_err(), "{choice}");
        }
    }

    #[test]
    fn chat_max_tokens_is_capped_and_openai_renames_it() {
        let mut greedy = chat_body();
        greedy["max_tokens"] = json!(1_000_000);
        let router = sanitize_chat_request(R, greedy.clone()).unwrap();
        assert_eq!(router["max_tokens"], MAX_TOKENS_CAP);
        assert!(router.get("max_completion_tokens").is_none());
        let openai = sanitize_chat_request(O, greedy).unwrap();
        assert_eq!(openai["max_completion_tokens"], MAX_TOKENS_CAP);
        assert!(openai.get("max_tokens").is_none());

        let mut missing = chat_body();
        missing.as_object_mut().unwrap().remove("max_tokens");
        assert_eq!(sanitize_chat_request(R, missing.clone()).unwrap()["max_tokens"], 1024);
        assert_eq!(sanitize_chat_request(O, missing).unwrap()["max_completion_tokens"], 1024);
        let mut zero = chat_body();
        zero["max_tokens"] = json!(0);
        assert_eq!(sanitize_chat_request(R, zero).unwrap()["max_tokens"], 1);
    }

    #[test]
    fn sanitize_dispatches_on_the_provider_format() {
        let anthropic = json!({"model": "m", "messages": [], "tools": [{"name": "t", "input_schema": {}}]});
        assert!(sanitize(A, anthropic.clone()).is_ok());
        assert!(sanitize(R, anthropic).is_err());
        assert!(sanitize(A, chat_body()).is_err(), "chat-format tools are not Anthropic tools");
        assert!(sanitize(O, chat_body()).unwrap().get("max_completion_tokens").is_some());
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
            parse_models(A, &body),
            vec![
                ModelInfo { id: "claude-b".into(), display_name: "Claude B".into() },
                ModelInfo { id: "claude-a".into(), display_name: "claude-a".into() },
                ModelInfo { id: "claude-c".into(), display_name: "claude-c".into() },
            ]
        );
        assert!(parse_models(A, &json!({})).is_empty());
        assert!(parse_models(R, &json!({})).is_empty());
        assert!(parse_models(O, &json!({"data": "nope"})).is_empty());
    }

    #[test]
    fn openrouter_models_keep_only_tool_callers() {
        let body = json!({"data": [
            {"id": "anthropic/claude-sonnet-4", "name": "Anthropic: Claude Sonnet 4",
             "supported_parameters": ["max_tokens", "tools", "tool_choice"]},
            {"id": "x/no-tools", "name": "No Tools", "supported_parameters": ["max_tokens"]},
            {"id": "x/no-params", "name": "No Params"},
            {"id": "x/unnamed", "supported_parameters": ["tools"]},
            {"id": "x/blank", "name": "", "supported_parameters": ["tools"]},
            {"id": "x/model:online", "name": "Online", "supported_parameters": ["tools"]},
            {"name": "no id", "supported_parameters": ["tools"]}
        ]});
        assert_eq!(
            parse_models(R, &body),
            vec![
                ModelInfo { id: "anthropic/claude-sonnet-4".into(), display_name: "Anthropic: Claude Sonnet 4".into() },
                ModelInfo { id: "x/unnamed".into(), display_name: "x/unnamed".into() },
                ModelInfo { id: "x/blank".into(), display_name: "x/blank".into() },
            ]
        );
    }

    #[test]
    fn openai_models_keep_only_chat_models_sorted_by_id() {
        let ids = [
            "whisper-1", "gpt-4o", "gpt-4o-audio-preview", "gpt-4o-realtime-preview", "gpt-4o-transcribe",
            "gpt-4o-mini-tts", "gpt-image-1", "gpt-4o-search-preview", "text-embedding-3-small",
            "omni-moderation-latest", "gpt-3.5-turbo-instruct", "o3-mini", "o1", "gpt-4.1-mini",
            "dall-e-3", "davinci-002", "chatgpt-4o-latest", "o3-deep-research-search", "omni-x", "gpt-4o",
        ];
        let body = json!({"data": ids.iter().map(|id| json!({"id": id, "object": "model"})).collect::<Vec<_>>()});
        let kept: Vec<String> = parse_models(O, &body).into_iter().map(|model| model.id).collect();
        assert_eq!(kept, ["gpt-4.1-mini", "gpt-4o", "o1", "o3-mini"]);
        assert!(parse_models(O, &body).iter().all(|model| model.id == model.display_name));
    }

    #[test]
    fn the_active_provider_is_the_one_with_a_stored_key() {
        assert_eq!(select_active(vec![(A, None), (R, None), (O, None)]), None);
        assert_eq!(
            select_active(vec![(A, None), (R, Some("sk-or".into())), (O, None)]),
            Some((R, "sk-or".to_string()))
        );
        assert_eq!(
            select_active(vec![(A, Some("a".into())), (R, Some("r".into()))]),
            Some((A, "a".to_string()))
        );
        assert_eq!(AssistantStatus::of(None), AssistantStatus { configured: false, provider: None });
        assert_eq!(AssistantStatus::of(Some(O)), AssistantStatus { configured: true, provider: Some(O) });
    }

    #[test]
    fn provider_wire_names_accounts_and_urls() {
        assert_eq!(serde_json::to_value(AssistantStatus::of(Some(R))).unwrap(), json!({"configured": true, "provider": "openrouter"}));
        assert_eq!(serde_json::to_value(AssistantStatus::of(None)).unwrap(), json!({"configured": false, "provider": null}));
        assert_eq!(serde_json::from_value::<Provider>(json!("openai")).unwrap(), O);
        assert_eq!(serde_json::from_value::<Provider>(json!("anthropic")).unwrap(), A);
        assert!(serde_json::from_value::<Provider>(json!("gemini")).is_err());
        assert_eq!(A.account(), "anthropic-api-key");
        assert_eq!(R.account(), "openrouter-api-key");
        assert_eq!(O.account(), "openai-api-key");
        assert_eq!(A.validate_url(), "https://api.anthropic.com/v1/models?limit=1");
        assert_eq!(A.models_url(), "https://api.anthropic.com/v1/models?limit=100");
        assert_eq!(A.chat_url(), "https://api.anthropic.com/v1/messages");
        assert_eq!(R.validate_url(), "https://openrouter.ai/api/v1/key");
        assert_eq!(R.models_url(), "https://openrouter.ai/api/v1/models");
        assert_eq!(R.chat_url(), "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(O.validate_url(), "https://api.openai.com/v1/models");
        assert_eq!(O.chat_url(), "https://api.openai.com/v1/chat/completions");
    }
}
