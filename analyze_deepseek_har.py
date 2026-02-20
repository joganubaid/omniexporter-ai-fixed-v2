#!/usr/bin/env python3
"""
DeepSeek HAR File Analyzer
Analyzes network requests to extract API endpoints and authentication patterns
"""

import json
import sys
from collections import defaultdict
from urllib.parse import urlparse, parse_qs

def analyze_har(filename):
    """Analyze DeepSeek HAR file and extract API information"""
    
    with open(filename, 'r', encoding='utf-8') as f:
        har_data = json.load(f)
    
    entries = har_data['log']['entries']
    
    # Statistics
    total_requests = len(entries)
    api_calls = []
    blocked_requests = []
    auth_headers = set()
    cookies = set()
    custom_headers = set()
    
    print(f"Total network requests: {total_requests}")
    print("=" * 80)
    
    # Analyze each request
    for entry in entries:
        url = entry['request']['url']
        method = entry['request']['method']
        status = entry['response']['status']
        
        # Check for blocked requests
        if status == 0:
            blocked_requests.append(url)
            continue
        
        # Extract DeepSeek API calls
        if 'chat.deepseek.com/api' in url:
            parsed_url = urlparse(url)
            path = parsed_url.path
            query_params = parse_qs(parsed_url.query)
            
            # Extract headers
            headers = {h['name']: h['value'] for h in entry['request']['headers']}
            
            # Track authentication
            if 'authorization' in headers:
                auth_headers.add('authorization')
            
            # Track custom headers
            for header_name in headers:
                if header_name.startswith('x-'):
                    custom_headers.add(header_name)
            
            # Track cookies
            for cookie in entry['request']['cookies']:
                cookies.add(cookie['name'])
            
            # Get response
            response_content = entry['response']['content']
            response_size = response_content.get('size', 0)
            
            api_calls.append({
                'method': method,
                'path': path,
                'query_params': query_params,
                'status': status,
                'response_size': response_size,
                'headers': headers,
                'response': response_content
            })
    
    print(f"\nDeepSeek API Calls: {len(api_calls)}")
    print(f"Blocked Requests: {len(blocked_requests)}")
    print("=" * 80)
    
    # Group API calls by endpoint
    endpoints = defaultdict(list)
    for call in api_calls:
        endpoints[call['path']].append(call)
    
    print(f"\nUnique API Endpoints: {len(endpoints)}")
    print("=" * 80)
    
    for path, calls in sorted(endpoints.items()):
        print(f"\n{path}")
        print(f"  Calls: {len(calls)}")
        print(f"  Methods: {set(c['method'] for c in calls)}")
        if calls[0]['query_params']:
            print(f"  Query Params: {list(calls[0]['query_params'].keys())}")
    
    print("\n" + "=" * 80)
    print("AUTHENTICATION & HEADERS")
    print("=" * 80)
    print(f"\nAuth Headers: {sorted(auth_headers)}")
    print(f"\nCustom Headers: {sorted(custom_headers)}")
    print(f"\nCookies: {sorted(cookies)}")
    
    # Analyze blocked requests
    if blocked_requests:
        print("\n" + "=" * 80)
        print("BLOCKED REQUESTS")
        print("=" * 80)
        blocked_domains = defaultdict(int)
        for url in blocked_requests:
            domain = urlparse(url).netloc
            blocked_domains[domain] += 1
        
        for domain, count in sorted(blocked_domains.items(), key=lambda x: x[1], reverse=True):
            print(f"  {domain}: {count} requests")
    
    # Sample API responses
    print("\n" + "=" * 80)
    print("SAMPLE API RESPONSES")
    print("=" * 80)
    
    for path, calls in sorted(endpoints.items()):
        if calls[0]['response'].get('text'):
            print(f"\n{path}")
            try:
                response_data = json.loads(calls[0]['response']['text'])
                print(json.dumps(response_data, indent=2)[:500] + "...")
            except:
                print(f"  Response size: {calls[0]['response_size']} bytes")
    
    return {
        'total_requests': total_requests,
        'api_calls': len(api_calls),
        'endpoints': len(endpoints),
        'blocked_requests': len(blocked_requests),
        'auth_headers': sorted(auth_headers),
        'custom_headers': sorted(custom_headers),
        'cookies': sorted(cookies),
        'endpoint_details': endpoints
    }

if __name__ == '__main__':
    filename = 'deepseek.har'
    if len(sys.argv) > 1:
        filename = sys.argv[1]
    
    results = analyze_har(filename)
    
    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)
