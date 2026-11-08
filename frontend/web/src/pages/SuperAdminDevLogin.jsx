import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import tokenStore from '@/auth/tokenStore';

const MOCK_TOKEN = 'frontend-dev-token';

const mockSuperAdmin = {
  id: 99,
  emp_id: 99,
  first_name: 'Super',
  last_name: 'Admin',
  name: 'Super Admin',
  email: 'superadmin@hospital.com',
  role: 'superadmin',
  department: 'superadmin',
};

export default function SuperAdminDevLogin() {
  const navigate = useNavigate();
  const { setIsAuthenticated, setUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    tokenStore.setToken(MOCK_TOKEN);
    sessionStorage.setItem('user', JSON.stringify(mockSuperAdmin));
    localStorage.removeItem('user');
    setUser(mockSuperAdmin);
    setIsAuthenticated(true);
    navigate('/superadmin/config', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#07071a] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#252578] text-2xl text-white font-bold">
          SA
        </div>
        <h1 className="mb-1 text-2xl font-bold text-gray-900">SuperAdmin (Dev)</h1>
        <p className="mb-8 text-sm text-gray-500">Development-only mock login</p>
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full rounded-xl bg-[#252578] px-6 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-60"
        >
          {loading ? 'Logging in...' : 'Login as SuperAdmin'}
        </button>
        <button
          onClick={() => navigate('/login', { replace: true })}
          className="mt-3 w-full rounded-xl border border-gray-200 px-6 py-3 text-sm font-semibold text-gray-600 transition-all hover:bg-gray-50"
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
