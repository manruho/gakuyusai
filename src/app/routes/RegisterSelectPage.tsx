import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const stations = [
  { id: 1, color: '赤' },
  { id: 2, color: '青' },
  { id: 3, color: '緑' },
  { id: 4, color: '水色' },
] as const;

export function RegisterSelectPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const select = async (registerId: number) => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/staff/register/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registerId }),
      });
      const raw = await response.text();
      let json: { ok: true } | { ok: false; error: { message: string } };
      try {
        json = JSON.parse(raw) as typeof json;
      } catch {
        throw new Error(`サーバーが応答できませんでした（HTTP ${response.status}）。`);
      }
      if (!json.ok) throw new Error(json.error.message);
      navigate('/staff/register', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'レジを選択できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page-form">
      <section className="panel register-choice-panel">
        <p className="eyebrow">Register Setup</p>
        <h1>使用するレジを選択してください</h1>
        <p className="small">レジ番号と色紙の色を確認して選択してください。</p>
        <div className="register-choice-grid">
          {stations.map((station) => (
            <button key={station.id} type="button" onClick={() => void select(station.id)} disabled={busy}>
              <strong>レジ{station.id}</strong>
              <span>受取{station.id}</span>
              <small>色紙：{station.color}</small>
            </button>
          ))}
        </div>
        {message ? <p className="error">{message}</p> : null}
      </section>
    </main>
  );
}
