//! Request handlers for the API endpoints.
//!
//! This module contains the main request handlers and supporting functions
//! for processing chat requests, including both streaming and non-streaming
//! responses. It coordinates between different AI models and handles
//! usage tracking and cost calculations.

use crate::{
    clients::AnthropicClient,
    config::Config,
    error::{ApiError, Result, SseResponse},
    models::{
        AnthropicUsage, ApiRequest, ApiResponse, CombinedUsage, ContentBlock,
        ExternalApiResponse, StreamEvent,
    },
};
use axum::{
    extract::State,
    response::{sse::Event, IntoResponse},
    Json,
};
use chrono::Utc;
use futures::StreamExt;
use std::{collections::HashMap, sync::Arc};
use tokio_stream::wrappers::ReceiverStream;

/// Application state shared across request handlers.
///
/// Contains configuration that needs to be accessible
/// to all request handlers.
pub struct AppState {
    pub config: Config,
}

/// Extracts API token from request headers.
///
/// # Arguments
///
/// * `headers` - The HTTP headers containing the API token
///
/// # Returns
///
/// * `Result<String>` - The Anthropic API token
///
/// # Errors
///
/// Returns `ApiError::MissingHeader` if the token is missing
/// Returns `ApiError::BadRequest` if token is malformed
fn extract_api_token(headers: &axum::http::HeaderMap) -> Result<String> {
    let anthropic_token = headers
        .get("X-Anthropic-API-Token")
        .ok_or_else(|| ApiError::MissingHeader {
            header: "X-Anthropic-API-Token".to_string(),
        })?
        .to_str()
        .map_err(|_| ApiError::BadRequest {
            message: "Invalid Anthropic API token".to_string(),
        })?
        .to_string();

    Ok(anthropic_token)
}

/// Calculates the cost of Anthropic API usage.
///
/// # Arguments
///
/// * `model` - The specific Claude model used
/// * `input_tokens` - Number of input tokens processed
/// * `output_tokens` - Number of output tokens generated
/// * `cache_write_tokens` - Number of tokens written to cache
/// * `cache_read_tokens` - Number of tokens read from cache
/// * `config` - Configuration containing pricing information
///
/// # Returns
///
/// The total cost in dollars for the API usage
fn calculate_anthropic_cost(
    model: &str,
    input_tokens: u32,
    output_tokens: u32,
    cache_write_tokens: u32,
    cache_read_tokens: u32,
    config: &Config,
) -> f64 {
    let pricing = if model.contains("claude-3-5-sonnet") {
        &config.pricing.anthropic.claude_3_sonnet
    } else if model.contains("claude-3-5-haiku") {
        &config.pricing.anthropic.claude_3_haiku
    } else if model.contains("claude-3-opus") {
        &config.pricing.anthropic.claude_3_opus
    } else {
        &config.pricing.anthropic.claude_3_sonnet // default to sonnet pricing
    };

    let input_cost = (input_tokens as f64 / 1_000_000.0) * pricing.input_price;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * pricing.output_price;
    let cache_write_cost = (cache_write_tokens as f64 / 1_000_000.0) * pricing.cache_write_price;
    let cache_read_cost = (cache_read_tokens as f64 / 1_000_000.0) * pricing.cache_read_price;

    input_cost + output_cost + cache_write_cost + cache_read_cost
}

/// Formats a cost value as a dollar amount string.
///
/// # Arguments
///
/// * `cost` - The cost value to format
///
/// # Returns
///
/// A string representing the cost with 3 decimal places and $ prefix
fn format_cost(cost: f64) -> String {
    format!("${:.3}", cost)
}

/// Main handler for chat requests.
///
/// Routes requests to either streaming or non-streaming handlers
/// based on the request configuration.
///
/// # Arguments
///
/// * `state` - Application state containing configuration
/// * `headers` - HTTP request headers
/// * `request` - The parsed chat request
///
/// # Returns
///
/// * `Result<Response>` - The API response or an error
pub async fn handle_chat(
    state: State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<ApiRequest>,
) -> Result<axum::response::Response> {
    if request.stream {
        let stream_response = chat_stream(state, headers, Json(request)).await?;
        Ok(stream_response.into_response())
    } else {
        let json_response = chat(state, headers, Json(request)).await?;
        Ok(json_response.into_response())
    }
}

