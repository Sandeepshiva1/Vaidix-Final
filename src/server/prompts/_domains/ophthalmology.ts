import type { DomainConfig } from '../types';

/**
 * Ophthalmology domain — the values injected into prompt placeholders for
 * LVPEI and any other ophthalmology-focused tenant.
 *
 * To support a new domain (cardiology, dentistry, etc.), copy this file,
 * change every value, and register in _domains/index.ts. No prompt edits needed.
 */
export const ophthalmology: DomainConfig = {
  id: 'ophthalmology',

  // ---------- Naming ----------
  name: 'ophthalmology',
  nameTitle: 'Ophthalmology',
  nameUpper: 'OPHTHALMOLOGY',
  adjective: 'ophthalmic',

  // ---------- Subspecialty taxonomy ----------
  subspecialties: [
    'cornea_external',
    'glaucoma',
    'medical_retina',
    'surgical_retina',
    'vitreoretinal',
    'neuro_ophthalmology',
    'pediatric_ophthalmology',
    'strabismus',
    'oculoplastics_orbit',
    'uveitis_inflammation',
    'refractive_surgery',
    'ocular_oncology',
    'cataract',
    'ocular_pathology',
    'optics_refraction',
    'general_ophthalmology',
  ],

  // ---------- Critical conditions ----------
  criticalConditions: [
    'Acute angle-closure crisis',
    'Central or branch retinal artery occlusion',
    'Giant cell arteritis (with visual symptoms)',
    'Endophthalmitis (acute postoperative or endogenous)',
    'Rhegmatogenous retinal detachment (especially macula-on)',
    'Chemical injury (acid or alkali)',
    'Open-globe injury',
    'Retinopathy of prematurity requiring treatment',
    'Orbital cellulitis',
    'Optic neuritis (with red-flag features for compressive or infiltrative etiology)',
    'Suspected ocular tumor (retinoblastoma, choroidal melanoma)',
    'Acute uveitis with hypopyon',
    'Corneal ulcer with imminent perforation',
    'Papilledema with raised intracranial pressure features',
    'Carotid-cavernous fistula',
    'Toxic optic neuropathy from suspected ingestion (methanol, ethambutol)',
  ],

  // ---------- Imaging modalities ----------
  imagingModalities: [
    {
      name: 'Slit-lamp biomicroscopy',
      code: 'slit_lamp',
      readingPattern: 'Layered exam: lids, lashes, conjunctiva, cornea (layer by layer), AC, iris, lens',
    },
    {
      name: 'Fundus photography',
      code: 'fundus_photo',
      readingPattern: 'Disc, vessels, macula, periphery (DVM-P)',
    },
    {
      name: 'Optical coherence tomography',
      code: 'oct_macula | oct_disc | oct_anterior',
      readingPattern: 'Layers ILM through RPE; foveal contour preservation; presence of fluid, drusen, atrophy',
    },
    {
      name: 'Fluorescein angiography',
      code: 'fa',
      readingPattern: 'Phases (choroidal, arterial, venous, late); patterns (window defect, blockage, leakage, staining, pooling)',
    },
    {
      name: 'Fundus autofluorescence',
      code: 'faf',
      readingPattern: 'Hypo- vs hyper-autofluorescence patterns',
    },
    {
      name: 'OCT angiography',
      code: 'oct_a',
      readingPattern: 'Superficial and deep capillary plexus, choriocapillaris',
    },
    {
      name: 'Ultrasound B-scan',
      code: 'b_scan',
      readingPattern: 'Vitreous opacities, retinal detachment, masses',
    },
    {
      name: 'Anterior segment OCT',
      code: 'as_oct',
      readingPattern: 'Angle structures, corneal pachymetry, scleral spur',
    },
    {
      name: 'Visual field',
      code: 'visual_field',
      readingPattern: 'Reliability indices, pattern, location, severity',
    },
    {
      name: 'Corneal topography/tomography',
      code: 'topo',
      readingPattern: 'Astigmatism axis, keratoconus indices',
    },
    {
      name: 'Specular microscopy',
      code: 'specular',
      readingPattern: 'Endothelial cell density, hexagonality, polymegethism',
    },
  ],

  // ---------- Worked examples ----------
  exampleVignette:
    'A 65-year-old presents at 3 a.m. with severe right eye pain, headache, nausea, and blurred vision. Examination shows ciliary flush, mid-dilated unreactive pupil, hazy cornea, and IOP 48 mmHg.',

  examplePearl:
    'Halos around lights with headache in a patient over 50 is angle-closure until proven otherwise.',

  redFlagExamples: [
    'Sudden painless monocular vision loss → CRAO until proven otherwise',
    'Curtain over vision + flashes + new floaters → retinal detachment',
    'Acute red painful eye + halos + nausea → angle-closure crisis',
    'Post-cataract surgery + pain + decreased vision → endophthalmitis until proven otherwise',
    'New jaw claudication + temporal headache + visual symptoms in patient >50 → giant cell arteritis',
  ],

  fellowTierExample:
    'On a vitrectomy for diabetic tractional retinal detachment with active fibrovascular proliferation, what specific maneuver minimizes iatrogenic break formation when delaminating membranes off the macula, and how would you adapt the approach if the posterior hyaloid is firmly attached?',

  commonConditions: [
    'diabetic retinopathy',
    'glaucoma',
    'age-related macular degeneration',
    'cataract',
    'uveitis',
    'retinal detachment',
    'corneal ulcer',
    'optic neuritis',
    'amblyopia',
    'refractive error',
  ],

  stakesPhrase: 'vision loss',

  patientFears: [
    'going blind',
    'never seeing children or grandchildren clearly',
    'losing independence due to poor vision',
    'pain during or after eye surgery',
    'needles in the eye for injections',
  ],

  procedureExamples: [
    'intravitreal injection',
    'laser peripheral iridotomy',
    'panretinal photocoagulation',
    'phacoemulsification',
    'pars plana vitrectomy',
    'gonioscopy',
    'fundoscopy',
    'slit-lamp examination',
    'scleral indentation',
    'B-scan ultrasonography',
  ],

  drugExamples: [
    'anti-VEGF (bevacizumab, ranibizumab, aflibercept)',
    'latanoprost 0.005% qhs',
    'timolol 0.5% BID',
    'acetazolamide 500 mg',
    'cyclosporine 0.05% BID',
    'topical steroids (prednisolone, dexamethasone)',
    'pilocarpine',
    'mydriatic agents (tropicamide, phenylephrine)',
  ],

  anatomyFocus: [
    'cornea',
    'lens',
    'iris',
    'anterior chamber',
    'vitreous',
    'retina',
    'macula',
    'optic nerve',
    'choroid',
    'sclera',
  ],

  difficultConversations: [
    'breaking news of irreversible vision loss',
    'counseling a patient with newly diagnosed glaucoma about lifelong drops',
    'explaining the need for eye injections in a fearful patient',
    'discussing surgical risk for cataract surgery in a high-risk patient',
    'managing a parent\'s expectations about a child\'s amblyopia outcome',
  ],

  practiceSettings: [
    'tertiary academic ophthalmology clinic',
    'community eye hospital',
    'rural screening camp',
    'on-call emergency room consultation',
    'operating theatre',
    'vision centre / primary eye care',
    'optometry chair-side',
  ],

  boardExamNames: ['OKAP', 'FRCS', 'FRCOphth', 'AAO BCSC', 'ICO'],

  hookOpeners: [
    'Curtain over vision?',
    'Halos at night plus headache in a 55-year-old?',
    'Painful red eye 4 days post-cataract surgery?',
    'Sudden monocular vision loss in a 70-year-old with new jaw claudication?',
    'High myope with new floaters and a smoke-cloud in the vitreous?',
  ],

  exampleWhatsAppPearl:
    'Halos + headache in a patient over 50 = angle-closure until proven otherwise. Check IOP before sending to neurology.',

  exampleReelHook:
    'Tear or leak? One clue changes everything — the moment fluid shifts with gravity, your surgery reflex should stop.',

  exampleTeachBackTopic: 'diabetic retinopathy',

  // ---------- Roles ----------
  learnerRoles: ['resident', 'fellow', 'optometrist', 'technician', 'faculty'],

  // ---------- Curriculum tags ----------
  curriculumTagFormats: [
    'ico_curriculum_node:<id> — International Council of Ophthalmology curriculum',
    'aao_basic_clinical_science:<chapter> — AAO BCSC chapter',
    'rcophth_curriculum:<node> — Royal College of Ophthalmologists (UK) curriculum',
    'frcs_topic:<id> — FRCS examination topic',
    'okap_topic:<id> — OKAP examination topic',
    'frcophth_part:<n> — FRCOphth Part 1 / 2',
  ],

  // ---------- Pedagogy note ----------
  domainPedagogyNote:
    'Ophthalmology education depends heavily on visual pattern recognition (slit-lamp findings, fundus signs, OCT layers). Connect every sign to a clinical decision and to a patient consequence; vision loss is often irreversible if a red flag is missed.',

  // ---------- Disclaimer ----------
  educationalDisclaimer:
    'This content is for educational use by ophthalmology trainees. It is not a substitute for current clinical guidelines or attending judgment.',
};
