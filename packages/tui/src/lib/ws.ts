import type { WSEvent } from "./types.js";

export type WSListener = (event: WSEvent) => void;
export type WSStatusListener = (connected: boolean) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private listeners: Set<WSListener> = new Set();
  private statusListeners: Set<WSStatusListener> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = true;

  constructor(private baseUrl: string) {}

  connect(): void {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/api/ws";

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.notifyStatus(true);
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (!data) return;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "pong") return;
        this.notifyListeners(parsed as WSEvent);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.cleanup();
      this.notifyStatus(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnection
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onEvent(listener: WSListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: WSStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private notifyListeners(event: WSEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      listener(connected);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3_000);
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
