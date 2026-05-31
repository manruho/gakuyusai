import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = (await response.json()) as
      | { ok: true; data: { role: 'admin' | 'owner' } }
      | { ok: false; error: { message: string } };
    if (!json.ok) {
      setError(json.error.message);
      return;
    }
    navigate('/admin', { replace: true });
  };

  return (
    <main className="page page-form">
      <form className="panel" onSubmit={onSubmit}>
        <h1>ログイン</h1>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">ログイン</button>
        <p className="small">admin / owner は /admin に移動します。</p>
      </form>
    </main>
  );
}
