import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const api = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit' });
const app = spawn(npmCommand, ['run', 'start:app'], { stdio: 'inherit' });
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  api.kill();
  app.kill();
  process.exit(exitCode);
}

api.once('exit', (code) => stop(code ?? 1));
app.once('exit', (code) => stop(code ?? 1));
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());