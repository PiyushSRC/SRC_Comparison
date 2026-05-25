import { useEffect, useState } from "react";

const SITE_ORIGIN =
  (import.meta as any).env?.VITE_SRC_ORIGIN || "https://sataniresearchcentre.com";
const VALIDATE_URL = `${SITE_ORIGIN}/api/lab-access/validate`;
const REVALIDATE_MS = 15 * 60 * 1000;
const STORAGE_KEY = "src_access_token";

type Props = {
  toolSlug: string;
  children: React.ReactNode;
};

type Status = "checking" | "ok";

function readToken(): { token: string; fromUrl: boolean } | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("access");
  if (fromUrl) return { token: fromUrl, fromUrl: true };
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) return { token: stored, fromUrl: false };
  return null;
}

function redirectToApproval(slug: string, reason: string): never {
  const dest = `${SITE_ORIGIN}/lab-tools/${slug}?error=${encodeURIComponent(reason)}`;
  window.location.replace(dest);
  throw new Error("redirecting");
}

async function validate(token: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const res = await fetch(VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return await res.json();
  } catch {
    return { valid: false, reason: "network" };
  }
}

export default function AccessGate({ toolSlug, children }: Props) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const t = readToken();
      if (!t) redirectToApproval(toolSlug, "missing");

      const result = await validate(t!.token);
      if (cancelled) return;

      if (!result.valid) {
        sessionStorage.removeItem(STORAGE_KEY);
        redirectToApproval(toolSlug, result.reason || "invalid");
      }

      sessionStorage.setItem(STORAGE_KEY, t!.token);

      if (t!.fromUrl) {
        const url = new URL(window.location.href);
        url.searchParams.delete("access");
        window.history.replaceState({}, "", url.toString());
      }

      setStatus("ok");
    })();

    return () => {
      cancelled = true;
    };
  }, [toolSlug]);

  useEffect(() => {
    if (status !== "ok") return;
    const interval = window.setInterval(async () => {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) redirectToApproval(toolSlug, "missing");
      const result = await validate(stored!);
      if (!result.valid) {
        sessionStorage.removeItem(STORAGE_KEY);
        redirectToApproval(toolSlug, result.reason || "invalid");
      }
    }, REVALIDATE_MS);
    return () => window.clearInterval(interval);
  }, [status, toolSlug]);

  if (status === "checking") {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#555",
          fontSize: 14,
        }}
      >
        Verifying access…
      </div>
    );
  }

  return <>{children}</>;
}
