import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const port = Number(process.env.PORT ?? 3000);
const recordsFile = join(process.cwd(), 'data', 'care-records.json');
const maxBodySize = 1_000_000;
let recordWriteQueue = Promise.resolve();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    // Local development API: no credentials are used.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function getRecords() {
  try {
    const content = await readFile(recordsFile, 'utf8');
    const records = JSON.parse(content);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveRecords(records) {
  await mkdir(dirname(recordsFile), { recursive: true });
  await writeFile(recordsFile, JSON.stringify(records, null, 2), 'utf8');
}

/** Serializes writes so concurrent POSTs cannot lose a record. */
function createRecord(record) {
  const operation = recordWriteQueue.then(async () => {
    const records = await getRecords();
    const existingRecord = records.find((item) => item.id === record.id);
    if (existingRecord) {
      return { record: existingRecord, duplicate: true };
    }

    records.push(record);
    await saveRecords(records);
    return { record, duplicate: false };
  });

  // A rejected write must not block later queued records.
  recordWriteQueue = operation.catch(() => undefined);
  return operation;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBodySize) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/care-records') {
      sendJson(response, 200, await getRecords());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/care-records') {
      const record = JSON.parse(await readBody(request));
      if (
        !record ||
        typeof record !== 'object' ||
        typeof record.id !== 'string' ||
        typeof record.petName !== 'string' ||
        typeof record.description !== 'string' ||
        typeof record.createdAt !== 'string' ||
        !record.id ||
        !record.petName ||
        !record.description ||
        !record.createdAt
      ) {
        sendJson(response, 400, { error: 'A complete care record is required.' });
        return;
      }

      const result = await createRecord(record);
      sendJson(response, result.duplicate ? 200 : 201, result);
      return;
    }

    sendJson(response, 404, { error: 'Route not found.' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Unable to process the request.' });
  }
});

server.listen(port, () => {
  console.log(`PetCare API ready at http://localhost:${port}`);
});
