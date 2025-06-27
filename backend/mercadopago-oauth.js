const axios = require('axios');
const fs = require('fs');
const path = require('path');

class MercadoPagoOAuth {
  constructor() {
    this.clientId = process.env.MERCADOPAGO_CLIENT_ID;
    this.clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
    this.redirectUri = process.env.MERCADOPAGO_REDIRECT_URI || 'http://localhost:3000/mercadopago/callback';
    this.baseUrl = process.env.MERCADOPAGO_BASE_URL || 'https://api.mercadopago.com';
    this.authUrl = process.env.MERCADOPAGO_AUTH_URL || 'https://auth.mercadopago.com.ar';
    this.tokensFile = path.join(__dirname, 'mercadopago-tokens.json');
    
    // Ensure tokens file exists
    this.initializeTokensFile();
  }

  initializeTokensFile() {
    if (!fs.existsSync(this.tokensFile)) {
      const initialTokens = {
        access_token: null,
        refresh_token: null,
        expires_at: null,
        token_type: 'Bearer',
        scope: null,
        user_id: null,
        public_key: null
      };
      fs.writeFileSync(this.tokensFile, JSON.stringify(initialTokens, null, 2));
    }
  }

  /**
   * Generate OAuth authorization URL
   * @param {string} state - Optional state parameter for security
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(state = null) {
    if (!this.clientId) {
      throw new Error('MERCADOPAGO_CLIENT_ID is required');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'read write offline_access'
    });

    if (state) {
      params.append('state', state);
    }

    return `${this.authUrl}/authorization?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @returns {Object} Token response
   */
  async exchangeCodeForToken(code) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('MERCADOPAGO_CLIENT_ID and MERCADOPAGO_CLIENT_SECRET are required');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.redirectUri
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const tokenData = response.data;
      
      // Calculate expiration time
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

      const tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt.toISOString(),
        token_type: tokenData.token_type || 'Bearer',
        scope: tokenData.scope,
        user_id: tokenData.user_id,
        public_key: tokenData.public_key
      };

      // Save tokens to file
      this.saveTokens(tokens);

      return tokens;
    } catch (error) {
      console.error('Error exchanging code for token:', error.response?.data || error.message);
      throw new Error(`Failed to exchange code for token: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   * @returns {Object} New token data
   */
  async refreshAccessToken() {
    const tokens = this.loadTokens();
    
    if (!tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: tokens.refresh_token
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const tokenData = response.data;
      
      // Calculate new expiration time
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

      const newTokens = {
        ...tokens,
        access_token: tokenData.access_token,
        expires_at: expiresAt.toISOString()
      };

      // Update refresh token if provided
      if (tokenData.refresh_token) {
        newTokens.refresh_token = tokenData.refresh_token;
      }

      // Save updated tokens
      this.saveTokens(newTokens);

      return newTokens;
    } catch (error) {
      console.error('Error refreshing token:', error.response?.data || error.message);
      throw new Error(`Failed to refresh token: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get valid access token (refresh if expired)
   * @returns {string} Valid access token
   */
  async getValidAccessToken() {
    const tokens = this.loadTokens();
    
    if (!tokens.access_token) {
      throw new Error('No access token available. Please complete OAuth authorization first.');
    }

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = new Date(tokens.expires_at);
    const now = new Date();
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds

    if (expiresAt.getTime() - now.getTime() < bufferTime) {
      console.log('Access token expired or expiring soon, refreshing...');
      const newTokens = await this.refreshAccessToken();
      return newTokens.access_token;
    }

    return tokens.access_token;
  }

  /**
   * Load tokens from file
   * @returns {Object} Token data
   */
  loadTokens() {
    try {
      const data = fs.readFileSync(this.tokensFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading tokens:', error.message);
      return {
        access_token: null,
        refresh_token: null,
        expires_at: null,
        token_type: 'Bearer',
        scope: null,
        user_id: null,
        public_key: null
      };
    }
  }

  /**
   * Save tokens to file
   * @param {Object} tokens - Token data to save
   */
  saveTokens(tokens) {
    try {
      fs.writeFileSync(this.tokensFile, JSON.stringify(tokens, null, 2));
      console.log('Tokens saved successfully');
    } catch (error) {
      console.error('Error saving tokens:', error.message);
      throw error;
    }
  }

  /**
   * Check if OAuth is configured
   * @returns {boolean} True if configured
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Check if user is authorized
   * @returns {boolean} True if authorized
   */
  isAuthorized() {
    const tokens = this.loadTokens();
    return !!(tokens.access_token && tokens.refresh_token);
  }

  /**
   * Get user information
   * @returns {Object} User data
   */
  async getUserInfo() {
    const accessToken = await this.getValidAccessToken();
    
    try {
      const response = await axios.get(`${this.baseUrl}/users/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error getting user info:', error.response?.data || error.message);
      throw new Error(`Failed to get user info: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Revoke access token
   * @returns {boolean} Success status
   */
  async revokeAccess() {
    const tokens = this.loadTokens();
    
    if (!tokens.access_token) {
      return true; // Already revoked
    }

    try {
      await axios.post(`${this.baseUrl}/oauth/revoke`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        token: tokens.access_token
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Clear tokens
      this.saveTokens({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        token_type: 'Bearer',
        scope: null,
        user_id: null,
        public_key: null
      });

      return true;
    } catch (error) {
      console.error('Error revoking access:', error.response?.data || error.message);
      return false;
    }
  }
}

module.exports = MercadoPagoOAuth; 