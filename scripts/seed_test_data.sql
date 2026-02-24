-- Seed test data for Zen Ops
-- Run with: cat scripts/seed_test_data.sql | docker exec -i zen-ops-db-1 psql -U zenops -d zenops

BEGIN;

-- Clean existing test data (keep users)
DELETE FROM assignment_documents;
DELETE FROM assignment_messages;
DELETE FROM assignment_tasks;
DELETE FROM assignment_assignees;
DELETE FROM assignment_floor_areas;
DELETE FROM assignments;
DELETE FROM property_subtypes;
DELETE FROM property_types;
DELETE FROM clients WHERE id > 1;

-- Insert clients
INSERT INTO clients (name, client_type, contact_name, contact_phone, contact_email, is_active)
VALUES
  ('Acme Corporation', 'CORPORATE', 'John Doe', '+91-9876543210', 'john@acme.com', true),
  ('TechStart Limited', 'CORPORATE', 'Jane Smith', '+91-9876543211', 'jane@techstart.com', true),
  ('Green Ventures Pvt Ltd', 'CORPORATE', 'Bob Wilson', '+91-9876543212', 'bob@green.com', true),
  ('HomeSeek Realty', 'INDIVIDUAL', 'Sarah Kumar', '+91-9876543213', 'sarah@homeseek.com', true),
  ('Prime Developers', 'CORPORATE', 'Amit Patel', '+91-9876543214', 'amit@primedev.com', true),
  ('Urban Estates', 'CORPORATE', 'Priya Sharma', '+91-9876543215', 'priya@urban.com', true);

-- Insert property types
INSERT INTO property_types (name, code, description)
VALUES
  ('Residential', 'RES', 'Residential properties'),
  ('Commercial', 'COM', 'Commercial properties'),
  ('Industrial', 'IND', 'Industrial properties'),
  ('Agricultural', 'AGR', 'Agricultural land');

-- Insert property subtypes
INSERT INTO property_subtypes (property_type_id, name, code, description)
SELECT pt.id, v.name, v.code, v.description
FROM property_types pt
CROSS JOIN (VALUES
  ('Apartment', 'APT', 'Apartment/Flat'),
  ('Villa', 'VILLA', 'Independent Villa'),
  ('Row House', 'ROW', 'Row House')
) AS v(name, code, description)
WHERE pt.code = 'RES'
UNION ALL
SELECT pt.id, v.name, v.code, v.description
FROM property_types pt
CROSS JOIN (VALUES
  ('Office', 'OFF', 'Office Space'),
  ('Shop', 'SHOP', 'Retail Shop'),
  ('Warehouse', 'WARE', 'Warehouse')
) AS v(name, code, description)
WHERE pt.code = 'COM';

-- Insert assignments
INSERT INTO assignments (
    assignment_code, client_id, case_type, borrower_name, phone, address,
    property_type_id, property_subtype_id, land_area, builtup_area,
    status, service_line, site_visit_date, report_due_date,
    created_by_user_id, assigned_to_user_id, fees, is_paid
)
SELECT 
    'ASN-2024-' || LPAD(generate_series::text, 4, '0'),
    ((generate_series - 1) % 6) + 2,  -- cycle through clients
    CASE (generate_series % 3) WHEN 0 THEN 'MORTGAGE'::casetype WHEN 1 THEN 'LITIGATION'::casetype ELSE 'INSURANCE'::casetype END,
    'Borrower ' || generate_series,
    '+91-98765432' || LPAD(generate_series::text, 2, '0'),
    'Plot ' || (generate_series * 10) || ', Sector ' || ((generate_series % 5) + 1) || ', ' ||
    CASE (generate_series % 3) WHEN 0 THEN 'Mumbai, Maharashtra' WHEN 1 THEN 'Bangalore, Karnataka' ELSE 'Pune, Maharashtra' END,
    ((generate_series - 1) % 2) + 1,  -- cycle between property types 1-2
    ((generate_series - 1) % 3) + 1,  -- cycle through subtypes
    1200.00 + (generate_series * 100),
    850.00 + (generate_series * 50),
    CASE (generate_series % 4) 
        WHEN 0 THEN 'ASSIGNED'::assignmentstatus 
        WHEN 1 THEN 'IN_PROGRESS'::assignmentstatus 
        WHEN 2 THEN 'FIELD_VISIT_DONE'::assignmentstatus 
        ELSE 'PENDING'::assignmentstatus 
    END,
    'VALUATION'::serviceline,
    CURRENT_DATE + (generate_series % 10 + 1) * INTERVAL '1 day',
    CURRENT_DATE + (generate_series % 10 + 7) * INTERVAL '1 day',
    1,  -- created by admin
    CASE (generate_series % 2) WHEN 0 THEN 3 ELSE 4 END,  -- assign to emp1 or emp2
    15000.00 + (generate_series * 1000),
    (generate_series % 3) = 0  -- every 3rd is paid
FROM generate_series(1, 20);

COMMIT;

-- Show results
SELECT 'Clients: ' || COUNT(*) FROM clients;
SELECT 'Property Types: ' || COUNT(*) FROM property_types;
SELECT 'Property Subtypes: ' || COUNT(*) FROM property_subtypes;
SELECT 'Assignments: ' || COUNT(*) FROM assignments;
