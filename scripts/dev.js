/**
 * `npm run start:dev` — runs NestJS (watch mode, port 5001) and the Python FastAPI service
 * (python_service, port 8000) together in one terminal. Ctrl+C stops both.
 *
 *   PYTHON_BIN=python3 npm run start:dev     # override the Python executable
 *   SKIP_PYTHON=1 npm run start:dev          # NestJS only
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWin = process.platform === 'win32';
const backendDir = path.resolve(__dirname, '..');
const pythonDir = path.resolve(backendDir, '..', 'python_service');
const children = [];

function freePort(port) {
  // Stale processes from a previous run (e.g. a crashed terminal) would otherwise hold the port.
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr ":${port} " | findstr LISTENING`, { encoding: 'utf8' });
      const pids = [...new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p) && p !== '0'))];
      for (const pid of pids) execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } else {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore', shell: '/bin/sh' });
    }
  } catch {
    // nothing listening
  }
}

function run(name, color, cmd, args, cwd, extraEnv = {}) {
  const env = { ...process.env, FORCE_COLOR: '1', PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...extraEnv };
  const child = spawn(cmd, args, { cwd, shell: true, env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) out.write(tag + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => process.stdout.write(`${tag}exited with code ${code}\n`));
  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    try {
      if (isWin) execSync(`taskkill /PID ${c.pid} /F /T`, { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {}
  }
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

freePort(process.env.PORT || 5001);

if (!process.env.SKIP_PYTHON && fs.existsSync(path.join(pythonDir, 'app.py'))) {
  const pythonPort = String(process.env.PYTHON_PORT || 8000);
  freePort(pythonPort);
  // app.py reads PORT too — pin it so it never collides with NestJS's PORT.
  // --reload: editing any python_service .py file restarts it (like nest --watch), so a stale
  // process never keeps serving old routes.
  run(
    'python',
    '35',
    process.env.PYTHON_BIN || (isWin ? 'python' : 'python3'),
    ['-m', 'uvicorn', 'app:app', '--host', '0.0.0.0', '--port', pythonPort, '--reload'],
    pythonDir,
    { PORT: pythonPort },
  );
} else {
  console.log('[dev] python_service skipped');
}

const nest = run('nest', '36', 'npx', ['nest', 'start', '--watch'], backendDir);
nest.on('exit', (code) => {
  stopAll();
  process.exit(code ?? 0);
});
