# DeepSeek API Validation Guide

**Quick Reference for Extension Developers**

---

## Quick Start Validation

### 1. Check Authentication

```javascript
// Test if you can get user info and token
const response = await fetch('https://chat.deepseek.com/api/v0/users/current', {
  credentials: 'include',
  headers: {
    'x-client-platform': 'web',
    'x-client-version': '1.7.0',
    'x-client-locale': 'en_US',
    'x-client-timezone-offset': '19800',
    'x-app-version': '20241129.1'
  }
});

const data = await response.json();
console.log('Token:', data.data.biz_data.token);
console.log('User:', data.data.biz_data.email);
```

**Expected Response:**
```json
{
  "code": 0,
  "data": {
    "biz_code": 0,
    "biz_data": {
      "token": "...",
      "email": "user@example.com"
    }
  }
}
```

---

### 2. List Conversations

```javascript
const token = 'YOUR_TOKEN_HERE';

const response = await fetch(
  'https://chat.deepseek.com/api/v0/chat_session/fetch_page?lte_cursor.pinned=false',
  {
    credentials: 'include',
    headers: {
      'authorization': `Bearer ${token}`,
      'x-client-platform': 'web',
      'x-client-version': '1.7.1',
      'x-client-locale': 'en_US',
      'x-client-timezone-offset': String(-(new Date().getTimezoneOffset())),
      'x-app-version': '20241129.1'
    }
  }
);

const data = await response.json();
console.log('Conversations:', data.data.biz_data.chat_sessions);
```

**Expected Response:**
```json
{
  "code": 0,
  "data": {
    "biz_data": {
      "chat_sessions": [
        {
          "id": "uuid",
          "title": "Conversation Title",
          "updated_at": 1771315975.015
        }
      ],
      "has_more": false
    }
  }
}
```

---

### 3. Get Conversation Messages

```javascript
const sessionId = 'YOUR_SESSION_ID';

const response = await fetch(
  `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${sessionId}&cache_version=2`,
  {
    credentials: 'include',
    headers: {
      'authorization': `Bearer ${token}`,
      'x-client-platform': 'web',
      'x-client-version': '1.7.1',
      'x-client-locale': 'en_US',
      'x-client-timezone-offset': String(-(new Date().getTimezoneOffset())),
      'x-app-version': '20241129.1'
    }
  }
);

const data = await response.json();
console.log('Messages:', data.data.biz_data.chat_messages);
```

---

## Critical Implementation Points

### ✓ Must Have

1. **Bearer Token Authentication**
   - Try `localStorage.getItem('userToken')` and other known keys first (plain string)
   - Fall back to `/api/v0/users/current` (async) if localStorage has nothing
   - Cache token in-memory only — **do NOT write back to localStorage** (BUG-3 fix)

2. **Required Headers**
   ```javascript
   {
     'authorization': 'Bearer {token}',
     'x-client-platform': 'web',
     'x-client-version': '1.7.1',
     'x-client-locale': 'en_US',
     'x-client-timezone-offset': String(-(new Date().getTimezoneOffset())),
     'x-app-version': '20241129.1'
   }
   ```

3. **Response Wrapper Handling**
   ```javascript
   // Always check both code and biz_code
   if (data.code === 0 && data.data.biz_code === 0) {
     return data.data.biz_data;
   }
   ```

4. **Message Structure — `fragments[]` not `content`**
   ```javascript
   // ❌ WRONG — content field is always ""
   const text = msg.content;

   // ✅ CORRECT — real text is in fragments[]
   const parts = [];
   for (const f of (msg.fragments || [])) {
     if (f.type === 'thinking' || f.type === 'reasoning') {
       parts.push(`\n> 💭 **Thinking:**\n> ${f.content.replace(/\n/g, '\n> ')}\n`);
     } else {
       parts.push(f.content || '');
     }
   }
   const text = parts.join('').trim();
   ```
   DeepSeek R1 also embeds `<think>...</think>` tags in text fragments — handle both forms.

5. **Credentials Include**
   ```javascript
   fetch(url, { credentials: 'include' })
   ```

### ⚠️ Common Pitfalls

1. **Using `msg.content` instead of `msg.fragments`**
   - `content` is always `""` — you'll get empty exports
   - Real text lives in `fragments[].content`

2. **Missing Authorization Header**
   - Will get 401 Unauthorized

3. **Wrong Response Path**
   - Data is at `data.data.biz_data`, not `data`

4. **Hardcoded Timezone Offset**
   - Use dynamic `String(-(new Date().getTimezoneOffset()))` not a hardcoded string

5. **Empty Message Arrays**
   - Some conversations have no messages
   - Always check `chat_messages.length`

---

## Validation Checklist

### Pre-Implementation

- [ ] Reviewed DEEPSEEK_API_REFERENCE.md
- [ ] Understand Bearer token authentication
- [ ] Know the 4 core endpoints
- [ ] Understand response wrapper structure

### During Implementation

- [ ] Can extract Bearer token from `/users/current`
- [ ] Can list conversations with `/chat_session/fetch_page`
- [ ] Can get messages with `/chat/history_messages`
- [ ] Handle empty message arrays gracefully
- [ ] Include all required headers
- [ ] Use `credentials: 'include'` for cookies

### Post-Implementation

- [ ] Test with real DeepSeek account
- [ ] Verify all conversations are retrieved
- [ ] Verify all messages are retrieved
- [ ] Test error handling (invalid token, network errors)
- [ ] Test with empty conversations
- [ ] Test pagination if > 20 conversations

---

## Testing Script

