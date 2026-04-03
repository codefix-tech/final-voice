import os
import asyncio
from groq import Groq
from typing import List, Dict
from dotenv import load_dotenv

# Ensure .env is loaded
load_dotenv()

class LLMService:
    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        if not self.api_key or self.api_key == "your_groq_api_key_here":
            print("❌ GROQ_API_KEY is not set or is still a placeholder.")
            raise ValueError("GROQ_API_KEY environment variable not set in .env")
        
        print(f"DEBUG: Groq Key loaded (prefix): {self.api_key[:10]}...")
        self.client = Groq(api_key=self.api_key)
        self.model = "llama-3.3-70b-versatile"

    async def get_response(self, messages: List[Dict[str, str]]) -> str:
        # Groq SDK is synchronous — run in executor to avoid blocking event loop
        loop = asyncio.get_event_loop()
        completion = await loop.run_in_executor(
            None,
            lambda: self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=256,   # shorter for faster real-time responses
                stream=False
            )
        )
        return completion.choices[0].message.content

llm_service = LLMService()
