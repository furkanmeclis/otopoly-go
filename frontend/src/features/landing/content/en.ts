import type { LandingContent } from "./types";

export const en: LandingContent = {
  locale: "en",
  htmlLang: "en",
  meta: {
    title: "Otopoly — Car Wash and Detailing Business Software",
    description:
      "Job orders, WhatsApp notifications, OTP-confirmed digital contracts, customer accounts, cash and stock for car wash, detailing and car care businesses. Try it free for 14 days.",
    ogLocale: "en_US",
    appCategory: "Car wash and detailing business management",
    offer: "14-day free trial",
  },
  a11y: {
    mainNav: "Main menu",
    home: "Otopoly home",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    sections: "Page sections",
    account: "Account",
    services: "Supported services",
    weeklyChart: "Sample weekly revenue chart",
  },
  language: { label: "Language", switchTo: "Türkçe", href: "/" },
  nav: [
    { href: "#ozellikler", label: "Features" },
    { href: "#bir-gun", label: "How it works" },
    { href: "#fiyatlar", label: "Pricing" },
    { href: "#whatsapp", label: "WhatsApp" },
    { href: "#sss", label: "FAQ" },
  ],
  hero: {
    eyebrow: "Car wash · Detailing · Car care",
    titleLead: "From drop-off to hand-over,",
    titleAccent: "your whole shop on one screen.",
    description:
      "Job orders, WhatsApp notifications, OTP-confirmed digital contracts, customer accounts, cash and stock. Otopoly runs the daily flow of your wash or detailing shop without paper and without mistakes.",
    primaryCta: "Try free for 14 days",
    secondaryCta: "Sign in",
    trust: [
      "No credit card required",
      "Nothing to install, runs in the browser",
      "Works on tablet and phone",
    ],
  },
  services: [
    "Interior & exterior wash",
    "Ceramic coating",
    "PPF",
    "Deep interior cleaning",
    "Polishing",
    "Engine wash",
    "Paint protection",
    "Window tint",
    "Wheel cleaning",
    "Seat shampoo",
  ],
  sections: {
    features: {
      eyebrow: "Features",
      title: "One flow instead of paper, notebooks and spreadsheets.",
      description:
        "Every step from drop-off to payment is on record. Your staff know what to do next, and you see how the business is doing in real time.",
    },
    how: {
      eyebrow: "Getting started",
      title: "Sign up today, use it tomorrow morning.",
      description:
        "No setup, training or hardware. Your shop is ready in three steps.",
    },
    faq: {
      eyebrow: "Frequently asked questions",
      title: "Questions you might have",
      description:
        "What people ask most about the trial, setup, payment, the WhatsApp connection and digital contracts.",
    },
  },
  features: [
    {
      icon: "jobs",
      title: "Job orders and operations board",
      description:
        "Service lines, assigned staff and status for every vehicle. See the In progress → Ready → Delivered flow at a glance.",
      points: [
        "Fast check-in by plate",
        "Staff assignment",
        "Payment status tracked separately",
        "Multi-day jobs land on their delivery day",
      ],
      size: "lg",
    },
    {
      icon: "contract",
      title: "OTP-confirmed digital contracts",
      description:
        "Have ceramic or PPF contracts signed on a tablet. The customer gets a confirmation code and privacy notice on WhatsApp; the PDF is stored as evidence.",
      points: [
        "Names filled in automatically",
        "Damage photo attachments",
        "Time-stamped PDF",
      ],
      size: "lg",
    },
    {
      icon: "whatsapp",
      title: "WhatsApp from your own number",
      description:
        "Check-in, ready, delivered and payment messages go out automatically from your business WhatsApp line.",
      points: [
        "Connects with a QR code",
        "Editable templates",
        "End-of-day summary and team alerts",
      ],
      size: "md",
    },
    {
      icon: "cari",
      title: "Customer accounts and credit",
      description:
        "Jobs on credit post to the customer account; see collections and the statement in one click.",
      points: [
        "Open balance tracking",
        "Statement PDF with debit/credit columns",
      ],
      size: "md",
    },
    {
      icon: "finance",
      title: "Cash and finance",
      description:
        "Cash and card registers, income and expense categories, transfers between registers.",
      points: ["Daily cash summary", "Income recorded automatically"],
      size: "md",
    },
    {
      icon: "stock",
      title: "Product sales and stock",
      description:
        "Sell shampoo, fragrance and accessories; with service recipes the products used on each job come off stock by themselves.",
      points: ["Quick sale", "Service recipes", "Supplier purchases"],
      size: "md",
    },
    {
      icon: "reports",
      title: "Reports",
      description:
        "Income, expenses, service mix and top customers. Export to PDF, Excel and CSV.",
      points: ["Day / week / month", "Export"],
      size: "lg",
    },
    {
      icon: "staff",
      title: "Staff and permissions",
      description:
        "Give cashiers their own accounts; critical actions such as cancellations and finance stay with the owner.",
      points: ["Role-based permissions", "Activity history"],
      size: "lg",
    },
  ],
  steps: [
    {
      title: "Register your business",
      description:
        "Open an account in two minutes. The 14-day trial starts right away, no card needed.",
    },
    {
      title: "Add WhatsApp and your services",
      description:
        "Scan the QR code to connect your business line, then enter your services and prices.",
    },
    {
      title: "Check in the first car",
      description:
        "Type the plate, pick the services and have the contract signed if needed. Otopoly tracks the rest.",
    },
  ],
  whatsappMessages: [
    {
      time: "09:12",
      title: "Your car is checked in",
      body: "Dear Ayşe Kaya, your car with plate 34 TKO 34 has been checked in. We'll keep you posted.",
    },
    {
      time: "09:14",
      title: "Contract confirmation code",
      body: "Your code for the Ceramic Coating Contract (SZL-0012): *482913* · Privacy notice attached.",
    },
    {
      time: "15:40",
      title: "Your car is ready",
      body: "The work on your car is done and it's ready for pick-up. Have a nice day.",
    },
    {
      time: "16:05",
      title: "Payment received",
      body: "We've received your payment of 4,250.00 TRY. Thank you for choosing us.",
    },
  ],
  whatsappSection: {
    eyebrow: "WhatsApp integration",
    title: "Let customers know before they call.",
    description:
      "Otopoly sends the right message at the right moment from your own WhatsApp line. Customers stop calling to ask if the car is ready; you stay on the work, not the phone.",
    points: [
      "Your business number connects with a QR code, no paid API needed",
      "Check-in, ready, delivered and payment messages are automatic",
      "One-time code and privacy notice for contract approval",
      "Edit message templates in your own words",
    ],
  },
  whatsappAccount: "business account",
  whatsappToday: "Today",
  reportsSection: {
    eyebrow: "Reports",
    title: "See which service actually pays.",
    description:
      "Income and expenses, service and product mix, open customer balances and top customers. Filter, then share as PDF or Excel in one click.",
    mixTitle: "Service mix",
    bars: [
      { label: "Mon", value: 42 },
      { label: "Tue", value: 58 },
      { label: "Wed", value: 51 },
      { label: "Thu", value: 66 },
      { label: "Fri", value: 83 },
      { label: "Sat", value: 100 },
      { label: "Sun", value: 71 },
    ],
    mix: [
      { label: "Ceramic coating", share: 38 },
      { label: "Deep cleaning", share: 27 },
      { label: "Interior & exterior", share: 21 },
      { label: "Product sales", share: 14 },
    ],
  },
  productMock: {
    title: "Operations · Today",
    revenueToday: "Today's revenue",
    readyToast: "Your car {{plate}} is ready for pick-up. Have a nice day.",
    now: "now",
    numberLocale: "en-US",
    columns: ["In progress", "Ready", "Delivered"],
    jobs: [
      {
        plate: "34 TKO 34",
        vehicle: "Toyota Corolla",
        service: "Ceramic coating",
        price: "₺4,250",
        staff: "AU",
      },
      {
        plate: "06 BRK 061",
        vehicle: "VW Passat",
        service: "Deep interior cleaning",
        price: "₺1,400",
        staff: "MK",
      },
      {
        plate: "35 EGE 35",
        vehicle: "Renault Clio",
        service: "Interior & exterior",
        price: "₺450",
        staff: "SY",
      },
      {
        plate: "16 BRS 116",
        vehicle: "BMW 320i",
        service: "Polishing",
        price: "₺2,100",
        staff: "AU",
      },
      {
        plate: "41 KCL 41",
        vehicle: "Fiat Egea",
        service: "Engine wash",
        price: "₺600",
        staff: "MK",
      },
      {
        plate: "34 PPF 07",
        vehicle: "Tesla Model Y",
        service: "PPF",
        price: "₺38,000",
        staff: "SY",
      },
    ],
  },
  journey: {
    eyebrow: "A day in the life of a car",
    title: "You do the work, Otopoly handles the rest.",
    description:
      "Step a ceramic coating job forward yourself. At each step, see the message the customer gets and what gets recorded in the background on its own.",
    next: "Next step",
    restart: "Start over",
    customerPhone: "Customer's phone",
    ownerPhone: "to the owner",
    behindTitle: "In the background",
    stepLabel: "Step {{n}} of {{total}}",
    plate: "34 TKO 34",
    vehicle: "Toyota Corolla · Ayşe Kaya",
    stages: [
      {
        label: "Check-in",
        time: "09:12",
        message: {
          to: "customer",
          title: "Your car is checked in",
          body: "Dear Ayşe Kaya, your car with plate 34 TKO 34 has been checked in. We'll keep you posted.",
        },
        effects: [
          {
            kind: "job",
            text: "Job order opened: ceramic coating + interior & exterior wash, ₺4,250",
          },
        ],
      },
      {
        label: "Contract",
        time: "09:14",
        message: {
          to: "customer",
          title: "Contract confirmation code",
          body: "Your code for the Ceramic Coating Contract: *482913*. Privacy notice attached.",
        },
        effects: [
          {
            kind: "contract",
            text: "Customer confirmed the code; the signed contract PDF is archived",
          },
        ],
      },
      {
        label: "Work",
        time: "11:30",
        effects: [
          {
            kind: "stock",
            text: "Service recipe: ceramic bottle −1, shampoo −60 ml taken off stock",
          },
          {
            kind: "team",
            text: "Team alert: 34 TKO 34 has been in progress for over 2 hours",
          },
        ],
      },
      {
        label: "Ready",
        time: "15:40",
        message: {
          to: "customer",
          title: "Your car is ready",
          body: "The work on your car is done and it's ready for pick-up. Have a nice day.",
        },
        effects: [{ kind: "job", text: "Card moved to the Ready column" }],
      },
      {
        label: "Hand-over and payment",
        time: "16:05",
        message: {
          to: "customer",
          title: "Payment received",
          body: "We've received your payment of 4,250.00 TRY. Thank you for choosing us.",
        },
        effects: [
          { kind: "cash", text: "₺4,250 income posted to the card register" },
        ],
      },
      {
        label: "End of day",
        time: "21:00",
        message: {
          to: "owner",
          title: "Today's summary",
          body: "18 cars delivered today, revenue ₺42,300. Most popular: interior & exterior wash. 6 bookings tomorrow.",
        },
        effects: [
          {
            kind: "summary",
            text: "End-of-day summary sent to the owner on WhatsApp",
          },
        ],
      },
    ],
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Pick a plan that fits the size of your shop.",
    description:
      "Try it free for 14 days, then continue on the plan that suits you. Prices include VAT; yearly billing is discounted.",
    monthly: "Monthly",
    yearly: "Yearly",
    perMonth: "/ month",
    perYear: "/ year",
    vatIncluded: "VAT included",
    yearlySaving: "{{value}} off yearly",
    trialCard: {
      name: "Free trial",
      price: "₺0",
      description: "Try it for 14 days without card details.",
      points: ["10 jobs a day", "2 staff members", "Digital contracts"],
      cta: "Start the trial",
    },
    choose: "Start with this plan",
    configure: "Choose your limits",
    configureHint: "Move the sliders; the price updates as you go.",
    unlimited: "Unlimited",
    included: "Included",
    notIncluded: "Not included",
    footnote:
      "Pay by bank transfer, get an e-Archive invoice. Change plans any time; the unused part of your period is credited to the new plan.",
    popular: "Recommended",
    stepPrice: "+{{price}} per {{step}} {{unit}}",
    units: {
      adet: "",
      kişi: "people",
      mesaj: "messages",
      istek: "requests",
      GB: "GB",
    },
    plans: {
      pro: {
        description: "The full package for growing shops",
        badge: "Popular",
      },
      enterprise: { description: "You choose the limits", badge: "Flexible" },
    },
  },
  faqs: [
    {
      q: "Is there a free trial?",
      a: "Yes. The 14-day trial starts the moment you sign up. No credit card is needed and you can use every feature during the trial.",
    },
    {
      q: "Do I need to install anything?",
      a: "No. Otopoly is cloud-based and runs in the browser on a computer, tablet or phone. We recommend a tablet for contract signatures.",
    },
    {
      q: "Which number do WhatsApp messages come from?",
      a: "Your business's own WhatsApp number. Scan the QR code shown in the messaging settings with your phone; you choose which events send a message.",
    },
    {
      q: "How are digital contracts verified?",
      a: "Before signing, the customer confirms a one-time code sent to WhatsApp together with the contract details and privacy notice. The verification time, masked phone number and signing time are written into the contract PDF.",
    },
    {
      q: "Can my staff see everything?",
      a: "No. Cashiers can handle job orders, sales and contracts; critical actions such as cancellations, finance and the catalog are for the owner only.",
    },
    {
      q: "Can I export my data?",
      a: "Yes. Lists and reports export to PDF, Excel (XLSX), CSV and JSON; PDFs carry your business letterhead.",
    },
    {
      q: "How do I pay, and do I get an invoice?",
      a: "Choose your plan in the panel and pay by bank transfer; once the uploaded receipt is approved your subscription starts and your e-Archive invoice is created automatically. Yearly billing is discounted.",
    },
    {
      q: "Is my data deleted when the trial ends?",
      a: "No. You get a few days of grace, then the account becomes read-only: you can still see and export your data, and everything continues where you left off once you renew.",
    },
  ],
  finalCta: {
    title: "Check in tomorrow's first car with Otopoly.",
    description:
      "Sign up today, connect WhatsApp, add your services. Free for 14 days.",
    cta: "Create a free account",
  },
  footer: {
    tagline:
      "Car wash and service management platform. One place for job orders, contracts, customer accounts and reports.",
    product: "Product",
    account: "Account",
    register: "Create a free account",
    login: "Sign in",
    rights: "All rights reserved.",
  },
};
