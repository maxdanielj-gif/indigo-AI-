export class AsyncWebSocketService {
  private ws: WebSocket | null = null;
  private onAudio: (audio: string, contextId: string, final: boolean) => void;
  private onError: (error: string) => void;

  constructor(
    onAudio: (audio: string, contextId: string, final: boolean) => void,
    onError: (error: string) => void
  ) {
    this.onAudio = onAudio;
    this.onError = onError;
  }

  connect() {
    this.ws = new WebSocket(`ws://${window.location.host}/api/tts/ws`);
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.audio !== undefined) {
          this.onAudio(data.audio, data.context_id, data.final);
        } else if (data.error_code) {
          this.onError(data.message);
        }
      } catch (e) {
        console.error("Error parsing WebSocket message", e);
      }
    };

    this.ws.onerror = (event) => {
      this.onError("WebSocket error occurred");
    };
  }

  send(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.onError("WebSocket is not open");
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
