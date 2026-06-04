/**
 * VAIDIX LEARN CONTENT
 *
 * Sub-topic learning modules: each has 5 sections (Read → Play → Quiz →
 * Pearls → Cases). The Read section contains faculty-authored explanations
 * paired with plain-English analogies so residents AND curious non-medical
 * learners can follow along. Every paragraph cites a real, verifiable source
 * (Ryan's Retina, AAO BCSC, Wills Eye Manual, Kanski, landmark trials).
 *
 * This file is the content seed. Sub-topics not listed here render an
 * "Authoring in progress" placeholder — the routing and layout are already
 * wired, so adding a new sub-topic is a data-only change.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface LearnCitation {
  authors: string
  /** Book name, journal name, or trial name */
  source: string
  year: number
  /** Optional chapter, section, or page reference */
  ref?: string
}

export interface LearnReadSection {
  id: string
  heading: string
  /** 2-4 short paragraphs. Markdown not parsed — treat as plain text. */
  body: string[]
  /** The "explain like I'm not a med student" version. Uses analogies. */
  plainEnglish: string
  citation: LearnCitation
}

/**
 * Game: "Sort into buckets". Learner assigns chips to the correct column.
 * Simple, touch-friendly, scores on done.
 */
export interface LearnGame {
  kind: 'sort-into-buckets'
  title: string
  instruction: string
  buckets: { id: string; label: string; description: string; color: 'teal' | 'rose' | 'amber' | 'blue' }[]
  chips: { id: string; label: string; correctBucket: string; explanation: string }[]
}

export interface LearnQuizQuestion {
  id: string
  stem: string
  options: { id: string; text: string }[]
  correctId: string
  explanation: string
}

export interface LearnSubTopic {
  id: string
  label: string
  shortLabel: string
  description: string
  /** Rough read time in minutes for the whole Read section */
  readMinutes: number
  /** Match these strings against pearls.json `condition` field */
  pearlConditions: string[]
  /** Match these strings against cases.json `title` field (substring, case-insensitive) */
  caseTitleMatches: string[]
  read: LearnReadSection[]
  game: LearnGame
  quiz: LearnQuizQuestion[]
}

// ─────────────────────────────────────────────────────────────────────────────
// RETINA — seeded sub-topics
// ─────────────────────────────────────────────────────────────────────────────

