import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const port = Number(process.env.PORT ?? 3000);
const recordsFile = join(process.cwd(), 'data', 'care-records.json');
const petsFile = join(process.cwd(), 'data', 'pets.json');
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

async function getRecords(file = recordsFile) {
  try {
    const content = await readFile(file, 'utf8');
    const records = JSON.parse(content);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function saveRecords(records, file = recordsFile) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(records, null, 2), 'utf8');
}

/** Serializes writes so concurrent POSTs cannot lose a record. */
function createRecord(record, file = recordsFile) {
  const operation = recordWriteQueue.then(async () => {
    const records = await getRecords(file);
    const existingRecord = records.find((item) => item.id === record.id);
    if (existingRecord) {
      return { record: existingRecord, duplicate: true };
    }

    records.push(record);
    await saveRecords(records, file);
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


    if (request.method === 'GET' && url.pathname === '/api/pets') {
      sendJson(response, 200, await getRecords(petsFile));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/pets') {
      let value;
      try { value = JSON.parse(await readBody(request)); }
      catch {
        sendJson(response, 400, { error: 'Invalid JSON body.' });
        return;
      }
      if (
        !value || typeof value !== 'object' ||
        typeof value.id !== 'string' || !value.id.trim() ||
        typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 ||
        !['Perro', 'Gato', 'Ave', 'Conejo', 'Otro'].includes(value.species) ||
        typeof value.breed !== 'string' || value.breed.length > 80 ||
        !['Hembra', 'Macho', 'Sin especificar'].includes(value.sex) ||
        !(value.ageYears === null || (Number.isInteger(value.ageYears) && value.ageYears >= 0 && value.ageYears <= 200)) ||
        !(value.weightKg === null || (typeof value.weightKg === 'number' && Number.isFinite(value.weightKg) && value.weightKg > 0)) ||
        typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
      ) {
        sendJson(response, 400, { error: 'A valid pet profile is required.' });
        return;
      }
      const pet = {
        id: value.id, name: value.name.trim(), species: value.species,
        breed: value.breed.trim(), sex: value.sex, ageYears: value.ageYears,
        weightKg: value.weightKg, createdAt: value.createdAt,
      };
      const result = await createRecord(pet, petsFile);
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
  console.log(`PetCare API ready at http://localhost:${server.address().port}`);
});
