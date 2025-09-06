import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';

// 🔐 ENVIRONMENT VARIABLES
const connectionString = process.env.AzureWebJobsStorage;
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
const tableName = 'tokens';
const failedTokenUrl = process.env.FAILED_TOKEN_URL || 'https://onlinetherapytools.com/access-denied';

// 🚀 AZURE FUNCTION - TOKEN VERIFICATION & ACCESS GATE
app.http('verify-token', {
  methods: ['POST', 'GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'verify-token',
  
  handler: async (request, context) => {
    context.log('🔍 Token verification function triggered');

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return {
        status: 200,
        headers: corsHeaders,
        body: ''
      };
    }

    // Validate environment
    if (!connectionString) {
      context.log('❌ ERROR: Missing required environment variables');
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Server configuration error' 
        }
      };
    }

    let token;
    let redirectUrl;

    // Handle both GET (URL parameters) and POST (JSON body) requests
    if (request.method === 'GET') {
      // Extract token from query parameters (for direct link access)
      const url = new URL(request.url);
      token = url.searchParams.get('token');
      redirectUrl = url.searchParams.get('redirect') || url.searchParams.get('activity');
      
      context.log('📝 GET request - Token from URL params:', token ? token.substring(0, 8) + '...' : 'missing');
    } else {
      // Extract token from request body (for API calls)
      let requestBody;
      try {
        requestBody = await request.json();
        token = requestBody.token;
        redirectUrl = requestBody.redirectUrl || requestBody.activityUrl;
      } catch (err) {
        context.log('❌ ERROR: Invalid JSON in request body');
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Invalid JSON in request body' 
          }
        };
      }
      
      context.log('📝 POST request - Token from body:', token ? token.substring(0, 8) + '...' : 'missing');
    }

    // Validate token parameter
    if (!token) {
      context.log('❌ ERROR: Missing token');
      
      // For GET requests, redirect to failed page
      if (request.method === 'GET') {
        return {
          status: 302,
          headers: {
            'Location': failedTokenUrl + '?error=missing_token',
            ...corsHeaders
          }
        };
      }
      
      // For POST requests, return JSON error
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Missing token parameter',
          error: 'missing_token'
        }
      };
    }

    try {
      // Initialize table client
      const tokensClient = TableClient.fromConnectionString(connectionString, tableName);

      // Query for the token across all partitions
      const entities = tokensClient.listEntities({
        filter: `RowKey eq '${token}'`
      });

      let tokenEntity = null;
      for await (const entity of entities) {
        tokenEntity = entity;
        break; // Should only be one match
      }

      // Token not found
      if (!tokenEntity) {
        context.log('❌ ERROR: Token not found in database');
        
        if (request.method === 'GET') {
          return {
            status: 302,
            headers: {
              'Location': failedTokenUrl + '?error=invalid_token',
              ...corsHeaders
            }
          };
        }
        
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Invalid token',
            error: 'invalid_token'
          }
        };
      }

      const { therapistId, expiresAt, isRevoked, createdAt } = tokenEntity;

      // Check if token is manually revoked
      if (isRevoked) {
        context.log('❌ ERROR: Token has been revoked', { therapistId, token: token.substring(0, 8) + '...' });
        
        if (request.method === 'GET') {
          return {
            status: 302,
            headers: {
              'Location': failedTokenUrl + '?error=token_revoked',
              ...corsHeaders
            }
          };
        }
        
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Token has been revoked',
            error: 'token_revoked'
          }
        };
      }

      // Check if token is expired
      const now = new Date();
      const expirationDate = new Date(expiresAt);
      
      if (expirationDate < now) {
        context.log('❌ ERROR: Token is expired', {
          therapistId,
          expiresAt: expirationDate.toISOString(),
          currentTime: now.toISOString(),
          expiredMinutesAgo: Math.round((now - expirationDate) / (1000 * 60))
        });

        // Clean up expired token from table
        try {
          await tokensClient.deleteEntity(tokenEntity.partitionKey, tokenEntity.rowKey);
          context.log('🧹 Cleaned up expired token from database');
        } catch (cleanupErr) {
          context.log('⚠️ Failed to cleanup expired token:', cleanupErr.message);
        }

        if (request.method === 'GET') {
          return {
            status: 302,
            headers: {
              'Location': failedTokenUrl + '?error=token_expired',
              ...corsHeaders
            }
          };
        }
        
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Token has expired',
            error: 'token_expired',
            expiresAt: expirationDate.toISOString()
          }
        };
      }

      // Token is valid! 
      const timeRemaining = Math.round((expirationDate - now) / (1000 * 60));
      
      context.log('✅ SUCCESS: Token verified successfully', {
        therapistId,
        expiresAt: expirationDate.toISOString(),
        timeRemainingMinutes: timeRemaining,
        createdAt: createdAt
      });

      // For GET requests with redirect URL, redirect to the activity
      if (request.method === 'GET' && redirectUrl) {
        // Add token validation info to redirect URL
        const redirectUrlObj = new URL(redirectUrl);
        redirectUrlObj.searchParams.set('validated_token', token);
        redirectUrlObj.searchParams.set('therapist_id', therapistId);
        redirectUrlObj.searchParams.set('expires_at', expirationDate.toISOString());
        
        context.log('🔄 Redirecting to validated activity:', redirectUrlObj.toString());
        
        return {
          status: 302,
          headers: {
            'Location': redirectUrlObj.toString(),
            ...corsHeaders
          }
        };
      }

      // For API calls or GET without redirect, return JSON response
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: {
          success: true,
          valid: true,
          therapistId: therapistId,
          expiresAt: expirationDate.toISOString(),
          timeRemainingMinutes: timeRemaining,
          createdAt: createdAt,
          message: 'Token is valid - access granted'
        }
      };

    } catch (err) {
      context.log('❌ ERROR: Token verification failed:', err.message, err.stack);
      
      if (request.method === 'GET') {
        return {
          status: 302,
          headers: {
            'Location': failedTokenUrl + '?error=verification_failed',
            ...corsHeaders
          }
        };
      }
      
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Failed to verify token - please try again',
          error: 'verification_failed'
        }
      };
    }
  }
});

