SELECT slug, name, status FROM programs ORDER BY "createdAt";
SELECT u.email, p.slug, pm.role AS override_role
  FROM program_memberships pm
  JOIN users u ON u.id = pm."userId"
  JOIN programs p ON p.id = pm."programId"
  WHERE u.email IN ('sandeep@vaidix.local', 'rajeev.nair@vaidix.local', 'meera.krishnan@vaidix.local', 'arjun.mehta@vaidix.local', 'priya.sharma@vaidix.local')
  ORDER BY u.email, p.slug;
