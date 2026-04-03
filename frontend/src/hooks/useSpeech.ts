"use client";
import { useState, useCallback, useRef } from 'react';

export default function useSpeech() {
    const [transcript, setTranscript] = useState('');
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<any>(null);
    const silenceTimerRef = useRef<any>(null);
    const callbackRef = useRef<{ onResult: (text: string) => void, onSpeechDetect?: () => void } | null>(null);
    const intentActiveRef = useRef(false);  // true = user wants mic ON
    const pausedRef = useRef(false);        // true = temporarily paused (AI speaking)
    const createRecognitionRef = useRef<(() => void) | null>(null);

    // Internal: create & start a fresh recognition session
    const createRecognition = useCallback(() => {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.error('Speech Recognition not supported');
            return;
        }

        // Clean up any existing session
        try { recognitionRef.current?.stop(); } catch (e) {}

        const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setListening(true);
            console.log("🎤 Speech recognition started");
        };

        recognition.onresult = (event: any) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            const current = (finalTranscript || interimTranscript).trim();
            if (!current) return;

            setTranscript(current);

            // Notify that speech is happening right now (for barge-in)
            if (callbackRef.current?.onSpeechDetect) {
                callbackRef.current.onSpeechDetect();
            }

            // Silence detection: wait for pause in speech, then send
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
                if (callbackRef.current && current.length > 0) {
                    console.log("📤 Sending speech:", current);
                    callbackRef.current.onResult(current);
                    setTranscript('');
                }
            }, 900); // 900ms silence = sentence complete
        };

        recognition.onerror = (event: any) => {
            console.warn('Speech recognition error:', event.error);
            // These errors are transient - don't kill the session
            if (['no-speech', 'network', 'aborted'].includes(event.error)) {
                return;
            }
            // Fatal error
            setListening(false);
        };

        recognition.onend = () => {
            console.log("🔇 Speech recognition session ended");
            setListening(false);

            // Auto-restart if the user still intends to be listening
            if (intentActiveRef.current) {
                console.log("♻️ Auto-restarting speech recognition...");
                setTimeout(() => {
                    if (intentActiveRef.current) {
                        try {
                            if (createRecognitionRef.current) {
                                createRecognitionRef.current();
                            }
                        } catch (e) {
                            console.error("Failed to restart recognition:", e);
                        }
                    }
                }, 300);
            }
        };

        try {
            recognition.start();
        } catch (e) {
            console.error("Failed to start recognition:", e);
        }
    }, []);

    createRecognitionRef.current = createRecognition;

    // Public: start listening
    const startListening = useCallback((onResult: (text: string) => void, onSpeechDetect?: () => void) => {
        callbackRef.current = { onResult, onSpeechDetect };
        intentActiveRef.current = true;
        createRecognition();
    }, [createRecognition]);

    // Public: stop listening permanently
    const stopListening = useCallback(() => {
        intentActiveRef.current = false;
        callbackRef.current = null;
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        try { recognitionRef.current?.stop(); } catch (e) {}
        recognitionRef.current = null;
        setListening(false);
        setTranscript('');
    }, []);

    return {
        transcript,
        listening,
        startListening,
        stopListening,
    };
}
