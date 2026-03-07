import asyncio
import httpx

async def test():
    OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
    api_key = "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"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/aurex-ai",
        "X-Title": "AurexAI",
    }
    payload = {
        "model": "google/gemma-3-27b-it:free",
        "messages": [{"role": "user", "content": "hello"}],
        "temperature": 0.7,
        "max_tokens": 4096,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        print("Status:", response.status_code)
        print("Response:", response.text)

if __name__ == "__main__":
    asyncio.run(test())
