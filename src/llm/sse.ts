async function* processEvent(event: string): AsyncGenerator<string> {
  for (const rawLine of event.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trimStart();
    if (payload === "[DONE]") return;

    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        yield delta;
      }
    } catch {
      // Ignore malformed JSON payloads and continue.
    }
  }
}

export async function* parseSseStream(resp: Response): AsyncGenerator<string> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let eventEnd = buffer.search(/\r?\n\r?\n/);
    while (eventEnd !== -1) {
      const separatorMatch = buffer.slice(eventEnd).match(/^\r?\n\r?\n/);
      const separatorLength = separatorMatch?.[0].length ?? 2;
      const event = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + separatorLength);

      for await (const chunk of processEvent(event)) {
        yield chunk;
      }

      eventEnd = buffer.search(/\r?\n\r?\n/);
    }
  }

  if (buffer.trim().length > 0) {
    for await (const chunk of processEvent(buffer)) {
      yield chunk;
    }
  }
}
