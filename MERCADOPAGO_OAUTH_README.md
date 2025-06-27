# MercadoPago OAuth Integration for Faster POS

This document explains the MercadoPago OAuth 2.0 integration implemented in the Faster POS system.

## Overview

The MercadoPago OAuth integration allows the Faster POS system to securely connect to MercadoPago's APIs for payment processing. This implementation follows OAuth 2.0 standards and provides a complete workflow for authorization, token management, and API access.

## Architecture

### Backend Components

1. **`mercadopago-oauth.js`** - Core OAuth management class
2. **OAuth Routes** - Express.js endpoints for OAuth workflow
3. **Token Storage** - Secure local token management
4. **API Integration** - MercadoPago API client

### Frontend Components

1. **`mercadopago-config.html`** - Configuration and status management interface
2. **Integration with `gerencia.html`** - Admin panel access

## OAuth 2.0 Workflow

### 1. Application Registration

Before using this integration, you must register your application with MercadoPago:

1. Go to [MercadoPago Developers](https://developers.mercadopago.com/)
2. Create a new application
3. Note your `Client ID` and `Client Secret`
4. Configure the redirect URI (e.g., `http://your-domain:3000/mercadopago/callback`)

### 2. Environment Configuration

Add the following environment variables to your `.env` file:

```env
# MercadoPago OAuth Configuration
MERCADOPAGO_CLIENT_ID=your_client_id_here
MERCADOPAGO_CLIENT_SECRET=your_client_secret_here
MERCADOPAGO_REDIRECT_URI=http://your-domain:3000/mercadopago/callback

# Optional: Custom URLs (defaults to production)
MERCADOPAGO_BASE_URL=https://api.mercadopago.com
MERCADOPAGO_AUTH_URL=https://auth.mercadopago.com.ar
```

### 3. OAuth Authorization Flow

#### Step 1: Initiate Authorization
- User clicks "Autorizar con MercadoPago" in the admin panel
- System generates authorization URL with required parameters
- User is redirected to MercadoPago's authorization page

#### Step 2: User Authorization
- User logs into MercadoPago and grants permissions
- MercadoPago redirects back to your callback URL with authorization code

#### Step 3: Token Exchange
- System exchanges authorization code for access and refresh tokens
- Tokens are securely stored locally
- User is notified of successful authorization

#### Step 4: API Access
- System can now make authenticated API calls to MercadoPago
- Access tokens are automatically refreshed when needed

## API Endpoints

### OAuth Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mercadopago/auth` | GET | Generate authorization URL |
| `/mercadopago/callback` | GET | OAuth callback handler |
| `/mercadopago/status` | GET | Get OAuth status |
| `/mercadopago/user` | GET | Get user information |
| `/mercadopago/revoke` | POST | Revoke access |
| `/mercadopago/test` | GET | Test API connection |

### Frontend Pages

| Page | Description |
|------|-------------|
| `/mercadopago-config.html` | Configuration and status management |

## Token Management

### Token Storage
- Tokens are stored in `backend/mercadopago-tokens.json`
- File is created automatically on first use
- Contains access token, refresh token, expiration, and user info

### Token Refresh
- Access tokens expire after a set time (typically 6 hours)
- System automatically refreshes tokens using refresh token
- 5-minute buffer before expiration for proactive refresh

### Security Considerations
- Tokens are stored locally on the server
- File permissions should be restricted to server user only
- Consider encrypting token file in production

## Usage Instructions

### For Administrators

1. **Access Configuration**
   - Log into the admin panel (`gerencia.html`)
   - Click "Configurar MercadoPago" button
   - Or navigate directly to `/mercadopago-config.html`

2. **Initial Setup**
   - Verify configuration status
   - Click "Autorizar con MercadoPago"
   - Complete authorization in popup window
   - Verify successful connection

3. **Ongoing Management**
   - Monitor token status and expiration
   - Test API connection periodically
   - Revoke access if needed

### For Developers

#### Using the OAuth Class

```javascript
const MercadoPagoOAuth = require('./mercadopago-oauth');
const mercadopagoOAuth = new MercadoPagoOAuth();

// Check if configured
if (mercadopagoOAuth.isConfigured()) {
  // Check if authorized
  if (mercadopagoOAuth.isAuthorized()) {
    // Get valid access token
    const accessToken = await mercadopagoOAuth.getValidAccessToken();
    
    // Make API calls
    const userInfo = await mercadopagoOAuth.getUserInfo();
  }
}
```

#### Making API Calls

```javascript
// Get valid access token (automatically refreshes if needed)
const accessToken = await mercadopagoOAuth.getValidAccessToken();

// Use with axios or fetch
const response = await axios.get('https://api.mercadopago.com/endpoint', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

## Error Handling

### Common Errors

1. **Configuration Errors**
   - Missing environment variables
   - Invalid client credentials
   - Incorrect redirect URI

2. **Authorization Errors**
   - User denies permission
   - Expired authorization code
   - Invalid state parameter

3. **Token Errors**
   - Expired refresh token
   - Invalid access token
   - Network connectivity issues

### Error Responses

All API endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "message": "Detailed error message"
}
```

## Security Best Practices

1. **Environment Variables**
   - Never commit credentials to version control
   - Use different credentials for development/production
   - Rotate credentials regularly

2. **Token Security**
   - Store tokens securely
   - Implement proper file permissions
   - Consider token encryption

3. **Network Security**
   - Use HTTPS in production
   - Validate redirect URIs
   - Implement CSRF protection

4. **Access Control**
   - Restrict admin panel access
   - Log OAuth activities
   - Monitor for suspicious activity

## Troubleshooting

### Common Issues

1. **"OAuth not configured"**
   - Check environment variables
   - Verify `.env` file location
   - Restart server after changes

2. **"Authorization failed"**
   - Check redirect URI configuration
   - Verify client credentials
   - Check network connectivity

3. **"Token expired"**
   - Tokens should refresh automatically
   - Check refresh token validity
   - Re-authorize if needed

4. **"API connection failed"**
   - Verify access token
   - Check API endpoint availability
   - Review error logs

### Debug Mode

Enable debug logging by setting:

```env
DEBUG=mercadopago:*
```

### Logs

OAuth activities are logged to:
- Console output
- Application logs (`backend/logs/`)

## Next Steps

This OAuth integration provides the foundation for:

1. **Payment Processing**
   - Create payment preferences
   - Process payments
   - Handle webhooks

2. **Order Management**
   - Sync orders with MercadoPago
   - Track payment status
   - Manage refunds

3. **Reporting**
   - Payment analytics
   - Transaction history
   - Financial reports

## Support

For issues with this integration:

1. Check the troubleshooting section
2. Review MercadoPago API documentation
3. Check server logs for detailed error messages
4. Verify environment configuration

## Dependencies

- `axios` - HTTP client for API calls
- `express` - Web framework
- `dotenv` - Environment variable management

## License

This integration is part of the Faster POS system and follows the same licensing terms. 