import asyncio
import json
import os
from aurex.main import JsonRpcServer

async def main():
    print("Starting JSON-RPC Server...")
    # Inject dummy key so initialization passes
    os.environ["OPENROUTER_API_KEY"] = os.environ.get("OPENROUTER_API_KEY", "dummy_key")
    server = JsonRpcServer()
    
    # Check that skills are loaded
    loader = server.skill_loader
    print(f"Loaded skills: {list(loader.loaded_skills.keys())}")
    
    request = {
        "jsonrpc": "2.0",
        "method": "agent_run",
        "params": {
            "user_input": "Find the latest news about OpenRouter and summarize them."
        },
        "id": 1
    }
    
    print(f"Sending JSON-RPC request: {json.dumps(request, indent=2)}")
    response = await server.handle_request(request)
    print(f"Response: {json.dumps(response, indent=2)}")

if __name__ == "__main__":
    asyncio.run(main())
