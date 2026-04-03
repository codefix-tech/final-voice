"""
End-to-end test: connects to the WebSocket, sends a text message,
and checks if we get back an audio_url with a valid file on disk.
"""
import asyncio
import json
import websockets

async def test():
    uri = "ws://localhost:8000/ws"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as ws:
            print("✅ WebSocket connected")

            # Send a test message
            msg = json.dumps({"text": "Hello VOXEN, say hi."})
            await ws.send(msg)
            print(f"📤 Sent: {msg}")

            # Wait for response (up to 30 seconds)
            response = await asyncio.wait_for(ws.recv(), timeout=30)
            data = json.loads(response)
            print(f"📩 Received: {json.dumps(data, indent=2)}")

            if data.get("audio_url"):
                print(f"\n✅ SUCCESS! Audio URL: {data['audio_url']}")
                # Check if file exists on disk
                import os
                path = data["audio_url"].replace("http://localhost:8000/", "backend/")
                if os.path.exists(path):
                    size = os.path.getsize(path)
                    print(f"✅ Audio file exists on disk: {path} ({size} bytes)")
                else:
                    print(f"❌ Audio file NOT found at: {path}")
            else:
                print("❌ No audio_url in response")
    except Exception as e:
        print(f"❌ Error: {e}")

asyncio.run(test())
