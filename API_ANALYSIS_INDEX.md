# AI Platform API Endpoints Analysis - Index

## 📋 Overview

Comprehensive analysis of API endpoints from 9 major AI platform HAR files, extracting **330 unique API endpoints** across multiple AI platforms including ChatGPT, Claude, DeepSeek, Gemini, Grok, and Perplexity.

**Analysis Date:** March 16, 2025  
**Source Format:** HAR (HTTP Archive) files from live browser sessions  
**Methodology:** Python JSON parsing with keyword filtering

---

## 📊 Quick Stats

| Metric | Value |
|--------|-------|
| Platforms Analyzed | 9 |
| Total API Endpoints | 330 |
| HAR Files Processed | 9 |
| Documentation Files | 3 |
| Largest Platform | ChatGPT (90 endpoints) |
| Most Minimal | Gemini (2-3 endpoints) |

---

## 📁 Documentation Files

### 1. **API_ENDPOINTS_SUMMARY.txt** ⭐ START HERE
- **Type:** Human-readable text report
- **Size:** 12 KB
- **Content:** 
  - Executive summary
  - Platform breakdown with key hosts
  - Detailed analysis for each platform
  - Key findings and patterns
  - Security observations
  - Methodology explanation
- **Best For:** Quick reference, presentations, understanding architecture
- **Format:** Plain text with ASCII formatting

### 2. **API_ENDPOINTS_ANALYSIS.md**
- **Type:** Markdown documentation
- **Size:** 25 KB
- **Content:**
  - Statistics table
  - Complete endpoint listing by platform
  - All 330 endpoints in code blocks
  - Sorted within each platform
- **Best For:** GitHub documentation, markdown viewers, comprehensive listing
- **Format:** Markdown with code fences

### 3. **api_endpoints_reference.json**
- **Type:** Structured JSON reference
- **Size:** 28 KB
- **Content:**
  - Metadata and statistics
  - Endpoints organized by platform
  - Endpoints grouped by HTTP method (GET, POST, PUT, DELETE)
  - Machine-readable format
- **Best For:** Programmatic access, API integration, automation
- **Format:** Valid JSON with 2-space indentation

---

## 🔍 Platform Details

### ChatGPT (90 endpoints) 🚀
**Primary Host:** `chatgpt.com`

**Key Features:**
- Conversation management (`/backend-api/conversation/*`)
- Custom GPTs/Gizmos (`/backend-api/gizmos/*`)
- Memory system
- Image generation
- Deep research reports
- WebSocket support: `wss://ws.chatgpt.com/p6/ws/user/*`
- Security requirements (`/backend-api/sentinel/*`)

**HTTP Methods:** GET, POST, WSS

---

### Claude (claude.har) - 29 endpoints 📚
**Primary Host:** `claude.ai`

**Key Features:**
- Conversation API (`/api/organizations/{id}/chat_conversations*`)
- Artifact versioning
- Integration endpoints:
  - Gmail sync
  - Google Calendar
  - Google Drive
  - MCP (Model Context Protocol)
- Projects management
- Marketplace features

**HTTP Methods:** GET, POST

---

### Claude.ai (claude.ai.har) - 39 endpoints 📚
**Primary Host:** `claude.ai`, `api.anthropic.com`

**Key Features:**
- File preview endpoints
- Artifact tools and storage
- Published artifacts
- Sharing capabilities
- MCP v2 bootstrap
- Extensions support

**HTTP Methods:** GET, POST

---

### DeepSeek - 21 endpoints 🧠
**Primary Host:** `chat.deepseek.com`

**Key Features:**
- Chat completion (`/api/v0/chat/completion`)
- Message history
- Session management
- User settings
- Cloudflare Turnstile CAPTCHA
- PoW (Proof-of-Work) challenge

**HTTP Methods:** GET, POST

---

### Gemini - 3 endpoints ⚡
**Primary Host:** `gemini.google.com`

**Key Features:**
- Minimal captured surface
- RPC-style `batchexecute` endpoint
- Uses Google infrastructure

**HTTP Methods:** GET, POST

**Note:** Gemini's API is heavily abstracted through Google's RPC layer.

---

### Gemini.google.com - 2 endpoints ⚡
**Primary Host:** `gemini.google.com`

**Key Features:**
- Main endpoint: `POST /_/BardChatUi/data/batchexecute`
- Static assets from `www.gstatic.com`

**HTTP Methods:** GET, POST

---

### Grok - 31 endpoints 🤖
**Primary Host:** `grok.com`

**Key Features:**
- Conversation management (`/rest/app-chat/conversations*`)
- Workspace management
- Model listing
- Notifications
- Task management
- OAuth connectors
- Rate limits and metrics

**HTTP Methods:** GET, POST

---

### Perplexity - 59 endpoints 🔍
**Primary Host:** `www.perplexity.ai`

**Key Features:**
- Main SSE endpoint: `/rest/sse/perplexity_ask`
- Thread management
- Collection/bookmark management
- Billing information
- Rate limiting
- User profiles
- Experiments/feature flags
- Search sources

**HTTP Methods:** GET, POST, OPTIONS

---

### www.perplexity.ai - 56 endpoints 🔍
**Primary Host:** `www.perplexity.ai`

**Key Features:**
- Similar to perplexity.har with variants:
  - Computer/desktop features
  - Account promo messages
  - Credit management
  - Homepage widgets
- Thread and collection management
- Analytics

