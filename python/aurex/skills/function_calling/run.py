"""
Function Calling Nativo - Tool Use estruturado via API.

Em vez de pedir ao LLM para retornar JSON como texto (que é frágil
e depende de parsing regex/json.loads), esta skill usa o mecanismo
NATIVO de tool_use das APIs:

- Claude (Anthropic): tool_use content blocks com input validado
- OpenAI/OpenRouter: function_calling com arguments estruturados

O modelo retorna chamadas de tool como objetos estruturados,
não como texto parseado.

Formato Anthropic (tool_use):
  response.content = [
    {"type": "text", "text": "Vou buscar..."},
    {"type": "tool_use", "id": "toolu_xxx", "name": "search", "input": {"query": "..."}}
  ]

Formato OpenAI (function_calling):
  response.choices[0].message.tool_calls = [
    {"id": "call_xxx", "type": "function", "function": {"name": "search", "arguments": "{...}"}}
  ]
"""

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def convert_tools_to_anthropic(tools: list[dict]) -> list[dict]:
    """Converte definições de tools para formato Anthropic."""
    anthropic_tools = []
    for tool in tools:
        anthropic_tools.append({
            "name": tool["name"],
            "description": tool.get("description", ""),
            "input_schema": tool.get("parameters", tool.get("input_schema", {
                "type": "object",
                "properties": {},
            })),
        })
    return anthropic_tools


def convert_tools_to_openai(tools: list[dict]) -> list[dict]:
    """Converte definições de tools para formato OpenAI/OpenRouter."""
    openai_tools = []
    for tool in tools:
        openai_tools.append({
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("parameters", tool.get("input_schema", {
                    "type": "object",
                    "properties": {},
                })),
            },
        })
    return openai_tools


async def call_anthropic(
    messages: list[dict],
    tools: list[dict],
    model: str = "claude-sonnet-4-20250514",
    api_key: str = "",
    system_prompt: str = "",
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """
    Chama API Anthropic com tool_use nativo.
    Retorna resposta com content blocks tipados.
    """
    try:
        import httpx
    except ImportError as e:
        raise ImportError("A required dependency 'httpx' is missing. Please ensure it is installed in your python environment (pyproject.toml).") from e

    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    anthropic_tools = convert_tools_to_anthropic(tools)

    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
        "tools": anthropic_tools,
    }
    if system_prompt:
        payload["system"] = system_prompt

    # Sanitize surrogate characters that crash httpx JSON encoder (common on Windows)
    payload = sanitize_surrogates(payload)

    async with httpx.AsyncClient(
        timeout=120.0,
        transport=httpx.AsyncHTTPTransport(retries=2),
    ) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    # Extrai tool_use blocks e text blocks
    content = data.get("content", [])
    stop_reason = data.get("stop_reason", "")

    text_parts = []
    tool_calls = []

    for block in content:
        if block["type"] == "text":
            text_parts.append(block["text"])
        elif block["type"] == "tool_use":
            tool_calls.append({
                "id": block["id"],
                "name": block["name"],
                "arguments": block["input"],
                "provider": "anthropic",
            })

    return {
        "text": "\n".join(text_parts),
        "tool_calls": tool_calls,
        "stop_reason": stop_reason,
        "has_tool_calls": len(tool_calls) > 0,
        "raw_content": content,
    }


async def call_openrouter(
    messages: list[dict],
    tools: list[dict],
    model: str = "meta-llama/llama-3.3-70b-instruct:free",
    api_key: str = "",
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """
    Chama OpenRouter com function_calling nativo.
    """
    try:
        import httpx
    except ImportError as e:
        raise ImportError("A required dependency 'httpx' is missing. Please ensure it is installed in your python environment (pyproject.toml).") from e

    api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    openai_tools = convert_tools_to_openai(tools)

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "tools": openai_tools,
        "tool_choice": "auto",
    }

    # Sanitize surrogate characters that crash httpx JSON encoder (common on Windows)
    payload = sanitize_surrogates(payload)

    async with httpx.AsyncClient(
        timeout=120.0,
        transport=httpx.AsyncHTTPTransport(retries=2),
    ) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    message = data["choices"][0]["message"]
    content = message.get("content", "") or ""
    raw_tool_calls = message.get("tool_calls", [])

    tool_calls = []
    for tc in raw_tool_calls:
        func = tc.get("function", {})
        args = func.get("arguments", "{}")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"raw": args}
        tool_calls.append({
            "id": tc.get("id", ""),
            "name": func.get("name", ""),
            "arguments": args,
            "provider": "openrouter",
        })

    return {
        "text": content,
        "tool_calls": tool_calls,
        "stop_reason": data["choices"][0].get("finish_reason", ""),
        "has_tool_calls": len(tool_calls) > 0,
    }


