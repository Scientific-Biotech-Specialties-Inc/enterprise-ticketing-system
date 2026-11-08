import axiosInstance from '@/api/axiosInstance';
import { AUTH_ENDPOINTS, SANCTUM_URL } from '@/config/api.config';
import { fetchEncryptionKey, encryptPayload } from '@/utils/rsa';

// For API Calls

//CSRF
export const getCsrfToken = async () => {
  // Passport (customer portal) uses Bearer tokens 
  if (import.meta.env.VITE_APP_MODE === 'customer') return;

  try {
    const hasXsrfCookie = typeof document !== 'undefined' && document.cookie.split('; ').some((cookie) => cookie.startsWith('XSRF-TOKEN='));
    if (hasXsrfCookie) {
      return;
    }

    await axiosInstance.get(`${SANCTUM_URL}${AUTH_ENDPOINTS.CSRF_TOKEN}`, {
      withCredentials: true,
      withXSRFToken: true,
    });
  } catch (error) {
    console.error('Error fetching CSRF token:', error);
    throw error;
  }
};

// Login with email and password

export const loginUser = async (email, password, mode = 'customer') => {
  try {
    await getCsrfToken();
    const { public_key, key_id } = await fetchEncryptionKey();
    console.log('Fetched encryption key:', { public_key, key_id });
    
    const response = await axiosInstance.post(AUTH_ENDPOINTS.LOGIN, {
      email,
      password: encryptPayload(password, public_key),
      mode,
    }, {
      headers: {
        'X-Key-Id': key_id
      }
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Register new user accoun
export const registerUser = async (name, email, password, passwordConfirmation) => {
  try {
    await getCsrfToken();
    const { public_key, key_id } = await fetchEncryptionKey();

    const response = await axiosInstance.post(AUTH_ENDPOINTS.REGISTER, {
      name,
      email,
      password: encryptPayload(password, public_key),
      password_confirmation: encryptPayload(passwordConfirmation, public_key),
    }, {
      headers: {
        'X-Key-Id': key_id
      }
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Logout user
export const logoutUser = async () => {
  try {
    await getCsrfToken();
    const response = await axiosInstance.post(AUTH_ENDPOINTS.LOGOUT);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Get current authenticated user
export const getCurrentUser = async () => {
  try {
    const response = await axiosInstance.get(AUTH_ENDPOINTS.ME);
    return response.data.user;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Request password reset (forgot password)

export const requestPasswordReset = async (email) => {
  try {
    await getCsrfToken();
    const response = await axiosInstance.post(AUTH_ENDPOINTS.FORGOT_PASSWORD, {
      email,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Verify password reset OTP

export const verifyPasswordResetOtp = async (email, otp) => {
  try {
    await getCsrfToken();
    const response = await axiosInstance.post(AUTH_ENDPOINTS.FORGOT_PASSWORD_VERIFY, {
      email,
      otp,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Reset password with OTP

export const resetPassword = async (email, otp, password, passwordConfirmation) => {
  try {
    await getCsrfToken();
    const { public_key, key_id } = await fetchEncryptionKey();

    const response = await axiosInstance.post(AUTH_ENDPOINTS.RESET_PASSWORD, {
      email,
      otp,
      password: encryptPayload(password, public_key),
      password_confirmation: encryptPayload(passwordConfirmation, public_key),
    }, {
      headers: {
        'X-Key-Id': key_id
      }
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Verify email address

export const verifyEmail = async (email, code) => {
  try {
    await getCsrfToken();
    const response = await axiosInstance.post(AUTH_ENDPOINTS.VERIFY_EMAIL, {
      email,
      code,
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

//Refresh authentication token

export const refreshToken = async () => {
  try {
    await getCsrfToken();
    const response = await axiosInstance.post(AUTH_ENDPOINTS.REFRESH_TOKEN);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Update user profile
export const updateUserProfile = async (profileData) => {
  try {
    const response = await axiosInstance.put('/profile', profileData);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

export const getUserProfile = async () => {
  try {
    const response = await axiosInstance.get('/profile');
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

export const resendFirstLoginOtp = async () => {
  try {
    const response = await axiosInstance.post('/first-login/resend-otp');
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

export const verifyFirstLoginOtp = async (otp) => {
  try {
    const response = await axiosInstance.post('/first-login/verify-otp', { otp });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};
