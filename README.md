<div align="center">

<h1>DeepClaude 🧠</h1>

<img src="frontend/public/deepclaude.png" width="300">

Enhance Claude's capabilities with Extended Thinking - a unified API and chat interface for powerful reasoning and generation.

[![GitHub license](https://img.shields.io/github/license/getasterisk/deepclaude)](https://github.com/getasterisk/deepclaude/blob/main/LICENSE.md)
[![Rust](https://img.shields.io/badge/rust-v1.75%2B-orange)](https://www.rust-lang.org/)
[![API Status](https://img.shields.io/badge/API-Stable-green)](https://deepclaude.asterisk.so)

[Getting Started](#getting-started) •
[Features](#features) •
[API Usage](#api-usage) •
[Documentation](#documentation) •
[Self-Hosting](#self-hosting) •
[Contributing](#contributing)

</div>

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Why Extended Thinking?](#why-extended-thinking)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [API Usage](#api-usage)
  - [Basic Example](#basic-example)
  - [Streaming Example](#streaming-example)
- [Configuration Options](#configuration-options)
- [Self-Hosting](#self-hosting)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Overview

DeepClaude is a high-performance LLM inference API that harnesses Claude 3.7 Sonnet's Extended Thinking capabilities. It provides a streamlined interface for accessing advanced reasoning and generation capabilities while maintaining complete control over your API keys and data.

## Features

🚀 **Advanced Reasoning** - Access Claude's Extended Thinking capabilities for transparent step-by-step reasoning, powered by a high-performance Rust API

🔒 **Private & Secure** - End-to-end security with local API key management. Your data stays private

⚙️ **Highly Configurable** - Customize thinking parameters, output length, and more to match your needs

🌟 **Open Source** - Free and open-source codebase. Contribute, modify, and deploy as you wish

🤖 **Enhanced Intelligence** - Leverage structured thinking processes for better problem-solving and content generation

🔑 **Managed BYOK API** - Use your own API keys with our managed infrastructure for complete control

## Why Extended Thinking?

Claude 3.7 Sonnet's Extended Thinking feature provides unprecedented transparency into the model's reasoning process, allowing it to tackle complex problems with structured, step-by-step thinking.

Extended Thinking enables Claude to:

- Break down complex problems into manageable components
- Explore multiple approaches and evaluate their merits
- Catch and correct errors in its own reasoning
- Consider edge cases and limitations
- Document its entire thought process for transparency

DeepClaude provides a streamlined interface to these capabilities with:

- Configurable thinking budgets to control depth of reasoning
- Seamless integration with streaming for real-time thought visibility
- Support for large context windows and extended outputs
- Complete control with your own API keys

## Getting Started

### Prerequisites

- Rust 1.75 or higher
- Anthropic API key (with access to Claude 3.7 Sonnet)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/getasterisk/deepclaude.git
cd deepclaude
```

2. Build the project:
```bash
cargo build --release
```

### Configuration

Create a `config.toml` file in the project root:

```toml
[server]
host = "127.0.0.1"
port = 3000

[pricing]
# Configure pricing settings for usage tracking
```

## API Usage

See [API Docs](https://deepclaude.chat)

### Basic Example

```python
import requests

response = requests.post(
    "http://127.0.0.1:1337/",
    headers={
        "X-Anthropic-API-Token": "<YOUR_ANTHROPIC_API_KEY>"
    },
    json={
        "messages": [
            {"role": "user", "content": "How many 'r's in the word 'strawberry'?"}
        ],
        "anthropic_config": {
            "body": {
                "thinking": {
                    "type": "enabled",
                    "budget_tokens": 16000
                }
            }
        }
    }
)

print(response.json())
```

### Streaming Example

```python
import asyncio
import json
import httpx

async def stream_response():
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            "http://127.0.0.1:1337/",
            headers={
                "X-Anthropic-API-Token": "<YOUR_ANTHROPIC_API_KEY>"
            },
            json={
                "stream": True,
                "messages": [
                    {"role": "user", "content": "How many 'r's in the word 'strawberry'?"}
                ],
                "anthropic_config": {
                    "body": {
                        "thinking": {
                            "type": "enabled",
                            "budget_tokens": 16000
                        }
                    }
                }
            }
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    if line.startswith('data: '):
                        data = line[6:]
                        try:
                            parsed_data = json.loads(data)
                            if 'content' in parsed_data:
                                for block in parsed_data.get('content', []):
                                    if block.get('content_type') == 'thinking':
                                        print("\n[THINKING] ", block.get('thinking', ''))
                                    elif block.get('content_type') == 'text':
                                        print(block.get('text', ''), end='', flush=True)
                            else:
                                print(data, flush=True)
                        except json.JSONDecodeError:
                            pass

if __name__ == "__main__":
    asyncio.run(stream_response())
```

## Configuration Options

The API supports extensive configuration through the request body:

```json
{
    "stream": false,
    "verbose": false,
    "system": "Optional system prompt",
    "messages": [...],
    "anthropic_config": {
        "headers": {
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "output-128k-2025-02-19"
        },
        "body": {
            "model": "claude-3-7-sonnet-20250219",
            "max_tokens": 32000,
            "thinking": {
                "type": "enabled",
                "budget_tokens": 16000
            }
        }
    }
}
```

## Self-Hosting

DeepClaude can be self-hosted on your own infrastructure. Follow these steps:

1. Configure environment variables or `config.toml`
2. Build the Docker image or compile from source
3. Deploy to your preferred hosting platform

## Security

- No data storage or logged
- BYOK (Bring Your Own Keys) architecture
- Regular security audits and updates

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on:

- Code of Conduct
- Development process
- Submitting pull requests
- Reporting issues

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.

## Acknowledgments

DeepClaude is a free and open-source project by [Asterisk](https://asterisk.so/). Special thanks to:

- Anthropic for Claude's capabilities and Extended Thinking feature
- The open-source community for their continuous support

---

<div align="center">
Made with ❤️ by <a href="https://asterisk.so">Asterisk</a>
</div>