**HTTP Methods:** GET, POST

---

## 🎯 API Patterns Identified

### REST/JSON Architecture
**Platforms:** ChatGPT, Claude, DeepSeek, Grok, Perplexity

```
GET /api/endpoint - Data retrieval
POST /api/endpoint - Create/mutation
```

### RPC (batchexecute)
**Platforms:** Gemini

```
POST /_/ServiceName/data/batchexecute - Multiple operations in single call
```

### Server-Sent Events (SSE)
**Platforms:** Perplexity

```
POST /rest/sse/perplexity_ask - Streaming responses
```

### WebSocket
**Platforms:** ChatGPT

```
wss://ws.chatgpt.com/p6/ws/user/* - Real-time updates
```

---

## 📈 Common Endpoint Categories

| Category | Count | Examples |
|----------|-------|----------|
| Message/Chat Operations | 300+ | completions, history, creation |
| Conversation/Thread Management | 60+ | fetch, list, create threads |
| User/Settings Management | 40+ | preferences, profile, billing |
| Model/Configuration | 50+ | config, capabilities, models |
| File/Image Handling | 35+ | upload, preview, generation |
| Authentication/Sessions | 25+ | login, auth, session init |
| Billing/Subscriptions | 20+ | credits, pricing, plans |
| Miscellaneous | 100+ | connectors, utilities, health |

---

## 🔐 Security Observations

1. **HTTPS Enforcement:** All platforms use encrypted connections
2. **Authentication:**
   - Token-based (bearer tokens)
   - Session cookies
   - API keys
3. **Rate Limiting:** Explicit endpoints for checking limits
4. **Bot Protection:**
   - ChatGPT: Sentinel requirements
   - DeepSeek: Cloudflare Turnstile + PoW
5. **Data Protection:** Query parameters stripped from URLs (sensitive data not exposed)

---

## 🔧 Integration Patterns

### Google Services Integration
- **Claude:** Gmail, Calendar, Drive sync
- **Grok:** Google Picker API, OAuth
- **Gemini:** Native Google service

### Third-party Analytics
- Datadog RUM
- Singular Analytics
- EPPO Feature Flags

### MCP (Model Context Protocol)
- **Claude:** Full MCP support with bootstrap endpoints

### Custom Features
- **ChatGPT:** Gizmos/Custom GPTs
- **Claude:** Artifacts with versioning
- **Perplexity:** Collections and spaces
- **Grok:** Workspaces and tasks

---

## 📝 How to Use This Documentation

### For Documentation/Reference:
1. Start with **API_ENDPOINTS_SUMMARY.txt**
2. Review specific platform section
3. Check **API_ENDPOINTS_ANALYSIS.md** for complete endpoint listing

### For Development/Integration:
1. Query **api_endpoints_reference.json** programmatically
2. Filter by platform and HTTP method
3. Use as reference for API discovery

### For Research/Comparison:
1. Compare endpoint counts across platforms
2. Study architecture patterns
3. Analyze category distributions

---

## 🛠️ Technical Details

### Analysis Method
```python
1. Load HAR file as JSON
2. Iterate through log.entries
3. Extract: URL, method, headers
4. Filter for API keywords: api, rest, backend, chat, conversation, thread, message, completion, batchexecute
5. Exclude: /cdn/assets/*, query parameters
6. Deduplicate and sort results
7. Categorize by endpoint type
```

### Filter Keywords
- Architecture: `api`, `rest`, `backend`
- Functionality: `chat`, `conversation`, `thread`, `message`, `completion`, `batchexecute`

### Exclusions
- Static CDN assets
- Query parameters (base URL only)
- Duplicate URLs with different params

---

## 📚 Additional Resources

### File Locations
- **Original HAR Files:** `/home/runner/work/omniexporter-ai-fixed-v2/omniexporter-ai-fixed-v2/*.har`
- **Documentation:** Same directory as this file

### Related Files
- `API_ENDPOINTS_SUMMARY.txt` - Human-readable report
- `API_ENDPOINTS_ANALYSIS.md` - Detailed markdown listing
- `api_endpoints_reference.json` - Programmatic reference

---

## 📞 Questions & Troubleshooting

**Q: Why are some endpoints showing UUIDs?**  
A: These are actual UUIDs from the captured sessions. Treat them as template examples.

**Q: Can I use these endpoints directly?**  
A: Not recommended. These are captured from specific sessions. Use official APIs where available.

**Q: Why is Gemini's surface so small?**  
A: Gemini uses heavily abstracted RPC-style communication through Google's infrastructure.

**Q: Are these endpoints stable?**  
A: Endpoints may change without notice. This represents a point-in-time snapshot.

**Q: Which platform has the most endpoints?**  
A: ChatGPT with 90 endpoints, followed by Perplexity (59) and claude.ai (39).

---

## 🎯 Key Takeaways

1. **Diversity in Architecture:** Platforms use different communication patterns (REST, RPC, SSE, WebSocket)
2. **Common Features:** All platforms support conversation management and message handling
3. **Differentiation:** Each platform has unique integrations and features
4. **Security:** All platforms implement rate limiting and authentication
5. **Scale:** APIs range from 2 endpoints (Gemini surface) to 90 (ChatGPT)

---

**Last Updated:** March 16, 2025  
**Analysis Tool:** Python 3 with JSON/URlparse  
**Documentation Format:** Markdown + TXT + JSON

