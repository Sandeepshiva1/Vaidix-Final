import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export const IconClock = ({ size = 20, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
);
export const IconPlay = ({ size = 20, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4V8Z" /></svg>
);
export const IconCheck = ({ size = 20, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconCheckBare = ({ size = 16, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconPlus = ({ size = 20, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconArrowRight = ({ size = 18, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
export const IconArrowLeft = ({ size = 20, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></svg>
);
export const IconChevronRight = ({ size = 16, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconUpload = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);
export const IconUsers = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
export const IconChat = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
export const IconPoll = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M3 3v18h18" />
    <rect x="7" y="12" width="3" height="6" />
    <rect x="12" y="8" width="3" height="10" />
    <rect x="17" y="5" width="3" height="13" />
  </svg>
);
export const IconBolt = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="m13 2-3 7h7l-9 13 3-9H4l9-11z" /></svg>
);
export const IconDocText = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
  </svg>
);
export const IconRefresh = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);
export const IconChart = ({ size = 22, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-6" />
  </svg>
);
export const IconStethoscope = ({ size = 56, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <path d="M11 2v2M5 2v2" />
    <path d="M5 4h6v6a3 3 0 0 1-3 3v0a3 3 0 0 1-3-3V4Z" />
    <path d="M8 13v3a5 5 0 0 0 10 0v-2" />
    <circle cx="20" cy="10" r="2" />
  </svg>
);
export const IconSettings = ({ size = 18, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);
export const IconCalendar = ({ size = 18, ...rest }: Props) => (
  <svg {...base(size)} {...rest}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
export const IconClose = ({ size = 18, ...rest }: Props) => (
  <svg {...base(size)} {...rest}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
