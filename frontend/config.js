const BACKEND_BASE_URL = 'http://192.168.100.81:3000';

// ===== FUNCIONES DE AUTENTICACIÓN =====

// Función para verificar si el usuario está autenticado
async function checkAuthStatus() {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/auth/status`, {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.authenticated;
    }
    return false;
  } catch (error) {
    console.error('Error al verificar estado de autenticación:', error);
    return false;
  }
}

// Función para redirigir al login si no está autenticado
async function requireAuth() {
  const isAuthenticated = await checkAuthStatus();
  if (!isAuthenticated) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// Función para cerrar sesión
async function logout() {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    
    if (response.ok) {
      window.location.href = 'login.html';
    }
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
    window.location.href = 'login.html';
  }
}

// Función para obtener información del dispositivo
async function getDeviceInfo() {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/device/info`, {
      credentials: 'include'
    });
    
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error('Error al obtener información del dispositivo:', error);
    return null;
  }
}

// Verificar autenticación al cargar páginas protegidas
document.addEventListener('DOMContentLoaded', async function() {
  // No verificar en login.html
  if (window.location.pathname.includes('login.html')) {
    return;
  }
  
  // Verificar autenticación en todas las demás páginas
  const isAuthenticated = await checkAuthStatus();
  if (!isAuthenticated) {
    window.location.href = 'login.html';
  }
});