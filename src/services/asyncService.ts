export interface AsyncVoice {
  voice_id: string;
  name: string;
  description: string;
  language: string;
  gender: 'Male' | 'Female' | 'Neutral' | 'Unspecified';
  accent: string;
  style: string;
  created_at: string;
  updated_at: string;
  voice_type: 'PREDEFINED' | 'CUSTOM';
}

export const generateAsyncSpeech = async (text: string, voiceId: string, apiKey?: string | null): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/tts/ws${apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''}`;
    const socket = new WebSocket(wsUrl);
    let audioData = new Uint8Array(0);
    let resolved = false;

    socket.onopen = () => {
      // 1. initializeConnection
      socket.send(JSON.stringify({
        model_id: "async_flash_v1.0",
        voice: {
          mode: "id",
          id: voiceId
        },
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: 44100
        }
      }));

      // 2. sendText
      socket.send(JSON.stringify({
        transcript: text + " "
      }));

      // 3. terminate
      socket.send(JSON.stringify({
        terminate: true
      }));
    };

    socket.onmessage = async (event) => {
      if (resolved) return;
      try {
        let textData: string;
        if (event.data instanceof Blob) {
          textData = await event.data.text();
        } else if (typeof event.data === 'string') {
          textData = event.data;
        } else {
          textData = new TextDecoder().decode(event.data);
        }

        const data = JSON.parse(textData);

        if (data.error_code) {
          resolved = true;
          reject(new Error(`Async TTS Error (${data.error_code}): ${data.message}`));
          socket.close();
          return;
        }
        
        if (data.audio) {
          const binaryString = window.atob(data.audio);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const newAudioData = new Uint8Array(audioData.length + bytes.length);
          newAudioData.set(audioData);
          newAudioData.set(bytes, audioData.length);
          audioData = newAudioData;
        }

        if (data.final === true) {
          resolved = true;
          // Convert PCM to WAV for browser playback
          const wavBuffer = encodeWAV(audioData, 44100);
          const blob = new Blob([wavBuffer], { type: 'audio/wav' });
          resolve(blob);
          socket.close();
        }
      } catch (e) {
        console.error("Error parsing WS message:", e);
      }
    };

    socket.onerror = (error) => {
      if (resolved) return;
      console.error("WebSocket error:", error);
      resolved = true;
      reject(new Error("WebSocket connection failed"));
    };

    socket.onclose = (event) => {
      if (resolved) return;
      if (!event.wasClean) {
        resolved = true;
        reject(new Error(`WebSocket closed unexpectedly: ${event.code}`));
      }
    };
  });
};

function encodeWAV(samples: Uint8Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length, true);

  const samplesArray = new Uint8Array(buffer, 44);
  samplesArray.set(samples);

  return buffer;
}

export const listAsyncVoices = async (params: any = {}, apiKey?: string | null): Promise<AsyncVoice[]> => {
  const response = await fetch('/api/voices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...params, apiKey }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voices: ${response.statusText}`);
  }

  const data = await response.json();
  return data.voices;
};

export const getAsyncVoice = async (voiceId: string, apiKey?: string | null): Promise<AsyncVoice> => {
  const url = `/api/voices/${voiceId}${apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voice details: ${response.statusText}`);
  }

  return await response.json();
};
