(() => {
  const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return crc;
  });

  function chunk(type, data) {
    const result = new Uint8Array(data.length + 12);
    const view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set(new TextEncoder().encode(type), 4);
    result.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of result.subarray(4, -4)) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
    return result;
  }

  async function clean(source) {
    const bitmap = await createImageBitmap(source);
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let pixels;
    try {
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, width, height).data;
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }

    // NovelAI uses 254/255 alpha values to carry a hidden bit in opaque areas.
    // Rebuild the PNG with no copied chunks and clear the low bits of all channels.
    let hasTransparency = false;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] < 254) {
        hasTransparency = true;
        break;
      }
    }
    const channels = hasTransparency ? 4 : 3;
    const stride = width * channels + 1;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y += 1) {
      // Filter 1 (Sub) keeps the re-encoded PNG small without changing pixel values.
      const start = stride * y;
      rows[start] = 1;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        for (let c = 0; c < channels; c += 1) {
          const pixel = pixels[index + c] & 254;
          const previous = x ? (pixels[index + c - 4] & 254) : 0;
          rows[start + 1 + x * channels + c] = pixel - previous;
        }
      }
    }
    const stream = new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = 8;
    header[9] = hasTransparency ? 6 : 2;
    return new Blob([
      Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
      chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())
    ], { type: "image/png" });
  }

  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  window.CleanImage = { clean, save };
})();
