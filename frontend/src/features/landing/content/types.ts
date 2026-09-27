export type LandingLocale = "tr" | "en";

export type FeatureIcon =
  | "jobs"
  | "whatsapp"
  | "contract"
  | "cari"
  | "finance"
  | "stock"
  | "reports"
  | "staff";

export type JourneyEffectKind =
  "job" | "contract" | "stock" | "team" | "cash" | "summary";

export type LandingContent = {
  locale: LandingLocale;
  htmlLang: string;
  meta: {
    title: string;
    description: string;
    ogLocale: string;
    appCategory: string;
    offer: string;
  };
  a11y: {
    mainNav: string;
    home: string;
    menuOpen: string;
    menuClose: string;
    sections: string;
    account: string;
    services: string;
    weeklyChart: string;
  };
  language: { label: string; switchTo: string; href: string };
  nav: { href: string; label: string }[];
  hero: {
    eyebrow: string;
    titleLead: string;
    titleAccent: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
    trust: string[];
  };
  services: string[];
  sections: {
    features: { eyebrow: string; title: string; description: string };
    how: { eyebrow: string; title: string; description: string };
    faq: { eyebrow: string; title: string; description: string };
  };
  features: {
    icon: FeatureIcon;
    title: string;
    description: string;
    points: string[];
    size: "lg" | "md";
  }[];
  steps: { title: string; description: string }[];
  whatsappMessages: { time: string; title: string; body: string }[];
  whatsappSection: {
    eyebrow: string;
    title: string;
    description: string;
    points: string[];
  };
  whatsappAccount: string;
  whatsappToday: string;
  reportsSection: {
    eyebrow: string;
    title: string;
    description: string;
    mixTitle: string;
    bars: { label: string; value: number }[];
    mix: { label: string; share: number }[];
  };
  productMock: {
    title: string;
    revenueToday: string;
    readyToast: string;
    now: string;
    numberLocale: string;
    columns: [string, string, string];
    jobs: {
      plate: string;
      vehicle: string;
      service: string;
      price: string;
      staff: string;
    }[];
  };
  journey: {
    eyebrow: string;
    title: string;
    description: string;
    next: string;
    restart: string;
    customerPhone: string;
    ownerPhone: string;
    behindTitle: string;
    stepLabel: string;
    plate: string;
    vehicle: string;
    stages: {
      label: string;
      time: string;
      message?: { title: string; body: string; to: "customer" | "owner" };
      effects: { kind: JourneyEffectKind; text: string }[];
    }[];
  };
  pricing: {
    eyebrow: string;
    title: string;
    description: string;
    monthly: string;
    yearly: string;
    perMonth: string;
    perYear: string;
    vatIncluded: string;
    yearlySaving: string;
    trialCard: {
      name: string;
      price: string;
      description: string;
      points: string[];
      cta: string;
    };
    choose: string;
    configure: string;
    configureHint: string;
    unlimited: string;
    included: string;
    notIncluded: string;
    footnote: string;
    popular: string;
    stepPrice: string;
    /** Unit words from the feature catalog (stored in Turkish) → this language. */
    units: Record<string, string>;
    /** Copy for known plan codes; plan data is entered once by the platform admin. */
    plans: Record<string, { description?: string; badge?: string }>;
  };
  faqs: { q: string; a: string }[];
  finalCta: { title: string; description: string; cta: string };
  footer: {
    tagline: string;
    product: string;
    account: string;
    register: string;
    login: string;
    rights: string;
  };
};

/** Public plan as returned by GET /v1/public/billing/plans. */
export type PublicPlan = {
  uuid: string;
  code: string;
  name: string;
  description: string;
  price_monthly: string;
  yearly_pricing: "fixed" | "discount_amount" | "discount_percent";
  price_yearly: string;
  yearly_discount_value: string;
  effective_yearly: string;
  currency: string;
  is_customizable: boolean;
  badge: string;
  features: {
    key: string;
    value_int: number | null;
    value_bool: boolean | null;
    display_text: string;
    min_value: number | null;
    max_value: number | null;
    step: number | null;
    unit_price: string | null;
    unit?: string;
    label_tr?: string;
    label_en?: string;
    kind?: string;
  }[];
};
