import Link from "next/link";

import { AppWordmark } from "@/components/brand/app-wordmark";
import { routes } from "@/config/routes";
import { brand } from "@/config/brand";
import { landingNav } from "@/features/landing/content";

export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <AppWordmark className="h-7" />
          <p className="text-muted-foreground mt-4 max-w-sm text-sm leading-relaxed">
            {brand.tagline}. İş emirlerinden sözleşmeye, carilerden raporlara
            kadar tek platform.
          </p>
        </div>
        <nav aria-label="Sayfa bölümleri">
          <p className="text-sm font-semibold">Ürün</p>
          <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
            {landingNav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="hover:text-foreground transition-colors"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Hesap">
          <p className="text-sm font-semibold">Hesap</p>
          <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
            <li>
              <Link
                href={routes.public.register}
                className="hover:text-foreground transition-colors"
              >
                Ücretsiz hesap oluştur
              </Link>
            </li>
            <li>
              <Link
                href="/login"
                className="hover:text-foreground transition-colors"
              >
                Giriş yap
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="text-muted-foreground border-t py-6 text-center text-xs">
        © {year} {brand.name}. Tüm hakları saklıdır.
      </div>
    </footer>
  );
}
