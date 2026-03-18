"""
Streaming Engine - Respostas token-by-token em tempo real.

Resolve o gap crítico de UX: em vez de esperar 30s por uma resposta
completa, o usuário vê cada token sendo gerado em tempo real.

Suporta 3 modos:
  - stdout: imprime tokens direto no terminal (para CLI)
  - callback: chama uma função para cada chunk (para integração)
  - sse: emite Server-Sent Events (para web/API)
"""

import sys
import json
import time
import asyncio
import logging
from typing import Any, AsyncGenerator, Callable, Optional

logger = logging.getLogger(__name__)


class StreamBuffer:
    """Buffer que acumula tokens e emite chunks formatados."""

    def __init__(self, mode: str = "stdout", callback: Optional[Callable] = None):
        self.mode = mode
        self.callback = callback
        self.tokens: list[str] = []
        self.start_time = time.time()

    def emit(self, token: str) -> None:
        """Emite um token no modo configurado."""
        self.tokens.append(token)

        if self.mode == "stdout":
            sys.stdout.write(token)
            sys.stdout.flush()
        elif self.mode == "callback" and self.callback:
            self.callback({
                "type": "token",
                "content": token,
                "index": len(self.tokens) - 1,
            })
        elif self.mode == "sse":
            sse_data = json.dumps({"token": token, "index": len(self.tokens) - 1})
            sys.stdout.write(f"data: {sse_data}\n\n")
            sys.stdout.flush()

    def emit_status(self, status: str, data: dict | None = None) -> None:
        """Emite evento de status (início, fim, erro)."""
        event = {"type": "status", "status": status, "timestamp": time.time()}
        if data:
            event.update(data)

        if self.mode == "stdout":
            if status == "start":
                sys.stdout.write("\n")
            elif status == "end":
                sys.stdout.write("\n")
        elif self.mode == "callback" and self.callback:
            self.callback(event)
        elif self.mode == "sse":
            sys.stdout.write(f"event: {status}\ndata: {json.dumps(event)}\n\n")
            sys.stdout.flush()

    def get_result(self) -> dict[str, Any]:
        """Retorna resultado final com métricas."""
        elapsed = time.time() - self.start_time
        full_text = "".join(self.tokens)
        return {
            "full_response": full_text,
            "token_count": len(self.tokens),
            "duration_ms": round(elapsed * 1000, 2),
            "tokens_per_second": round(len(self.tokens) / max(elapsed, 0.001), 2),
        }


async def stream_openrouter(
    prompt: str,
    system_prompt: str = "",
    model: str = "",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_key: str = "",
    buffer: StreamBuffer | None = None,
) -> AsyncGenerator[str, None]:
    """
    Stream de tokens do OpenRouter via SSE.
    Usa httpx para streaming HTTP real, não requests bloqueante.
    """
    try:
        import httpx
    except ImportError as e:
        raise ImportError("A required dependency 'httpx' is missing. Please ensure it is installed in your python environment (pyproject.toml).") from e

    if not model:
        model = "meta-llama/llama-3.3-70b-instruct:free"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aurexai.dev",
    }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        if buffer:
                            buffer.emit(content)
                        yield content
                except json.JSONDecodeError:
                    continue


async def stream_deepseek(
    prompt: str,
    system_prompt: str = "",
    model: str = "deepseek-chat",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_key: str = "",
    buffer: StreamBuffer | None = None,
) -> AsyncGenerator[str, None]:
    """
    Stream de tokens do DeepSeek via SSE.
    """
    try:
        import httpx
    except ImportError as e:
        raise ImportError("A required dependency 'httpx' is missing. Please ensure it is installed in your python environment (pyproject.toml).") from e

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            "https://api.deepseek.com/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        if buffer:
                            buffer.emit(content)
                        yield content
                except json.JSONDecodeError:
                    continue


async def stream_anthropic(
    prompt: str,
    system_prompt: str = "",
    model: str = "claude-sonnet-4-20250514",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_key: str = "",
    buffer: StreamBuffer | None = None,
) -> AsyncGenerator[str, None]:
    """
    Stream de tokens da API Anthropic via SSE nativo.
    Usa o formato de streaming nativo do Claude com content_block_delta.
    """
    try:
        import httpx
    except ImportError as e:
        raise ImportError("A required dependency 'httpx' is missing. Please ensure it is installed in your python environment (pyproject.toml).") from e

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system_prompt:
        payload["system"] = system_prompt

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                    if event.get("type") == "content_block_delta":
                        text = event.get("delta", {}).get("text", "")
                        if text:
                            if buffer:
                                buffer.emit(text)
                            yield text
                except json.JSONDecodeError:
                    continue


async def run(params: dict[str, Any], tool_registry: Any = None) -> dict[str, Any]:
    """
    Entry point da skill de streaming.

    Params:
        prompt: texto para enviar ao LLM
        system_prompt: system prompt opcional
        model: modelo a usar
        stream_mode: stdout | callback | sse
        temperature: temperatura de geração
        provider: openrouter | anthropic
        api_key: chave de API
        callback: função de callback (para modo callback)
    """
    prompt = params.get("prompt", "")
    if not prompt:
        return {"error": "prompt é obrigatório"}

    system_prompt = params.get("system_prompt", "")
    model = params.get("model", "")
    stream_mode = params.get("stream_mode", "stdout")
    temperature = params.get("temperature", 0.7)
    provider = params.get("provider", "openrouter")
    api_key = params.get("api_key", "")
    callback = params.get("callback")
    max_tokens = params.get("max_tokens", 4096)

    buffer = StreamBuffer(mode=stream_mode, callback=callback)
    buffer.emit_status("start", {"model": model, "provider": provider})

    timeout_seconds = params.get("timeout_seconds", 120)

    try:
        async with asyncio.timeout(timeout_seconds):
            if provider == "anthropic":
                stream_gen = stream_anthropic(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    model=model or "claude-sonnet-4-20250514",
                    temperature=temperature,
                    max_tokens=max_tokens,
                    api_key=api_key,
                    buffer=buffer,
                )
            elif provider == "deepseek":
                stream_gen = stream_deepseek(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    model=model or "deepseek-chat",
                    temperature=temperature,
                    max_tokens=max_tokens,
                    api_key=api_key,
                    buffer=buffer,
                )
            else:
                stream_gen = stream_openrouter(
                    prompt=prompt,
                    system_prompt=system_prompt,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    api_key=api_key,
                    buffer=buffer,
                )

            async for _ in stream_gen:
                pass  # buffer handles emission

            result = buffer.get_result()
            buffer.emit_status("end", result)
            return result

    except TimeoutError:
        logger.warning(f"Streaming timeout após {timeout_seconds}s")
        buffer.emit_status("error", {"message": f"Timeout após {timeout_seconds}s"})
        partial = buffer.get_result()
        partial["error"] = f"Streaming timeout após {timeout_seconds}s"
        partial["partial"] = True
        return partial

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        buffer.emit_status("error", {"message": str(e)})
        partial = buffer.get_result()
        partial["error"] = str(e)
        return partial
