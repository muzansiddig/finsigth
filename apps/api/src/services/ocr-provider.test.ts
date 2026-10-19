import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalOcrProvider, OcrProviderError } from './ocr-provider.js';

const result = {
  provider: 'tesseract-local',
  engineVersion: '5.3.0',
  languages: 'eng+ara',
  pages: [{
    pageNumber: 1,
    text: 'Invoice 42',
    tokens: [{
      text: '42',
      confidence: 0.9,
      box: { x: 1, y: 2, width: 3, height: 4 },
    }],
  }],
  text: 'Invoice 42',
};

describe('LocalOcrProvider', () => {
  it('sends document bytes to the local engine and validates page evidence', async () => {
    const provider = new LocalOcrProvider('http://localhost:58000', async (input, init) => {
      assert.equal(input, 'http://localhost:58000/ocr');
      assert.equal(init?.method, 'POST');
      assert.ok(init?.body instanceof FormData);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    assert.deepEqual(await provider.extract({
      contents: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
    }), result);
  });

  it('reports unavailable services and rejects malformed provider output', async () => {
    const unavailable = new LocalOcrProvider('http://localhost:58000', async () => {
      throw new Error('connection refused');
    });
    await assert.rejects(
      unavailable.extract({ contents: Buffer.from('file'), contentType: 'image/png' }),
      (error: unknown) => error instanceof OcrProviderError && error.unavailable,
    );

    const malformed = new LocalOcrProvider('http://localhost:58000', async () => new Response('{}', { status: 200 }));
    await assert.rejects(
      malformed.extract({ contents: Buffer.from('file'), contentType: 'image/png' }),
      (error: unknown) => error instanceof OcrProviderError && !error.unavailable,
    );
  });

  it('rejects empty or oversized documents before making a request', async () => {
    let requestCount = 0;
    const provider = new LocalOcrProvider('http://localhost:58000', async () => {
      requestCount += 1;
      return new Response(JSON.stringify(result), { status: 200 });
    });
    await assert.rejects(provider.extract({ contents: Buffer.alloc(0), contentType: 'image/png' }), OcrProviderError);
    await assert.rejects(
      provider.extract({ contents: Buffer.alloc(12 * 1024 * 1024 + 1), contentType: 'image/png' }),
      OcrProviderError,
    );
    assert.equal(requestCount, 0);
  });
});
