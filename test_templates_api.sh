#!/bin/bash

echo "🧪 Testing Document Templates API"
echo "=================================="

# Login
echo "1. Logging in as admin..."
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@zenops.local&password=admin" | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ Login failed"
  exit 1
fi
echo "✅ Logged in"

# List templates (should be empty initially)
echo -e "\n2. Listing templates..."
RESULT=$(curl -s -X GET http://localhost:8000/api/master/document-templates \
  -H "Authorization: Bearer $TOKEN")
echo "$RESULT" | jq '{total, item_count: (.items | length)}'

# Create a test template
echo -e "\n3. Creating test template..."
echo "Sample Report Template - This is a standard report format for all valuation assignments." > /tmp/sample_report.txt
RESULT=$(curl -s -X POST http://localhost:8000/api/master/document-templates \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/sample_report.txt" \
  -F "name=Sample Report Template" \
  -F "description=Standard report format for all assignments" \
  -F "category=REPORT" \
  -F "is_active=true" \
  -F "display_order=1")

TEMPLATE_ID=$(echo "$RESULT" | jq -r '.id')
if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
  echo "❌ Template creation failed"
  echo "$RESULT" | jq '.'
  exit 1
fi
echo "✅ Template created: $TEMPLATE_ID"

# Get single template
echo -e "\n4. Getting template details..."
curl -s -X GET "http://localhost:8000/api/master/document-templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, name, category, size, is_active, original_name}'

# List templates again
echo -e "\n5. Listing templates (should show 1)..."
curl -s -X GET http://localhost:8000/api/master/document-templates \
  -H "Authorization: Bearer $TOKEN" | jq '{total, items: [.items[] | {id: .id[0:8], name, category}]}'

# Update template
echo -e "\n6. Updating template..."
curl -s -X PATCH "http://localhost:8000/api/master/document-templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated: Standard report format for all valuation assignments", "display_order": 5}' | jq '{name, description, display_order}'

# Get available templates for assignment 1
echo -e "\n7. Getting available templates for assignment 1..."
curl -s -X GET "http://localhost:8000/api/master/document-templates/assignments/1/available" \
  -H "Authorization: Bearer $TOKEN" | jq '{assignment_id, template_count: (.templates | length), filters_applied}'

# Download template
echo -e "\n8. Downloading template..."
curl -s -X GET "http://localhost:8000/api/master/document-templates/$TEMPLATE_ID/download" \
  -H "Authorization: Bearer $TOKEN" -o /tmp/downloaded_template.txt
if [ -f /tmp/downloaded_template.txt ]; then
  CONTENT=$(cat /tmp/downloaded_template.txt)
  echo "✅ Template downloaded (${#CONTENT} bytes)"
  echo "   Content: ${CONTENT:0:50}..."
else
  echo "❌ Download failed"
fi

# Add document from template to assignment 1
echo -e "\n9. Adding document from template to assignment 1..."
curl -s -X POST "http://localhost:8000/api/master/document-templates/assignments/1/from-template/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{message, document_id, original_name}'

# Soft delete
echo -e "\n10. Soft deleting template..."
HTTP_CODE=$(curl -s -X DELETE "http://localhost:8000/api/master/document-templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}" -o /dev/null)
echo "HTTP Status: $HTTP_CODE"

# List templates (should show 0 active)
echo -e "\n11. Listing active templates (should show 0)..."
curl -s -X GET "http://localhost:8000/api/master/document-templates?is_active=true" \
  -H "Authorization: Bearer $TOKEN" | jq '{total}'

# List inactive templates
echo -e "\n12. Listing inactive templates (should show 1)..."
curl -s -X GET "http://localhost:8000/api/master/document-templates?is_active=false" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, items: [.items[] | {name, is_active}]}'

echo -e "\n✅ All API tests completed!"
