-- Specialty taxonomy — global, editable lists backing the Classroom wizard's
-- Specialty / Sub-specialty pickers. Seeded below from the list that was
-- previously hardcoded in the client; the wizard's inline "+ new" inserts here
-- so additions persist and are reusable for everyone.

-- CreateTable
CREATE TABLE "specialties" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_specialties" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "specialtyId"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sub_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "specialties_name_key" ON "specialties"("name");
CREATE INDEX "sub_specialties_specialtyId_idx" ON "sub_specialties"("specialtyId");
CREATE UNIQUE INDEX "sub_specialties_specialtyId_name_key" ON "sub_specialties"("specialtyId", "name");

-- AddForeignKey
ALTER TABLE "sub_specialties"
  ADD CONSTRAINT "sub_specialties_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: original hardcoded ophthalmology specialties (gen_random_uuid is in
-- Postgres core since v13, so no extension is required).
INSERT INTO "specialties" ("id", "name", "displayOrder") VALUES
  (gen_random_uuid()::text, 'Vitreoretina', 0),
  (gen_random_uuid()::text, 'Cornea', 1),
  (gen_random_uuid()::text, 'Cataract & IOL', 2),
  (gen_random_uuid()::text, 'Glaucoma', 3),
  (gen_random_uuid()::text, 'Uvea', 4),
  (gen_random_uuid()::text, 'Paediatric Ophthalmology', 5),
  (gen_random_uuid()::text, 'Oculoplasty', 6),
  (gen_random_uuid()::text, 'Imaging', 7),
  (gen_random_uuid()::text, 'Refractive Surgery', 8)
ON CONFLICT ("name") DO NOTHING;

-- Seed: sub-specialties, linked to their parent by name.
INSERT INTO "sub_specialties" ("id", "name", "displayOrder", "specialtyId")
SELECT gen_random_uuid()::text, sub.name, sub.ord, s.id
FROM "specialties" s
JOIN (VALUES
  ('Vitreoretina', 'Medical Retina', 0),
  ('Vitreoretina', 'Vitreoretinal Surgery', 1),
  ('Vitreoretina', 'Diabetic Retinopathy', 2),
  ('Vitreoretina', 'Macular Diseases', 3),
  ('Cornea', 'Corneal Dystrophies', 0),
  ('Cornea', 'Keratoconus', 1),
  ('Cornea', 'Transplantation', 2),
  ('Cornea', 'Ocular Surface', 3),
  ('Cataract & IOL', 'Phacoemulsification', 0),
  ('Cataract & IOL', 'Premium IOLs', 1),
  ('Cataract & IOL', 'Toric IOLs', 2),
  ('Cataract & IOL', 'Complex Cataract', 3),
  ('Glaucoma', 'Primary Open Angle', 0),
  ('Glaucoma', 'Angle Closure', 1),
  ('Glaucoma', 'Surgical Glaucoma', 2),
  ('Glaucoma', 'Pediatric Glaucoma', 3),
  ('Uvea', 'Anterior Uveitis', 0),
  ('Uvea', 'Posterior Uveitis', 1),
  ('Uvea', 'Panuveitis', 2),
  ('Uvea', 'Ocular Oncology', 3),
  ('Paediatric Ophthalmology', 'Strabismus', 0),
  ('Paediatric Ophthalmology', 'Amblyopia', 1),
  ('Paediatric Ophthalmology', 'Pediatric Cataract', 2),
  ('Paediatric Ophthalmology', 'ROP', 3),
  ('Oculoplasty', 'Eyelid Surgery', 0),
  ('Oculoplasty', 'Orbital Diseases', 1),
  ('Oculoplasty', 'Lacrimal System', 2),
  ('Oculoplasty', 'Aesthetic Oculoplasty', 3),
  ('Imaging', 'OCT', 0),
  ('Imaging', 'FFA', 1),
  ('Imaging', 'OCT-A', 2),
  ('Imaging', 'Wide-field Imaging', 3),
  ('Refractive Surgery', 'LASIK', 0),
  ('Refractive Surgery', 'SMILE', 1),
  ('Refractive Surgery', 'ICL', 2),
  ('Refractive Surgery', 'Surface Ablation', 3)
) AS sub(specialty, name, ord) ON sub.specialty = s.name
ON CONFLICT ("specialtyId", "name") DO NOTHING;
