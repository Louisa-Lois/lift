/** One Server-Sent Events frame: an event, or a comment such as the heartbeat. */
export interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

function parseFrame(raw: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) frame.comment = line.slice(1).trim();
    else {
      const colon = line.indexOf(":");
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1).replace(/^ /, "");
      if (field === "id" || field === "event" || field === "data") frame[field] = value;
    }
  }
  return frame;
}

/**
 * Opens a stream over real HTTP (inject can't stream) and reads it frame by frame. Every read
 * has a deadline, so a missing event fails the test instead of hanging it.
 */
export async function openStream(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  async function next(timeoutMs = 5_000): Promise<SseFrame> {
    if (!reader) throw new Error(`no body (status ${response.status})`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return parseFrame(raw);
      }
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no frame within ${timeoutMs} ms`)),
          Math.max(0, deadline - Date.now()),
        );
      });
      try {
        const { value, done } = await Promise.race([reader.read(), timeout]);
        if (done) throw new Error("the stream ended");
        buffer += value;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    response,
    next,
    /** The next frame that is an event, skipping comments. */
    async nextEvent(timeoutMs = 5_000): Promise<SseFrame> {
      for (;;) {
        const frame = await next(timeoutMs);
        if (frame.event || frame.data) return frame;
      }
    },
    close() {
      controller.abort();
    },
  };
}
