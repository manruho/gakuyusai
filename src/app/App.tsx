import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminPage } from './routes/AdminPage';
import { LoginPage } from './routes/LoginPage';
import { PublicPage } from './routes/PublicPage';
import { RegisterPage } from './routes/RegisterPage';
import { StockPage } from './routes/StockPage';
import { RegisterSelectPage } from './routes/RegisterSelectPage';
import { RecentSalesPage } from './routes/RecentSalesPage';
import { PickupPage } from './routes/PickupPage';
import { FulfillmentAdminPage } from './routes/FulfillmentAdminPage';
import { ProtectedRoute } from './routes/ProtectedRoute';

const staffArea = ['staff', 'admin', 'owner'] as const;
const adminArea = ['admin', 'owner'] as const;
const pickupArea = ['pickup', 'admin', 'owner'] as const;

export function App() {
  return (
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
      <Route path="/admin/inventory" element={<ProtectedRoute allow={[...adminArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/products" element={<ProtectedRoute allow={[...adminArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute allow={[...adminArea]}><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/fulfillment" element={<ProtectedRoute allow={[...adminArea]}><FulfillmentAdminPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
