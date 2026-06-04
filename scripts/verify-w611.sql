SELECT count(*) AS programs FROM programs;
SELECT count(*) AS memberships FROM program_memberships;
SELECT count(*) AS users_with_active_program FROM users WHERE "activeProgramId" IS NOT NULL;
SELECT count(*) AS cohorts_default FROM cohorts WHERE "programId" = 'prg_default_lvpei_ms';
SELECT count(*) AS sessions_default FROM teaching_sessions WHERE "programId" = 'prg_default_lvpei_ms';
SELECT count(*) AS topics_default FROM topics WHERE "programId" = 'prg_default_lvpei_ms';
SELECT count(*) AS templates_default FROM case_templates WHERE "programId" = 'prg_default_lvpei_ms';
SELECT count(*) AS pearls_default FROM pearls WHERE "programId" = 'prg_default_lvpei_ms';
SELECT count(*) AS courses_default FROM courses WHERE "programId" = 'prg_default_lvpei_ms';
