import edge_tts
import os
import uuid
import asyncio

class TTSService:
    def __init__(self, voice="en-US-AvaNeural"):
        self.voice = voice

    async def generate_speech_file(self, text: str, output_path: str):
        try:
            communicate = edge_tts.Communicate(text, self.voice)
            await communicate.save(output_path)
            return output_path
        except Exception as e:
            print(f"Error in TTS generation: {e}")
            return None

tts_service = TTSService()
