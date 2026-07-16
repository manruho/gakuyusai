import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

type LoginTarget = 'staff' | 'pickup' | 'admin' | 'owner';

const targets: Array<{ id: LoginTarget; label: string; description: string }> = [
  { id: 'staff', label: 'レジ', description: '販売・会計を行う' },
  { id: 'pickup', label: '受取', description: '商品の受け渡しを行う' },
  { id: 'admin', label: '管理者', description: '在庫・販売状況を確認する' },
  { id: 'owner', label: '責任者', description: '商品・設定を管理する' },
];

export function LoginPage() {
  const navigate = useNavigate();
  const [target, setTarget] = useState<LoginTarget | null>(null);
  const [stationId, setStationId] = useState(1);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target) return;
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginTarget: target, stationId: target === 'pickup' ? stationId : undefined, password }),
      });
      const json = (await response.json()) as
        | { ok: true; data: { role: 'staff' | 'pickup' | 'admin' | 'owner' } }
        | { ok: false; error: { message: string } };
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      navigate(json.data.role === 'staff' ? '/staff/register/select' : json.data.role === 'pickup' ? '/pickup' : '/admin', { replace: true });
    } catch {
      setError('ログインに失敗しました。通信状態を確認してください。');
    }
  };

  return (
    <main className="page page-form">
      <form className="panel login-panel" onSubmit={onSubmit}>
        <h1>ログイン</h1>
        <p className="small">利用する担当を選択してください。</p>
        <div className="login-target-grid" aria-label="ログインする担当を選択">
          {targets.map((item) => (
            <button
              key={item.id}
              type="button"
              className={target === item.id ? 'login-target is-selected' : 'login-target'}
              onClick={() => { setTarget(item.id); setPassword(''); setError(''); }}
              aria-pressed={target === item.id}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        {target === 'pickup' ? (
          <label>
            受取場所
            <select value={stationId} onChange={(event) => setStationId(Number(event.target.value))}>
              {[1, 2, 3, 4].map((id) => <option key={id} value={id}>受取{id}</option>)}
            </select>
          </label>
        ) : null}
        {target ? (
          <label>
            パスワード
            <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={!target || !password}>ログイン</button>
      </form>
    </main>
  );
}
