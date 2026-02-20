#!/usr/bin/env python3
"""
Perplexity HAR File Analyzer
Analyzes network traffic to understand Perplexity API structure
"""

import json
import sys
from collections import defaultdict
from urllib.parse import urlparse, parse_qs

def analyze_har(filename):
    """Analyze Perplexity HAR file"""
    
    with open(filename, 'r', encoding='utf-8') as f:
        har_data = json.load(f)
    
    entries = har_data['log']['entries']
    
    # Statistics
    stats = {
        'total_requests': len(entries),
        'perplexity_api_calls': 0,
        'blocked_requests': 0,
        'third_party_requests': 0
    }
    
    # Categorize requests
    api_endpoints = defaultdict(list)
    blocked_requests = []
    third_party_domains = defaultdict(int)
    
    print(f"\n{'='*80}")
    print(f"PERPLEXITY HAR ANALYSIS")
    print(f"{'='*80}\n")
    print(f"Total Requests: {stats['total_requests']}")
    
    for idx, entry in enumerate(entries):
        url = entry['request']['url']
        method = entry['request']['method']
        status = entry['response']['status']
        
        parsed_url = urlparse(url)
        domain = parsed_url.netloc
        
        # Check if blocked
        if status == 0 or status >= 400:
            blocked_requests.append({
                'url': url,
                'status': status,
                'method': method
            })
            stats['blocked_requests'] += 1
        
        # Categorize by domain
        if 'perplexity.ai' in domain:
            # Filter out static assets
            if any(ext in url for ext in ['.js', '.css', '.png', '.jpg', '.svg', '.woff', '.ttf', '.ico']):
                continue
            
            if '/rest/' in url or '/api/' in url:
                stats['perplexity_api_calls'] += 1
                
                # Extract endpoint path
                path = parsed_url.path
                query = parsed_url.query
                
                # Get request/response details
                request_body = None
                response_body = None
                
                if 'postData' in entry['request']:
                    try:
                        request_body = json.loads(entry['request']['postData'].get('text', '{}'))
                    except:
                        request_body = entry['request']['postData'].get('text', '')
                
                if 'text' in entry['response']['content']:
                    try:
                        response_body = json.loads(entry['response']['content']['text'])
                    except:
                        response_body = entry['response']['content']['text']
                
                api_endpoints[path].append({
                    'method': method,
                    'url': url,
                    'status': status,
                    'request_body': request_body,
                    'response_body': response_body,
                    'request_headers': entry['request']['headers'],
                    'response_size': entry['response']['bodySize']
                })
        else:
            stats['third_party_requests'] += 1
            third_party_domains[domain] += 1
    
    # Print statistics
    print(f"\nPerplexity API Calls: {stats['perplexity_api_calls']}")
    print(f"Third-party Requests: {stats['third_party_requests']}")
    print(f"Blocked Requests: {stats['blocked_requests']}")
    
    # Print API endpoints
    print(f"\n{'='*80}")
    print(f"DISCOVERED API ENDPOINTS ({len(api_endpoints)} unique)")
    print(f"{'='*80}\n")
    
    for endpoint, calls in sorted(api_endpoints.items()):
        print(f"\n{endpoint}")
        print(f"  Calls: {len(calls)}")
        print(f"  Methods: {set(call['method'] for call in calls)}")
        print(f"  Status Codes: {set(call['status'] for call in calls)}")
        
        # Show first call details
        if calls:
            first_call = calls[0]
            print(f"  Example URL: {first_call['url'][:100]}...")
            if first_call['request_body']:
                print(f"  Request Body Sample: {str(first_call['request_body'])[:200]}...")
            if first_call['response_body']:
                print(f"  Response Size: {first_call['response_size']} bytes")
    
    # Print blocked requests
    if blocked_requests:
        print(f"\n{'='*80}")
        print(f"BLOCKED REQUESTS ({len(blocked_requests)})")
        print(f"{'='*80}\n")
        
        blocked_by_domain = defaultdict(int)
        for req in blocked_requests:
            domain = urlparse(req['url']).netloc
            blocked_by_domain[domain] += 1
        
        for domain, count in sorted(blocked_by_domain.items(), key=lambda x: x[1], reverse=True):
            print(f"  {domain}: {count} requests")
    
    # Print third-party domains
    print(f"\n{'='*80}")
    print(f"THIRD-PARTY DOMAINS (Top 10)")
    print(f"{'='*80}\n")
    
    for domain, count in sorted(third_party_domains.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {domain}: {count} requests")
    
    # Detailed analysis of critical endpoints
    print(f"\n{'='*80}")
    print(f"CRITICAL ENDPOINTS ANALYSIS")
    print(f"{'='*80}\n")
    
    # Analyze thread endpoint (conversation detail)
    thread_calls = [call for path, calls in api_endpoints.items() if '/rest/thread/' in path for call in calls]
    if thread_calls:
        print(f"\n1. THREAD ENDPOINT (Get Conversation)")
        print(f"   Calls: {len(thread_calls)}")
        call = thread_calls[0]
        print(f"   Method: {call['method']}")
        print(f"   URL Pattern: /rest/thread/{{thread_id}}")
        if call['response_body']:
            print(f"   Response Structure:")
            if isinstance(call['response_body'], dict):
                print(f"     Keys: {list(call['response_body'].keys())[:10]}")
    
    # Analyze session endpoint
    session_calls = api_endpoints.get('/api/auth/session', [])
    if session_calls:
        print(f"\n2. SESSION ENDPOINT")
        print(f"   Calls: {len(session_calls)}")
        call = session_calls[0]
        print(f"   Method: {call['method']}")
        if call['response_body']:
            print(f"   Response Structure:")
            if isinstance(call['response_body'], dict):
                print(f"     Keys: {list(call['response_body'].keys())}")
    
    # Analyze user info endpoint
    user_info_calls = api_endpoints.get('/rest/user/info', [])
    if user_info_calls:
        print(f"\n3. USER INFO ENDPOINT")
        print(f"   Calls: {len(user_info_calls)}")
        call = user_info_calls[0]
        print(f"   Method: {call['method']}")
        if call['response_body']:
            print(f"   Response Structure:")
            if isinstance(call['response_body'], dict):
                print(f"     Keys: {list(call['response_body'].keys())}")
    
    # Analyze collections endpoint
    collections_calls = api_endpoints.get('/rest/collections/list_user_collections', [])
    if collections_calls:
        print(f"\n4. COLLECTIONS ENDPOINT (List Conversations)")
        print(f"   Calls: {len(collections_calls)}")
        call = collections_calls[0]
        print(f"   Method: {call['method']}")
        if call['response_body']:
            print(f"   Response Structure:")
            if isinstance(call['response_body'], dict):
                print(f"     Keys: {list(call['response_body'].keys())}")
    
    print(f"\n{'='*80}")
    print(f"ANALYSIS COMPLETE")
    print(f"{'='*80}\n")
    
    return api_endpoints, stats

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python analyze_perplexity_har.py <har_file>")
        sys.exit(1)
    
    analyze_har(sys.argv[1])
