#!/bin/bash

# VOXEN - Start Script

echo "🚀 Starting VOXEN - AI Persona Meeting Agent..."

# 1. Check for .env file
if [ ! -f backend/.env ]; then
    echo "⚠️  backend/.env not found! Creating from .env.example..."
    cp backend/.env.example backend/.env
    echo "--------------------------------------------------------"
    echo "❌ ACTION REQUIRED: Please edit backend/.env"
    echo "   and add your GROQ_API_KEY before continuing."
    echo "   (You can find it at https://console.groq.com)"
    echo "--------------------------------------------------------"
    exit 1
fi

# Check if GROQ_API_KEY is still the placeholder
if grep -q "your_groq_api_key_here" backend/.env; then
    echo "❌ Error: GROQ_API_KEY is still set to placeholder."
    echo "Please update backend/.env with your actual key."
    exit 1
fi

# 2. Check for models
if [ ! -d backend/models/liveportrait ]; then
    echo "⚠️  LivePortrait models not found!"
    echo "Running download_models.py..."
    cd backend
    # Use the root .venv
    source ../.venv/bin/activate
    python3 download_models.py
    cd ..
fi

# 2. Start Backend
echo "📡 Starting Backend (FastAPI)..."
cd backend
source ../.venv/bin/activate
export GROQ_API_KEY=$(grep GROQ_API_KEY .env | cut -d '=' -f2)
python3 main.py &
BACKEND_PID=$!
cd ..

# 3. Start Frontend
echo "💻 Starting Frontend (Next.js)..."
cd frontend
npm run dev

# Cleanup on exit
trap "kill $BACKEND_PID" EXIT
