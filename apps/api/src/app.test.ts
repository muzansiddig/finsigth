import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from './app.js';

describe('document upload API', () => {
  let uploadDirectory: string;
  let app: ReturnType<typeof createApp>;

  before(async () => {
    uploadDirectory = await mkdtemp(join(tmpdir(), 'finsight-upload-test-'));
    app = createApp({ uploadDirectory });
  });

  after(async () => {
    await rm(uploadDirectory, { recursive: true, force: true });
  });

  it('stores a real PDF using a generated id and serves it as an attachment', async () => {
    const file = Buffer.from('%PDF-1.7\nFinSight test document\n%%EOF');
    const upload = await request(app)
      .post('/api/documents')
      .attach('file', file, { filename: 'invoice.pdf', contentType: 'application/pdf' });

    assert.equal(upload.status, 201);
    assert.deepEqual(
      {
        originalName: upload.body.data.originalName,
        contentType: upload.body.data.contentType,
        status: upload.body.data.status,
      },
      { originalName: 'invoice.pdf', contentType: 'application/pdf', status: 'uploaded' },
    );
    assert.match(upload.body.data.id, /^[0-9a-f-]{36}$/i);

    const download = await request(app).get(upload.body.data.downloadUrl);
    assert.equal(download.status, 200);
    assert.match(download.headers['content-type'], /application\/pdf/);
    assert.equal(download.headers['content-disposition'], 'attachment');
    assert.deepEqual(download.body, file);
  });

  it('rejects files whose bytes do not match their declared media type', async () => {
    const response = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('not a pdf'), { filename: 'invoice.pdf', contentType: 'application/pdf' });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /contents do not match/);
  });

  it('rejects unsupported file types', async () => {
    const response = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('plain text'), { filename: 'invoice.txt', contentType: 'text/plain' });

    assert.equal(response.status, 415);
    assert.match(response.body.message, /Unsupported file type/);
  });

  it('requires a file and safely reports missing documents', async () => {
    const uploadResponse = await request(app).post('/api/documents');
    const missingResponse = await request(app).get('/api/documents/00000000-0000-4000-8000-000000000000/file');

    assert.equal(uploadResponse.status, 400);
    assert.equal(missingResponse.status, 404);
  });
});
