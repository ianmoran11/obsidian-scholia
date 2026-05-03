export interface DeepInfraTtsRequest {
  text: string;
  model: string;
  voice?: string;
  outputFormat?: "mp3" | "wav";
}

export interface DeepInfraTtsResult {
  audio: ArrayBuffer;
  extension: "mp3" | "wav";
}

export class DeepInfraTtsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DeepInfraTtsError";
  }
}

export class DeepInfraTtsClient {
  constructor(private readonly apiKey: string) {}

  async generateSpeech(
    request: DeepInfraTtsRequest,
    signal?: AbortSignal,
  ): Promise<DeepInfraTtsResult> {
    const model = encodeURIComponent(request.model).replace(/%2F/g, "/");
    const body: Record<string, string> = {
      text: request.text,
      output_format: request.outputFormat ?? "mp3",
    };
    if (request.voice?.trim()) {
      body.voice = request.voice.trim();
    }

    const response = await fetch(
      `https://api.deepinfra.com/v1/inference/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      },
    );

    if (!response.ok) {
      throw new DeepInfraTtsError(
        await this.readErrorMessage(response),
        response.status,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return this.readJsonAudio(await response.json());
    }

    return {
      audio: await response.arrayBuffer(),
      extension: contentType.includes("wav") ? "wav" : "mp3",
    };
  }

  private readJsonAudio(data: unknown): DeepInfraTtsResult {
    const audio = (data as { audio?: unknown }).audio;
    if (typeof audio !== "string") {
      throw new Error("DeepInfra TTS response did not include audio data.");
    }

    const match = audio.match(/^data:([^;]+);base64,(.*)$/);
    const base64 = match ? match[2] : audio;
    const mime = match?.[1] ?? "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return {
      audio: bytes.buffer,
      extension: mime.includes("wav") ? "wav" : "mp3",
    };
  }

  private async readErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const data = await response.json();
        const detail = data?.detail ?? data?.error?.message ?? data?.message;
        if (typeof detail === "string" && detail.trim()) {
          return detail;
        }
      } catch {
        // Fall through to status text.
      }
    }

    const text = await response.text().catch(() => "");
    return text.trim() || `DeepInfra TTS failed with HTTP ${response.status}`;
  }
}
