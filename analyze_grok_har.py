#!/usr/bin/env python3
"""
Grok HAR File Analyzer
Analyzes grok.har to extract API endpoints, request/response patterns, and statistics
"""

import json
import sys
from collections import defaultdict
from datetime import datetime

def analyze_har(filename):
    print(f"Loading {filename}...")
    with open(filename, 'r', encoding='utf-8') as f:
        har_data = json.load(f)
    
    entries = har_data['log']['entries']
    print(f"Total entries: {len(entries)}\n")
    
    # Statistics
    api_calls = []
    domains = defaultdict(int)
    methods = defaultdict(int)
    status_codes = defaultdict(int)
    
    # Grok-specific endpoints
    grok_endpoints = defaultdict(list)
    
    for entry in entries:
        url = entry['request']['url']
        method = entry['request']['method']
        status = entry['response']['status']
        
        # Extract domain
        if '://' in url:
            domain = url.split('://')[1].split('/')[0]
            domains[domain] += 1
        
        methods[method] += 1
        status_codes[status] += 1
        
        # Grok API calls
        if 'grok.com/rest/app-chat' in url or 'grok.com/api' in url:
            # Extract endpoint pattern
            if '/rest/app-chat/' in url:
                path = url.split('/rest/app-chat/')[1].split('?')[0]
                # Normalize UUIDs
                import re
                path = re.sub(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', '{uuid}', path)
                endpoint = f"{method} /rest/app-chat/{path}"
            elif '/api/' in url:
                path = url.split('/api/')[1].split('?')[0]
                endpoint = f"{method} /api/{path}"
            else:
                endpoint = f"{method} {url}"
            
            grok_endpoints[endpoint].append({
                'url': url,
                'method': method,
                'status': status,
                'request_size': entry['request'].get('bodySize', 0),
                'response_size': entry['response']['content'].get('size', 0),
                'time': entry.get('time', 0)
            })
            api_calls.append(entry)
    
    # Print statistics
    print("=" * 80)
    print("DOMAIN DISTRIBUTION")
    print("=" * 80)
    for domain, count in sorted(domains.items(), key=lambda x: x[1], reverse=True)[:15]:
        print(f"{domain:50} {count:5} requests")
    
    print("\n" + "=" * 80)
    print("HTTP METHODS")
    print("=" * 80)
    for method, count in sorted(methods.items(), key=lambda x: x[1], reverse=True):
        print(f"{method:10} {count:5} requests")
    
    print("\n" + "=" * 80)
    print("STATUS CODES")
    print("=" * 80)
    for status, count in sorted(status_codes.items(), key=lambda x: x[1], reverse=True):
        print(f"{status:10} {count:5} responses")
    
    print("\n" + "=" * 80)
    print(f"GROK API ENDPOINTS ({len(grok_endpoints)} unique)")
    print("=" * 80)
    for endpoint, calls in sorted(grok_endpoints.items(), key=lambda x: len(x[1]), reverse=True):
        count = len(calls)
        avg_time = sum(c['time'] for c in calls) / count if count > 0 else 0
        avg_resp_size = sum(c['response_size'] for c in calls) / count if count > 0 else 0
        print(f"\n{endpoint}")
        print(f"  Count: {count}, Avg Time: {avg_time:.0f}ms, Avg Response: {avg_resp_size:.0f} bytes")
        
        # Show first example
        if calls:
            example = calls[0]
            print(f"  Example: {example['url'][:100]}")
            print(f"  Status: {example['status']}, Request: {example['request_size']} bytes, Response: {example['response_size']} bytes")
    
    print("\n" + "=" * 80)
    print("SAMPLE API RESPONSES")
    print("=" * 80)
    
    # Show sample responses for key endpoints
    key_endpoints = [
        'conversations?pageSize=60',
        'conversations_v2/',
        'response-node?includeThreads=true',
        'load-responses'
    ]
    
    for entry in api_calls[:20]:  # Check first 20 API calls
        url = entry['request']['url']
        if any(key in url for key in key_endpoints):
            print(f"\n--- {entry['request']['method']} {url[:80]} ---")
            print(f"Status: {entry['response']['status']}")
            
            content = entry['response']['content']
            if content.get('text'):
                try:
                    response_data = json.loads(content['text'])
                    print(f"Response structure: {json.dumps(response_data, indent=2)[:500]}...")
                except:
                    print(f"Response (first 300 chars): {content['text'][:300]}")
            
            # Show request body if POST
            if entry['request']['method'] == 'POST' and entry['request'].get('postData'):
                try:
                    post_data = json.loads(entry['request']['postData']['text'])
                    print(f"Request body: {json.dumps(post_data, indent=2)}")
                except:
                    print(f"Request body: {entry['request']['postData']['text'][:200]}")

if __name__ == '__main__':
    analyze_har('grok.har')