/// Handler for non-streaming chat requests.
///
/// Processes the request through both AI models sequentially,
/// combining their responses and tracking usage.
///
/// # Arguments
///
/// * `state` - Application state containing configuration
/// * `headers` - HTTP request headers
/// * `request` - The parsed chat request
///
/// # Returns
///
/// * `Result<Json<ApiResponse>>` - The combined API response or an error
pub(crate) async fn chat(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<ApiRequest>,
) -> Result<Json<ApiResponse>> {
    // Validate system prompt
    if !request.validate_system_prompt() {
        return Err(ApiError::InvalidSystemPrompt);
    }

    // Extract API token
    let anthropic_token = extract_api_token(&headers)?;

    // Initialize client
    let anthropic_client = AnthropicClient::new(anthropic_token);

    // Get messages with system prompt
    let messages = request.get_messages_with_system();

    // Configure Anthropic with thinking capability
    // Add thinking parameter to Anthropic config
    let mut anthropic_config = request.anthropic_config.clone();
    if anthropic_config.body.get("thinking").is_none() {
        // Add default thinking configuration if not provided
        let thinking_config = serde_json::json!({
            "type": "enabled",
            "budget_tokens": 16000
        });

        if let serde_json::Value::Object(ref mut body) = anthropic_config.body {
            body.insert("thinking".to_string(), thinking_config);
        }
    }

    // Call Anthropic API directly with thinking enabled
    let anthropic_messages = messages;

    // Call Anthropic API with thinking enabled
    let anthropic_response = anthropic_client
        .chat(
            anthropic_messages,
            request.get_system_prompt().map(String::from),
            &anthropic_config,
        )
        .await?;

    // Store response metadata
    let anthropic_status: u16 = 200;
    let anthropic_headers = HashMap::new(); // Headers not available when using high-level chat method

    // Calculate usage costs for Anthropic only
    let anthropic_cost = calculate_anthropic_cost(
        &anthropic_response.model,
        anthropic_response.usage.input_tokens,
        anthropic_response.usage.output_tokens,
        anthropic_response.usage.cache_creation_input_tokens,
        anthropic_response.usage.cache_read_input_tokens,
        &state.config,
    );

    // Use Anthropic's response blocks directly, which include thinking blocks
    let content = anthropic_response
        .content
        .clone()
        .into_iter()
        .map(ContentBlock::from_anthropic)
        .collect::<Vec<_>>();

    // Build response with only Anthropic details
    let response = ApiResponse {
        created: Utc::now(),
        content,
        anthropic_response: request.verbose.then(|| ExternalApiResponse {
            status: anthropic_status,
            headers: anthropic_headers,
            body: serde_json::to_value(&anthropic_response).unwrap_or_default(),
        }),
        combined_usage: CombinedUsage {
            total_cost: format_cost(anthropic_cost), // Only Anthropic cost
            anthropic_usage: AnthropicUsage {
                input_tokens: anthropic_response.usage.input_tokens,
                output_tokens: anthropic_response.usage.output_tokens,
                cached_write_tokens: anthropic_response.usage.cache_creation_input_tokens,
                cached_read_tokens: anthropic_response.usage.cache_read_input_tokens,
                total_tokens: anthropic_response.usage.input_tokens
                    + anthropic_response.usage.output_tokens,
                total_cost: format_cost(anthropic_cost),
            },
        },
    };

    Ok(Json(response))
}

