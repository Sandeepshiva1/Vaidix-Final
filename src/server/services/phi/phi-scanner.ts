// ════════════════════════════════════════════════════════════════════════════
// PHI Scanner — stopgap regex detector with Indian clinical context
// ════════════════════════════════════════════════════════════════════════════
// Purpose: catch obvious PHI/PII in faculty-uploaded case notes before they
// land in the document library. Patterns are tuned for LVPEI / Indian
// healthcare context.
//
// IMPORTANT: this is a CONSERVATIVE stopgap, not a substitute for Microsoft
// Presidio. Real Presidio integration runs as a Python sidecar and supports
// ML-based name detection, address resolution, and per-document redaction.
// Until that ships, this scanner blocks high-severity uploads (Aadhaar,
// phone numbers, MRN-like patterns) and flags medium-severity ones for
// faculty review.
//
// Output schema matches PhiScanResult.detectedEntities:
//   [{ type: string, span: [start, end], excerpt: string, severity: 'high'|'medium'|'low' }]

export type PhiSeverity = 'high' | 'medium' | 'low';

export interface PhiEntity {
  /** Detector kind, e.g. 'AADHAAR', 'PHONE_IN', 'MRN', 'EMAIL', 'NAME_LIKELY' */
  type: string;
  /** Character offset [startInclusive, endExclusive] in the scanned text */
  span: [number, number];
  /** Original matched text — for the faculty-redaction UI */
  excerpt: string;
  severity: PhiSeverity;
}

export interface PhiScanReport {
  scannerVersion: string;
  textLength: number;
  entities: PhiEntity[];
  /** Highest severity in the report ('low' if no entities) */
  severity: PhiSeverity;
  /** Whether faculty must review before this can be tagged to a session */
  blocked: boolean;
}

const SCANNER_VERSION = 'vaidix-regex-1.0';

interface DetectorRule {
  type: string;
  /** Must use the global flag so we can iterate matches */
  pattern: RegExp;
  severity: PhiSeverity;
  /** Optional post-match validator (e.g. Verhoeff for Aadhaar) */
  validate?: (match: string) => boolean;
}

// ─── Validators ────────────────────────────────────────────────────────────

/** Verhoeff checksum used by UIDAI for Aadhaar 12-digit numbers. */
function verhoeffValid(num12: string): boolean {
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  const digits = num12.replace(/\D/g, '').split('').map(Number).reverse();
  if (digits.length !== 12) return false;
  let c = 0;
  digits.forEach((digit, i) => {
    c = d[c][p[i % 8][digit]];
  });
  return c === 0;
}

// ─── Detectors ─────────────────────────────────────────────────────────────

const DETECTORS: DetectorRule[] = [
  {
    type: 'AADHAAR',
    // 12 digits, optionally grouped 4-4-4 with spaces or hyphens
    pattern: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/g,
    severity: 'high',
    validate: (m) => verhoeffValid(m),
  },
  {
    type: 'PHONE_IN',
    // Indian mobile: optional +91 / 0 prefix, 10 digits starting with 6-9
    pattern: /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{9}(?!\d)/g,
    severity: 'high',
  },
  {
    type: 'EMAIL',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    severity: 'medium',
  },
  {
    type: 'PAN',
    // Indian PAN: 5 letters, 4 digits, 1 letter
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    severity: 'high',
  },
  {
    type: 'MRN',
    // Common LVPEI MRN-like pattern: 6-10 alphanumeric with optional hyphen,
    // labelled with MRN/UHID/Patient ID/PID nearby
    pattern: /\b(?:MRN|UHID|Patient\s*ID|PID|Hosp(?:ital)?\s*No\.?)\s*[:#]?\s*([A-Z0-9-]{4,12})\b/gi,
    severity: 'high',
  },
  {
    type: 'DATE_OF_BIRTH',
    // dd/mm/yyyy or dd-mm-yyyy in a context that suggests DOB
    pattern: /\b(?:DOB|Date\s*of\s*Birth|Born)\s*[:#]?\s*\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/gi,
    severity: 'medium',
  },
  {
    type: 'AGE_NAME',
    // "Mr X, 58" / "Mrs Y, 67yo" — likely identifying when paired with case notes
    pattern: /\b(?:Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,?\s*\d{1,3}\s*(?:y(?:r|ear)?s?)?(?:\s*old)?\b/g,
    severity: 'medium',
  },
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    severity: 'high',
    validate: (m) => {
      // Luhn checksum
      const digits = m.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alt) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
        alt = !alt;
      }
      return sum % 10 === 0;
    },
  },
];

const SEVERITY_RANK: Record<PhiSeverity, number> = { low: 0, medium: 1, high: 2 };

export function scanForPhi(text: string): PhiScanReport {
  const entities: PhiEntity[] = [];
  let highestSeverity: PhiSeverity = 'low';

  for (const rule of DETECTORS) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      const matched = m[0];
      if (rule.validate && !rule.validate(matched)) continue;
      entities.push({
        type: rule.type,
        span: [m.index, m.index + matched.length],
        excerpt: matched,
        severity: rule.severity,
      });
      if (SEVERITY_RANK[rule.severity] > SEVERITY_RANK[highestSeverity]) {
        highestSeverity = rule.severity;
      }
    }
  }

  return {
    scannerVersion: SCANNER_VERSION,
    textLength: text.length,
    entities,
    severity: highestSeverity,
    // Block uploads with any high-severity match — faculty must review/redact
    blocked: highestSeverity === 'high',
  };
}

/** Convenience for the worker — also persists the scan to PhiScanResult. */
export async function scanAndPersist(input: {
  text: string;
  targetType: 'DOCUMENT' | 'TRANSCRIPT' | 'CASE_NOTE';
  targetId: string;
  prismaClient: import('@prisma/client').PrismaClient;
}): Promise<PhiScanReport> {
  const report = scanForPhi(input.text);
  await input.prismaClient.phiScanResult.create({
    data: {
      targetType: input.targetType,
      targetId: input.targetId,
      detectedEntities: report.entities as unknown as object,
      severity: report.severity,
      blocked: report.blocked,
      scannerVersion: report.scannerVersion,
    },
  });
  return report;
}
