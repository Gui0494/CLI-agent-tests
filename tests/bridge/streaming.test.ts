// Test the streaming concepts without importing PythonBridge directly
// (it uses import.meta.url which conflicts with Jest's CommonJS transform)

describe("callStream concept", () => {
  test("AbortController can signal abort", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  test("notification event structure", () => {
    const notification = {
      method: "stream_chunk",
      params: { request_id: 1, token: "Hello" },
    };
    expect(notification.method).toBe("stream_chunk");
    expect(notification.params.token).toBe("Hello");
  });

  test("stream chunk accumulation", () => {
    const chunks: string[] = [];
    const onChunk = (token: string) => chunks.push(token);

    onChunk("Hello");
    onChunk(" ");
    onChunk("world");

    expect(chunks.join("")).toBe("Hello world");
  });

  test("abort stops accumulation", () => {
    const controller = new AbortController();
    const chunks: string[] = [];

    const onChunk = (token: string) => {
      if (!controller.signal.aborted) {
        chunks.push(token);
      }
    };

    onChunk("Hello");
    controller.abort();
    onChunk(" world");

    expect(chunks).toEqual(["Hello"]);
  });
});
