-- Quick seed for testing
DELETE FROM assignments;
DELETE FROM property_subtypes;
DELETE FROM property_types;
DELETE FROM clients WHERE id > 1;

-- Insert clients
INSERT INTO clients (name, client_type, contact_name, contact_phone, contact_email, is_active)
SELECT * FROM (VALUES
  ('Acme Corp', 'CORPORATE', 'John Doe', '+91-9876543210', 'john@acme.com', true),
  ('TechStart Ltd', 'CORPORATE', 'Jane Smith', '+91-9876543211', 'jane@techstart.com', true),
  ('Green Ventures', 'CORPORATE', 'Bob Wilson', '+91-9876543212', 'bob@green.com', true),
  ('HomeSeek Realty', 'INDIVIDUAL', 'Sarah Kumar', '+91-9876543213', 'sarah@homeseek.com', true)
) AS v(name, client_type, contact_name, contact_phone, contact_email, is_active);

-- Insert property types
INSERT INTO property_types (name, code, description)
SELECT * FROM (VALUES
  ('Residential', 'RES', 'Residential properties'),
  ('Commercial', 'COM', 'Commercial properties'),
  ('Industrial', 'IND', 'Industrial properties')
) AS v(name, code, description);

-- Insert property subtypes
INSERT INTO property_subtypes (property_type_id, name, code, description)
SELECT pt.id, v.* FROM property_types pt
CROSS JOIN (VALUES
  ('Apartment', 'APT', 'Apartment/Flat'),
  ('Villa', 'VILLA', 'Independent Villa')
) AS v(name, code, description)
WHERE pt.code = 'RES';

-- Insert assignments
INSERT INTO assignments (
    code, client_id, property_address, property_city, property_state, property_pincode,
    property_type_id, status, service_line, case_type,
    inspection_date, report_due_date, created_by_user_id, assigned_to_user_id
)
SELECT 
    'ASN-2024-' || LPAD(generate_series::text, 4, '0'),
    ((generate_series - 1) % 4) + 2,  -- cycle through clients 2-5
    'Plot ' || (generate_series * 10) || ', Sector ' || ((generate_series % 5) + 1),
    CASE (generate_series % 3) WHEN 0 THEN 'Mumbai' WHEN 1 THEN 'Bangalore' ELSE 'Pune' END,
    CASE (generate_series % 3) WHEN 0 THEN 'Maharashtra' WHEN 1 THEN 'Karnataka' ELSE 'Maharashtra' END,
    CASE (generate_series % 3) WHEN 0 THEN '400001' WHEN 1 THEN '560001' ELSE '411001' END,
    1,  -- first property type
    CASE (generate_series % 3) WHEN 0 THEN 'ASSIGNED'::assignmentstatus WHEN 1 THEN 'IN_PROGRESS'::assignmentstatus ELSE 'DRAFT'::assignmentstatus END,
    'VALUATION'::serviceline,
    CASE (generate_series % 2) WHEN 0 THEN 'MORTGAGE'::casetype ELSE 'LITIGATION'::casetype END,
    CURRENT_DATE + (generate_series % 10 + 1) * INTERVAL '1 day',
    CURRENT_DATE + (generate_series % 10 + 5) * INTERVAL '1 day',
    1,
    3
FROM generate_series(1, 12);

SELECT 'Seeded: ' || COUNT(*) || ' clients' FROM clients;
SELECT 'Seeded: ' || COUNT(*) || ' property types' FROM property_types;
SELECT 'Seeded: ' || COUNT(*) || ' assignments' FROM assignments;
