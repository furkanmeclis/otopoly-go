/**
 * Suggested catalog services for a new car-wash / detailing business.
 * Prices are editable starting points in TRY; the owner can change them later.
 */
export const STARTER_SERVICES = [
  { key: "exterior", name: "Dış yıkama", price: "250", selected: true },
  { key: "full", name: "İç-dış yıkama", price: "450", selected: true },
  {
    key: "interior",
    name: "Detaylı iç temizlik",
    price: "1400",
    selected: true,
  },
  { key: "engine", name: "Motor yıkama", price: "600", selected: false },
  { key: "seats", name: "Koltuk yıkama", price: "900", selected: false },
  { key: "polish", name: "Pasta cila", price: "2100", selected: true },
  { key: "ceramic", name: "Seramik kaplama", price: "4250", selected: false },
  { key: "ppf", name: "PPF kaplama", price: "38000", selected: false },
] as const;

export type StarterService = {
  key: string;
  name: string;
  price: string;
  selected: boolean;
};
