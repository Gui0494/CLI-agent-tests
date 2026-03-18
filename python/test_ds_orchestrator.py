import asyncio
from dotenv import load_dotenv
from aurex.search.orchestrator import SearchOrchestrator

load_dotenv()

async def test_deepseek_search():
    # Make sure we don't hit cache from previous test
    orchestrator = SearchOrchestrator()
    print("Testing orchestrator priority search with DEEPSEEK_API_KEY loaded...")
    try:
        results = await orchestrator.search("What is the latest news regarding DeepSeek AI models today?")
        if not results:
            print("No results found. All providers failed.")
            return
            
        for idx, res in enumerate(results):
            print(f"{idx+1}. {res.title} - {res.url}")
            print(f"   Provider: {res.provider}")
            print(f"   Excerpt: {res.excerpt[:150]}...\n")
    except Exception as e:
        print("Error during search:", e)

if __name__ == "__main__":
    asyncio.run(test_deepseek_search())
