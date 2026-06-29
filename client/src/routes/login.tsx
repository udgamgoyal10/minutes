import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useAuth } from "../lib/auth.tsx";

export function LoginPage() {
  const { loginWithGoogle, verifyTwoFactorSetup, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ token: string; qrDataUrl: string; manualSecret: string } | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const step = setup ? "setup" : challengeToken ? "verify" : "google";
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (step !== "google" || !googleClientId || !googleButtonRef.current) return;
    const render = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          if (!response.credential) return;
          setError(null);
          setLoading(true);
          try {
            const result = await loginWithGoogle(response.credential);
            if (result.status === "ok") {
              navigate({ to: "/" });
              return;
            }
            if (result.status === "2fa_setup_required") {
              setSetup({ token: result.setupToken, qrDataUrl: result.qrDataUrl, manualSecret: result.manualSecret });
              setCode("");
              return;
            }
            setChallengeToken(result.challengeToken);
            setCode("");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setLoading(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, { theme: "outline", size: "large", width: 320 });
    };
    if (window.google?.accounts?.id) {
      render();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = render;
    if (!existing) document.head.appendChild(script);
  }, [googleClientId, loginWithGoogle, navigate, step]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setLoading(true);
          try {
            if (step === "setup" && setup) {
              await verifyTwoFactorSetup(setup.token, code);
              navigate({ to: "/" });
              return;
            }
            if (step === "verify" && challengeToken) {
              await verifyTwoFactor(challengeToken, code);
              navigate({ to: "/" });
              return;
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setLoading(false);
          }
        }}
        className="bg-white shadow-sm border border-slate-200 rounded-lg p-8 w-full max-w-sm space-y-4"
      >
        <div className="flex items-center gap-2 mb-2">
          <FileText className="size-6 text-brand-600" />
          <h1 className="text-xl font-semibold">Meeting Minutes</h1>
        </div>
        {step === "google" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Sign in with your authorized Google account, then complete authenticator verification.</p>
            {googleClientId ? <div ref={googleButtonRef} className="flex justify-center" /> : (
              <p className="text-sm text-rose-600">Google OAuth is not configured. Set GOOGLE_CLIENT_ID in the server .env and rebuild the frontend.</p>
            )}
          </div>
        )}
        {step === "setup" && setup && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Scan this QR code in Google Authenticator, then enter the 6-digit code.</p>
            <img src={setup.qrDataUrl} alt="Google Authenticator QR code" className="mx-auto border border-slate-200 rounded-md" />
            <p className="text-xs text-slate-500 break-all">Manual key: <span className="font-mono">{setup.manualSecret}</span></p>
          </div>
        )}
        {step !== "google" && (
          <label className="block">
            <span className="text-sm text-slate-700">Authenticator code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </label>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {step !== "google" && (
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Please wait…" : step === "setup" ? "Finish authenticator setup" : "Verify code"}
          </button>
        )}
      </form>
    </div>
  );
}
