import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminPage } from './routes/AdminPage';
import { LoginPage } from './routes/LoginPage';
import { PublicPage } from './routes/PublicPage';
import { RegisterPage } from './routes/RegisterPage';
import { StockPage } from './routes/StockPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/staff/register" element={<RegisterPage />} />
      <Route path="/staff/stock" element={<StockPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

