import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const api = spawn(process.execPath, ['server.mjs'], { cwd, stdio: 'inherit' });
// Run the CLI with Node directly: spawning npm.cmd fails on Windows without a shell.
const appEnv = { ...process.env };
// PORT belongs to the API; Angular must keep its own --port option.
delete appEnv.PORT;
const app = spawn(process.execPath, [
  'node_modules/@angular/cli/bin/ng.js', 'serve', ...process.argv.slice(2),
], { cwd, env: appEnv, stdio: 'inherit' });
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  app.kill();
  process.exit(exitCode);
}

for (const child of [api, app]) {
  child.once('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.once('exit', (code) => stop(code ?? 1));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
