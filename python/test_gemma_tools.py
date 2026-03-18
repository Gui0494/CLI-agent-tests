import asyncio
import os
from aurex.skills.function_calling.run import call_openrouter

async def test_gemma_tools():
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        print("Error: OPENROUTER_API_KEY environment variable is not set.")
        return

    tools = [{
        "name": "get_weather",
        "description": "Get current weather in a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            },
            "required": ["location"]
        }
    }]
    messages = [{"role": "user", "content": "What is the weather in Paris?"}]
    try:
        res = await call_openrouter(messages, tools, model="google/gemma-3-27b-it:free", api_key=api_key)
        print("Success:", res)
    except Exception as e:
        print(f"Error ({type(e).__name__}): {e}")

if __name__ == "__main__":
    asyncio.run(test_gemma_tools())
