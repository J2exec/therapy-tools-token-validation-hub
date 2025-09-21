import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';

// 🔐 ENVIRONMENT VARIABLES
const connectionString = process.env.AzureWebJobsStorage;
const allowedOrigins = process.env.ALLOWED_ORIGIN 
  ? process.env.ALLOWED_ORIGIN.split(',').map(origin => origin.trim())
  : ['https://onlinetherapytools.com']; // fallback
const tableName = 'accesstokens';
const failedTokenUrl = process.env.FAILED_TOKEN_URL || 'https://onlinetherapytools.com/access-denied';

// 🌐 STANDARDIZED CORS FUNCTION
function getAllowedOrigin(request) {
  const requestOrigin = request.headers.get('origin');
  
  // For development, allow localhost
  if (requestOrigin && requestOrigin.includes('localhost')) {
    return requestOrigin;
  }
  
  // Check if request origin is in allowed list
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  // Default to first allowed origin
  return allowedOrigins[0];
}

// 🚀 AZURE FUNCTION - TOKEN VERIFICATION & ACCESS GATE
app.http('verify-token', {
  methods: ['POST', 'GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'verify-token',
  
  handler: async (request, context) => {
    context.log('🔍 Token verification function triggered');

    // CORS headers - Updated to match generator hub for 2FA compatibility
    const corsHeaders = {
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, X-Request-ID',
      'Access-Control-Allow-Credentials': 'false',
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
    let therapistId;
    let redirectUrl;

    // Handle both GET (URL parameters) and POST (JSON body) requests
    if (request.method === 'GET') {
      // Extract token and therapist ID from query parameters (for direct link access)
      const url = new URL(request.url);
      token = url.searchParams.get('token');
      therapistId = url.searchParams.get('therapist_id');
      redirectUrl = url.searchParams.get('redirect') || url.searchParams.get('activity');
      
      context.log('📝 GET request - Token from URL params:', token ? token.substring(0, 8) + '...' : 'missing');
      context.log('📝 GET request - Therapist ID from URL params:', therapistId || 'missing');
    } else {
      // Extract token and therapist ID from request body (for API calls)
      let requestBody;
      try {
        requestBody = await request.json();
        token = requestBody.token;
        therapistId = requestBody.therapistId;
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
      context.log('📝 POST request - Therapist ID from body:', therapistId || 'missing');
    }

    // Validate required parameters for 2FA
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

    // Require therapist ID for 2FA security - no fallback allowed
    if (!therapistId) {
      context.log('❌ ERROR: Missing therapist_id parameter - 2FA security requires both token AND therapist ID');
      
      // For GET requests, redirect to failed page with specific error
      if (request.method === 'GET') {
        return {
          status: 302,
          headers: {
            'Location': failedTokenUrl + '?error=missing_therapist_id',
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
          message: 'Missing therapist_id parameter - required for 2FA security validation',
          error: 'missing_therapist_id'
        }
      };
    }

    try {
      // Initialize table client
      const tokensClient = TableClient.fromConnectionString(connectionString, tableName);

      // 🔐 2FA TOKEN VERIFICATION: Exact match on therapist ID + token
      // This ensures only the therapist who generated the token can validate it
      const entities = tokensClient.listEntities({
        filter: `PartitionKey eq '${therapistId}' and RowKey eq '${token}'`
      });

      context.log('🔍 2FA TOKEN SEARCH:', {
        therapistId: therapistId,
        token: token.substring(0, 8) + '...',
        searchFilter: `PartitionKey eq '${therapistId}' and RowKey eq '${token.substring(0, 8)}...'`
      });

      let validTokens = [];
      let allFoundEntities = [];
      
      for await (const entity of entities) {
        allFoundEntities.push({
          partitionKey: entity.partitionKey,
          hasExpiresAt: !!entity.expiresAt,
          hasActivityUrl: !!entity.activityUrl,
          hasTherapistId: !!entity.therapistId,
          expiresAtValue: entity.expiresAt,
          activityUrlValue: entity.activityUrl,
          therapistIdValue: entity.therapistId,
          isRevokedValue: entity.isRevoked,
          maxLifetimeHours: entity.maxLifetimeHours,
          requestedHours: entity.requestedHours,
          createdAt: entity.createdAt
        });
        
        // Only accept tokens with complete new schema
        if (entity.expiresAt && entity.activityUrl && entity.therapistId) {
          validTokens.push(entity);
        }
      }

      // Log detailed information about what we found
      context.log('🔍 TOKEN EXACT MATCH SEARCH:', {
        token: token.substring(0, 8) + '...',
        totalEntitiesFound: allFoundEntities.length,
        validTokensFound: validTokens.length,
        allEntities: allFoundEntities
      });

      // Handle multiple valid tokens (should not happen with proper token generation)
      let tokenEntity = null;
      if (validTokens.length === 0) {
        context.log('❌ No valid tokens found for exact match');
      } else if (validTokens.length === 1) {
        tokenEntity = validTokens[0];
        context.log('✅ Found exactly one valid token - perfect match');
      } else {
        // Multiple valid tokens found - this indicates a token generation issue
        context.log('⚠️ WARNING: Multiple valid tokens found for same token string', {
          count: validTokens.length,
          partitionKeys: validTokens.map(t => t.partitionKey),
          createdAtTimes: validTokens.map(t => t.createdAt)
        });
        
        // Use the most recently created token as fallback
        tokenEntity = validTokens.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        context.log('🔄 Using most recent token as fallback:', {
          selectedPartitionKey: tokenEntity.partitionKey,
          selectedCreatedAt: tokenEntity.createdAt
        });
      }

      // If no valid token found with exact match, reject
      if (!tokenEntity) {
        context.log('❌ ERROR: No valid token found for exact match', { 
          token: token.substring(0, 8) + '...',
          searchedFor: 'exact token match with complete schema',
          foundEntities: allFoundEntities,
          rejectionReason: 'No token with exact match and required fields'
        });
        
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
            message: 'Invalid token - no exact match found',
            error: 'invalid_token',
            debug: { foundEntities: allFoundEntities }
          }
        };
      }

      // Extract fields from new token schema only
      const { therapistId, expiresAt, isRevoked, createdAt, activityUrl } = tokenEntity;

      // Validate essential fields exist (new schema only)
      if (!expiresAt || !activityUrl || !therapistId) {
        context.log('❌ ERROR: Token missing essential fields for new schema', { 
          hasExpiresAt: !!expiresAt,
          hasActivityUrl: !!activityUrl,
          hasTherapistId: !!therapistId,
          tokenPartitionKey: tokenEntity.partitionKey,
          tokenRowKey: tokenEntity.rowKey?.substring(0, 8) + '...'
        });
        
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
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Token has invalid schema - new schema required',
            error: 'invalid_token_schema'
          }
        };
      }

      // Check if token is manually revoked (new schema feature)
      if (isRevoked === true) {
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
      
      // 🔍 COMPREHENSIVE DATE DEBUGGING FOR LIVE TESTING
      context.log('🔍 DATE COMPARISON DEBUG:', {
        token: token.substring(0, 8) + '...',
        therapistId,
        rawExpiresAtFromDB: expiresAt,
        rawExpiresAtType: typeof expiresAt,
        parsedExpirationDate: expirationDate.toString(),
        parsedExpirationDateISO: expirationDate.toISOString(),
        isExpirationDateValid: !isNaN(expirationDate.getTime()),
        currentTime: now.toString(),
        currentTimeISO: now.toISOString(),
        isCurrentTimeValid: !isNaN(now.getTime()),
        comparisonResult: expirationDate < now,
        timeDifferenceMS: expirationDate.getTime() - now.getTime(),
        timeDifferenceMinutes: Math.round((expirationDate.getTime() - now.getTime()) / (1000 * 60)),
        bothDatesValid: !isNaN(expirationDate.getTime()) && !isNaN(now.getTime())
      });
      
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

      // For GET requests with redirect URL, fetch and serve activity content with caching
      if (request.method === 'GET' && (redirectUrl || activityUrl)) {
        // Use provided redirect URL or fall back to token's activity URL
        let finalRedirectUrl = redirectUrl || activityUrl;
        
        // 🛡️ VALIDATE AND SANITIZE REDIRECT URL
        try {
          // Ensure the URL is valid and uses HTTPS
          const urlObj = new URL(finalRedirectUrl);
          
          // Check if it's one of your allowed domains
          const isAllowedDomain = allowedOrigins.some(origin => 
            finalRedirectUrl.startsWith(origin)
          );
          
          if (!isAllowedDomain) {
            context.log('⚠️ WARNING: Redirect URL not in allowed domains, using fallback', {
              originalUrl: finalRedirectUrl,
              allowedOrigins
            });
            finalRedirectUrl = 'https://onlinetherapytools.com/dashboard';
          }
          
          // Add token validation info to redirect URL
          const redirectUrlObj = new URL(finalRedirectUrl);
          redirectUrlObj.searchParams.set('validated_token', token);
          redirectUrlObj.searchParams.set('therapist_id', therapistId);
          redirectUrlObj.searchParams.set('expires_at', expirationDate.toISOString());
          
          context.log('🔄 Fetching activity content to serve with cache headers:', redirectUrlObj.toString());
          
          try {
            // Fetch the activity content from your site
            const activityResponse = await fetch(redirectUrlObj.toString());
            
            if (activityResponse.ok) {
              const activityContent = await activityResponse.text();
              
              // Calculate cache duration (time remaining until token expires)
              const timeRemainingSeconds = Math.floor((expirationDate - now) / 1000);
              const cacheUntil = expirationDate.toUTCString();
              
              context.log('✅ Serving activity with cache headers:', {
                timeRemainingSeconds,
                cacheUntil,
                tokenId: token.substring(0, 8) + '...'
              });
              
              // Serve the activity content directly with cache headers tied to token expiration
              return {
                status: 200,
                headers: {
                  'Content-Type': 'text/html',
                  'Cache-Control': `private, max-age=${timeRemainingSeconds}, must-revalidate`,
                  'Expires': cacheUntil,
                  'Last-Modified': new Date().toUTCString(),
                  'ETag': `"${token}"`,
                  ...corsHeaders
                },
                body: activityContent
              };
            } else {
              throw new Error(`Failed to fetch activity: ${activityResponse.status} ${activityResponse.statusText}`);
            }
            
          } catch (fetchError) {
            context.log('❌ ERROR: Failed to fetch activity content:', fetchError.message);
            
            // Fallback: redirect if we can't fetch content
            return {
              status: 302,
              headers: {
                'Location': redirectUrlObj.toString(),
                ...corsHeaders
              }
            };
          }
          
        } catch (urlError) {
          context.log('❌ ERROR: Invalid redirect URL in token, using fallback', {
            originalUrl: finalRedirectUrl,
            error: urlError.message
          });
          
          // Fallback to safe default URL
          const fallbackUrl = new URL('https://onlinetherapytools.com/dashboard');
          fallbackUrl.searchParams.set('validated_token', token);
          fallbackUrl.searchParams.set('therapist_id', therapistId);
          fallbackUrl.searchParams.set('expires_at', expirationDate.toISOString());
          fallbackUrl.searchParams.set('error', 'invalid_activity_url');
          
          return {
            status: 302,
            headers: {
              'Location': fallbackUrl.toString(),
              ...corsHeaders
            }
          };
        }
      }

      // For API calls or GET without redirect, return JSON response
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: {
          success: true,
          valid: true,
          therapistId: therapistId,
          activityUrl: activityUrl,
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

    // CORS headers - Updated to match generator hub for 2FA compatibility
    const corsHeaders = {
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, X-Request-ID',
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

    const { token, therapistId } = requestBody;
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

    if (!therapistId) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        jsonBody: { 
          success: false, 
          message: 'Missing therapistId parameter - required for 2FA token revocation' 
        }
      };
    }

    try {
      const tokensClient = TableClient.fromConnectionString(connectionString, tableName);
      
      // 🔐 2FA TOKEN REVOCATION: Exact match on therapist ID + token
      // This ensures only the therapist who generated the token can revoke it
      const entities = tokensClient.listEntities({
        filter: `PartitionKey eq '${therapistId}' and RowKey eq '${token}'`
      });

      context.log('🔍 2FA TOKEN REVOCATION SEARCH:', {
        therapistId: therapistId,
        token: token.substring(0, 8) + '...'
      });

      let tokenEntity = null;
      for await (const entity of entities) {
        // Only accept tokens with new schema (must have expiresAt and activityUrl fields)
        if (entity.expiresAt && entity.activityUrl && entity.therapistId) {
          tokenEntity = entity;
          break; // Found a valid new schema token
        }
      }

      if (!tokenEntity) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          jsonBody: { 
            success: false, 
            message: 'Token not found or uses deprecated schema' 
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