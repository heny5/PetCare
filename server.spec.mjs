import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('pet API persists, validates and deduplicates profiles independently of care records', { timeout: 20_000 }, async (t) => {
  const tempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'petcare-api-test-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: directory, env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const ended = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
    // Only remove the exact temporary directory created by this test.
    assert.equal(dirname(resolve(directory)), tempRoot);
    assert.ok(basename(directory).startsWith('petcare-api-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const base = await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('API startup timed out: ' + stderr)), 10_000);
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolveReady('http://127.0.0.1:' + match[1]);
      }
    });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('API exited: ' + stderr)); });
  });
  const pet = {
    id: 'pet-coco', name: ' Coco ', species: 'Gato', breed: ' Mestizo ',
    sex: 'Macho', ageYears: 2, weightKg: 4.5, createdAt: '2026-09-25T12:00:00.000Z',
  };
  const post = (route, body) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  await t.test('creates one durable pet for concurrent requests and repeated delivery', async () => {
    assert.deepEqual(await (await fetch(base + '/api/pets')).json(), []);
    const responses = await Promise.all([post('/api/pets', pet), post('/api/pets', pet)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
    const expected = { ...pet, name: 'Coco', breed: 'Mestizo' };
    assert.deepEqual(await (await fetch(base + '/api/pets')).json(), [expected]);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'data', 'pets.json'), 'utf8')), [expected]);
    assert.equal((await post('/api/pets', pet)).status, 200);
  });
  await t.test('rejects malformed JSON and invalid profile fields without persisting them', async () => {
    for (const invalid of [
      '{', null, { ...pet, name: ' ' }, { ...pet, species: 'invalid' },
      { ...pet, ageYears: -1 }, { ...pet, ageYears: 1.5 }, { ...pet, weightKg: 0 },
      { ...pet, sex: 'invalid' }, { ...pet, createdAt: 'invalid' },
    ]) {
      assert.equal((await post('/api/pets', invalid)).status, 400);
    }
    assert.equal((await (await fetch(base + '/api/pets')).json()).length, 1);
  });
  await t.test('keeps care persistence intact and separate from pet profiles', async () => {
    const care = { id: pet.id, petName: 'Coco', description: 'Paseo', createdAt: pet.createdAt };
    assert.equal((await post('/api/care-records', care)).status, 201);
    assert.deepEqual(await (await fetch(base + '/api/care-records')).json(), [care]);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'data', 'care-records.json'), 'utf8')), [care]);
    assert.equal((await (await fetch(base + '/api/pets')).json()).length, 1);
  });
});
