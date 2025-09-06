import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';

// 🔐 ENVIRONMENT VARIABLES
const connectionString = process.env.AzureWebJobsStorage;
const expiredTokenPageUrl = process.env.EXPIRED_TOKEN_PAGE_URL || 'https://www.onlinetherapytools.com/token-expired.html';
const tableName = 'accesstokens';

// 🚀 AZURE FUNCTION
app.http('verifytokens', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'verifytokens',
  
  handler: async (request, context) => {
    context.log('🔍 Token verification function triggered');

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    // Validate environment
    if (!connectionString) {
      context.log('❌ ERROR: Missing AzureWebJobsStorage environment variable');
      return {
        status: 500,
        headers: { 'Content-Type': 'text/html', ...corsHeaders },
        body: '<html><body><h1>Server Error</h1><p>Service temporarily unavailable.</p></body></html>'
      };
    }

    // Extract parameters from query string
    const therapistId = request.query.get('therapistId');
    const token = request.query.get('token');
    const redirectUrl = request.query.get('redirectUrl');

    context.log('📝 Request parameters:', { 
      therapistId: therapistId ? '***' : 'missing', 
      token: token ? '***' : 'missing',
      hasRedirectUrl: !!redirectUrl
    });

    // Validate required parameters
    if (!therapistId || !token) {
      context.log('❌ ERROR: Missing required parameters');
      return {
        status: 302,
        headers: { 
          'Location': `${expiredTokenPageUrl}?reason=invalid-request`,
          ...corsHeaders
        },
        body: ''
      };
    }

    try {
      // Initialize table client
      const tokensClient = TableClient.fromConnectionString(connectionString, tableName);
      
      context.log('🔍 Validating access token...');

      // Get token entity
      const tokenEntity = await tokensClient.getEntity(therapistId, token);
      
      context.log('✅ Token entity found:', { 
        therapistId: tokenEntity.partitionKey, 
        tokenId: tokenEntity.rowKey,
        expiresAt: tokenEntity.expiresAt,
        createdAt: tokenEntity.createdAt
      });

      // Validate token timestamps
      const now = new Date();
      const expiresAt = new Date(tokenEntity.expiresAt);
      const createdAt = new Date(tokenEntity.createdAt);

      // Check if token has expired
      if (now > expiresAt) {
        context.log('❌ ERROR: Token has expired', { 
          now: now.toISOString(), 
          expiresAt: expiresAt.toISOString() 
        });
        return {
          status: 302,
          headers: { 
            'Location': `${expiredTokenPageUrl}?reason=expired`,
            ...corsHeaders
          },
          body: ''
        };
      }

      // Validate maximum token lifetime (2 hours)
      const maxTokenLifetime = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      const tokenAge = now.getTime() - createdAt.getTime();
      
      if (tokenAge > maxTokenLifetime) {
        context.log('❌ ERROR: Token exceeds maximum lifetime', { 
          tokenAgeMinutes: Math.round(tokenAge / 1000 / 60),
          maxLifetimeMinutes: maxTokenLifetime / 1000 / 60
        });
        return {
          status: 302,
          headers: { 
            'Location': `${expiredTokenPageUrl}?reason=expired`,
            ...corsHeaders
          },
          body: ''
        };
      }

      // Token is valid!
      const remainingTimeMinutes = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);
      
      context.log('✅ SUCCESS: Token validation passed', {
        therapistId,
        remainingTimeMinutes
      });

      if (redirectUrl) {
        // Redirect to the therapy activity page
        return {
          status: 302,
          headers: { 
            'Location': redirectUrl,
            ...corsHeaders
          },
          body: ''
        };
      } else {
        // Return JSON success (for API usage)
        return {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          },
          jsonBody: {
            valid: true,
            therapistId,
            expiresAt: tokenEntity.expiresAt,
            remainingTimeMinutes,
            message: 'Access granted to therapy activity'
          }
        };
      }

    } catch (err) {
      context.log('❌ ERROR: Token validation failed:', err.message);
      return {
        status: 302,
        headers: { 
          'Location': `${expiredTokenPageUrl}?reason=invalid`,
          ...corsHeaders
        },
        body: ''
      };
    }
  }
});
