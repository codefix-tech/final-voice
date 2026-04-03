from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import shutil
import asyncio
import json
import os
import glob
import time
from services.llm_service import llm_service
from services.tts_service import tts_service
from services.kb_service import kb_service

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    """Cleanup old audio on startup."""
    for f in glob.glob("static/audio_*.mp3"):
        try:
            os.remove(f)
        except Exception:
            pass
    print("🧹 Cleaned up old audio files")
    yield
    # Cleanup on shutdown
    for f in glob.glob("static/audio_*.mp3"):
        try:
            os.remove(f)
        except Exception:
            pass

app = FastAPI(title="VOXEN - AI Persona Meeting Agent", lifespan=lifespan)

# CORS — must be added before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create static directory and mount
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return {"status": "VOXEN backend running"}


@app.post("/upload_persona")
async def upload_persona(file: UploadFile = File(...)):
    file_path = "static/avatar.jpg"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"filename": "avatar.jpg", "status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ WebSocket client connected")

    history = [
        {"role": "system", "content": (
            "You are VOXEN, an AI Persona Meeting Agent. "
            "You are professional, concise, and helpful. "
            "Keep responses SHORT — 1-2 sentences maximum for real-time conversation. "
            "Respond naturally as if speaking in a live meeting."
        )}
    ]

    counter = 0
    old_files = []  # track files for cleanup

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            user_input = message.get("text", "").strip()

            if not user_input:
                continue

            print(f"📥 User said: {user_input}")
            start_time = time.time()

            # --- Send "thinking" acknowledgment immediately ---
            await websocket.send_json({
                "status": "thinking",
                "text": None,
                "audio_url": None,
            })

            # --- Check cache first ---
            cached_answer = kb_service.find_cached_answer(user_input)

            if cached_answer:
                print(f"🧠 Cache hit")
                response_text = cached_answer
                history.append({"role": "user", "content": user_input})
                history.append({"role": "assistant", "content": response_text})
            else:
                history.append({"role": "user", "content": user_input})
                try:
                    response_text = await llm_service.get_response(history)
                    llm_time = time.time() - start_time
                    print(f"🤖 AI Response ({llm_time:.1f}s): {response_text[:80]}")
                except Exception as e:
                    print(f"❌ LLM Error: {e}")
                    await websocket.send_json({
                        "text": f"Sorry, I had an error: {str(e)[:50]}",
                        "status": "error"
                    })
                    continue

                history.append({"role": "assistant", "content": response_text})

                # Save to cache (fire and forget)
                try:
                    kb_service.add_qa_pair(user_input, response_text)
                except Exception:
                    pass

            # Keep history manageable (last 20 messages + system prompt)
            if len(history) > 21:
                history = [history[0]] + history[-20:]

            # --- Send text immediately (before TTS) so user sees response fast ---
            await websocket.send_json({
                "text": response_text,
                "audio_url": None,
            })

            # --- TTS: Generate audio file ---
            counter += 1
            audio_filename = f"static/audio_{os.getpid()}_{counter}.mp3"

            try:
                audio_path = await tts_service.generate_speech_file(response_text, audio_filename)
                tts_time = time.time() - start_time
                print(f"🎵 Audio generated ({tts_time:.1f}s): {audio_filename}")
            except Exception as e:
                print(f"❌ TTS Error: {e}")
                # Text was already sent above, just skip audio
                continue

            # Clean up previous audio file
            for old in old_files:
                try:
                    os.remove(old)
                except Exception:
                    pass
            old_files = [audio_filename]

            # --- Send audio URL ---
            audio_url = f"http://localhost:8000/{audio_filename}"
            print(f"📡 Sending audio: {audio_url}")

            await websocket.send_json({
                "text": None,  # text already sent
                "audio_url": audio_url,
            })

            total_time = time.time() - start_time
            print(f"⏱️ Total response time: {total_time:.1f}s")

    except WebSocketDisconnect:
        print("👋 Client disconnected")
    except Exception as e:
        print(f"❌ WebSocket error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Cleanup audio files for this session
        for old in old_files:
            try:
                os.remove(old)
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
