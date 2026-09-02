export async function readBoundedText(response, maximumBytes, tooLargeMessage = "HTTP response exceeded the safety limit.") {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error(tooLargeMessage);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(tooLargeMessage);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
