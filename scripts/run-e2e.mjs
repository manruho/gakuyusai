import { spawn } from 'node:child_process';
import net from 'node:net';
import { chromium } from 'playwright';

function waitForPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection(port, host);
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => setTimeout(attempt, 250));
    };
    attempt();
  });
}

function run(command, args) {
  return spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
}

const dev = run('npx', ['vite', '--host', '127.0.0.1', '--port', '4173']);

try {
  await waitForPort(4173);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: '文化祭食品販売' }).isVisible())) {
    throw new Error('公開ページの見出しが表示されていません');
  }
  if (!(await page.getByText('最終更新').isVisible())) {
    throw new Error('公開ページの最終更新が表示されていません');
  }

  await page.goto('http://127.0.0.1:4173/login', { waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: 'ログイン' }).isVisible())) {
    throw new Error('ログイン画面の見出しが表示されていません');
  }
  if (!(await page.getByRole('button', { name: 'ログイン' }).isVisible())) {
    throw new Error('ログインボタンが表示されていません');
  }

  await browser.close();
  console.log('E2E passed');
} finally {
  dev.kill('SIGTERM');
}
