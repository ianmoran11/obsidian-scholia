export async function* parseSseStream(resp: Response): AsyncGenerator<string> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n\n")) {
      const eventEnd = buffer.indexOf("\n\n");
      const event = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + 2);

      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) yield delta;
        } catch {
          // ignore malformed
        }
      }
    }

    if (buffer && !buffer.includes("\n\n")) {
      try {
        const json = JSON.parse(buffer);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) yield delta;
        buffer = "";
      } catch {
        // incomplete, wait for more
      }
    }
  }
}
