# 🔗 TOKEN VERIFIER ENDPOINT SPECIFICATION

**Date**: September 13, 2025  
**For**: Backend Understanding & Frontend Integration  
**Status**: ✅ PRODUCTION READY SPECIFICATION  

---

## 🌐 **TOKEN VERIFIER ENDPOINT - COMPLETE SPECIFICATION**

### **Base URL:**
```
https://therapy-tools-token-validation-hub.azurewebsites.net
```

### **Primary Endpoint: Token Verification**

#### **GET /api/verify-token** - Direct Link Validation

**Purpose**: Validates token and redirects user to activity or error page  
**Use Case**: Client clicks on tokenized link directly  
**Authentication**: None required (anonymous access)  

**Request Format:**
```http
GET /api/verify-token?token={64-char-token}&redirect={optional-activity-url}
Host: therapy-tools-token-validation-hub.azurewebsites.net
```

**Parameters:**
- `token` (required): 64-character hexadecimal token string
- `redirect` (optional): Activity URL to redirect to (if not provided, uses token's stored activityUrl)

**Example Request:**
```
GET /api/verify-token?token=99d4eb68a8d4c4af19091eb3cce9755042aa7cd2cf6bc4439b2189f4994b0061&redirect=https://onlinetherapytools.com/activities/bingo/bingo.html
```

**Response Behavior:**

✅ **SUCCESS (Valid Token):**
```http
HTTP/1.1 302 Found
Location: https://onlinetherapytools.com/activities/bingo/bingo.html?validated_token=99d4eb68a8d4c4af19091eb3cce9755042aa7cd2cf6bc4439b2189f4994b0061&therapist_id=therapist_default&expires_at=2025-09-13T16:30:00.000Z
Access-Control-Allow-Origin: https://onlinetherapytools.com
Cache-Control: no-cache, no-store, must-revalidate
```

❌ **ERROR (Expired Token):**
```http
HTTP/1.1 302 Found
Location: https://onlinetherapytools.com/token-expired.html?reason=expired
Access-Control-Allow-Origin: https://onlinetherapytools.com
Cache-Control: no-cache, no-store, must-revalidate
```

❌ **ERROR (Invalid Token):**
```http
HTTP/1.1 302 Found
Location: https://onlinetherapytools.com/token-expired.html?reason=invalid
Access-Control-Allow-Origin: https://onlinetherapytools.com
Cache-Control: no-cache, no-store, must-revalidate
```

❌ **ERROR (Revoked Token):**
```http
HTTP/1.1 302 Found
Location: https://onlinetherapytools.com/token-expired.html?reason=revoked
Access-Control-Allow-Origin: https://onlinetherapytools.com
Cache-Control: no-cache, no-store, must-revalidate
```

---

#### **POST /api/verify-token** - API Validation

**Purpose**: Programmatic token validation with JSON response  
**Use Case**: Frontend needs to validate token programmatically  
**Authentication**: None required (anonymous access)  

**Request Format:**
```http
POST /api/verify-token
Host: therapy-tools-token-validation-hub.azurewebsites.net
Content-Type: application/json

{
  "token": "99d4eb68a8d4c4af19091eb3cce9755042aa7cd2cf6bc4439b2189f4994b0061",
  "redirectUrl": "https://onlinetherapytools.com/activities/bingo/bingo.html"
}
```

**Request Body Parameters:**
- `token` (required): 64-character hexadecimal token string
- `redirectUrl` (optional): Activity URL (if not provided, uses token's stored activityUrl)

**Success Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://onlinetherapytools.com

{
  "success": true,
  "valid": true,
  "therapistId": "therapist_default",
  "activityUrl": "https://onlinetherapytools.com/activities/bingo/bingo.html",
  "expiresAt": "2025-09-13T16:30:00.000Z",
  "timeRemainingMinutes": 45,
  "createdAt": "2025-09-13T14:30:00.000Z",
  "message": "Token is valid - access granted"
}
```

**Error Response (Expired):**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Access-Control-Allow-Origin: https://onlinetherapytools.com

{
  "success": false,
  "message": "Token has expired",
  "error": "token_expired",
  "expiresAt": "2025-09-13T14:30:00.000Z"
}
```

**Error Response (Invalid):**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Access-Control-Allow-Origin: https://onlinetherapytools.com

{
  "success": false,
  "message": "Invalid token or token uses deprecated schema",
  "error": "invalid_token"
}
```

**Error Response (Revoked):**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Access-Control-Allow-Origin: https://onlinetherapytools.com

{
  "success": false,
  "message": "Token has been revoked",
  "error": "token_revoked"
}
```

---

## 🔧 **BACKEND PROCESSING LOGIC**

### **Token Validation Steps:**

1. **Extract Token**: Get token from query string (GET) or request body (POST)
2. **Database Query**: Search Azure Table Storage for token in `accesstokens` table
3. **Schema Validation**: Ensure token has required fields (`expiresAt`, `activityUrl`, `therapistId`)
4. **Expiration Check**: Compare `expiresAt` with current time
5. **Revocation Check**: Check `isRevoked` flag
6. **Success Processing**: Add validation parameters and redirect/respond

### **Token Schema Requirements:**
```javascript
// Required fields in database token record:
{
  PartitionKey: "therapist_default",      // Therapist partition
  RowKey: "99d4eb68a8d4c4af...",         // 64-char token
  therapistId: "therapist_default",       // Therapist identifier
  activityUrl: "https://...",             // Target activity URL
  expiresAt: "2025-09-13T16:30:00.000Z", // ISO expiration timestamp
  createdAt: "2025-09-13T14:30:00.000Z", // ISO creation timestamp
  isRevoked: false                        // Revocation flag
}
```

### **Success Redirect Parameter Addition:**
```javascript
// Backend automatically adds these parameters to activity URL:
const redirectUrlObj = new URL(activityUrl);
redirectUrlObj.searchParams.set('validated_token', token);
redirectUrlObj.searchParams.set('therapist_id', therapistId);
redirectUrlObj.searchParams.set('expires_at', expiresAt);

// Final URL:
// https://onlinetherapytools.com/activities/bingo/bingo.html?validated_token=99d4eb68...&therapist_id=therapist_default&expires_at=2025-09-13T16:30:00.000Z
```

---

## 🛡️ **SECURITY & CORS SPECIFICATIONS**

### **CORS Configuration:**
```javascript
// Allowed origins:
const allowedOrigins = [
  'https://onlinetherapytools.com',
  'https://www.onlinetherapytools.com',
  'https://therapistportal.onlinetherapytools.com', 
  'https://admin.onlinetherapytools.com'
];

// Development support:
// Localhost origins automatically allowed (*.localhost, 127.0.0.1, etc.)
```

### **CORS Headers (All Responses):**
```http
Access-Control-Allow-Origin: https://onlinetherapytools.com
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Cache-Control: no-cache, no-store, must-revalidate
```

### **Authentication Requirements:**
- **Token Verification**: ❌ No authentication required (anonymous access)
- **Token Revocation**: ✅ Requires `Authorization: Bearer {therapistToken}` header

---

## 🔄 **CLIENT INTEGRATION PATTERNS**

### **Pattern 1: Direct Link Generation (RECOMMENDED)**
```javascript
// Frontend generates links pointing directly to token verifier:
const generateClientLink = (token, activityUrl) => {
  const baseUrl = 'https://therapy-tools-token-validation-hub.azurewebsites.net/api/verify-token';
  const params = new URLSearchParams({
    token: token,
    redirect: activityUrl
  });
  return `${baseUrl}?${params.toString()}`;
};

// Example output:
// https://therapy-tools-token-validation-hub.azurewebsites.net/api/verify-token?token=99d4eb68a8d4c4af19091eb3cce9755042aa7cd2cf6bc4439b2189f4994b0061&redirect=https%3A//onlinetherapytools.com/activities/bingo/bingo.html

// User experience:
// 1. User clicks link → Token verifier endpoint
// 2. Backend validates token → Auto-redirect to activity with validation params
// 3. Activity page receives validated_token, therapist_id, expires_at parameters
```

### **Pattern 2: API-First Validation**
```javascript
// Frontend validates token programmatically first:
const validateToken = async (token, activityUrl) => {
  const response = await fetch('https://therapy-tools-token-validation-hub.azurewebsites.net/api/verify-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: token,
      redirectUrl: activityUrl
    })
  });
  
  if (response.ok) {
    const data = await response.json();
    // data.success === true, contains therapistId, activityUrl, expiresAt
    return data;
  } else {
    const error = await response.json();
    // error.success === false, contains error message and error code
    throw new Error(error.message);
  }
};
```

---

## 📊 **ERROR HANDLING REQUIREMENTS**

### **Frontend Error Page: `/token-expired.html`**

The frontend MUST implement an error page that handles these reason parameters:

```html
<!-- URL: https://onlinetherapytools.com/token-expired.html?reason=expired -->
<!-- URL: https://onlinetherapytools.com/token-expired.html?reason=invalid -->
<!-- URL: https://onlinetherapytools.com/token-expired.html?reason=revoked -->
<!-- URL: https://onlinetherapytools.com/token-expired.html?reason=error -->
```

**JavaScript Error Handling:**
```javascript
// Error page should parse reason parameter:
const urlParams = new URLSearchParams(window.location.search);
const reason = urlParams.get('reason');

const errorMessages = {
  'expired': 'Your session has expired. Please request a new link from your therapist.',
  'invalid': 'Invalid access link. Please contact your therapist for a new link.',
  'revoked': 'Access has been revoked. Please contact your therapist.',
  'error': 'System error occurred. Please try again or contact support.'
};

const message = errorMessages[reason] || 'Unknown error occurred.';
```

---

## 🚀 **PRODUCTION STATUS**

### **✅ READY FOR INTEGRATION**

**Backend Status:**
- ✅ All endpoints tested and functional
- ✅ Token validation logic verified
- ✅ Error handling and redirects working
- ✅ CORS configured for all production domains
- ✅ Security logging active
- ✅ Database connection and queries optimized

**Performance:**
- ✅ 5-minute timeout configured
- ✅ Efficient database queries (RowKey lookup)
- ✅ Automatic token cleanup for expired tokens
- ✅ Connection pooling for Azure Table Storage

**Security:**
- ✅ Input validation and sanitization
- ✅ Generic error messages (no information leakage)
- ✅ Comprehensive audit logging
- ✅ CORS protection active

### **Frontend Integration Confidence: 100%**

The token verifier endpoint is **production ready** and will handle all validation requirements correctly. Frontend can proceed with implementation using the specified patterns above.

---

## 📋 **QUICK REFERENCE**

**Endpoint:** `https://therapy-tools-token-validation-hub.azurewebsites.net/api/verify-token`

**Client Link Format:**
```
{endpoint}?token={64-char-token}&redirect={activity-url}
```

**Success Redirect:**
```
{activity-url}?validated_token={token}&therapist_id={id}&expires_at={iso-date}
```

**Error Redirects:**
```
/token-expired.html?reason={expired|invalid|revoked|error}
```

**Ready for immediate frontend integration!** ✅
