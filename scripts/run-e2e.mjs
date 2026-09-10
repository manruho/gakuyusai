import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
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

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = run(command, args);
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await runOnce('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);
const currentBranch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const previewBranch = currentBranch && currentBranch !== 'main' ? currentBranch : 'e2e-preview';
const dev = run('npx', [
  'wrangler', 'pages', 'dev', 'dist',
  '--binding', 'PREVIEW_AUTH_BYPASS=true',
  '--binding', `CF_PAGES_BRANCH=${previewBranch}`,
  '--port', '4173',
]);

try {
  await waitForPort(4173);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const apiResponse = await page.request.get('http://127.0.0.1:4173/api/public/status');
  if (!apiResponse.ok()) throw new Error(`公開APIがHTTP ${apiResponse.status()}を返しました`);
  const apiJson = await apiResponse.json();
  if (apiJson.ok !== true) throw new Error('公開APIが正常応答を返しませんでした');

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: '文化祭食品販売' }).isVisible())) {
    throw new Error('公開ページの見出しが表示されていません');
  }
  if (!(await page.getByText('最新の販売状況は自動で更新されます。').isVisible())) {
    throw new Error('公開ページの自動更新案内がありません');
  }

  await page.goto('http://127.0.0.1:4173/login', { waitUntil: 'networkidle' });
  if (!(await page.getByRole('heading', { name: 'ログイン' }).isVisible())) {
    throw new Error('ログイン画面の見出しが表示されていません');
  }
  if (!(await page.getByRole('button', { name: 'ログイン' }).isVisible())) {
    throw new Error('ログインボタンが表示されていません');
  }

  await page.goto('http://127.0.0.1:4173/staff/register/select', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /レジ1/ }).click();
  await page.getByRole('heading', { name: '商品を選ぶ' }).waitFor();
  const availableProduct = page.locator('.product-main-button:not([disabled])').first();
  if (!(await availableProduct.isVisible())) throw new Error('会計テストに使える在庫あり商品がありません');
  await availableProduct.click();
  await page.getByRole('button', { name: '会計へ進む' }).click();
  await page.getByRole('heading', { name: 'お会計' }).waitFor();
  await page.getByRole('button', { name: '商品選択へ戻る' }).click();
  await page.getByRole('heading', { name: '商品を選ぶ' }).waitFor();
  await page.getByRole('button', { name: '会計へ進む' }).click();
  await page.getByRole('button', { name: 'ちょうど' }).click();
  await page.getByRole('button', { name: 'お会計確定' }).click();
  await page.getByRole('heading', { name: '会計が完了しました' }).waitFor();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'この会計を取り消す' }).click();
  await page.getByRole('heading', { name: '商品を選ぶ' }).waitFor();

  await browser.close();
  console.log('E2E passed');
} finally {
  dev.kill('SIGTERM');
}
