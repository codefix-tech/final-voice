import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv("backend/.env")
api_key = os.getenv("GROQ_API_KEY")

print(f"🔍 Testing key: {api_key[:5]}...{api_key[-5:]}")

try:
    client = Groq(api_key=api_key)
    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": "test"}],
        model="llama-3.3-70b-versatile",
    )
    print("✅ SUCCESS: The API key is working perfectly!")
except Exception as e:
    print(f"❌ FAILURE: {e}")
