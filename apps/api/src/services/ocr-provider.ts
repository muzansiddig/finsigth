import { z } from 'zod';

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const tokenSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  box: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  }),
});
const pageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  tokens: z.array(tokenSchema),
});
const ocrResultSchema = z.object({
  provider: z.literal('tesseract-local'),
  engineVersion: z.string().min(1),
  languages: z.literal('eng+ara'),
  pages: z.array(pageSchema).min(1).max(20),
  text: z.string(),
});

export type OcrResult = z.infer<typeof ocrResultSchema>;
export interface OcrProvider {
  extract(input: {
    contents: Buffer;
    contentType: string;
  }): Promise<OcrResult>;
}

export class OcrProviderError extends Error {
  constructor(message: string, readonly unavailable = false) {
    super(message);
    this.name = 'OcrProviderError';
  }
}

export class LocalOcrProvider implements OcrProvider {
  constructor(
    private readonly endpoint = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:58000',
    private readonly request: typeof fetch = fetch,
  ) {}

  async extract(input: { contents: Buffer; contentType: string }): Promise<OcrResult> {
    if (input.contents.length === 0 || input.contents.length > MAX_DOCUMENT_BYTES) {
      throw new OcrProviderError('Document size is outside the OCR processing limit.');
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([Uint8Array.from(input.contents)], { type: input.contentType }),
      'document',
    );
    let response: Response;
    try {
      response = await this.request(`${this.endpoint}/ocr`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new OcrProviderError('Local OCR service is unavailable.', true);
    }
    if (!response.ok) {
      throw new OcrProviderError(
        response.status === 503
          ? 'Local OCR service is unavailable or busy.'
          : `Local OCR could not process this document (HTTP ${response.status}).`,
        response.status === 503,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OcrProviderError('Local OCR returned an invalid response.');
    }
    const parsed = ocrResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new OcrProviderError('Local OCR returned an invalid response.');
    }
    return parsed.data;
  }
}
