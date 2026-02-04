import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import { verifyRequestToken } from '../auth/verify.js';

// Environment variable for Deepgram API key
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

// Track active transcription sessions
const activeSessions = new Map<
  string,
  {
    uiSocket: WebSocket;
    deepgramClient: LiveClient;
    sessionId: string;
  }
>();

/**
 * Register voice transcription WebSocket routes
 * This proxy keeps the Deepgram API key server-side while forwarding
 * audio chunks from the UI and returning transcripts.
 */
export function registerVoiceRoutes(app: FastifyInstance): void {
  app.get('/v1/voice/status', async () => {
    return { available: Boolean(DEEPGRAM_API_KEY) };
  });

  // Voice feature is disabled if no API key is configured
  if (!DEEPGRAM_API_KEY) {
    app.log.info('Voice transcription disabled: DEEPGRAM_API_KEY not set');
    return;
  }

  // WebSocket route for voice transcription
  app.get(
    '/v1/voice/transcribe',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      // Verify authentication (token from query param for WebSocket)
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        socket.close(4002, 'Missing authentication token');
        return;
      }

      // Create mock request with authorization header for verification
      const mockRequest = {
        headers: { authorization: `Bearer ${token}` },
      } as FastifyRequest;

      const user = await verifyRequestToken(mockRequest);
      if (!user) {
        socket.close(4003, 'Invalid authentication token');
        return;
      }

      // Generate session ID
      const sessionId = crypto.randomUUID();

      // Connect to Deepgram
      let deepgramClient: LiveClient;
      try {
        const deepgram = createClient(DEEPGRAM_API_KEY);
        deepgramClient = deepgram.listen.live({
          model: 'nova-2',
          language: 'en',
          smart_format: true,
          interim_results: true,
          punctuate: true,
          encoding: 'opus',
          sample_rate: 48000,
          channels: 1,
        });
      } catch (error) {
        app.log.error({ error }, 'Failed to create Deepgram client');
        socket.close(4010, 'Failed to connect to transcription service');
        return;
      }

      // Store session
      activeSessions.set(sessionId, {
        uiSocket: socket,
        deepgramClient,
        sessionId,
      });

      app.log.info({ sessionId }, 'Voice transcription session started');

      // Handle Deepgram events
      deepgramClient.on(LiveTranscriptionEvents.Open, () => {
        socket.send(JSON.stringify({ type: 'connected' }));
      });

      deepgramClient.on(LiveTranscriptionEvents.Transcript, (data) => {
        try {
          const transcript = data.channel?.alternatives?.[0];
          if (transcript) {
            const isFinal = data.is_final ?? false;
            socket.send(
              JSON.stringify({
                type: 'transcript',
                text: transcript.transcript || '',
                confidence: transcript.confidence || 0,
                isFinal,
              })
            );
          }
        } catch (error) {
          app.log.error({ error, sessionId }, 'Error processing transcript');
        }
      });

      deepgramClient.on(LiveTranscriptionEvents.Error, (error) => {
        app.log.error({ error, sessionId }, 'Deepgram error');
        socket.send(JSON.stringify({ type: 'error', message: 'Transcription error' }));
      });

      deepgramClient.on(LiveTranscriptionEvents.Close, () => {
        app.log.info({ sessionId }, 'Deepgram connection closed');
        cleanupSession(sessionId);
        if (socket.readyState === 1) {
          socket.close(1000, 'Transcription service disconnected');
        }
      });

      // Handle audio chunks from UI
      socket.on('message', (data: Buffer) => {
        const session = activeSessions.get(sessionId);
        if (!session) return;

        try {
          // Check if it's JSON control message or binary audio
          if (data[0] === 0x7b) {
            // Starts with '{', probably JSON
            const json = JSON.parse(data.toString());
            if (json.type === 'close') {
              cleanupSession(sessionId);
              socket.close(1000, 'Session closed by client');
            }
          } else {
            // Binary audio data - forward to Deepgram
            session.deepgramClient.send(bufferToArrayBuffer(data));
          }
        } catch {
          // Assume binary audio data
          session.deepgramClient.send(bufferToArrayBuffer(data));
        }
      });

      socket.on('close', () => {
        app.log.info({ sessionId }, 'Voice WebSocket closed');
        cleanupSession(sessionId);
      });

      socket.on('error', (error: unknown) => {
        app.log.error({ error, sessionId }, 'Voice WebSocket error');
        cleanupSession(sessionId);
      });
    }
  );
}

function bufferToArrayBuffer(data: Buffer): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function cleanupSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    try {
      session.deepgramClient.finish();
    } catch {
      // Ignore cleanup errors
    }
    activeSessions.delete(sessionId);
  }
}