/// Handler for streaming chat requests.
///
/// Processes the request through both AI models sequentially,
/// streaming their responses as Server-Sent Events.
///
/// # Arguments
///
/// * `state` - Application state containing configuration
/// * `headers` - HTTP request headers
/// * `request` - The parsed chat request
///
/// # Returns
///
/// * `Result<SseResponse>` - A stream of Server-Sent Events or an error
pub(crate) async fn chat_stream(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<ApiRequest>,
) -> Result<SseResponse> {
    println!("Handling streaming chat request");

    // Validate system prompt
    if !request.validate_system_prompt() {
        return Err(ApiError::InvalidSystemPrompt);
    }

    // Extract API token
    let anthropic_token = extract_api_token(&headers)?;

    // Debug log token length and first/last few characters for debugging
    let token_len = anthropic_token.len();
    let token_preview = if token_len > 10 {
        format!(
            "{}...{}",
            &anthropic_token[0..5],
            &anthropic_token[token_len - 5..token_len]
        )
    } else {
        format!("Token too short: {}", token_len)
    };
    println!(
        "Using Anthropic API token (length {}): {}",
        token_len, token_preview
    );

    // Initialize client
    let anthropic_client = AnthropicClient::new(anthropic_token);

    // Get messages with system prompt
    let messages = request.get_messages_with_system();

    // Configure Anthropic with thinking capability
    // Add thinking parameter to Anthropic config
    let mut anthropic_config = request.anthropic_config.clone();
    if anthropic_config.body.get("thinking").is_none() {
        // Add default thinking configuration if not provided
        let thinking_config = serde_json::json!({
            "type": "enabled",
            "budget_tokens": 16000
        });

        if let serde_json::Value::Object(ref mut body) = anthropic_config.body {
            body.insert("thinking".to_string(), thinking_config);
        }
    }

    // Create channel for stream events
    let (tx, rx) = tokio::sync::mpsc::channel(100);
    let tx = Arc::new(tx);

    // Spawn task to handle streaming
    let config = state.config.clone();
    let request_clone = request.clone();
    tokio::spawn(async move {
        let tx = tx.clone();

        // Start event
        let _ = tx
            .send(Ok(Event::default().event("start").data(
                serde_json::to_string(&StreamEvent::Start {
                    created: Utc::now(),
                })
                .unwrap_or_default(),
            )))
            .await;

        println!("Starting Anthropic API stream request");

        // Stream from Anthropic with thinking enabled
        let mut anthropic_stream = anthropic_client.chat_stream(
            messages.clone(), // Use original messages directly
            request_clone.get_system_prompt().map(String::from),
            &anthropic_config, // Use the config with thinking enabled
        );

        println!(
            "Streaming request sent to Anthropic API with {} messages",
            messages.len()
        );

        // We no longer use DeepSeek, so no need to track its usage

        while let Some(chunk) = anthropic_stream.next().await {
            match chunk {
                Ok(event) => {
                    println!("Received Anthropic stream event: {:?}", event);

                    match event {
                        crate::clients::anthropic::StreamEvent::MessageStart { message } => {
                            println!(
                                "MessageStart event with {} content blocks",
                                message.content.len()
                            );

                            // Only send content event if there's actual content to send
                            if !message.content.is_empty() {
                                let content_blocks = message
                                    .content
                                    .into_iter()
                                    .map(ContentBlock::from_anthropic)
                                    .collect::<Vec<_>>();

                                println!(
                                    "Sending content event with {} blocks",
                                    content_blocks.len()
                                );

                                let _ = tx
                                    .send(Ok(Event::default().event("content").data(
                                        serde_json::to_string(&StreamEvent::Content {
                                            content: content_blocks,
                                        })
                                        .unwrap_or_default(),
                                    )))
                                    .await;
                            } else {
                                println!("MessageStart event has empty content, not sending event");
                            }
                        }
                        crate::clients::anthropic::StreamEvent::ContentBlockDelta {
                            delta, ..
                        } => {
                            // Create a base content block
                            let content_block = ContentBlock {
                                content_type: delta.delta_type.clone(),
                                text: String::new(),
                                thinking: None,
                                signature: None,
                                data: None,
                            };

                            // Apply all delta fields including signature_delta and data
                            // This will use the apply_to method which handles all fields properly
                            delta.apply_to(&mut crate::clients::anthropic::ContentBlock {
                                content_type: content_block.content_type.clone(),
                                text: content_block.text.clone(),
                                thinking: content_block.thinking.clone(),
                                signature: content_block.signature.clone(),
                                data: content_block.data.clone(),
                            });

                            // Convert to the application's content block
                            let content_block =
                                if delta.delta_type == "thinking" && delta.thinking.is_some() {
                                    // Handle thinking content
                                    ContentBlock {
                                        content_type: delta.delta_type,
                                        text: "".to_string(),
                                        thinking: delta.thinking,
                                        signature: delta.signature_delta,
                                        data: delta.data,
                                    }
                                } else {
                                    // Handle regular text content
                                    ContentBlock {
                                        content_type: delta.delta_type,
                                        text: delta.text,
                                        thinking: None,
                                        signature: delta.signature_delta,
                                        data: delta.data,
                                    }
                                };

                            let _ = tx
                                .send(Ok(Event::default().event("content").data(
                                    serde_json::to_string(&StreamEvent::Content {
                                        content: vec![content_block],
                                    })
                                    .unwrap_or_default(),
                                )))
                                .await;
                        }
                        crate::clients::anthropic::StreamEvent::MessageDelta { usage: Some(usage), .. } => {
                            let anthropic_usage = AnthropicUsage::from_anthropic(usage);
                            let anthropic_cost = calculate_anthropic_cost(
                                "claude-3-7-sonnet-20250219", // Use latest model
                                anthropic_usage.input_tokens,
                                anthropic_usage.output_tokens,
                                anthropic_usage.cached_write_tokens,
                                anthropic_usage.cached_read_tokens,
                                &config,
                            );
                            let _ = tx
                                .send(Ok(Event::default().event("usage").data(
                                    serde_json::to_string(&StreamEvent::Usage {
                                        usage: CombinedUsage {
                                            total_cost: format_cost(anthropic_cost), // Only Anthropic cost
                                            anthropic_usage: AnthropicUsage {
                                                input_tokens: anthropic_usage.input_tokens,
                                                output_tokens: anthropic_usage
                                                    .output_tokens,
                                                cached_write_tokens: anthropic_usage
                                                    .cached_write_tokens,
                                                cached_read_tokens: anthropic_usage
                                                    .cached_read_tokens,
                                                total_tokens: anthropic_usage.total_tokens,
                                                total_cost: format_cost(anthropic_cost),
                                            },
                                        },
                                    })
                                    .unwrap_or_default(),
                                )))
                                .await;
                        }
                        crate::clients::anthropic::StreamEvent::MessageDelta { usage: None, .. } => {
                            // No usage data to send
                        }
                        crate::clients::anthropic::StreamEvent::MessageStop => {
                            println!("MessageStop event received");
                            let _ = tx
                                .send(Ok(Event::default().event("message_stop").data(
                                    serde_json::to_string(&StreamEvent::MessageStop)
                                    .unwrap_or_default(),
                                )))
                                .await;
                        }
                        _ => {} // Handle other events if needed
                    }
                }
                Err(e) => {
                    println!("Error from Anthropic stream: {}", e);

                    let error_message = e.to_string();
                    println!("Sending error event to client: {}", error_message);

                    let _ = tx
                        .send(Ok(Event::default().event("error").data(
                            serde_json::to_string(&StreamEvent::Error {
                                message: error_message,
                                code: 500,
                            })
                            .unwrap_or_default(),
                        )))
                        .await;
                    return;
                }
            }
        }

        // Send done event
        let _ = tx
            .send(Ok(Event::default().event("done").data(
                serde_json::to_string(&StreamEvent::Done).unwrap_or_default(),
            )))
            .await;

        // Debug logging to confirm event was sent
        println!("Stream completed, sent done event");
    });

    // Convert receiver into stream
    let stream = ReceiverStream::new(rx);

    // Create SSE response with explicit content type and keep-alive settings
    let sse = SseResponse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive-text"),
    );

    println!("Created SSE response, returning to client");
    Ok(sse)
}
