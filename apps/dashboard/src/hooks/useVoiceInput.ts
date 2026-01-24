'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getControlPlaneToken } from '@/lib/wsToken';

interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence: number;
}

interface UseVoiceInputOptions {
  onTranscript?: (transcript: TranscriptResult) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (error: string) => void;
  onSpectrum?: (levels: number[]) => void;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isConnecting: boolean;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
  clearTranscript: () => void;
}

/**
 * Voice input hook that connects to the voice transcription WebSocket
 * and handles microphone capture.
 */
export function useVoiceInput({
  onTranscript,
  onFinalTranscript,
  onError,
  onSpectrum,
}: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const spectrumRafRef = useRef<number | null>(null);

  const stopListening = useCallback(() => {
    if (spectrumRafRef.current) {
      cancelAnimationFrame(spectrumRafRef.current);
      spectrumRafRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Stop media recorder
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsListening(false);
    setIsConnecting(false);
    setInterimTranscript('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const startSpectrum = useCallback(
    (stream: MediaStream) => {
      if (!onSpectrum) return;
      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const bars = 10;

        const update = () => {
          analyser.getByteFrequencyData(dataArray);
          const levels = Array.from({ length: bars }, (_, i) => {
            const start = Math.floor((i * bufferLength) / bars);
            const end = Math.floor(((i + 1) * bufferLength) / bars);
            let sum = 0;
            for (let j = start; j < end; j += 1) {
              sum += dataArray[j];
            }
            const avg = sum / Math.max(1, end - start);
            return Math.min(1, avg / 255);
          });
          onSpectrum(levels);
          spectrumRafRef.current = requestAnimationFrame(update);
        };

        update();
      } catch {
        // Ignore spectrum failures
      }
    },
    [onSpectrum]
  );

  const startListening = useCallback(async () => {
    if (isListening || isConnecting) return;

    setError(null);
    setIsConnecting(true);

    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Get auth token
      const token = await getControlPlaneToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Connect to WebSocket
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/v1/voice/transcribe?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnecting(false);
        setIsListening(true);

        // Start recording
        try {
          const preferredTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
          ];
          const mimeType = preferredTypes.find((type) =>
            typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
          );
          const mediaRecorder = new MediaRecorder(
            stream,
            mimeType ? { mimeType } : undefined
          );
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(event.data);
            }
          };

          // Send chunks every 250ms for real-time transcription
          mediaRecorder.start(250);

          startSpectrum(stream);
        } catch (err) {
          throw new Error('Failed to start recording');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'transcript') {
            const result: TranscriptResult = {
              text: data.text,
              isFinal: data.isFinal,
              confidence: data.confidence,
            };

            onTranscript?.(result);

            if (data.isFinal && data.text) {
              setTranscript((prev) => {
                const next = prev + (prev ? ' ' : '') + data.text;
                onFinalTranscript?.(next);
                return next;
              });
              setInterimTranscript('');
            } else {
              setInterimTranscript(data.text);
            }
          } else if (data.type === 'error') {
            const errMsg = data.message || 'Transcription error';
            setError(errMsg);
            onError?.(errMsg);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        const errMsg = 'WebSocket connection error';
        setError(errMsg);
        onError?.(errMsg);
        stopListening();
      };

      ws.onclose = (event) => {
        if (event.code !== 1000) {
          const errMsg = event.reason || 'Connection closed unexpectedly';
          setError(errMsg);
          onError?.(errMsg);
        }
        stopListening();
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to start voice input';
      setError(errMsg);
      onError?.(errMsg);
      setIsConnecting(false);
      stopListening();
    }
  }, [isListening, isConnecting, onTranscript, onFinalTranscript, onError, startSpectrum, stopListening]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    isConnecting,
    error,
    startListening,
    stopListening,
    clearTranscript,
  };
}
