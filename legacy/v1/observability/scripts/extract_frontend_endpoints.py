#!/usr/bin/env python3
"""
Extract API endpoint paths from frontend API client modules.

Scans frontend/src/api/*.js and extracts all API paths called via axios.
Outputs a JSON file used by the watchdog for contract validation.
"""

import json
import re
import sys
from pathlib import Path


def extract_endpoints_from_file(filepath: Path) -> list[str]:
    """Extract API endpoints from a single JS file."""
    endpoints = []
    content = filepath.read_text()
    
    # Match api.get/post/patch/delete/put calls with string paths
    # Patterns:
    # api.get('/api/...')
    # api.get(`/api/...`)
    # api.get(`/api/.../${id}/...`)
    
    patterns = [
        # Template literals: api.method(`/api/...`)
        r"api\.(get|post|patch|put|delete)\s*\(\s*`([^`]+)`",
        # Regular strings: api.method('/api/...')
        r"api\.(get|post|patch|put|delete)\s*\(\s*'([^']+)'",
        # Double quotes: api.method("/api/...")
        r'api\.(get|post|patch|put|delete)\s*\(\s*"([^"]+)"',
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, content)
        for method, path in matches:
            # Clean up template literal expressions
            # Replace ${...} with placeholder
            cleaned = re.sub(r'\$\{[^}]+\}', '{id}', path)
            if cleaned.startswith('/api'):
                endpoints.append(cleaned)
    
    return endpoints


def normalize_endpoint(path: str) -> str:
    """Normalize endpoint path for comparison."""
    # Already has {id} placeholders from extraction
    # Remove trailing slashes
    path = path.rstrip('/')
    # Remove query string params (everything after ?)
    if '?' in path:
        path = path.split('?')[0]
    return path


def main():
    """Scan frontend API files and output endpoints."""
    frontend_api_dir = Path("frontend/src/api")
    
    if not frontend_api_dir.exists():
        print(f"Error: {frontend_api_dir} does not exist", file=sys.stderr)
        sys.exit(1)
    
    all_endpoints = set()
    
    for js_file in frontend_api_dir.glob("*.js"):
        endpoints = extract_endpoints_from_file(js_file)
        for endpoint in endpoints:
            normalized = normalize_endpoint(endpoint)
            all_endpoints.add(normalized)
            print(f"Found: {normalized} (from {js_file.name})")
    
    # Sort for consistent output
    sorted_endpoints = sorted(all_endpoints)
    
    output = {
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "source": "frontend/src/api/*.js",
        "count": len(sorted_endpoints),
        "endpoints": sorted_endpoints
    }
    
    output_file = Path("observability/watchdog/frontend_endpoints.json")
    output_file.write_text(json.dumps(output, indent=2))
    
    print(f"\nExtracted {len(sorted_endpoints)} unique endpoints")
    print(f"Output written to {output_file}")


if __name__ == "__main__":
    main()