async def call_deepseek(
    messages: list[dict],
    tools: list[dict],
    model: str = "deepseek-chat",
    api_key: str = "",
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """
    Chama DeepSeek nativo com function_calling (compatível com OpenAI).
    """
    try:
        import httpx
    except ImportError as e:
        raise ImportError("A required dependency 'httpx' is missing. Please ensure it is installed in your python environment (pyproject.toml).") from e

    api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
    openai_tools = convert_tools_to_openai(tools)

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "tools": openai_tools,
        "tool_choice": "auto",
    }

    # DeepSeek doesn't allow empty tools list, so omit if empty
    if not openai_tools:
        del payload["tools"]
        del payload["tool_choice"]

    # Sanitize surrogate characters that crash httpx JSON encoder (common on Windows)
    payload = sanitize_surrogates(payload)

    async with httpx.AsyncClient(
        timeout=120.0,
        transport=httpx.AsyncHTTPTransport(retries=2),
    ) as client:
        resp = await client.post(
            "https://api.deepseek.com/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    message = data["choices"][0]["message"]
    content = message.get("content", "") or ""
    raw_tool_calls = message.get("tool_calls", [])

    tool_calls = []
    for tc in raw_tool_calls:
        func = tc.get("function", {})
        args = func.get("arguments", "{}")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"raw": args}
        tool_calls.append({
            "id": tc.get("id", ""),
            "name": func.get("name", ""),
            "arguments": args,
            "provider": "deepseek",
        })

    return {
        "text": content,
        "tool_calls": tool_calls,
        "stop_reason": data["choices"][0].get("finish_reason", ""),
        "has_tool_calls": len(tool_calls) > 0,
    }


def sanitize_surrogates(obj: Any) -> Any:
    """Recursively removes utf-8 surrogate characters that crash httpx JSON encoder."""
    if isinstance(obj, str):
        return obj.encode('utf-8', 'replace').decode('utf-8')
    elif isinstance(obj, dict):
        return {k: sanitize_surrogates(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_surrogates(item) for item in obj]
    return obj

def build_tool_result_message_anthropic(tool_call_id: str, result: Any) -> dict:
    """Constrói mensagem de resultado de tool para Anthropic."""
    safe_result = sanitize_surrogates(result)
    return {
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": tool_call_id,
            "content": json.dumps(safe_result, default=str, ensure_ascii=False),
        }],
    }


def build_tool_result_message_openai(tool_call_id: str, name: str, result: Any) -> dict:
    """Constrói mensagem de resultado de tool para OpenAI."""
    safe_result = sanitize_surrogates(result)
    return {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "name": name,
        "content": json.dumps(safe_result, default=str, ensure_ascii=False),
    }


async def run(params: dict[str, Any], tool_registry: Any = None) -> dict[str, Any]:
    """
    Entry point do Function Calling nativo.

    Executa um loop completo de function calling onde:
    1. Envia mensagens + tools ao LLM
    2. Se LLM retorna tool_calls, executa cada uma
    3. Envia resultados de volta ao LLM
    4. Repete até LLM dar resposta final (sem tool_calls)
    """
    messages = list(params.get("messages", []))
    tools = params.get("tools", [])
    provider = params.get("provider", "openrouter")
    model = params.get("model", "")
    api_key = params.get("api_key", "")
    system_prompt = params.get("system_prompt", "")
    max_rounds = params.get("max_rounds", 10)
    max_tokens = params.get("max_tokens", 4096)
    tool_executor = params.get("tool_executor")  # Função que executa tools

    if not messages:
        return {"error": "messages é obrigatório"}

    # For OpenRouter, inject system_prompt as first message if not already present
    if provider != "anthropic" and system_prompt:
        if not messages or messages[0].get("role") != "system":
            messages.insert(0, {"role": "system", "content": system_prompt})

    all_tool_calls = []

    for round_num in range(max_rounds):
        # 1. Chama LLM com tools
        if provider == "anthropic":
            response = await call_anthropic(
                messages=messages,
                tools=tools,
                model=model or "claude-sonnet-4-20250514",
                api_key=api_key,
                system_prompt=system_prompt,
                max_tokens=max_tokens,
            )
        elif provider == "deepseek":
            response = await call_deepseek(
                messages=messages,
                tools=tools,
                model=model or "deepseek-chat",
                api_key=api_key,
                max_tokens=max_tokens,
            )
        else:
            response = await call_openrouter(
                messages=messages,
                tools=tools,
                model=model,
                api_key=api_key,
                max_tokens=max_tokens,
            )

        # 2. Se não há tool calls, é resposta final
        if not response["has_tool_calls"]:
            return {
                "response": response["text"],
                "tool_calls": all_tool_calls,
                "rounds": round_num + 1,
            }

        # 3. Append assistant message ONCE before executing tool calls
        if provider == "anthropic":
            messages.append({
                "role": "assistant",
                "content": response.get("raw_content", [
                    {"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["arguments"]}
                    for tc in response["tool_calls"]
                ]),
            })
        else:
            messages.append({
                "role": "assistant",
                "content": response["text"] or "",
                "tool_calls": [{
                    "id": t["id"],
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "arguments": json.dumps(t["arguments"]),
                    },
                } for t in response["tool_calls"]],
            })

        # 4. Execute each tool call and append results
        for tc in response["tool_calls"]:
            all_tool_calls.append(tc)

            # Executa via executor customizado ou tool_registry
            result = {"error": "Nenhum executor disponível"}
            if tool_executor:
                try:
                    result = await tool_executor(tc["name"], tc["arguments"])
                except Exception as e:
                    result = {"error": str(e)}
            elif tool_registry:
                try:
                    if hasattr(tool_registry, "execute"):
                        result = await tool_registry.execute(tc["name"], tc["arguments"])
                    else:
                        result = {"error": "tool_registry sem método execute"}
                except Exception as e:
                    result = {"error": str(e)}

            # Append tool result
            if provider == "anthropic":
                messages.append(build_tool_result_message_anthropic(tc["id"], result))
            else:
                messages.append(build_tool_result_message_openai(tc["id"], tc["name"], result))

    return {
        "response": "Máximo de rounds atingido",
        "tool_calls": all_tool_calls,
        "rounds": max_rounds,
        "warning": "max_rounds_reached",
    }
