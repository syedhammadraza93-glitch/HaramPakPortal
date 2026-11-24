import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../utils/api";

/** Company branding, edited by the admin in Settings → Branding. Nothing about the company is hard-coded. */
export interface Branding {
  name: string;
  portalName: string;
  tagline: string | null;
  heroTitle: string | null;
  aboutText: string | null;
  highlights: string[];
  footerText: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  primaryColor: string;
  accentColor: string;
  highlightColor: string;
  cities: string[];
  termsVersion: string;
  currency: string;
  logoUrl: string | null;
}

interface BrandingContextValue {
  branding: Branding;
  reload: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

/** Applies colours (CSS variables), page title and favicon. */
function applyBranding(b: Branding) {
  const root = document.documentElement.style;
  root.setProperty("--brand-primary", b.primaryColor);
  root.setProperty("--brand-accent", b.accentColor);
  root.setProperty("--brand-highlight", b.highlightColor);
  document.title = [b.name, b.portalName].filter(Boolean).join(" · ");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", b.primaryColor);
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (b.logoUrl) {
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = b.logoUrl;
  } else {
    icon?.remove();
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const b = await api.get<Branding>("/public/company");
      applyBranding(b);
      setBranding(b);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!branding) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
        {error ? (
          <>
            <p>{error}</p>
            <button onClick={() => void reload()} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100">
              Try again
            </button>
          </>
        ) : (
          <span className="size-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" aria-label="Loading" />
        )}
      </div>
    );
  }

  return <BrandingContext.Provider value={{ branding, reload }}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used inside BrandingProvider");
  return ctx.branding;
}

export function useReloadBranding(): () => Promise<void> {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("useReloadBranding must be used inside BrandingProvider");
  return ctx.reload;
}
