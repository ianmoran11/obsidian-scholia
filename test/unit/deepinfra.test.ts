import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepInfraTtsClient } from "../../src/audio/deepinfra";

describe("DeepInfraTtsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends TTS text with bearer auth and does not put the key in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeepInfraTtsClient("secret-key");
    const result = await client.generateSpeech({
      text: "Read this",
      model: "hexgrad/Kokoro-82M",
      voice: "af_heart",
    });

    expect(result.audio.byteLength).toBe(3);
    expect(result.extension).toBe("mp3");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M");
    expect(init.headers.Authorization).toBe("Bearer secret-key");
    expect(init.body).not.toContain("secret-key");
    expect(JSON.parse(init.body)).toEqual({
      output_format: "mp3",
      text: "Read this",
      voice: "af_heart",
    });
  });

  it("decodes JSON data URI audio responses", async () => {
    const wavBytes = new Uint8Array([82, 73, 70, 70]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          audio: `data:audio/wav;base64,${Buffer.from(wavBytes).toString("base64")}`,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new DeepInfraTtsClient("secret-key").generateSpeech({
      text: "Read this",
      model: "hexgrad/Kokoro-82M",
    });

    expect(Array.from(new Uint8Array(result.audio))).toEqual([82, 73, 70, 70]);
    expect(result.extension).toBe("wav");
  });
});
