"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import useSpeech from '@/hooks/useSpeech';
import { Mic, MicOff, PhoneOff, Loader2, Volume2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import dynamic from 'next/dynamic';

const AvatarScene = dynamic(() => import('@/components/AvatarScene'), {
    ssr: false,
    loading: () => (
        <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
                <div className="w-20 h-20 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-blue-400 animate-pulse" />
                </div>
            </div>
            <p className="text-neutral-500 text-sm font-medium tracking-wide">Loading 3D Avatar...</p>
        </div>
    ),
});

export default function Home() {
    const [isMeetingStarted, setIsMeetingStarted] = useState(false);
    const [status, setStatus] = useState("Ready");
    const [aiResponse, setAiResponse] = useState("Click Start to talk with VOXEN.");
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    // Audio infrastructure
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const meetingActiveRef = useRef(false);  // stable ref for meeting state

    const {
        transcript,
        listening,
        startListening,
        stopListening,
    } = useSpeech();

    // ─── Handle Barge-in ───────────────────────────────────────────
    const handleBargeIn = useCallback(() => {
        if (currentSourceRef.current) {
            console.log("🛑 User barged in! Stopping AI audio...");
            try { currentSourceRef.current.stop(); } catch (e) {}
            currentSourceRef.current = null;
            setIsSpeaking(false);
            analyserRef.current = null;
            if (meetingActiveRef.current) {
                setStatus("Listening...");
            }
        }
    }, []);

    // ─── Send text to AI via WebSocket ──────────────────────────────
    const sendToAI = useCallback((text: string) => {
        console.log("📤 sendToAI called:", text, "WS state:", wsRef.current?.readyState);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ text }));
            setStatus("Thinking...");
            setIsThinking(true);
        } else {
            console.warn("⚠️ WebSocket not open, can't send");
        }
    }, []);

    // ─── Play TTS audio with lip-sync analyser ──────────────────────
    const playAudioFromUrl = useCallback(async (url: string) => {
        if (!audioCtxRef.current) return;

        // Stop any currently playing audio
        if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch (e) {}
            currentSourceRef.current = null;
        }

        try {
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') await ctx.resume();

            const res = await fetch(url + '?t=' + Date.now());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const arrayBuffer = await res.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            // Build audio graph: source → analyser → destination
            const source = ctx.createBufferSource();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.7;

            source.buffer = audioBuffer;
            source.connect(analyser);
            analyser.connect(ctx.destination);

            analyserRef.current = analyser;
            currentSourceRef.current = source;

            source.onended = () => {
                console.log("🔊 Audio playback ended");
                setIsSpeaking(false);
                analyserRef.current = null;
                currentSourceRef.current = null;

                if (meetingActiveRef.current) {
                    setStatus("Listening...");
                }
            };

            source.start(0);
            setIsSpeaking(true);
            setStatus("VOXEN Speaking...");
            console.log("🔊 Playing audio:", url);
        } catch (err) {
            console.error("Audio playback error:", err);
            setStatus("Audio error");
            setIsSpeaking(false);
        }
    }, []);

    // ─── WebSocket connection ───────────────────────────────────────
    const connectWebSocket = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        console.log("🔌 Connecting WebSocket...");
        const socket = new WebSocket("ws://localhost:8000/ws");

        socket.onopen = () => {
            console.log("✅ WebSocket connected");
            setStatus("Listening...");
        };

        socket.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("📩 WS message:", data);

                // Handle "thinking" acknowledgment
                if (data.status === "thinking") {
                    setIsThinking(true);
                    setStatus("Thinking...");
                    return;
                }

                // Handle errors
                if (data.status === "error") {
                    setStatus("Error");
                    setAiResponse(data.text);
                    setIsThinking(false);
                    return;
                }

                // Handle text response (arrives before audio)
                if (data.text && !data.audio_url) {
                    setAiResponse(data.text);
                    setIsThinking(false);
                    setStatus("Generating voice...");
                    return;
                }

                // Handle audio URL (arrives after text)
                if (data.audio_url) {
                    if (data.text) {
                        setAiResponse(data.text);
                        setIsThinking(false);
                    }
                    await playAudioFromUrl(data.audio_url);
                    return;
                }

                // Fallback: text with no audio expected
                if (data.text) {
                    setAiResponse(data.text);
                    setIsThinking(false);
                    if (meetingActiveRef.current) {
                        setStatus("Listening...");
                    }
                }
            } catch (err) {
                console.error("Error processing WS message:", err);
                setIsThinking(false);
            }
        };

        socket.onclose = (event) => {
            console.log("🔌 WebSocket closed:", event.code, event.reason);
            if (meetingActiveRef.current) {
                setStatus("Reconnecting...");
                // Auto-reconnect after 2s
                setTimeout(() => {
                    if (meetingActiveRef.current) {
                        console.log("♻️ Reconnecting WebSocket...");
                        connectWebSocket();
                    }
                }, 2000);
            } else {
                setStatus("Disconnected");
                setIsMeetingStarted(false);
            }
        };

        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
            setStatus("Connection failed — retrying...");
        };

        wsRef.current = socket;
    }, [playAudioFromUrl]);

    // ─── Start/Stop meeting ─────────────────────────────────────────
    const startMeeting = useCallback(() => {
        // AudioContext MUST be created inside a user gesture
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        } else {
            audioCtxRef.current.resume();
        }

        meetingActiveRef.current = true;
        setIsMeetingStarted(true);
        setAiResponse("Connecting...");
        connectWebSocket();

        // Start mic after a short delay (let WS connect)
        setTimeout(() => {
            if (meetingActiveRef.current) {
                startListening(sendToAI, handleBargeIn);
            }
        }, 800);
    }, [connectWebSocket, startListening, sendToAI, handleBargeIn]);

    const stopMeeting = useCallback(() => {
        meetingActiveRef.current = false;

        // Stop any playing audio
        if (currentSourceRef.current) {
            try { currentSourceRef.current.stop(); } catch (e) {}
            currentSourceRef.current = null;
        }

        stopListening();
        wsRef.current?.close();
        wsRef.current = null;

        setIsMeetingStarted(false);
        setIsThinking(false);
        setIsSpeaking(false);
        analyserRef.current = null;
        setStatus("Ready");
        setAiResponse("Click Start to talk with VOXEN.");
    }, [stopListening]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            meetingActiveRef.current = false;
            wsRef.current?.close();
            audioCtxRef.current?.close();
        };
    }, []);

    return (
        <main className="voxen-main">
            {/* Ambient background */}
            <div className="voxen-bg-ambient">
                <motion.div
                    animate={{
                        opacity: isSpeaking ? [0.08, 0.2, 0.08] : isThinking ? [0.05, 0.12, 0.05] : 0.04,
                        scale: [1, 1.05, 1],
                    }}
                    transition={{ repeat: Infinity, duration: isSpeaking ? 2 : 4 }}
                    className="voxen-bg-orb voxen-bg-orb--blue"
                />
                <motion.div
                    animate={{
                        opacity: isSpeaking ? [0.06, 0.15, 0.06] : 0.03,
                        scale: [1, 1.03, 1],
                    }}
                    transition={{ repeat: Infinity, duration: 5 }}
                    className="voxen-bg-orb voxen-bg-orb--purple"
                />
                <div className="voxen-bg-orb voxen-bg-orb--indigo" />
            </div>

            {/* Header */}
            <header className="voxen-header">
                <div className="voxen-header__brand">
                    <div className="voxen-header__logo">
                        <Volume2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="voxen-header__title">VOXEN</h1>
                        <p className="voxen-header__subtitle">3D AI Avatar Agent</p>
                    </div>
                </div>

                <div className="voxen-header__controls">
                    <div className={`voxen-status-badge ${isMeetingStarted ? 'voxen-status-badge--live' : ''}`}>
                        <div className={`voxen-status-dot ${isMeetingStarted ? 'voxen-status-dot--live' : ''}`} />
                        {isMeetingStarted ? 'LIVE' : 'OFFLINE'}
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const fd = new FormData();
                            fd.append("file", file);
                            await axios.post("http://localhost:8000/upload_persona", fd);
                        }}
                    />
                </div>
            </header>

            {/* 3D Avatar Container */}
            <div className="voxen-avatar-container">
                <div className="voxen-avatar-scene">
                    <AvatarScene
                        key="permanent-avatar"
                        analyserRef={analyserRef}
                        isSpeaking={isSpeaking}
                        isThinking={isThinking}
                    />
                </div>

                {/* State indicator ring */}
                <div className={`voxen-avatar-ring ${
                    isSpeaking ? 'voxen-avatar-ring--speaking' :
                    isThinking ? 'voxen-avatar-ring--thinking' :
                    listening ? 'voxen-avatar-ring--listening' : ''
                }`} />

                {/* Pre-meeting overlay */}
                {!isMeetingStarted && (
                    <div className="voxen-overlay-premeet">
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3, duration: 0.6 }}
                            className="voxen-overlay-premeet__content"
                        >
                            <h2 className="voxen-hero-title">
                                Meet <span className="voxen-hero-title__accent">VOXEN</span>
                            </h2>
                            <p className="voxen-hero-desc">
                                Your high-fidelity real-time 3D AI persona for professional remote interaction.
                            </p>
                            <button onClick={startMeeting} className="voxen-start-btn group">
                                <span className="voxen-start-btn__inner">
                                    <Volume2 className="w-5 h-5 group-hover:animate-pulse" />
                                    Start Voice Meeting
                                </span>
                                <div className="voxen-start-btn__glow" />
                            </button>
                        </motion.div>
                    </div>
                )}

                {/* In-meeting overlays */}
                {isMeetingStarted && (
                    <div className="voxen-overlay-meeting">
                        {/* Status badge */}
                        <div className="voxen-meeting-status">
                            <motion.div
                                animate={{ opacity: [0.85, 1, 0.85] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                                className={`voxen-meeting-status__badge ${
                                    isSpeaking ? 'voxen-meeting-status__badge--speaking' :
                                    isThinking ? 'voxen-meeting-status__badge--thinking' :
                                    listening ? 'voxen-meeting-status__badge--listening' :
                                    ''
                                }`}
                            >
                                <div className={`voxen-meeting-status__dot ${
                                    isSpeaking ? 'voxen-meeting-status__dot--speaking' :
                                    isThinking ? 'voxen-meeting-status__dot--thinking' :
                                    listening ? 'voxen-meeting-status__dot--listening' : ''
                                }`} />
                                {status}
                            </motion.div>

                            {isThinking && (
                                <div className="voxen-thinking-badge">
                                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                    <span className="text-amber-300">Processing...</span>
                                </div>
                            )}
                        </div>

                        {/* User transcript */}
                        <AnimatePresence>
                            {transcript && (
                                <motion.div
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="voxen-transcript"
                                >
                                    <div className="voxen-transcript__inner">
                                        <p className="voxen-transcript__label">YOU</p>
                                        <p className="voxen-transcript__text">{transcript}</p>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* AI Response */}
                        <div className="voxen-response">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={aiResponse}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <p className="voxen-response__label">VOXEN</p>
                                    <p className="voxen-response__text">{aiResponse}</p>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                )}

                {/* Voice waveform */}
                <div className="voxen-waveform">
                    {[...Array(28)].map((_, i) => (
                        <motion.div
                            key={i}
                            animate={{
                                height: isSpeaking
                                    ? [2, 16 + Math.abs(Math.sin((i + 1) * 0.7)) * 22, 4, 20, 2]
                                    : listening && transcript
                                    ? [2, 8, 3, 10, 2]
                                    : 2
                            }}
                            transition={{
                                repeat: Infinity,
                                duration: isSpeaking ? 0.4 : 0.6,
                                delay: i * 0.025,
                                ease: "easeInOut"
                            }}
                            className={`voxen-waveform__bar ${
                                isSpeaking ? 'voxen-waveform__bar--speaking' :
                                listening ? 'voxen-waveform__bar--listening' : ''
                            }`}
                        />
                    ))}
                </div>
            </div>

            {/* Bottom Controls */}
            <AnimatePresence>
                {isMeetingStarted && (
                    <motion.div
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        className="voxen-controls"
                    >
                        <button onClick={stopMeeting} className="voxen-controls__end group">
                            <PhoneOff className="w-6 h-6 text-red-400 group-hover:text-white transition-colors" />
                        </button>

                        <div className={`voxen-controls__mic ${listening ? 'voxen-controls__mic--active' : ''}`}>
                            {listening
                                ? <><Mic className="w-4 h-4 animate-pulse" /> Listening</>
                                : isSpeaking
                                ? <><MicOff className="w-4 h-4" /> Muted (AI speaking)</>
                                : <><MicOff className="w-4 h-4" /> Mic Off</>
                            }
                        </div>

                        {isSpeaking && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="voxen-controls__speaking"
                            >
                                <Volume2 className="w-4 h-4 animate-pulse" /> Speaking
                            </motion.div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
    );
}
