import asyncio
import os
import httpx

async def test_deepseek_search():
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        print("Set DEEPSEEK_API_KEY to test.")
        return
        
    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": "What is the capital of France?"}],
        "search": True
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post("https://api.deepseek.com/chat/completions", json=payload, headers=headers)
            print("Status:", resp.status_code)
            print("Response:", resp.json())
        except Exception as e:
            print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_deepseek_search())
