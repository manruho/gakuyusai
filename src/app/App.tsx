import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './routes/ProtectedRoute';

const AdminPage = lazy(async () => ({ default: (await import('./routes/AdminPage')).AdminPage }));
const LoginPage = lazy(async () => ({ default: (await import('./routes/LoginPage')).LoginPage }));
const PublicPage = lazy(async () => ({ default: (await import('./routes/PublicPage')).PublicPage }));
const RegisterPage = lazy(async () => ({ default: (await import('./routes/RegisterPage')).RegisterPage }));
const StockPage = lazy(async () => ({ default: (await import('./routes/StockPage')).StockPage }));
const RegisterSelectPage = lazy(async () => ({ default: (await import('./routes/RegisterSelectPage')).RegisterSelectPage }));
const RecentSalesPage = lazy(async () => ({ default: (await import('./routes/RecentSalesPage')).RecentSalesPage }));
const PickupPage = lazy(async () => ({ default: (await import('./routes/PickupPage')).PickupPage }));
const FulfillmentAdminPage = lazy(async () => ({ default: (await import('./routes/FulfillmentAdminPage')).FulfillmentAdminPage }));

const staffArea = ['staff', 'admin', 'owner'] as const;
const adminArea = ['admin', 'owner'] as const;
const ownerArea = ['owner'] as const;
const pickupArea = ['pickup', 'admin', 'owner'] as const;

export function App() {
  return (
    <Suspense fallback={<main className="page page-form"><p className="small">画面を読み込んでいます…</p></main>}>
      <Routes>
      <Route path="/" element={<PublicPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/staff/register/select" element={<ProtectedRoute allow={[...staffArea]}><RegisterSelectPage /></ProtectedRoute>} />
      <Route path="/staff/register" element={<ProtectedRoute allow={[...staffArea]}><RegisterPage /></ProtectedRoute>} />
      <Route path="/staff/register/recent-sales" element={<ProtectedRoute allow={[...staffArea]}><RecentSalesPage /></ProtectedRoute>} />
      <Route path="/staff/stock" element={<ProtectedRoute allow={[...adminArea]}><StockPage /></ProtectedRoute>} />
      <Route path="/pickup" element={<ProtectedRoute allow={[...pickupArea]}><PickupPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute allow={[...adminArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/sales" element={<ProtectedRoute allow={[...adminArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/inventory" element={<ProtectedRoute allow={[...adminArea]}><StockPage /></ProtectedRoute>} />
      <Route path="/admin/products" element={<ProtectedRoute allow={[...ownerArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute allow={[...ownerArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/fulfillment" element={<ProtectedRoute allow={[...adminArea]}><FulfillmentAdminPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