// 🚀 AZURE FUNCTION - TOKEN REVOCATION (FUTURE FEATURE)
app.http('revoke-token', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'revoke-token',
  
  handler: async (request, context) => {
    context.log('🔒 Token revocation function triggered');

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return {
        status: 200,
        headers: corsHeaders,
        body: ''
      };
    }

    // Extract Bearer token from Authorization header (therapist authentication)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Missing or invalid authorization token' 
        }
      };
    }

    let requestBody;
    try {
      requestBody = await request.json();
    } catch (err) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Invalid JSON in request body' 
        }
      };
    }

    const { token } = requestBody;
    if (!token) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Missing token parameter' 
        }
      };
    }

    try {
      const tokensClient = TableClient.fromConnectionString(connectionString, tableName);
      
      // Find the token
      const entities = tokensClient.listEntities({
        filter: `RowKey eq '${token}'`
      });

      let tokenEntity = null;
      for await (const entity of entities) {
        tokenEntity = entity;
        break;
      }

      if (!tokenEntity) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Token not found' 
          }
        };
      }

      // TODO: Verify therapist owns this token by comparing therapistId from Bearer token

      // Revoke the token
      const updatedEntity = {
        ...tokenEntity,
        isRevoked: true,
        revokedAt: new Date().toISOString()
      };

      await tokensClient.updateEntity(updatedEntity, 'Replace');

      context.log('✅ SUCCESS: Token revoked', {
        token: token.substring(0, 8) + '...',
        therapistId: tokenEntity.therapistId
      });

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: {
          success: true,
          message: 'Token successfully revoked',
          revokedAt: updatedEntity.revokedAt
        }
      };

    } catch (err) {
      context.log('❌ ERROR: Token revocation failed:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Failed to revoke token' 
        }
      };
    }
  }
});