const RETINA: LearnSubTopic[] = [
  // ───────────────────────────────────────────────
  // DIABETIC RETINOPATHY
  // ───────────────────────────────────────────────
  {
    id: 'diabetic-retinopathy',
    label: 'Diabetic Retinopathy',
    shortLabel: 'DR',
    description: 'The leading cause of blindness in working-age adults — from tiny microaneurysms to sight-threatening neovascularization.',
    readMinutes: 18,
    pearlConditions: [
      'Proliferative Diabetic Retinopathy with Tractional RD',
    ],
    caseTitleMatches: ['diabetic', 'pdr'],
    read: [
      {
        id: 'dr-1',
        heading: 'Root cause — why does diabetes attack the retina?',
        body: [
          'Chronic hyperglycaemia injures the retinal microvasculature through four intertwined biochemical pathways: (1) non-enzymatic glycation of basement-membrane proteins producing advanced glycation end-products (AGEs), (2) polyol (sorbitol) accumulation via aldose reductase, (3) protein kinase C activation, and (4) oxidative stress from mitochondrial superoxide overproduction.',
          'The first casualty is the pericyte — the mural cell that wraps around capillaries and regulates blood flow. Pericyte loss leads to focal capillary wall weakening, and the walls bulge out into microaneurysms — the earliest sign visible on fundoscopy. This is followed by capillary basement membrane thickening and inner blood–retinal barrier breakdown, which causes plasma leakage (hard exudates) and red-cell leakage (dot-and-blot haemorrhages).',
          'As more capillaries close, zones of retinal ischaemia trigger the release of vascular endothelial growth factor (VEGF). VEGF does two things: it increases vascular permeability (worsening oedema) and drives angiogenesis — the formation of fragile new blood vessels at the disc and retinal surface. These neovascular fronds bleed, contract, and pull the retina off, which is the final common pathway to blindness.',
          'Risk factors for faster progression: duration of diabetes (strongest), poor HbA1c control (each 1% reduction lowers retinopathy risk by ~35% per UKPDS), hypertension, dyslipidaemia (especially high triglycerides — see FIELD trial with fenofibrate), pregnancy (accelerates DR by 1-2 stages in a single trimester), and nephropathy (proteinuria is an independent marker of more severe retinopathy).',
          'There is also a genetic component. Twin studies show ~25-50% heritability for DR severity. Polymorphisms in VEGF-A, aldose reductase (ALR2), and receptor for AGE (RAGE) genes have been implicated, though no single gene is predictive enough for clinical use yet. The key clinical message: even with identical HbA1c levels, some patients progress faster than others.',
        ],
        plainEnglish:
          'Imagine the retina as the sensor chip at the back of a camera, and the tiny blood vessels that feed it as garden-hoses. Too much sugar in the blood slowly corrodes the rubber of those hoses from the inside. First, the walls weaken and form tiny blisters (microaneurysms). Then they leak — red blood and yellow fat seep into the retina like water staining a ceiling. Next, some hoses get completely blocked and the tissue behind them starves. The eye\'s emergency response is to grow new hoses, but these DIY hoses are thin-walled and fragile. They bleed into the gel (vitreous haemorrhage), and the scar tissue they drag along pulls the retina off like wallpaper peeling off a damp wall. The longer someone has diabetes and the higher the sugar, the faster this happens — but genes and blood pressure play a big role too.',
        citation: {
          authors: 'Antonetti DA, Silva PS, Stitt AW',
          source: 'Nature Reviews Disease Primers — "Current understanding of the molecular and cellular pathology of diabetic retinopathy"',
          year: 2021,
        },
      },
      {
        id: 'dr-2',
        heading: 'Signs to check — what you must see on the fundus',
        body: [
          'MICROANEURYSMS: Tiny red dots (20-100 µm), best seen temporal to the macula. The earliest clinical sign. On FFA they appear as pinpoint hyperfluorescent dots that may leak.',
          'DOT-AND-BLOT HAEMORRHAGES: Round, dark-red lesions in the deep retina (outer plexiform and inner nuclear layers). Distinguish from flame haemorrhages (which are in the NFL and suggest hypertensive retinopathy or papilloedema).',
          'HARD EXUDATES: Waxy yellow deposits of lipid and protein that have leaked through incompetent vessel walls. They tend to form circinate (ring-shaped) patterns around clusters of leaking microaneurysms. When hard exudates involve the fovea, vision drops.',
          'COTTON WOOL SPOTS (CWS): Fluffy white lesions from focal infarction of the nerve fibre layer. Each CWS represents a blocked precapillary arteriole. More than 5 CWS = "pre-proliferative" disease in older classifications.',
          'VENOUS BEADING AND LOOPS: Irregular calibre changes in retinal veins — like a string of sausages. This is a strong predictor of progression to PDR. Venous beading in ≥2 quadrants is one of the 4-2-1 criteria for severe NPDR.',
          'IRMA (Intraretinal microvascular abnormalities): Dilated, tortuous capillary-like channels within the retina. They represent either dilated pre-existing capillaries or early intraretinal neovascularization. On FFA, true IRMA does NOT leak (unlike NVE, which leaks profusely). IRMA in ≥1 quadrant is another 4-2-1 criterion.',
          'NVD / NVE: New vessels at the disc (NVD) or elsewhere (NVE). They grow along the posterior hyaloid face, are paper-thin, and bleed with minimal provocation. On FFA, they show intense early hyperfluorescence with profuse late leakage.',
          'VITREOUS / PRERETINAL HAEMORRHAGE: Blood in front of the retina or in the vitreous cavity. A boat-shaped subhyaloid haemorrhage with a flat meniscus (patient upright) is pathognomonic of bleeding from NV fronds. Non-clearing vitreous haemorrhage (>1 month) is an indication for vitrectomy.',
        ],
        plainEnglish:
          'Think of the eye exam as reading a story written on the retina. Tiny red dots (microaneurysms) are the opening sentence. Yellow waxy rings (hard exudates) mean something is leaking. White fluffy patches (cotton wool spots) mean small areas have lost their blood supply entirely. Sausage-shaped veins mean the veins are struggling. And if you see new, wispy, lacy vessels at the disc or on the retinal surface — that is the alarm bell. Those new vessels are the eye\'s desperate attempt to re-supply starving tissue, but they are the ones that bleed and cause the worst damage.',
        citation: {
          authors: 'American Academy of Ophthalmology',
          source: 'Basic and Clinical Science Course (BCSC), Section 12 — Retina and Vitreous, Chapter 5: Diabetic Retinopathy',
          year: 2023,
        },
      },
      {
        id: 'dr-3',
        heading: 'Classification — the ETDRS staging and the 4-2-1 rule',
        body: [
          'MILD NPDR: Microaneurysms only — no other lesions. This is the most common stage at first screening.',
          'MODERATE NPDR: More than just microaneurysms — dot-blot haemorrhages, hard exudates, cotton wool spots — but NOT meeting the 4-2-1 rule. The bulk of DR patients sit here.',
          'SEVERE NPDR (the 4-2-1 rule — any ONE of the following): (a) Diffuse intraretinal haemorrhages in all 4 quadrants, (b) Venous beading in ≥2 quadrants, or (c) IRMA in ≥1 quadrant. ~15% per year progress to high-risk PDR. The Diabetic Retinopathy Study (DRS) defined this as the "pre-proliferative" stage.',
          'VERY SEVERE NPDR: Any 2 of the 3 criteria in 4-2-1. ~45% progress to PDR within one year. Some guidelines recommend considering PRP at this stage.',
          'PDR: Neovascularization at the disc (NVD) or elsewhere (NVE). HIGH-RISK PDR: (a) NVD ≥ 1/4–1/3 disc area, (b) any NVD + vitreous haemorrhage, or (c) NVE ≥ 1/2 disc area + vitreous haemorrhage. PRP reduces severe visual loss by ~50% at high-risk stage (DRS, 1976).',
          'DME can coexist with ANY stage of DR and is classified independently: (a) Non-centre-involving: thickening within 1 disc diameter of fovea but NOT involving the central subfield. (b) Centre-involving (CI-DME): central subfield thickness > 300 µm on OCT AND visual acuity ≤ 20/32. CI-DME is the modern threshold for anti-VEGF initiation.',
        ],
        plainEnglish:
          'The classification is like a five-rung ladder from "barely noticeable" to "we need to act now". Mild = just tiny dots. Moderate = more damage but still manageable. Severe = the retina is sending distress signals (the 4-2-1 rule: haemorrhages everywhere, veins beading, or tiny abnormal vessels appearing). PDR = new fragile vessels have started growing. High-risk PDR = those vessels are bleeding. At each rung, the treatment gets more aggressive. And separately, fluid in the central reading zone (DME) can happen at any rung and needs its own treatment.',
        citation: {
          authors: 'Early Treatment Diabetic Retinopathy Study Research Group',
          source: 'Ophthalmology — "Grading diabetic retinopathy from stereoscopic color fundus photographs (ETDRS Report No. 10)"',
          year: 1991,
        },
      },
      {
        id: 'dr-4',
        heading: 'Investigations — what to order and what to look for',
        body: [
          'DILATED FUNDOSCOPY (gold standard for screening): Use binocular indirect ophthalmoscopy with a 20D or 28D lens. Slit-lamp biomicroscopy with a 78D or 90D Volk lens gives the best view of the macula and disc. Document with 7-standard-field colour fundus photography (ETDRS protocol) or widefield imaging (Optos).',
          'OPTICAL COHERENCE TOMOGRAPHY (OCT): Essential for DME assessment. Measures central subfield thickness (CST), detects intraretinal cysts, subretinal fluid, and vitreomacular traction. CST > 300 µm with reduced VA = treat. Also detects disorganisation of the retinal inner layers (DRIL), which predicts worse visual outcomes.',
          'OCT ANGIOGRAPHY (OCTA): Non-invasive capillary-level imaging. Shows foveal avascular zone (FAZ) enlargement, capillary dropout, and microaneurysm density without dye injection. Useful for detecting subclinical ischaemia in apparently mild DR.',
          'FUNDUS FLUORESCEIN ANGIOGRAPHY (FFA): The reference standard for detecting neovascularization (profuse late leakage), capillary non-perfusion (CNP) areas, and IRMA vs NVE distinction (IRMA does NOT leak on FFA). Wide-field FFA reveals peripheral non-perfusion that standard photography misses. Indicated when clinical staging is uncertain or when considering PRP.',
          'SYSTEMIC WORKUP: HbA1c (target < 7%), fasting lipid profile (triglycerides drive hard exudates), blood pressure (target < 130/80 per ACCORD-Eye), serum creatinine and urine albumin (nephropathy coexists with retinopathy), and pregnancy test in women of childbearing age (pregnancy accelerates DR).',
          'ULTRASONOGRAPHY (B-scan): When the fundus is not visible due to dense vitreous haemorrhage — to rule out tractional or combined retinal detachment before scheduling vitrectomy.',
        ],
        plainEnglish:
          'The retina doctor\'s toolkit: First, shine a light in and look (fundoscopy). Then take a cross-section scan to see if the central retina is waterlogged (OCT — the single most important test for deciding treatment). If the doctor needs to see the blood flow in detail, a dye test (FFA) maps out which areas are alive and which are starved. A newer scan (OCTA) does something similar without the dye injection. And always check the systemic numbers — sugar control (HbA1c), blood pressure, cholesterol, and kidneys — because treating the eye without controlling the body is like mopping a floor while the tap is still running.',
        citation: {
          authors: 'Silva PS, Cavallerano JD, Haddad NMN, et al.',
          source: 'Progress in Retinal and Eye Research — "Peripheral lesions identified on ultrawide field imaging predict increased risk of DR worsening"',
          year: 2015,
        },
      },
      {
        id: 'dr-5',
        heading: 'Differentials — what else could this be?',
        body: [
          'HYPERTENSIVE RETINOPATHY: Flame-shaped haemorrhages (not dot-blot), arteriolar narrowing, arteriovenous nipping, cotton wool spots. Can coexist with DR. Key distinction: hypertensive retinopathy preferentially damages arterioles; DR preferentially damages capillaries.',
          'RETINAL VEIN OCCLUSION: Haemorrhages in one sector (BRVO) or all four (CRVO). May look like asymmetric severe NPDR. Check: is it unilateral? Is the haemorrhage pattern sectoral? Is there disc swelling? CRVO has dilated tortuous veins in a "blood and thunder" pattern.',
          'RADIATION RETINOPATHY: Microaneurysms, hard exudates, and cotton wool spots in a patient who had orbital or periorbital radiation. Latency is usually 6 months–3 years post-treatment.',
          'OCULAR ISCHAEMIC SYNDROME: Carotid stenosis causes chronic retinal hypoperfusion — dilated veins (not tortuous like CRVO), dot-blot haemorrhages (mainly mid-peripheral), microaneurysms, and neovascularization. Key clue: asymmetric retinopathy + low IOP on the affected side + mid-peripheral (not posterior pole) predominance.',
          'SICKLE CELL RETINOPATHY: Sea-fan neovascularization at the peripheral retina, salmon-patch haemorrhages, black sunburst lesions. Predominantly in SC and S-thalassaemia genotypes. Geography and ethnicity are clues.',
          'PAPILLOEDEMA: Bilateral disc swelling with flame haemorrhages and CWS can mimic severe NPDR. Check: is there a headache? Is there bilateral involvement? Are there obscurations? Measure opening pressure if suspected.',
        ],
        plainEnglish:
          'Not every bleeding retina is diabetic. The exam question that catches residents: a unilateral "blood and thunder" fundus is more likely a vein blockage (CRVO) than DR, because DR is almost always bilateral and roughly symmetric. Radiation, sickle cell disease, and a blocked carotid artery can all mimic DR. The trick is to check: is it one eye or both? Is the pattern sectoral or diffuse? Does the patient have diabetes? And always check blood pressure — hypertensive retinopathy is the most common lookalike.',
        citation: {
          authors: 'Ryan SJ, Sadda SR, Hinton DR, et al.',
          source: 'Ryan\'s Retina, 7th edition (Elsevier), Chapter 49 — Differential Diagnosis of Diabetic Retinopathy',
          year: 2023,
        },
      },
      {
        id: 'dr-6',
        heading: 'Treatment — laser, injections, surgery, and systemic control',
        body: [
          'SYSTEMIC CONTROL (the foundation): Intensive glycaemic control (HbA1c < 7%) reduces DR incidence by 76% and progression by 54% (DCCT/EDIC for T1DM; UKPDS for T2DM). Blood pressure < 130/80 (UKPDS, ACCORD-Eye). Lipid control with fenofibrate reduces need for laser by 31% (FIELD, ACCORD-Eye). These are NON-NEGOTIABLE first-line measures.',
          'ANTI-VEGF INTRAVITREAL INJECTIONS (first-line for CI-DME and an option for PDR): Ranibizumab 0.5 mg, aflibercept 2 mg, bevacizumab 1.25 mg (off-label), faricimab 6 mg (dual anti-VEGF/Ang-2). Protocol T showed aflibercept superiority at VA ≤ 20/50; at better VA, all three are equivalent. Treat-and-extend protocol: monthly until dry, then extend by 2 weeks per visit to a maximum of 16 weeks.',
          'PANRETINAL PHOTOCOAGULATION (PRP) (definitive for PDR): 1200–1600 burns of 200–500 µm, placed from the arcades to the ora serrata, sparing the papillomacular bundle. PASCAL pattern-scanning laser reduces pain and treatment time. PRP causes ~0.5 lines of VA loss and mild visual field constriction but prevents severe visual loss in 50% of high-risk PDR eyes (DRS). It remains preferred over anti-VEGF for PDR when follow-up is unreliable.',
          'FOCAL/GRID MACULAR LASER: Historically first-line for DME. Now second-line after anti-VEGF. Still useful for persistent non-centre-involving DME and to reduce injection burden in CI-DME that has partially responded to anti-VEGF.',
          'INTRAVITREAL STEROIDS (second-line for DME): Dexamethasone implant (Ozurdex) — lasts ~4 months, raises IOP in 30%. Fluocinolone acetonide insert (Iluvien) — lasts ~3 years, for chronic DME after ≥2 anti-VEGF courses. Best for pseudophakic eyes (avoids steroid cataract). Triamcinolone 1-4 mg — short duration, used for vitrectomy-combined cases.',
          'PARS PLANA VITRECTOMY (PPV): Indications — (a) non-clearing vitreous haemorrhage (>1 month if macula-on, >3 months if no view), (b) tractional RD involving or threatening the macula, (c) combined tractional-rhegmatogenous RD, (d) vitreomacular traction causing DME refractory to injections. Pre-op anti-VEGF (3–7 days prior) reduces intraop bleeding but >7 days risks "crunch phenomenon" — fibrous contraction worsening traction as new vessels regress. The timing window is critical.',
          'SCREENING PROTOCOL: Type 1 DM — first screen at 5 years from diagnosis (or at puberty, whichever comes first). Type 2 DM — first screen at diagnosis (disease may have been subclinical for years). Pregnancy — screen in first trimester, repeat each trimester. Follow-up intervals: mild NPDR = 12 months; moderate NPDR = 6 months; severe NPDR = 3 months; PDR = immediate treatment.',
        ],
        plainEnglish:
          'Treatment stands on four legs. Leg 1: control sugar, blood pressure, and cholesterol systemically — this alone prevents most blindness. Leg 2: eye injections (anti-VEGF) that dry out the waterlogged macula and can shrink new vessels. Leg 3: a laser that burns the starving edges of the retina so the eye stops making fragile new vessels. Leg 4: surgery (vitrectomy) to clean out blood and peel scar tissue when legs 1-3 aren\'t enough. The art is picking the right tool at the right time. In a well-connected city, injections may be enough. In a remote area where the patient can\'t return monthly, laser is the safer bet because it\'s a one-time treatment.',
        citation: {
          authors: 'Wong TY, Sun J, Kawasaki R, et al.',
          source: 'Lancet — "Guidelines on diabetic eye care: The International Council of Ophthalmology Recommendations for Screening, Follow-Up, Referral, and Treatment"',
          year: 2018,
        },
      },
    ],
    game: {
      kind: 'sort-into-buckets',
      title: 'Sort the DR findings',
      instruction: 'Drag each finding to the stage where it first becomes diagnostic. Think: when would an ophthalmologist first expect to see this?',
      buckets: [
        { id: 'npdr', label: 'NPDR', description: 'Non-proliferative — leaks and dots, no new vessels yet', color: 'blue' },
        { id: 'pdr', label: 'PDR', description: 'Proliferative — the eye has started making new vessels', color: 'rose' },
        { id: 'dme', label: 'DME', description: 'Macular oedema — fluid in the central retina', color: 'amber' },
      ],
      chips: [
        { id: 'c1', label: 'Microaneurysms',             correctBucket: 'npdr', explanation: 'The very first visible sign — tiny bulges in weakened capillary walls.' },
        { id: 'c2', label: 'Dot-and-blot haemorrhages',  correctBucket: 'npdr', explanation: 'Leaks from microaneurysms in the deeper retina — round and dark.' },
        { id: 'c3', label: 'Cotton wool spots',          correctBucket: 'npdr', explanation: 'Infarcts of the nerve fibre layer — a sign of ischaemia but still pre-proliferative.' },
        { id: 'c4', label: 'Venous beading',             correctBucket: 'npdr', explanation: 'A sign of severe NPDR — part of the 4-2-1 rule that predicts progression to PDR.' },
        { id: 'c5', label: 'Neovascularization at disc', correctBucket: 'pdr',  explanation: 'NVD > 1/3 disc area defines high-risk PDR — PRP is indicated.' },
        { id: 'c6', label: 'Vitreous haemorrhage',       correctBucket: 'pdr',  explanation: 'New fragile vessels bleed into the vitreous — a hallmark of proliferative disease.' },
        { id: 'c7', label: 'Hard exudates at the fovea', correctBucket: 'dme',  explanation: 'Lipid deposits from leaking capillaries in the macula — classic for centre-involving DME.' },
        { id: 'c8', label: 'Central subfield > 300 µm on OCT', correctBucket: 'dme', explanation: 'The modern anatomical threshold for treating DME with anti-VEGF.' },
      ],
    },
    quiz: [
      {
        id: 'dr-q1',
        stem: 'A 58-year-old with 15 years of type 2 diabetes has a fundus showing diffuse intraretinal haemorrhages in all 4 quadrants, venous beading in 2 quadrants, and no neovascularization. What is the correct stage?',
        options: [
          { id: 'a', text: 'Mild NPDR' },
          { id: 'b', text: 'Moderate NPDR' },
          { id: 'c', text: 'Severe NPDR' },
          { id: 'd', text: 'High-risk PDR' },
        ],
        correctId: 'c',
        explanation: 'The 4-2-1 rule — diffuse haemorrhages in 4 quadrants OR venous beading in 2 quadrants OR IRMA in 1 quadrant = severe NPDR. This patient has two of those, well past the threshold. No NVD/NVE means it is NOT proliferative yet. Severe NPDR carries a ~15% one-year risk of progression to high-risk PDR.',
      },
      {
        id: 'dr-q2',
        stem: 'Which of the following is the FIRST-line treatment for centre-involving diabetic macular oedema with visual acuity 20/60?',
        options: [
          { id: 'a', text: 'Focal/grid argon laser photocoagulation' },
          { id: 'b', text: 'Intravitreal anti-VEGF injection' },
          { id: 'c', text: 'Panretinal photocoagulation' },
          { id: 'd', text: 'Pars plana vitrectomy' },
        ],
        correctId: 'b',
        explanation: 'Anti-VEGF has replaced focal laser as first-line for centre-involving DME since the DRCR Protocol T trial. At VA worse than 20/50, aflibercept was superior to bevacizumab and ranibizumab at 1 year. PRP is for proliferative disease, not DME. Vitrectomy is reserved for non-clearing haemorrhage or TRD.',
      },
      {
        id: 'dr-q3',
        stem: 'Why does intravitreal bevacizumab given 2 weeks before scheduled vitrectomy increase the risk of worsening tractional retinal detachment?',
        options: [
          { id: 'a', text: 'It causes choroidal effusion which lifts the retina.' },
          { id: 'b', text: 'It triggers immediate neovascular regrowth that tears the retina.' },
          { id: 'c', text: 'It causes rapid fibrous contraction as new vessels regress — the "crunch phenomenon".' },
          { id: 'd', text: 'It increases intraocular pressure to dangerous levels.' },
        ],
        correctId: 'c',
        explanation: 'The crunch phenomenon: anti-VEGF collapses the vascular component of fibrovascular membranes within 24–72 hours, leaving the fibrous scaffold intact. Over the following days the fibrous tissue contracts unopposed, transmitting tractional force through vitreoretinal adhesions and lifting the retina. The safe window is 3–7 days before surgery — long enough to reduce intraoperative bleeding, short enough to avoid crunch.',
      },
    ],
  },

  // ───────────────────────────────────────────────
  // AGE-RELATED MACULAR DEGENERATION
  // ───────────────────────────────────────────────
  {
    id: 'age-related-macular-degeneration',
    label: 'Age-Related Macular Degeneration',
    shortLabel: 'AMD',
    description: 'The leading cause of irreversible central vision loss in adults over 50 — from dry drusen to neovascular conversion.',
    readMinutes: 9,
    pearlConditions: [
      'Post-surgical Macular Recovery',
    ],
    caseTitleMatches: ['amd', 'macular degeneration', 'submacular'],
    read: [
      {
        id: 'amd-1',
        heading: 'The biology of aging at the RPE',
        body: [
          'AMD is fundamentally a disease of the retinal pigment epithelium (RPE) and its interface with Bruch\'s membrane. With aging, undigested photoreceptor outer-segment debris accumulates inside RPE lysosomes (lipofuscin) and between the RPE and Bruch\'s membrane (drusen). Oxidative stress, complement dysregulation, and impaired autophagy compound the injury.',
          'Small hard drusen are common in normal aging. Large soft drusen (> 125 µm) and reticular pseudodrusen are the hallmarks of intermediate AMD and independent risk factors for progression. The AREDS (Age-Related Eye Disease Study) classification remains the most widely used clinical staging system.',
        ],
        plainEnglish:
          'Every photoreceptor in your retina sheds its tip every day — like a candle dripping wax — and a layer of cleaner cells underneath eats the debris. Over decades those cleaner cells slow down, and waste piles up like yellow crumbs under a rug. Those crumbs are "drusen". Small crumbs are harmless. Big crumbs and complement (the immune system\'s cleanup crew) misbehaving together is what turns ordinary aging into macular degeneration.',
        citation: {
          authors: 'Fleckenstein M, Keenan TDL, Guymer RH, et al.',
          source: 'Nature Reviews Disease Primers — "Age-related macular degeneration"',
          year: 2021,
        },
      },
      {
        id: 'amd-2',
        heading: 'Dry vs wet — two very different endgames',
        body: [
          'Dry (non-neovascular) AMD accounts for ~85% of cases and progresses over years, with the end-stage being geographic atrophy — sharply demarcated patches where RPE and photoreceptors have been lost. Central vision fades slowly. There is no approved treatment that restores lost tissue, though pegcetacoplan and avacincaptad pegol (complement C3 and C5 inhibitors) were approved in 2023 to slow the progression of geographic atrophy.',
          'Wet (neovascular) AMD occurs when choroidal vessels break through Bruch\'s membrane and proliferate under or above the RPE, leaking fluid and blood. Vision can drop over days or weeks. This is the subtype that responds dramatically to anti-VEGF therapy — first proven in the MARINA and ANCHOR trials for ranibizumab.',
        ],
        plainEnglish:
          'Dry AMD is the slow-motion version: small patches of the sensor chip go dark, one by one, over many years. Wet AMD is the flash-flood version: a blood vessel from the layer under the retina sneaks up, leaks, and central vision drops in weeks. The slow version is frustrating but predictable; the flash-flood version is the one that needs urgent injections.',
        citation: {
          authors: 'Rosenfeld PJ, Brown DM, Heier JS, et al. (MARINA Study Group)',
          source: 'New England Journal of Medicine — "Ranibizumab for Neovascular Age-Related Macular Degeneration"',
          year: 2006,
        },
      },
      {
        id: 'amd-3',
        heading: 'The anti-VEGF revolution',
        body: [
          'Before 2006, wet AMD was treated with thermal laser or photodynamic therapy — both associated with scarring and vision loss. The introduction of anti-VEGF injections changed the natural history overnight. MARINA demonstrated that monthly ranibizumab stabilized vision in 95% of patients and improved it by 15 letters in 33% — a result with no precedent in retinal disease.',
          'Modern practice uses treat-and-extend regimens with ranibizumab, aflibercept, brolucizumab, or faricimab, individualizing injection intervals based on OCT response. The CATT trial (Martin DF et al., NEJM 2011) showed bevacizumab was non-inferior to ranibizumab — a finding that shaped access in cost-sensitive healthcare systems worldwide.',
        ],
        plainEnglish:
          'For most of the 20th century, wet AMD meant going blind in the centre of your vision. A single class of drugs changed that — injections into the eye every 4–12 weeks that block the signal telling fragile new vessels to grow. Not everyone recovers vision, but most stop losing it. An ophthalmologist in 2026 can meaningfully slow or reverse a disease that would have been untreatable when her grandmother was young.',
        citation: {
          authors: 'Martin DF, Maguire MG, Ying GS, et al. (CATT Research Group)',
          source: 'New England Journal of Medicine — "Ranibizumab and Bevacizumab for Neovascular Age-Related Macular Degeneration"',
          year: 2011,
        },
      },
    ],
    game: {
      kind: 'sort-into-buckets',
      title: 'Dry vs wet AMD — sort the signs',
      instruction: 'Each finding below belongs to either dry (non-neovascular) or wet (neovascular) AMD. Drag them into the right bucket. If a finding is seen in both, pick the one it is most diagnostic of.',
      buckets: [
        { id: 'dry', label: 'Dry AMD', description: 'Non-neovascular — slow atrophic progression', color: 'amber' },
        { id: 'wet', label: 'Wet AMD', description: 'Neovascular — leaky choroidal vessels', color: 'rose' },
      ],
      chips: [
        { id: 'c1', label: 'Soft drusen',                           correctBucket: 'dry', explanation: 'Yellow deposits between the RPE and Bruch\'s membrane — the classical early/intermediate dry AMD finding.' },
        { id: 'c2', label: 'Geographic atrophy',                    correctBucket: 'dry', explanation: 'End-stage dry AMD — sharply demarcated patches of RPE loss revealing the choroid beneath.' },
        { id: 'c3', label: 'Metamorphopsia on the Amsler grid',     correctBucket: 'wet', explanation: 'Straight lines appearing wavy is a classic symptom of subretinal fluid lifting the photoreceptors — a red flag for conversion to wet AMD.' },
        { id: 'c4', label: 'Subretinal fluid on OCT',               correctBucket: 'wet', explanation: 'Fluid under the neurosensory retina is the OCT hallmark of active choroidal neovascularization.' },
        { id: 'c5', label: 'Pigment epithelial detachment (PED)',   correctBucket: 'wet', explanation: 'A PED — especially fibrovascular — strongly suggests an underlying CNV membrane.' },
        { id: 'c6', label: 'Reticular pseudodrusen',                correctBucket: 'dry', explanation: 'Subretinal drusenoid deposits — an independent risk factor for progression but still a dry AMD finding.' },
        { id: 'c7', label: 'Lacy hyperfluorescence on FFA',         correctBucket: 'wet', explanation: 'The classic angiographic pattern of a classic CNV membrane — the reason we still do FFA in unclear cases.' },
      ],
    },
    quiz: [
      {
        id: 'amd-q1',
        stem: 'A 72-year-old presents with sudden metamorphopsia and a 2-week drop in central vision OD. OCT shows subretinal fluid, intraretinal cysts, and a small pigment epithelial detachment. What is the most appropriate first-line treatment?',
        options: [
          { id: 'a', text: 'AREDS2 vitamin supplementation' },
          { id: 'b', text: 'Intravitreal anti-VEGF injection' },
          { id: 'c', text: 'Photodynamic therapy with verteporfin' },
          { id: 'd', text: 'Thermal laser photocoagulation' },
        ],
        correctId: 'b',
        explanation: 'This is neovascular (wet) AMD. Subretinal fluid + PED + metamorphopsia = active CNV. Anti-VEGF is first-line since MARINA/ANCHOR (2006). AREDS2 is for intermediate dry AMD to reduce risk of conversion. PDT and thermal laser are obsolete for most wet AMD in the anti-VEGF era.',
      },
      {
        id: 'amd-q2',
        stem: 'Which clinical finding is MOST characteristic of intermediate dry AMD according to the AREDS classification?',
        options: [
          { id: 'a', text: 'Small hard drusen only' },
          { id: 'b', text: 'At least one large (> 125 µm) soft druse' },
          { id: 'c', text: 'Geographic atrophy involving the fovea' },
          { id: 'd', text: 'Choroidal neovascularization' },
        ],
        correctId: 'b',
        explanation: 'AREDS intermediate AMD = at least one large drusen (≥ 125 µm) OR extensive intermediate drusen OR non-central geographic atrophy. Hard drusen alone are common in normal aging. Central GA and CNV are late AMD.',
      },
      {
        id: 'amd-q3',
        stem: 'Which landmark trial first demonstrated that intravitreal ranibizumab produces visual improvement (rather than just stabilization) in wet AMD?',
        options: [
          { id: 'a', text: 'DRCR Protocol T' },
          { id: 'b', text: 'MARINA' },
          { id: 'c', text: 'AREDS2' },
          { id: 'd', text: 'CATT' },
        ],
        correctId: 'b',
        explanation: 'MARINA (Rosenfeld et al., NEJM 2006) showed ranibizumab not only prevented vision loss but improved vision by ≥15 letters in one-third of patients — unprecedented in retinal disease. ANCHOR confirmed superiority over photodynamic therapy the same year. CATT later showed bevacizumab was non-inferior; AREDS2 is about dry AMD supplements; Protocol T is diabetic macular oedema.',
      },
    ],
  },

  // ───────────────────────────────────────────────
  // RETINAL DETACHMENT
  // ───────────────────────────────────────────────
  {
    id: 'retinal-detachment',
    label: 'Rhegmatogenous Retinal Detachment',
    shortLabel: 'RD',
    description: 'A vision-threatening emergency where a retinal break allows fluid to lift the neurosensory retina off the RPE — hours matter when the macula is still on.',
    readMinutes: 9,
    pearlConditions: [
      'Rhegmatogenous Retinal Detachment',
    ],
    caseTitleMatches: ['retinal detachment', 'rhegmatogenous'],
    read: [
      {
        id: 'rd-1',
        heading: 'Anatomy of a break',
        body: [
          'The vitreous gel is attached to the retina most firmly at the vitreous base (the ora serrata), at the optic disc margin, and over retinal vessels. A posterior vitreous detachment (PVD) — an age-related liquefaction and separation of the vitreous — is the precipitating event for over 90% of rhegmatogenous detachments. In about 15% of acute PVDs, traction during the separation creates a horseshoe tear, most commonly in the superotemporal quadrant.',
          'Once a full-thickness retinal break exists, liquefied vitreous gains access to the subretinal space. Because the retina is attached to the RPE only by the loose interdigitation of photoreceptor outer segments and RPE microvilli, it lifts off easily. The detachment spreads in the direction gravity and vitreous currents permit — which is why inferior detachments are often slow-growing and superior ones are dramatic.',
        ],
        plainEnglish:
          'Imagine a giant jelly (the vitreous) glued to the wallpaper at the back of a room (the retina). With age, the jelly shrinks and pulls itself off the wallpaper. Most of the time it detaches cleanly. Sometimes it takes a chunk of wallpaper with it, tearing a flap. Now water can seep behind the wallpaper, and the wallpaper peels off. That peeling is the retinal detachment, and if it reaches the central reading zone (the macula), you stop seeing straight lines until a surgeon sticks it back down.',
        citation: {
          authors: 'Kanski JJ, Bowling B',
          source: 'Kanski\'s Clinical Ophthalmology: A Systematic Approach, 9th edition (Elsevier)',
          year: 2019,
          ref: 'Chapter 16 — Retinal Detachment',
        },
      },
      {
        id: 'rd-2',
        heading: 'Symptoms you must recognise in 30 seconds',
        body: [
          'The classic triad is photopsias (brief flashes of light from vitreoretinal traction), new-onset floaters (pigment or blood from the torn vessel), and a progressing "curtain" or "shadow" in the peripheral field. The curtain descends contralateral to the detachment — a superior detachment creates an inferior field defect and vice versa.',
          'Red flags that demand same-day evaluation: new floaters with flashes, sudden unilateral field loss, and vision loss in an eye with known risk factors (high myopia, previous cataract surgery, lattice degeneration, family history, fellow-eye RD). Any of these warrants a dilated peripheral fundus examination with indirect ophthalmoscopy and scleral indentation — the gold standard for detecting breaks.',
        ],
        plainEnglish:
          'The three symptoms to drill into every junior doctor: lightning, showers, and curtains. Lightning = flashes of light from the retina being tugged. Shower = a sudden burst of specks because a vessel tore. Curtain = a dark veil across one side of your vision that slowly expands. Any one of these symptoms in a myope, in a recent cataract patient, or after a blow to the head is a call to the on-call ophthalmologist that same hour.',
        citation: {
          authors: 'Mitry D, Charteris DG, Fleck BW, Campbell H, Singh J',
          source: 'British Journal of Ophthalmology — "The epidemiology of rhegmatogenous retinal detachment: geographical variation and clinical associations"',
          year: 2010,
        },
      },
      {
        id: 'rd-3',
        heading: 'Macula-on vs macula-off — the clock that matters',
        body: [
          'The single most important prognostic factor is whether the macula is still attached. Macula-on detachments treated within 24–48 hours have an excellent visual prognosis — often recovering to baseline. Once the macula detaches, every additional day of delay worsens the final visual outcome, with the steepest decline in the first week.',
          'Treatment options are pneumatic retinopexy (office-based gas injection, best for superior single breaks), scleral buckle (external indentation, preferred in phakic young eyes and inferior breaks), and pars plana vitrectomy (increasingly the default, especially in pseudophakic eyes or complex breaks). The choice depends on break configuration, lens status, PVR grade, and surgeon expertise.',
        ],
        plainEnglish:
          'The retina has a small central area (the macula) that you use for reading and for seeing faces. As long as that central area is still stuck to the wall, you still see; once it comes off, vision drops from 20/20 to 20/200 or worse in hours. Surgery within 1–2 days of a "macula-on" detachment usually gets vision back to normal. Once the macula has been off for days, the photoreceptors start to die, and even perfect surgery cannot fully restore the view.',
        citation: {
          authors: 'Williamson TH, Shunmugam M, Rodrigues I, Dogramaci M, Lee E',
          source: 'Retina — "Characteristics of rhegmatogenous retinal detachment and their relationship to visual outcome"',
          year: 2013,
        },
      },
    ],
    game: {
      kind: 'sort-into-buckets',
      title: 'Emergency triage — who needs surgery tonight?',
      instruction: 'Each patient below called the ophthalmology helpline. Sort them into "see tonight", "see tomorrow morning", or "routine clinic". Think about red flags and the macula clock.',
      buckets: [
        { id: 'tonight',  label: 'See tonight',          description: 'Likely macula-on RD or ruptured globe — hours matter', color: 'rose' },
        { id: 'tomorrow', label: 'Tomorrow AM',          description: 'High-risk symptoms, needs dilated exam next day',       color: 'amber' },
        { id: 'routine',  label: 'Routine clinic',       description: 'Low-risk, no red flags',                                color: 'teal' },
      ],
      chips: [
        { id: 'c1', label: '58yo myope, 2 hours of flashes, curtain in upper field, still reading normally', correctBucket: 'tonight',  explanation: 'A progressing curtain with reading vision intact = macula-on RD. This is the highest-yield moment to operate.' },
        { id: 'c2', label: '65yo, one new floater yesterday, no flashes, vision unchanged',                   correctBucket: 'tomorrow', explanation: 'PVD-type symptoms without progression — dilated exam next day is reasonable, but not safely deferrable to next week.' },
        { id: 'c3', label: '30yo with an isolated eye floater for 6 months, no new symptoms',                 correctBucket: 'routine',  explanation: 'Chronic stable floater with no red flags — book a routine clinic slot.' },
        { id: 'c4', label: '40yo after head trauma, sudden "black curtain" in one eye, vision 6/60',          correctBucket: 'tonight',  explanation: 'Trauma + sudden curtain + reduced acuity = possible macula-off RD or vitreous haemorrhage. Same-night exam.' },
        { id: 'c5', label: '70yo pseudophake with new flashes but full field',                                correctBucket: 'tomorrow', explanation: 'Pseudophakes are higher-risk for RD but this sounds like acute PVD. Next-day dilated exam with indentation.' },
        { id: 'c6', label: '25yo, flashes 1 week ago, now shadow spreading across half the visual field',     correctBucket: 'tonight',  explanation: 'Progressive shadow in a young person — macula-on RD is still possible. Do not wait until morning.' },
      ],
    },
    quiz: [
      {
        id: 'rd-q1',
        stem: 'A 60-year-old high myope develops flashes and floaters and now reports a "curtain" descending from above in the left eye over 6 hours. Visual acuity is 6/9. What is the single most important next step?',
        options: [
          { id: 'a', text: 'Urgent B-scan ultrasound to confirm detachment' },
          { id: 'b', text: 'Dilated binocular indirect ophthalmoscopy with scleral indentation' },
          { id: 'c', text: 'Oral acetazolamide to reduce subretinal fluid' },
          { id: 'd', text: 'Reassurance and review in 48 hours' },
        ],
        correctId: 'b',
        explanation: 'The curtain is descending — meaning the detachment is in the superior quadrant. Reading vision is still preserved, so the macula is likely still on. This is the golden window. The priority is to find the break with indirect ophthalmoscopy + indentation so surgery can be planned tonight or tomorrow morning. B-scan is useful when the media are opaque, not when the fundus view is clear. Delaying 48 hours risks the macula detaching.',
      },
      {
        id: 'rd-q2',
        stem: 'Which of the following is the STRONGEST independent risk factor for rhegmatogenous retinal detachment?',
        options: [
          { id: 'a', text: 'Hypertension' },
          { id: 'b', text: 'Diabetes mellitus' },
          { id: 'c', text: 'High axial myopia (> 6 D)' },
          { id: 'd', text: 'Smoking' },
        ],
        correctId: 'c',
        explanation: 'High myopia markedly elevates RD risk (roughly 10-fold over emmetropia) because the longer eye has thinner, more stretched retina and earlier vitreous syneresis. Other important risk factors: lattice degeneration, prior cataract surgery, blunt trauma, and family or fellow-eye history of RD. Hypertension and diabetes do not directly predispose to rhegmatogenous RD.',
      },
      {
        id: 'rd-q3',
        stem: 'A patient has a macula-on inferior rhegmatogenous detachment with a single horseshoe tear at the 6 o\'clock position. Which treatment is generally LEAST suitable in this scenario?',
        options: [
          { id: 'a', text: 'Pars plana vitrectomy with gas tamponade' },
          { id: 'b', text: 'Scleral buckle' },
          { id: 'c', text: 'Pneumatic retinopexy' },
          { id: 'd', text: 'Combined buckle + vitrectomy' },
        ],
        correctId: 'c',
        explanation: 'Pneumatic retinopexy requires the learner to be able to position the gas bubble against the break. Inferior breaks (at 4–8 o\'clock) cannot be reliably tamponaded by an intraocular gas bubble, which floats upward. Scleral buckle and vitrectomy are both valid for inferior breaks. This is a classic exam question distinguishing the indications for pneumatic retinopexy.',
      },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// RETINA — additional sub-topics
// ─────────────────────────────────────────────────────────────────────────────

const RETINA_CRVO: LearnSubTopic = {
  id: 'central-retinal-vein-occlusion',
  label: 'Central Retinal Vein Occlusion',
  shortLabel: 'CRVO',
  description: 'The "blood and thunder" fundus — diffuse haemorrhages from impaired venous outflow, with the spectre of neovascular glaucoma at 100 days.',
  readMinutes: 14,
  pearlConditions: [],
  caseTitleMatches: ['vein occlusion', 'crvo'],
  read: [
    {
      id: 'crvo-1',
      heading: 'Root cause — why do retinal veins block?',
      body: [
        'Central retinal vein occlusion occurs at the lamina cribrosa — the anatomical bottleneck where the CRV shares a confined space with the CRA inside a common adventitial sheath. Arteriosclerotic thickening of the CRA compresses the CRV against the rigid sieve plate, causing turbulent flow, endothelial damage, and thrombosis.',
        'Risk factors: age > 50 (strongest), systemic hypertension (present in ~65%), diabetes, dyslipidaemia, obesity, hyperviscosity syndromes (polycythaemia, Waldenström), thrombophilias (factor V Leiden, antiphospholipid syndrome), glaucoma (raised IOP compresses the CRV), and oral contraceptives in young women.',
        'In patients under 45, always investigate for thrombophilia, hyperhomocysteinaemia, and hyperviscosity. In patients over 65, check for occult malignancy and myeloproliferative disorders.',
      ],
      plainEnglish:
        'The main vein draining blood out of the retina has to pass through a tiny bony sieve at the back of the eye. With age, the artery running alongside it stiffens and squeezes it shut — like standing on a garden hose. Blood backs up, pressure rises inside the capillaries, and they burst. The retina fills with blood. High blood pressure, diabetes, and thick blood all make this more likely.',
      citation: { authors: 'Green WR, Chan CC, Hutchins GM, Terry JM', source: 'Transactions of the American Ophthalmological Society — "Central retinal vein occlusion: a prospective histopathologic study"', year: 1981 },
    },
    {
      id: 'crvo-2',
      heading: 'Signs — the fundus tells the story',
      body: [
        'CLASSIC FUNDUS: Diffuse intraretinal haemorrhages in ALL four quadrants (flame-shaped in NFL + dot-blot in deeper layers), dilated and tortuous retinal veins, disc oedema, cotton wool spots. The pattern is described as "blood and thunder" or "stormy sunset."',
        'ISCHAEMIC vs NON-ISCHAEMIC — the critical classification: Non-ischaemic (75%): VA often ≥ 6/18, mild relative afferent pupillary defect (RAPD), <10 disc areas of capillary non-perfusion (CNP) on FFA. Ischaemic (25%): VA usually ≤ 6/60, definite RAPD (≥ 0.9 log units), >10 disc areas of CNP on FFA, extensive cotton wool spots. The Central Vein Occlusion Study (CVOS) showed that 34% of initially non-ischaemic CRVO convert to ischaemic within 3 years.',
        'THE 100-DAY GLAUCOMA: Ischaemic CRVO carries a ~60% risk of developing neovascular glaucoma (NVG) — rubeosis iridis → angle neovascularization → secondary angle-closure with IOP spikes. Peak onset is around 90-100 days ("100-day glaucoma"). Check gonioscopy and iris every 2-4 weeks for the first 6 months.',
      ],
      plainEnglish:
        'The back of the eye looks like a battlefield — blood everywhere, swollen disc, tortuous veins. The key question the doctor must answer immediately: is this the mild version (lots of blood but blood flow is still getting through) or the bad version (the retina is actually starving under all that blood)? The bad version is dangerous because about 3 months later, the eye panics and grows new vessels inside the iris, which block the drain and cause a painful, vision-destroying spike in eye pressure. That is the "100-day glaucoma" — and it is the reason every CRVO patient needs frequent check-ups for 6 months.',
      citation: { authors: 'The Central Vein Occlusion Study Group', source: 'Archives of Ophthalmology — "Natural History and Clinical Management of Central Retinal Vein Occlusion (CVOS)"', year: 1997 },
    },
    {
      id: 'crvo-3',
      heading: 'Investigations and differentials',
      body: [
        'ESSENTIAL INVESTIGATIONS: FFA (capillary non-perfusion area determines ischaemic vs non-ischaemic), OCT (macular oedema — CMT, cystoid spaces, SRF), RAPD assessment (most reliable clinical marker of ischaemia), gonioscopy (angle NV), electroretinography (b-wave reduction predicts ischaemia and NVG risk — b/a ratio < 1 is ominous).',
        'SYSTEMIC WORKUP: BP measurement, fasting glucose/HbA1c, full blood count (polycythaemia), ESR/CRP (vasculitis), lipid profile, thrombophilia screen in patients < 50 (protein C, protein S, antithrombin III, factor V Leiden, antiphospholipid antibodies, homocysteine).',
        'DIFFERENTIALS: (1) Papillophlebitis (young patients, disc swelling + mild haemorrhages, self-limiting). (2) Ocular ischaemic syndrome (carotid stenosis — haemorrhages are mid-peripheral, veins dilated but NOT tortuous, low IOP). (3) Diabetic retinopathy (bilateral, symmetric, microaneurysms predominate). (4) Hypertensive retinopathy (flame haemorrhages + AV nipping but no tortuous veins). (5) Radiation retinopathy (latency post-treatment, microaneurysms, CWS).',
      ],
      plainEnglish:
        'The doctor does three things fast: (1) checks the pupil — a sluggish pupil means the bad version, (2) scans the macula with OCT to measure swelling, and (3) does a dye test (FFA) to map how much of the retina has lost its blood supply. Blood tests check for things that thicken the blood or damage vessels. The main lookalikes to rule out are a blocked carotid artery (different pattern) and diabetic retinopathy (both eyes, different story).',
      citation: { authors: 'Hayreh SS, Podhajsky PA, Zimmerman MB', source: 'Ophthalmology — "Natural history of visual outcome in central retinal vein occlusion"', year: 2011 },
    },
    {
      id: 'crvo-4',
      heading: 'Treatment — anti-VEGF, laser, and the NVG watch',
      body: [
        'MACULAR OEDEMA (the treatable part): Anti-VEGF is first-line. The CRUISE trial showed monthly ranibizumab improved VA by +14.9 letters at 6 months vs +0.8 for sham. Aflibercept (COPERNICUS, GALILEO) and dexamethasone implant (GENEVA) are also approved. Treat-and-extend protocols are standard — monthly until dry, then extend intervals.',
        'ISCHAEMIC CRVO — MANAGING NVG RISK: Close monitoring with gonioscopy and iris NV assessment every 2-4 weeks. DO NOT prophylactically laser before NV appears (CVOS showed no benefit). Once rubeosis or angle NV develops, start immediate PRP + anti-VEGF. If IOP is uncontrolled despite maximal medical therapy, consider glaucoma drainage device surgery.',
        'SYSTEMIC: Aggressive BP control, manage diabetes and lipids, stop smoking, stop OCP if applicable. There is no proven role for anticoagulation or thrombolysis in CRVO (unlike CRAO).',
      ],
      plainEnglish:
        'Two battles at once. Battle 1: dry out the swollen macula with injections (anti-VEGF). This is the part that recovers vision. Battle 2: watch like a hawk for 6 months for the new vessels that signal "100-day glaucoma" — and if they appear, blast them immediately with laser + injections. Meanwhile, control blood pressure and cholesterol to stop the other eye from doing the same thing.',
      citation: { authors: 'Brown DM, Campochiaro PA, Singh RP, et al. (CRUISE Investigators)', source: 'Ophthalmology — "Ranibizumab for macular edema following central retinal vein occlusion"', year: 2010 },
    },
  ],
  game: {
    kind: 'sort-into-buckets',
    title: 'Ischaemic vs non-ischaemic CRVO',
    instruction: 'Classify each clinical feature as pointing toward ischaemic or non-ischaemic CRVO.',
    buckets: [
      { id: 'ischaemic', label: 'Ischaemic', description: 'The dangerous subtype — high NVG risk', color: 'rose' },
      { id: 'non-ischaemic', label: 'Non-ischaemic', description: 'Milder — mainly macular oedema', color: 'teal' },
    ],
    chips: [
      { id: 'c1', label: 'VA ≤ 6/60', correctBucket: 'ischaemic', explanation: 'Poor initial vision correlates strongly with ischaemic CRVO.' },
      { id: 'c2', label: 'Definite RAPD (≥ 0.9 log units)', correctBucket: 'ischaemic', explanation: 'A strong RAPD is the most reliable clinical indicator of ischaemia.' },
      { id: 'c3', label: '>10 disc areas of CNP on FFA', correctBucket: 'ischaemic', explanation: 'This is the angiographic definition of ischaemic CRVO per the CVOS.' },
      { id: 'c4', label: 'VA ≥ 6/18', correctBucket: 'non-ischaemic', explanation: 'Preserved visual acuity suggests adequate macular perfusion.' },
      { id: 'c5', label: 'Minimal cotton wool spots', correctBucket: 'non-ischaemic', explanation: 'Fewer CWS indicate less inner retinal ischaemia.' },
      { id: 'c6', label: '60% risk of NVG at 100 days', correctBucket: 'ischaemic', explanation: 'Neovascular glaucoma risk is the reason ischaemic CRVO demands intensive follow-up.' },
    ],
  },
  quiz: [
    {
      id: 'crvo-q1',
      stem: 'A 62-year-old hypertensive presents with sudden painless blurring OS. Fundus shows diffuse haemorrhages in all quadrants with disc oedema. VA is 6/60 with a definite RAPD. What is the single most dangerous complication to watch for?',
      options: [
        { id: 'a', text: 'Macular hole' },
        { id: 'b', text: 'Neovascular glaucoma' },
        { id: 'c', text: 'Optic atrophy' },
        { id: 'd', text: 'Epiretinal membrane' },
      ],
      correctId: 'b',
      explanation: 'VA 6/60 with a definite RAPD = ischaemic CRVO. The most dangerous complication is neovascular glaucoma (NVG), which develops in ~60% of ischaemic CRVO eyes, peaking around 90-100 days. Regular gonioscopy and iris NV assessment every 2-4 weeks is essential.',
    },
    {
      id: 'crvo-q2',
      stem: 'First-line treatment for macular oedema secondary to CRVO is:',
      options: [
        { id: 'a', text: 'Grid macular laser' },
        { id: 'b', text: 'Intravitreal anti-VEGF injection' },
        { id: 'c', text: 'Prophylactic panretinal photocoagulation' },
        { id: 'd', text: 'Systemic anticoagulation' },
      ],
      correctId: 'b',
      explanation: 'CRUISE, COPERNICUS, and GALILEO trials established anti-VEGF as first-line for CRVO macular oedema. Grid laser is no longer first-line. CVOS showed no benefit for prophylactic PRP. Anticoagulation has no proven role in CRVO.',
    },
  ],
}

const RETINA_CRAO: LearnSubTopic = {
  id: 'central-retinal-artery-occlusion',
  label: 'Central Retinal Artery Occlusion',
  shortLabel: 'CRAO',
  description: 'A stroke of the eye — sudden painless monocular blindness that demands a stroke-pathway response within hours.',
  readMinutes: 12,
  pearlConditions: ['Central Retinal Artery Occlusion'],
  caseTitleMatches: ['artery occlusion', 'crao'],
  read: [
    {
      id: 'crao-1',
      heading: 'Root cause — this is a stroke equivalent',
      body: [
        'CRAO results from acute interruption of blood flow through the central retinal artery, usually from thromboembolism (70%), carotid atherosclerosis, cardiac emboli, or less commonly arteritis (GCA, ~5%). The retina tolerates ischaemia for only 90-100 minutes before irreversible photoreceptor death occurs — making this one of the most time-critical emergencies in ophthalmology.',
        'CRAO is formally classified as an acute ischaemic stroke by the American Heart Association since 2021. Up to 25% of CRAO patients have concurrent silent cerebral infarcts on MRI, and the 1-week stroke risk after CRAO is 2-5%. This means every CRAO must trigger the stroke pathway: emergent neuro-imaging, carotid duplex, echocardiography, and antiplatelet therapy.',
        'Risk factors mirror those of stroke: hypertension, atrial fibrillation, carotid stenosis, diabetes, smoking, hyperlipidaemia. In patients < 40, investigate for vasculitis, thrombophilia, sickle cell, cocaine use, and cardiac valvular disease.',
      ],
      plainEnglish:
        'A retinal artery occlusion IS a stroke — just in the eye instead of the brain. A clot or a chunk of cholesterol plaque breaks off from the carotid artery or the heart, travels up, and gets stuck in the tiny artery feeding the retina. The retina has about 90 minutes of oxygen reserve, then the nerve cells start dying permanently. The terrifying part: if a clot went to the eye, the next one might go to the brain. That is why these patients get rushed through the same stroke protocol as someone with a drooping face.',
      citation: { authors: 'Mac Grory B, Schrag M, Biousse V, et al.', source: 'Stroke — "Management of Central Retinal Artery Occlusion: A Scientific Statement From the American Heart Association"', year: 2021 },
    },
    {
      id: 'crao-2',
      heading: 'Signs — the cherry-red spot and what else to check',
      body: [
        'FUNDUS: Diffuse retinal whitening/pallor (ischaemic inner retina becomes opaque), cherry-red spot at the fovea (thin fovea transmits the choroidal red through the pale surroundings), attenuated and sometimes segmented arterioles ("boxcar" or "cattle-trucking"), slow or absent arterial filling. A visible embolus (Hollenhorst plaque — refractile cholesterol crystal at a bifurcation) is found in ~20% of non-arteritic CRAO.',
        'PUPIL: Relative afferent pupillary defect (RAPD) — often marked, 2-3+ log units.',
        'VISION: Sudden painless loss to counting fingers (CF) or hand movements (HM). If central vision is partially spared, suspect a cilioretinal artery supply to the fovea (~15% of the population has one — these patients may retain 6/18-6/36 centrally).',
        'CHERRY-RED SPOT — THE DIFFERENTIAL: Not pathognomonic for CRAO. Also seen in Tay-Sachs, Niemann-Pick, Gaucher disease, Sandhoff disease (all bilateral, paediatric, with systemic features), commotio retinae (trauma history), and quinine toxicity. Context is everything.',
      ],
      plainEnglish:
        'The retina goes pale like a limb without blood. But the very centre — the fovea — is so thin that you can still see the red colour of the blood vessels underneath, creating a "cherry-red spot" surrounded by a white dead zone. The pupil reacts sluggishly. Vision crashes to near-blindness in seconds. One important twist: a cherry-red spot alone is NOT enough for a diagnosis. In a baby, it might mean a storage disease like Tay-Sachs; after a punch to the eye, it might be bruising. The clinical context is what makes it CRAO.',
      citation: { authors: 'Hayreh SS, Zimmerman MB', source: 'American Journal of Ophthalmology — "Central retinal artery occlusion: visual outcome"', year: 2005 },
    },
    {
      id: 'crao-3',
      heading: 'Urgent workup and treatment — the first 4 hours matter',
      body: [
        'IMMEDIATE (within 4.5 hours of onset): ESR/CRP — to exclude GCA (temporal arteritis). If ESR > 50 or CRP elevated + age > 55 + headache/jaw claudication/scalp tenderness → start IV methylprednisolone 1g/day immediately and arrange same-day temporal artery biopsy. Missing GCA in CRAO leads to bilateral blindness.',
        'STROKE PATHWAY: Urgent MRI brain + DWI (silent infarcts in 25%), carotid duplex (stenosis > 50% needs vascular surgery referral), ECG + echocardiography (AF, valvular disease), antiplatelet therapy (aspirin 300mg loading then 75mg daily).',
        'OCULAR TREATMENT (limited evidence, but attempted within golden window): Ocular massage (digital pressure 10 seconds on, 10 off, repeat × 5 — to dislodge embolus), anterior chamber paracentesis (sudden IOP drop may open collapsed lumen), carbogen (95% O₂ + 5% CO₂) or hyperbaric oxygen. Intra-arterial thrombolysis (tPA via ophthalmic artery catheter) has been tried in select centres within 4-6 hours, but the EAGLE trial showed no significant benefit with increased adverse events.',
        'BEYOND THE GOLDEN WINDOW: If presentation is > 24 hours — the retina is already infarcted. Focus shifts entirely to secondary stroke prevention (antiplatelets, statin, BP control, AF management) and protecting the fellow eye.',
      ],
      plainEnglish:
        'Two races at once. Race 1: is this caused by giant cell arteritis? If yes, massive steroid doses must start within hours or the other eye goes blind too. Race 2: is a bigger stroke coming? Brain scan, neck artery scan, and heart rhythm check — all urgent. The eye treatments (pressing on the eye, draining fluid to lower pressure, breathing pure oxygen) are all "worth a try" but none has strong proof of working. The honest truth: if someone shows up 24 hours after it happened, the retina is already dead. The job becomes preventing a brain stroke and protecting the other eye.',
      citation: { authors: 'Schrag M, Mac Grory B, Engbrecht K, et al.', source: 'Journal of NeuroOphthalmology — "Acute Central Retinal Artery Occlusion Workup and Management"', year: 2022 },
    },
  ],
  game: {
    kind: 'sort-into-buckets',
    title: 'CRAO emergency triage',
    instruction: 'Sort these actions into "Do immediately (< 1 hour)" vs "Do within 24 hours" vs "Not indicated".',
    buckets: [
      { id: 'immediate', label: 'Do immediately (< 1 hr)', description: 'Time-critical actions', color: 'rose' },
      { id: 'within24', label: 'Within 24 hours', description: 'Important but not minute-by-minute', color: 'amber' },
      { id: 'not', label: 'Not indicated', description: 'No evidence or harmful', color: 'blue' },
    ],
    chips: [
      { id: 'c1', label: 'Check ESR/CRP to exclude GCA', correctBucket: 'immediate', explanation: 'Missing GCA in a CRAO causes bilateral blindness. Start steroids empirically if suspicion is high.' },
      { id: 'c2', label: 'Ocular massage', correctBucket: 'immediate', explanation: 'Attempted within hours to dislodge embolus. Limited evidence, but safe and worth trying early.' },
      { id: 'c3', label: 'Carotid duplex ultrasound', correctBucket: 'within24', explanation: 'Critical for stroke prevention — identifies carotid stenosis needing surgical referral.' },
      { id: 'c4', label: 'MRI brain with DWI', correctBucket: 'within24', explanation: '25% have concurrent silent brain infarcts — but the scan can be done within 24 hours.' },
      { id: 'c5', label: 'Prophylactic PRP laser', correctBucket: 'not', explanation: 'PRP is for proliferative retinopathy and ischaemic CRVO — it has no role in CRAO.' },
      { id: 'c6', label: 'Start aspirin 300mg', correctBucket: 'immediate', explanation: 'Antiplatelet therapy starts immediately for secondary stroke prevention.' },
    ],
  },
  quiz: [
    {
      id: 'crao-q1',
      stem: 'A 72-year-old presents 2 hours after sudden painless vision loss OD to hand movements. Fundus shows a cherry-red spot, pale retina, and attenuated arterioles. ESR is 68. What is the MOST critical immediate action?',
      options: [
        { id: 'a', text: 'Schedule FFA for next week' },
        { id: 'b', text: 'Start IV methylprednisolone 1g and arrange temporal artery biopsy' },
        { id: 'c', text: 'Prescribe aspirin and discharge' },
        { id: 'd', text: 'Refer to retina clinic in 2 weeks' },
      ],
      correctId: 'b',
      explanation: 'Age 72 + CRAO + ESR 68 = GCA until proven otherwise. Missing GCA causes bilateral blindness. Start IV methylprednisolone immediately — do NOT wait for biopsy results. Biopsy can be done within 1-2 weeks and remains positive even after weeks of steroids.',
    },
    {
      id: 'crao-q2',
      stem: 'Why is CRAO classified as a stroke equivalent by the AHA since 2021?',
      options: [
        { id: 'a', text: 'Because it causes optic nerve atrophy identical to cerebral infarction' },
        { id: 'b', text: 'Because up to 25% have concurrent silent cerebral infarcts and the short-term stroke risk is 2-5%' },
        { id: 'c', text: 'Because it always originates from a cardiac embolus' },
        { id: 'd', text: 'Because retinal arteries are anatomically part of the circle of Willis' },
      ],
      correctId: 'b',
      explanation: 'Mac Grory et al. (Stroke, 2021) showed that CRAO patients have a 2-5% stroke risk within the first week, and 25% have silent cerebral infarcts on DWI-MRI. The CRA is a branch of the ophthalmic artery (internal carotid territory), making CRAO a marker of systemic thromboembolic disease.',
    },
  ],
}

// Add CRVO and CRAO to RETINA array
RETINA.push(RETINA_CRVO, RETINA_CRAO)

// ─────────────────────────────────────────────────────────────────────────────
// GLAUCOMA
// ─────────────────────────────────────────────────────────────────────────────

const GLAUCOMA: LearnSubTopic[] = [
  {
    id: 'primary-open-angle-glaucoma',
    label: 'Primary Open-Angle Glaucoma',
    shortLabel: 'POAG',
    description: 'The "silent thief of sight" — progressive optic neuropathy with open drainage angles, often discovered only after irreversible field loss.',
    readMinutes: 16,
    pearlConditions: [],
    caseTitleMatches: ['open-angle', 'poag', 'progressive field loss'],
    read: [
      {
        id: 'poag-1',
        heading: 'Root cause — why does the optic nerve die?',
        body: [
          'POAG is a chronic progressive optic neuropathy characterised by retinal ganglion cell (RGC) death and corresponding visual field loss, with an open and normal-appearing anterior chamber angle. Intraocular pressure (IOP) is the major modifiable risk factor, but it is NOT the only cause — ~30-40% of POAG patients have IOP consistently < 21 mmHg ("normal tension glaucoma").',
          'The lamina cribrosa theory: elevated IOP creates a pressure differential across the lamina cribrosa (the sieve-like plate at the optic nerve head). This compresses axonal bundles, disrupts axoplasmic flow, and leads to mechanical damage. Additionally, reduced optic nerve head blood flow (vascular theory) and mitochondrial dysfunction contribute to RGC apoptosis.',
          'Risk factors: elevated IOP (strongest modifiable), age > 40, African descent (4-5× higher prevalence, earlier onset, more aggressive), family history (first-degree relative = 4-9× risk), myopia, thin central corneal thickness (CCT < 555 µm — OHTS), disc haemorrhage (marker of progression), and systemic hypotension (especially nocturnal dipping).',
          'Genetics: POAG has strong heritability (~65% in twin studies). Key genes: MYOC (myocilin — causes juvenile-onset OHT/POAG), OPTN (optineurin — associated with normal tension glaucoma), TBK1, SIX1/SIX6 region. A family history is the second strongest risk factor after IOP.',
        ],
        plainEnglish:
          'Glaucoma is not "high eye pressure" — it is the optic nerve dying, often silently. The optic nerve is a cable carrying visual information from the eye to the brain. In glaucoma, the nerve fibres at the back of the eye get crushed at a bony sieve (the lamina cribrosa) by fluid pressure inside the eye. But some people\'s nerves are fragile even at normal pressure — this is "normal tension glaucoma". Genetics plays a huge role: if your parent has glaucoma, your risk is 4-9× higher. African heritage makes it worse and earlier. The scary part: by the time you notice your side vision narrowing, 40% of nerve fibres may already be dead.',
        citation: { authors: 'Weinreb RN, Aung T, Medeiros FA', source: 'JAMA — "The pathophysiology and treatment of glaucoma: a review"', year: 2014 },
      },
      {
        id: 'poag-2',
        heading: 'Signs — what to check in clinic',
        body: [
          'OPTIC DISC: Increased cup-to-disc ratio (CDR) — normal is 0.3-0.5. Look for asymmetry between the two eyes (≥ 0.2 CDR difference is suspicious). Focal rim thinning (notching), especially inferotemporal and superotemporal (ISNT rule: in normal discs, rim is thickest Inferior > Superior > Nasal > Temporal — violations suggest glaucoma). Disc haemorrhage (Drance haemorrhage) — a flame-shaped bleed at the disc margin, highly specific for progression.',
          'RNFL DEFECTS: Wedge-shaped dark stripes in the peripapillary nerve fibre layer, best seen with red-free (green) illumination or OCT RNFL thickness maps.',
          'VISUAL FIELD: Characteristic patterns — nasal step (across horizontal midline), arcuate scotoma (following the arcuate nerve fibre bundle), paracentral scotoma, temporal wedge. Advanced disease: ring scotoma (complete arcuate joining up), tunnel vision. Central vision is preserved until very late — this is why patients don\'t notice until it\'s severe.',
          'GONIOSCOPY: Must be performed to confirm the angle is OPEN (Shaffer grade 3-4). An open angle is the defining feature that separates POAG from angle-closure glaucoma. Use a Goldmann or Zeiss 4-mirror lens.',
          'IOP: Goldmann applanation tonometry (GAT) is the gold standard. Normal range 10-21 mmHg, but remember: IOP fluctuates diurnally (highest in early morning, lowest in afternoon). A single reading is not enough — consider phasing (multiple IOP measurements at different times of day).',
        ],
        plainEnglish:
          'The disc at the back of the eye has a natural cup in the centre. In glaucoma, this cup enlarges as nerve fibres die — like a sinkhole slowly widening. The key signs: a big cup (especially if one eye\'s is much bigger than the other), a tiny bleed at the edge of the disc, and a specific pattern of blind spots on the visual field test. The tricky part is that central vision stays intact until late in the disease — you can lose 40% of your nerve fibres and still read 6/6 on the chart. That is why screening matters so much.',
        citation: { authors: 'Jonas JB, Aung T, Bourne RR, et al.', source: 'Lancet — "Glaucoma"', year: 2017 },
      },
      {
        id: 'poag-3',
        heading: 'Investigations — confirming and monitoring',
        body: [
          'OCT RNFL + GCC: Measures nerve fibre layer thickness and ganglion cell complex. Can detect structural damage 5-8 years before visual field loss is detectable. Red sectors on the RNFL map indicate thinning below the 1st percentile. Serial measurements track progression.',
          'HUMPHREY VISUAL FIELD (HVF 24-2 or 10-2): The functional test. Look for: reliability indices (fixation losses, false positives, false negatives), pattern deviation probability plot (highlights localised loss), glaucoma hemifield test (GHT — "outside normal limits" = suspicious), mean deviation (MD — global loss), visual field index (VFI — percentage of remaining field, best for tracking progression).',
          'CORNEAL PACHYMETRY: Thin corneas (< 555 µm) underestimate true IOP on GAT and independently increase POAG risk (OHTS). Thick corneas overestimate IOP. Every new glaucoma patient needs CCT measured at least once.',
          'DIURNAL IOP PHASING: 4-5 IOP measurements across the day to capture peak IOP and fluctuation amplitude. Fluctuation > 6 mmHg is an independent risk factor for progression (AGIS).',
        ],
        plainEnglish:
          'Two main tests: a scan of the nerve fibres at the back of the eye (OCT — like a high-resolution MRI of the optic nerve) and a visual field test (the "clicker test" where you press a button when you see flashing lights). The scan catches damage early — years before the field test shows anything. The thickness of the cornea matters too, because a thin cornea makes the pressure reading falsely low, hiding the real danger.',
        citation: { authors: 'Medeiros FA, Zangwill LM, Bowd C, et al.', source: 'Ophthalmology — "The structure and function relationship in glaucoma"', year: 2012 },
      },
      {
        id: 'poag-4',
        heading: 'Treatment — the only proven strategy is lowering IOP',
        body: [
          'TARGET IOP: Set based on baseline IOP + degree of damage + life expectancy. General targets: early/mild = 20-25% reduction from baseline; moderate = 25-30% reduction; severe/advanced = 30-50% reduction. The landmark AGIS, CIGTS, and EMGT trials all proved that IOP reduction slows progression.',
          'MEDICAL THERAPY (first-line): Prostaglandin analogues (latanoprost, travoprost, bimatoprost, latanoprostene bunod) — the most effective single agents, lower IOP by 25-35%, once-daily dosing. Side effects: iris darkening (permanent), eyelash growth, periorbital fat atrophy ("prostaglandin-associated periorbitopathy").',
          'ADD-ON AGENTS: Beta-blockers (timolol — avoid in asthma/COPD/bradycardia), alpha-agonists (brimonidine — watch for allergy), carbonic anhydrase inhibitors (dorzolamide, brinzolamide), rho-kinase inhibitors (netarsudil — conjunctival hyperaemia), fixed combinations (e.g., latanoprost/timolol).',
          'LASER: SLT (selective laser trabeculoplasty) is now considered a valid FIRST-LINE alternative to drops (LiGHT trial, Lancet 2019 — SLT was superior to eye drops at 3 years for drop-free disease control). Repeatable. Low complication rate.',
          'SURGERY: Trabeculectomy (gold standard for refractory cases — creates a guarded fistula, forming a bleb), tube shunt/glaucoma drainage device (Baerveldt, Ahmed — for failed trabs or complex cases), MIGS (minimally invasive glaucoma surgery — iStent, Hydrus, XEN gel stent — for mild-moderate disease, often combined with cataract surgery).',
        ],
        plainEnglish:
          'The only thing proven to save sight in glaucoma is lowering the eye pressure — by drops, laser, or surgery. Drops are the traditional first choice (usually a prostaglandin — one drop at bedtime). But a laser treatment called SLT has been shown to work even better than drops for 3 years and avoids the daily hassle of eye drops — a big deal for a disease that requires treatment every single day for life. If drops and laser aren\'t enough, surgery creates a new drainage channel to let fluid escape from the eye.',
        citation: { authors: 'Gazzard G, Konstantakopoulou E, Garway-Heath D, et al. (LiGHT Trial Group)', source: 'Lancet — "Selective laser trabeculoplasty versus eye drops for first-line treatment of ocular hypertension and glaucoma (LiGHT)"', year: 2019 },
      },
    ],
    game: {
      kind: 'sort-into-buckets',
      title: 'Glaucoma risk factors — modifiable vs non-modifiable',
      instruction: 'Sort each risk factor for POAG into whether a doctor can change it or not.',
      buckets: [
        { id: 'modifiable', label: 'Modifiable', description: 'Can be treated or changed', color: 'teal' },
        { id: 'non-modifiable', label: 'Non-modifiable', description: 'Cannot be changed — just monitored', color: 'amber' },
      ],
      chips: [
        { id: 'c1', label: 'Elevated IOP', correctBucket: 'modifiable', explanation: 'The major modifiable risk factor — drops, laser, or surgery can lower it.' },
        { id: 'c2', label: 'African descent', correctBucket: 'non-modifiable', explanation: '4-5× higher prevalence. Ethnicity cannot be changed — but informs screening intensity.' },
        { id: 'c3', label: 'Family history', correctBucket: 'non-modifiable', explanation: '4-9× risk with a first-degree relative affected. Genetics cannot be modified.' },
        { id: 'c4', label: 'Nocturnal blood pressure dipping', correctBucket: 'modifiable', explanation: 'Excessive nocturnal hypotension can be managed by adjusting antihypertensive timing.' },
        { id: 'c5', label: 'Thin central cornea', correctBucket: 'non-modifiable', explanation: 'CCT < 555 µm is an anatomic trait. It does not change — but informs IOP interpretation.' },
        { id: 'c6', label: 'Age > 40', correctBucket: 'non-modifiable', explanation: 'Age is the second most important risk factor — screening starts at 40, especially in high-risk groups.' },
      ],
    },
    quiz: [
      {
        id: 'poag-q1',
        stem: 'A 55-year-old African man presents for routine screening. IOP is 16 mmHg OU, CCT is 490 µm, CDR is 0.8 OD / 0.5 OS, and there is a disc haemorrhage OD. HVF shows an inferior arcuate scotoma OD. What is the most likely diagnosis?',
        options: [
          { id: 'a', text: 'Ocular hypertension' },
          { id: 'b', text: 'Normal tension glaucoma' },
          { id: 'c', text: 'Physiological cupping' },
          { id: 'd', text: 'Anterior ischaemic optic neuropathy' },
        ],
        correctId: 'b',
        explanation: 'IOP is within "normal" range (16 mmHg), but the thin cornea (490 µm) means true IOP may be higher. However, the asymmetric CDR (0.8 vs 0.5), disc haemorrhage, and arcuate scotoma are glaucomatous damage. IOP < 21 with glaucomatous damage = normal tension glaucoma (NTG). African descent and thin CCT further increase the risk profile.',
      },
      {
        id: 'poag-q2',
        stem: 'The LiGHT trial (Lancet, 2019) showed that SLT as first-line treatment compared to eye drops:',
        options: [
          { id: 'a', text: 'Was inferior and caused more complications' },
          { id: 'b', text: 'Was equivalent in IOP control but more expensive' },
          { id: 'c', text: 'Was superior — more patients were drop-free and at target IOP at 3 years' },
          { id: 'd', text: 'Was only effective in pseudophakic eyes' },
        ],
        correctId: 'c',
        explanation: 'The LiGHT trial randomized 718 treatment-naïve patients. At 3 years, 74% of SLT patients were drop-free at target IOP vs only 58% of the drops group achieving target IOP. SLT was also more cost-effective. This trial changed clinical practice — SLT is now a valid first-line option, not just an add-on.',
      },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// UVEA
// ─────────────────────────────────────────────────────────────────────────────

const UVEA: LearnSubTopic[] = [
  {
    id: 'anterior-uveitis',
    label: 'Anterior Uveitis',
    shortLabel: 'AU',
    description: 'The most common form of intraocular inflammation — from HLA-B27 acute attacks to chronic granulomatous smouldering.',
    readMinutes: 14,
    pearlConditions: ['Psoriatic Arthritis-Associated Anterior Uveitis'],
    caseTitleMatches: ['anterior uveitis', 'hla-b27'],
    read: [
      {
        id: 'au-1',
        heading: 'Root cause — why does the eye inflame from within?',
        body: [
          'Anterior uveitis (iridocyclitis) is inflammation of the iris and ciliary body. It accounts for ~75% of all uveitis cases. The pathogenesis involves autoimmune T-cell-mediated attack on uveal antigens, often triggered by molecular mimicry — microbial peptides share structural similarity with self-proteins, confusing the immune system.',
          'HLA-B27 is the single strongest genetic association in all of uveitis. HLA-B27-positive individuals have a 20-fold increased risk of acute anterior uveitis (AAU). The association is so strong that AAU is often the presenting feature that leads to the diagnosis of ankylosing spondylitis, reactive arthritis, psoriatic arthritis, or inflammatory bowel disease.',
          'Other causes: Herpes simplex/zoster (viral — unilateral, recurrent, with corneal involvement), Fuchs heterochromic iridocyclitis (chronic low-grade, unilateral, iris heterochromia), sarcoidosis (granulomatous — mutton-fat KPs, iris nodules), syphilis (the "great imitator"), tuberculosis (granulomatous, may have broad-based posterior synechiae).',
        ],
        plainEnglish:
          'The inside of the eye has its own immune system. In anterior uveitis, the body\'s immune soldiers attack the iris — the coloured part — by mistake. The most common trigger is a specific gene called HLA-B27, which is also linked to back pain (ankylosing spondylitis). So a young person showing up with a painful red eye may actually be showing the first sign of a spine disease. Infections (herpes, TB, syphilis) can also cause it, and each has its own fingerprint that an experienced eye doctor can read from the pattern of inflammation inside the eye.',
        citation: { authors: 'Jabs DA, Nussenblatt RB, Rosenbaum JT', source: 'American Journal of Ophthalmology — "Standardization of Uveitis Nomenclature (SUN) Working Group"', year: 2005 },
      },
      {
        id: 'au-2',
        heading: 'Signs — the slit lamp tells everything',
        body: [
          'CELLS IN THE ANTERIOR CHAMBER: Graded by SUN criteria — 0 to 4+ (0 = <1 cell, 0.5+ = 1-5, 1+ = 6-15, 2+ = 16-25, 3+ = 26-50, 4+ = >50 cells per field with a 1mm × 1mm slit beam at 45° in a dark room).',
          'FLARE: Protein leakage from inflamed iris vessels — graded 0 to 4+. Severe flare appears as a milky swirl (like headlights in fog). A laser flare meter can quantify it objectively.',
          'KERATIC PRECIPITATES (KPs): Inflammatory cell deposits on the corneal endothelium. Fine KPs = non-granulomatous (typically HLA-B27, viral). Mutton-fat KPs = granulomatous (sarcoidosis, TB, syphilis, VKH). Stellate KPs = Fuchs heterochromic iridocyclitis.',
          'POSTERIOR SYNECHIAE: Adhesions between the iris and the anterior lens capsule. If 360° (seclusio pupillae) → iris bombe → secondary angle closure → acute pressure spike. Prevention: cycloplegics (cyclopentolate, atropine) in every acute episode.',
          'HYPOPYON: Layered white cells in the anterior chamber — gravity-dependent. Seen in severe HLA-B27 AAU, Behçet disease (classically shifting, mobile), and endophthalmitis (distinguishing the two is critical).',
          'IRIS NODULES: Koeppe nodules (pupillary margin) and Busacca nodules (iris surface) — hallmarks of granulomatous inflammation (sarcoidosis, TB).',
        ],
        plainEnglish:
          'The slit lamp (a microscope with a focused beam of light) reveals the battle scene inside the eye. White blood cells floating in the eye\'s front chamber like dust motes in a sunbeam = inflammation. Protein mist making the fluid cloudy = worse inflammation. Sticky deposits on the inner surface of the cornea = specific clues to the cause (small = viral/autoimmune, large and greasy = TB/sarcoidosis). The iris sticking to the lens behind it = danger (if it sticks all the way around, pressure builds up and can destroy the eye). Drops that keep the pupil wide prevent this sticking.',
        citation: { authors: 'Rothova A, Suttorp-van Schulten MSA, Treffers WF, Kijlstra A', source: 'British Journal of Ophthalmology — "Causes and frequency of blindness in patients with intraocular inflammatory disease"', year: 1996 },
      },
      {
        id: 'au-3',
        heading: 'Workup — pattern-based investigation',
        body: [
          'FIRST EPISODE, UNILATERAL, YOUNG MALE, NON-GRANULOMATOUS: HLA-B27, sacroiliac X-ray (or MRI SI joints if X-ray negative), ESR/CRP. >50% will be HLA-B27 positive. If positive + back pain → refer rheumatology for ankylosing spondylitis workup.',
          'RECURRENT OR BILATERAL: Add chest X-ray (sarcoidosis, TB), ACE level + serum lysozyme (sarcoidosis), Mantoux/QuantiFERON (TB), RPR/VDRL + FTA-ABS (syphilis). In endemic regions, add Toxoplasma IgG/IgM.',
          'GRANULOMATOUS (mutton-fat KPs, iris nodules): Chest X-ray + HRCT chest (sarcoid — bilateral hilar lymphadenopathy, TB — apical infiltrates), ACE + lysozyme, Mantoux/IGRA, RPR/VDRL. Consider conjunctival or lacrimal gland biopsy if sarcoidosis suspected but serology negative.',
          'CHRONIC / REFRACTORY: Rule out masquerade syndromes — intraocular lymphoma (vitreous cells + sub-RPE deposits, send vitreous for cytology and IL-10:IL-6 ratio), retinoblastoma (children), juvenile xanthogranuloma (children — spontaneous hyphema).',
        ],
        plainEnglish:
          'The investigation depends on the pattern. A young man with his first attack gets a gene test (HLA-B27) and a back X-ray. Someone with recurrent or stubborn inflammation gets blood tests for TB, sarcoidosis, and syphilis, plus a chest X-ray. The golden rule: syphilis can mimic ANYTHING in the eye, so always test for it. And if inflammation doesn\'t respond to standard treatment, worry about cancer disguising itself as inflammation — this is the "masquerade syndrome" that every uveitis textbook warns about.',
        citation: { authors: 'Deschenes J, Murray PI, Rao NA, Nussenblatt RB', source: 'International Ophthalmology Clinics — "International Uveitis Study Group clinical classification of uveitis"', year: 2008 },
      },
      {
        id: 'au-4',
        heading: 'Treatment — calming the fire and preventing damage',
        body: [
          'ACUTE EPISODE: Topical steroids (prednisolone acetate 1% — hourly while awake for severe flare, then taper over 4-6 weeks). NEVER stop abruptly — rebound inflammation is common. Cycloplegics (cyclopentolate 1% TDS or atropine 1% BD — prevent posterior synechiae, relieve ciliary spasm/pain).',
          'PERIOCULAR / INTRAVITREAL STEROIDS: For severe cases or CMO. Posterior sub-Tenon triamcinolone 40mg. Intravitreal dexamethasone implant (Ozurdex) for refractory CMO.',
          'SYSTEMIC THERAPY (for recurrent, bilateral, or sight-threatening): Oral prednisolone (1mg/kg, taper over months). Steroid-sparing immunosuppressants: methotrexate (first-line steroid-sparer), azathioprine, mycophenolate mofetil. Biologics: adalimumab (anti-TNFα — FDA-approved for non-infectious intermediate/posterior/panuveitis, VISUAL I and II trials, Lancet 2016).',
          'TREAT THE UNDERLYING CAUSE: If HLA-B27 with spondyloarthropathy → TNFα inhibitors reduce both joint and eye flares. If TB → full ATT (isoniazid + rifampicin + pyrazinamide + ethamolol for 2 months, then IR for 4 months). If syphilis → IV penicillin G. If herpes → oral valaciclovir + topical steroids (steroids WITHOUT antivirals worsen herpetic uveitis).',
        ],
        plainEnglish:
          'Two priorities: kill the inflammation and prevent scarring. Steroid eye drops are the fire extinguisher — used aggressively at first, then slowly dialled down. Drops that widen the pupil (cycloplegics) stop the iris from sticking to the lens and also reduce pain. If it keeps coming back, the doctor adds pills that calm the whole immune system — starting with methotrexate, and if that fails, modern biologic injections (adalimumab). The key rule: ALWAYS look for and treat the underlying cause. Giving steroids to syphilitic uveitis without antibiotics, or to TB without anti-TB drugs, makes the disease worse.',
        citation: { authors: 'Jaffe GJ, Dick AD, Brézin AP, et al. (VISUAL I Study)', source: 'Lancet — "Adalimumab in patients with active noninfectious uveitis"', year: 2016 },
      },
    ],
    game: {
      kind: 'sort-into-buckets',
      title: 'Granulomatous vs non-granulomatous — spot the pattern',
      instruction: 'Sort each finding or feature into the uveitis pattern it most characteristically belongs to.',
      buckets: [
        { id: 'granulomatous', label: 'Granulomatous', description: 'TB, sarcoid, syphilis, VKH', color: 'rose' },
        { id: 'non-granulomatous', label: 'Non-granulomatous', description: 'HLA-B27, idiopathic, viral', color: 'teal' },
      ],
      chips: [
        { id: 'c1', label: 'Mutton-fat KPs', correctBucket: 'granulomatous', explanation: 'Large, greasy endothelial deposits = macrophage-rich granulomatous inflammation.' },
        { id: 'c2', label: 'Fine dusty KPs', correctBucket: 'non-granulomatous', explanation: 'Small, evenly distributed KPs are typical of lymphocyte-mediated non-granulomatous inflammation.' },
        { id: 'c3', label: 'Busacca nodules on iris stroma', correctBucket: 'granulomatous', explanation: 'Iris nodules are a hallmark of granulomatous inflammation — think sarcoidosis or TB.' },
        { id: 'c4', label: 'Acute onset, unilateral, young male', correctBucket: 'non-granulomatous', explanation: 'Classic HLA-B27 acute anterior uveitis — sudden, unilateral, non-granulomatous.' },
        { id: 'c5', label: 'Bilateral hilar lymphadenopathy on CXR', correctBucket: 'granulomatous', explanation: 'This points to sarcoidosis — the most common systemic cause of granulomatous uveitis.' },
        { id: 'c6', label: 'Hypopyon with back pain', correctBucket: 'non-granulomatous', explanation: 'Hypopyon + back pain = severe HLA-B27 AAU, likely with ankylosing spondylitis.' },
      ],
    },
    quiz: [
      {
        id: 'au-q1',
        stem: 'A 28-year-old male presents with acute painful red eye, photophobia, and 2+ cells with fine KPs. He mentions chronic lower back stiffness. What blood test is MOST informative?',
        options: [
          { id: 'a', text: 'Rheumatoid factor' },
          { id: 'b', text: 'HLA-B27' },
          { id: 'c', text: 'ANA' },
          { id: 'd', text: 'Anti-CCP antibodies' },
        ],
        correctId: 'b',
        explanation: 'Young male + acute non-granulomatous anterior uveitis + lower back stiffness = textbook HLA-B27-associated AAU with possible ankylosing spondylitis. RF and anti-CCP are for rheumatoid arthritis. ANA is for juvenile idiopathic arthritis-associated uveitis (chronic, in children).',
      },
      {
        id: 'au-q2',
        stem: 'Why must cycloplegic drops be prescribed in every episode of acute anterior uveitis?',
        options: [
          { id: 'a', text: 'To reduce IOP' },
          { id: 'b', text: 'To prevent posterior synechiae and relieve ciliary spasm pain' },
          { id: 'c', text: 'To sterilise the anterior chamber' },
          { id: 'd', text: 'To improve visual acuity immediately' },
        ],
        correctId: 'b',
        explanation: 'Cycloplegics (atropine, cyclopentolate) have two critical roles: (1) they keep the pupil mobile so the inflamed iris does not stick to the lens (posterior synechiae — which can cause pupillary block and glaucoma), and (2) they relax the ciliary muscle, relieving the deep aching pain of ciliary spasm. They do not reduce IOP or sterilise anything.',
      },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// CORNEA
// ─────────────────────────────────────────────────────────────────────────────

const CORNEA: LearnSubTopic[] = [
  {
    id: 'keratoconus',
    label: 'Keratoconus',
    shortLabel: 'KC',
    description: 'Progressive corneal ectasia — the cone that steals the sharp focus of youth, from Fleischer rings to hydrops.',
    readMinutes: 12,
    pearlConditions: [],
    caseTitleMatches: ['keratoconus'],
    read: [
      {
        id: 'kc-1',
        heading: 'Root cause — why does the cornea cone?',
        body: [
          'Keratoconus is a bilateral, asymmetric, progressive corneal ectasia where the central or paracentral cornea thins and protrudes anteriorly into a cone shape. It typically presents in the second decade of life, progresses through the twenties, and usually stabilizes by the mid-to-late thirties.',
          'The pathogenesis involves a combination of genetic susceptibility and environmental triggers. Genetically, keratoconus clusters in families (~6-8% of first-degree relatives affected) and is associated with connective tissue disorders (Ehlers-Danlos, Marfan, osteogenesis imperfecta), Down syndrome (~15% prevalence), and atopy. Key genes implicated: VSX1, SOD1, LOX, HGF, and multiple loci on chromosome 21.',
          'The critical environmental trigger is EYE RUBBING. Chronic vigorous eye rubbing (from allergy, habit, or sleeping face-down) is the strongest modifiable risk factor. Rubbing generates mechanical shear forces that thin and weaken the already susceptible stroma. The mantra in keratoconus clinics: "Stop rubbing your eyes."',
          'At the molecular level, keratoconus corneas show increased matrix metalloproteinase (MMP) activity, decreased collagen cross-linking, lower levels of TIMP (tissue inhibitors of metalloproteinases), and increased keratocyte apoptosis — resulting in progressive stromal thinning and biomechanical weakness.',
        ],
        plainEnglish:
          'The cornea is the clear window at the front of the eye — it should be spherical like a football. In keratoconus, it gradually bulges forward into a cone like a rugby ball with a pointy end. Why? The collagen fibrils that give the cornea its strength are weakened, partly by genetics and partly by rubbing. Eye rubbing is the number-one thing that makes it worse — so the single most important medical advice for keratoconus is embarrassingly simple: STOP RUBBING YOUR EYES. The disease usually starts in the teens, gets worse in the twenties, and tends to burn out by the mid-thirties. The goal of treatment is to stop the progression before too much cone has formed.',
        citation: { authors: 'Rabinowitz YS', source: 'Survey of Ophthalmology — "Keratoconus"', year: 1998 },
      },
      {
        id: 'kc-2',
        heading: 'Signs — the classic clinical fingerprint',
        body: [
          'SLIT LAMP SIGNS: Vogt\'s striae (fine vertical stress lines in the deep stroma that disappear with gentle digital pressure), Fleischer ring (iron deposition at the base of the cone — seen with cobalt blue filter), Munson\'s sign (bulging of the lower lid on down-gaze in advanced cones), central or paracentral corneal thinning, scissoring reflex on retinoscopy.',
          'ACUTE HYDROPS: A break in Descemet\'s membrane allows aqueous to flood the stroma → sudden severe corneal oedema, pain, tearing, and vision drop. Self-limiting over 6-10 weeks as Descemet heals, but may leave a scar. Occurs in ~3% of keratoconus patients, more common in Down syndrome and severe ectasia.',
          'TOPOGRAPHY (the diagnostic gold standard): Inferior steepening pattern (I-S asymmetry > 1.4D is the Rabinowitz criterion), skewed steepest radial axes (SRAX > 21°), elevated Kmax (> 47.2D is suspicious, > 48D is diagnostic). Modern indices: Belin/Ambrósio enhanced ectasia display (BAD-D), KISA% index.',
          'TOMOGRAPHY (Pentacam/Galilei): Anterior + posterior corneal surfaces, pachymetry map (thinnest point, not central — keratoconus is paracentral), corneal biomechanics (Corvis ST — reduced corneal resistance factor).',
        ],
        plainEnglish:
          'The eye doctor can see keratoconus at the slit lamp: stress lines in the cornea, an iron ring at the base of the cone, and in advanced cases the lower lid actually bulges when the patient looks down. But the real diagnostic power comes from topography — a colour-coded map of the corneal curvature. It shows the cone as a hot-spot (red) usually below centre. In rare scary episodes called "hydrops", the inner membrane of the cornea cracks and the cornea swells up like a balloon overnight — painful, but it actually heals on its own in a few weeks.',
        citation: { authors: 'Belin MW, Ambrósio R Jr', source: 'Journal of Refractive Surgery — "Scheimpflug imaging for keratoconus and ectatic disease"', year: 2013 },
      },
      {
        id: 'kc-3',
        heading: 'Treatment — from glasses to transplant',
        body: [
          'STAGE 1 — SPECTACLES: Mild keratoconus can be corrected with glasses. Irregular astigmatism limits spectacle correction as the cone progresses.',
          'STAGE 2 — CONTACT LENSES: Rigid gas-permeable (RGP) lenses are the mainstay. They create a smooth refractive surface over the irregular cornea. Specialty designs: Rose K, scleral lenses (vault the entire cornea — best for advanced cones and post-hydrops scarring), piggyback systems (RGP on top of soft lens for comfort).',
          'STAGE 3 — CORNEAL COLLAGEN CROSS-LINKING (CXL): The game-changer for progressive keratoconus. Riboflavin + UVA light (Dresden protocol: epithelium-off, 30 minutes UVA, 3 mW/cm²) creates new covalent bonds between collagen fibrils, stiffening the stroma and halting progression. Accelerated protocols (higher fluence, shorter time) and epi-on variants exist but have less robust long-term data. CXL is indicated when progression is documented (Kmax increase > 1D, or CCT decrease > 10 µm, over 6-12 months). The earlier you cross-link, the less cone forms.',
          'STAGE 4 — INTRACORNEAL RING SEGMENTS (ICRS): Intacs or Ferrara ring segments implanted in the mid-stroma flatten the cone, reduce astigmatism, and may improve contact lens tolerance. Increasingly used in combination with CXL ("Athens protocol" or "CXL-plus").',
          'STAGE 5 — CORNEAL TRANSPLANT: Deep anterior lamellar keratoplasty (DALK) is preferred over penetrating keratoplasty (PK) when the endothelium is healthy — lower rejection rate, no endothelial graft failure. PK is reserved for post-hydrops scarring involving the endothelium. Graft survival is excellent in keratoconus (~95% at 10 years) — the best of any corneal transplant indication.',
        ],
        plainEnglish:
          'Treatment is a ladder: glasses → contact lenses → cross-linking → ring implants → transplant. The biggest breakthrough of the last 20 years is cross-linking (CXL): vitamin B2 drops + UV light, applied once, stiffens the cornea and freezes the cone where it is. It\'s like adding hardener to wobbly jelly. Done early, it can prevent the need for a transplant entirely. Contact lenses — especially big scleral lenses that vault the whole cornea like a dome — give excellent vision even in advanced cases. A transplant is the last resort, and the good news is that keratoconus transplants have the highest success rate of any corneal transplant.',
        citation: { authors: 'Wollensak G, Spoerl E, Seiler T', source: 'American Journal of Ophthalmology — "Riboflavin/ultraviolet-A-induced collagen crosslinking for the treatment of keratoconus"', year: 2003 },
      },
    ],
    game: {
      kind: 'sort-into-buckets',
      title: 'Keratoconus management ladder',
      instruction: 'Place each treatment at the right stage of keratoconus management.',
      buckets: [
        { id: 'early', label: 'Early / Mild', description: 'Good vision, minimal cone', color: 'teal' },
        { id: 'moderate', label: 'Moderate / Progressing', description: 'Documented progression, contact-lens dependent', color: 'amber' },
        { id: 'advanced', label: 'Advanced / Scarred', description: 'Contact lens failure, significant scarring', color: 'rose' },
      ],
      chips: [
        { id: 'c1', label: 'Spectacle correction', correctBucket: 'early', explanation: 'Works only in early stages when astigmatism is still regular.' },
        { id: 'c2', label: 'Corneal collagen cross-linking', correctBucket: 'moderate', explanation: 'Indicated when progression is documented — halts the disease. The earlier the better.' },
        { id: 'c3', label: 'Scleral contact lens', correctBucket: 'moderate', explanation: 'Vaults the entire cornea — excellent vision even with advanced cones.' },
        { id: 'c4', label: 'DALK transplant', correctBucket: 'advanced', explanation: 'When contact lenses fail and scarring is significant — best transplant option when endothelium is healthy.' },
        { id: 'c5', label: 'Intracorneal ring segments', correctBucket: 'moderate', explanation: 'Flattens the cone and reduces astigmatism — often combined with CXL.' },
        { id: 'c6', label: 'Stop eye rubbing', correctBucket: 'early', explanation: 'The most important advice at EVERY stage, but especially early — it is the key modifiable trigger.' },
      ],
    },
    quiz: [
      {
        id: 'kc-q1',
        stem: 'A 19-year-old with documented keratoconus shows Kmax increase of 1.8D over the past 12 months. His current BCVA with RGP lenses is 6/9. What is the most appropriate intervention to prevent further progression?',
        options: [
          { id: 'a', text: 'Penetrating keratoplasty' },
          { id: 'b', text: 'Corneal collagen cross-linking (CXL)' },
          { id: 'c', text: 'LASIK for refractive correction' },
          { id: 'd', text: 'Observation with annual topography' },
        ],
        correctId: 'b',
        explanation: 'Documented progression (Kmax increase >1D in 12 months) in a young patient = clear indication for CXL. LASIK is CONTRAINDICATED in keratoconus (it thins the already thin cornea and can cause catastrophic ectasia). PK is for scarred, contact-lens-intolerant eyes. Observation is inappropriate with demonstrated progression in a teenager.',
      },
      {
        id: 'kc-q2',
        stem: 'Which of the following is the SINGLE MOST IMPORTANT modifiable risk factor for keratoconus progression?',
        options: [
          { id: 'a', text: 'UV light exposure' },
          { id: 'b', text: 'Contact lens wear' },
          { id: 'c', text: 'Eye rubbing' },
          { id: 'd', text: 'Screen time' },
        ],
        correctId: 'c',
        explanation: 'Vigorous eye rubbing generates mechanical shear forces that accelerate stromal thinning. It is the strongest modifiable risk factor — strongly associated with allergy, atopy, sleeping face-down, and habitual rubbing. Every keratoconus consult must address rubbing cessation.',
      },
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// TOPIC → SUB-TOPIC REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export const LEARN_CONTENT: Record<string, LearnSubTopic[]> = {
  retina: RETINA,
  glaucoma: GLAUCOMA,
  uvea: UVEA,
  cornea: CORNEA,
}

export function getLearnSubTopics(topicId: string): LearnSubTopic[] {
  return LEARN_CONTENT[topicId] ?? []
}

export function getLearnSubTopic(topicId: string, subTopicId: string): LearnSubTopic | undefined {
  return (LEARN_CONTENT[topicId] ?? []).find((s) => s.id === subTopicId)
}
