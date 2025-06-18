
// FASTER POS Configuration - Simple Dynamic Loading
class Config {
  constructor() {
    this.BACKEND_BASE_URL = window.location.origin; // Fallback to current origin
    this.API_TIMEOUT = 5000;
    this.REFRESH_INTERVAL = 30000;
    this.loaded = false;
    
    // Load config immediately
    this.loadConfig();
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const serverConfig = await response.json();
        this.BACKEND_BASE_URL = serverConfig.backendUrl;
        this.API_TIMEOUT = serverConfig.apiTimeout;
        this.REFRESH_INTERVAL = serverConfig.refreshInterval;
        
        console.log('✅ Configuration loaded from server:', this.BACKEND_BASE_URL);
      } else {
        console.warn('⚠️ Could not load server config, using fallback:', this.BACKEND_BASE_URL);
      }
    } catch (error) {
      console.warn('⚠️ Error loading server config, using fallback:', error.message);
    }
    
    this.loaded = true;
    
    // Make globally available
    window.BACKEND_BASE_URL = this.BACKEND_BASE_URL;
    window.CONFIG = {
      API_TIMEOUT: this.API_TIMEOUT,
      REFRESH_INTERVAL: this.REFRESH_INTERVAL
    };
    
    // Notify that config is ready
    window.dispatchEvent(new CustomEvent('configReady', { 
      detail: { 
        BACKEND_BASE_URL: this.BACKEND_BASE_URL,
        CONFIG: window.CONFIG 
      } 
    }));
  }

  // Helper method to get backend URL (always returns a value)
  getBackendUrl() {
    return this.BACKEND_BASE_URL;
  }

  // Helper method to wait for config to be ready
  async waitForConfig() {
    if (this.loaded) return this;
    
    return new Promise((resolve) => {
      window.addEventListener('configReady', () => resolve(this), { once: true });
    });
  }
}