```javascript
async function testDeepSeekAPI() {
  console.log('=== DeepSeek API Validation ===\n');
  
  // Test 1: Get user and token
  console.log('Test 1: Authentication...');
  try {
    const userResponse = await fetch('https://chat.deepseek.com/api/v0/users/current', {
      credentials: 'include',
      headers: {
        'x-client-platform': 'web',
        'x-client-version': '1.7.0',
        'x-client-locale': 'en_US',
        'x-client-timezone-offset': String(new Date().getTimezoneOffset() * -60),
        'x-app-version': '20241129.1'
      }
    });
    
    const userData = await userResponse.json();
    if (userData.code !== 0) {
      throw new Error(`Auth failed: ${userData.msg}`);
    }
    
    const token = userData.data.biz_data.token;
    console.log('✓ Token obtained:', token.substring(0, 20) + '...');
    console.log('✓ User:', userData.data.biz_data.email);
    
    // Test 2: List conversations
    console.log('\nTest 2: List conversations...');
    const convResponse = await fetch(
      'https://chat.deepseek.com/api/v0/chat_session/fetch_page?lte_cursor.pinned=false',
      {
        credentials: 'include',
        headers: {
          'authorization': `Bearer ${token}`,
          'x-client-platform': 'web',
          'x-client-version': '1.7.0',
          'x-client-locale': 'en_US',
          'x-client-timezone-offset': String(new Date().getTimezoneOffset() * -60),
          'x-app-version': '20241129.1'
        }
      }
    );
    
    const convData = await convResponse.json();
    if (convData.code !== 0) {
      throw new Error(`List failed: ${convData.msg}`);
    }
    
    const conversations = convData.data.biz_data.chat_sessions;
    console.log(`✓ Found ${conversations.length} conversations`);
    
    // Test 3: Get messages from first conversation
    if (conversations.length > 0) {
      console.log('\nTest 3: Get conversation messages...');
      const sessionId = conversations[0].id;
      
      const msgResponse = await fetch(
        `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${sessionId}&cache_version=2`,
        {
          credentials: 'include',
          headers: {
            'authorization': `Bearer ${token}`,
            'x-client-platform': 'web',
            'x-client-version': '1.7.0',
            'x-client-locale': 'en_US',
            'x-client-timezone-offset': String(new Date().getTimezoneOffset() * -60),
            'x-app-version': '20241129.1'
          }
        }
      );
      
      const msgData = await msgResponse.json();
      if (msgData.code !== 0) {
        throw new Error(`Messages failed: ${msgData.msg}`);
      }
      
      const messages = msgData.data.biz_data.chat_messages;
      console.log(`✓ Conversation "${conversations[0].title}"`);
      console.log(`✓ Has ${messages.length} messages`);
    }
    
    console.log('\n=== All Tests Passed! ===');
    
  } catch (error) {
    console.error('✗ Test failed:', error.message);
  }
}

// Run tests
testDeepSeekAPI();
```

---

## Error Handling Reference

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `code: 40001` | Invalid/expired token | Re-authenticate with `/users/current` |
| `code: 40003` | Forbidden | Check permissions |
| `code: 40004` | Not found | Verify session ID exists |
| `code: 42900` | Rate limit | Implement exponential backoff |
| `code: 50000` | Server error | Retry with backoff |

### Error Handling Template

```javascript
async function safeAPICall(url, options) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    
    // Check HTTP status
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Check API code
    if (data.code !== 0) {
      if (data.code === 40001) {
        // Token expired - re-authenticate
        await reAuthenticate();
        return safeAPICall(url, options); // Retry
      }
      throw new Error(`API Error ${data.code}: ${data.msg}`);
    }
    
    // Check business code
    if (data.data.biz_code !== 0) {
      throw new Error(`Business Error ${data.data.biz_code}: ${data.data.biz_msg}`);
    }
    
    return data.data.biz_data;
    
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}
```

---

## Performance Tips

1. **Parallel Requests**
   ```javascript
   // Fetch multiple conversations in parallel
   const promises = sessionIds.map(id => getMessages(id));
   const results = await Promise.all(promises);
   ```

2. **Caching**
   ```javascript
   // Cache client settings for 5 minutes
   const CACHE_DURATION = 5 * 60 * 1000;
   let settingsCache = null;
   let cacheTime = 0;
   
   if (Date.now() - cacheTime > CACHE_DURATION) {
     settingsCache = await getClientSettings();
     cacheTime = Date.now();
   }
   ```

3. **Rate Limiting**
   ```javascript
   // Add delay between requests
   async function delay(ms) {
     return new Promise(resolve => setTimeout(resolve, ms));
   }
   
   for (const session of sessions) {
     await getMessages(session.id);
     await delay(100); // 100ms between requests
   }
   ```

---

## Comparison with Current Implementation

### Check Your Adapter

Compare your `deepseek-adapter.js` with these requirements:

```javascript
// ✓ Should have
class DeepSeekAdapter {
  async initialize() {
    // Get token from /users/current
  }
  
  async listConversations() {
    // Use /chat_session/fetch_page
  }
  
  async getMessages(sessionId) {
    // Use /chat/history_messages
  }
  
  getHeaders() {
    // Return all required headers including Bearer token
  }
}
```

### Verify Against HAR

1. Open `deepseek.har` in browser DevTools
2. Find `/api/v0/users/current` request
3. Compare your headers with HAR headers
4. Verify response structure matches

---

## Support & Resources

- **API Reference:** DEEPSEEK_API_REFERENCE.md
- **HAR File:** deepseek.har (7,779 lines)
- **Analysis Script:** analyze_deepseek_har.py
- **Current Adapter:** src/adapters/deepseek-adapter.js

---

**Last Updated:** February 21, 2026  
**HAR Version:** Firefox 147.0.4  
**API Version:** v0
