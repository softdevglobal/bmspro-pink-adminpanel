"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { ensureUserDocument } from "@/lib/users";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);

  function friendlyAuthMessage(code?: string) {
    switch (code) {
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/user-not-found":
        return "Invalid email or password.";
      case "auth/wrong-password":
        return "Invalid email or password.";
      case "auth/invalid-credential":
        return "Invalid email or password.";
      case "auth/email-already-in-use":
        return "An account already exists with this email.";
      case "auth/weak-password":
        return "Password should be at least 6 characters.";
      case "auth/operation-not-allowed":
        return "Sign-in is temporarily unavailable. Please contact support.";
      case "auth/invalid-api-key":
        return "Configuration error. Please contact support.";
      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";
      case "auth/too-many-requests":
        return "Too many attempts. Try again later.";
      default:
        return "Sign in failed. Please try again.";
    }
  }

  useEffect(() => {
    const hasToken = typeof window !== "undefined" && localStorage.getItem("idToken");
    if (hasToken) {
      // Don't auto-redirect if we just landed here; let the user interaction or explicit auth check handle it
      // to prevent loops if token is invalid but present.
      // However, for UX, we often want to skip login if logged in.
      // Let's verify the token with onAuthStateChanged instead of blind redirect.
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAuthErrorCode(null);
    // simple client-side validation
    let valid = true;
    if (!email.trim()) {
      setEmailError("Email is required.");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      valid = false;
    } else {
      setEmailError(null);
    }
    if (!password) {
      setPasswordError("Password is required.");
      valid = false;
    } else {
      setPasswordError(null);
    }
    if (!valid) return;
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await ensureUserDocument(auth.currentUser);

      // Check suspension BEFORE persisting any tokens/role locally
      const uid = auth.currentUser?.uid;
      if (uid) {
        const snap = await getDoc(doc(db, "users", uid));
        const suspended = Boolean(snap.data()?.suspended);
        const statusText = (snap.data()?.status || "").toString().toLowerCase();
        if (suspended || statusText.includes("suspend")) {
          await (await import("firebase/auth")).signOut(auth);
          setError("Your account is suspended. Please contact support.");
          return;
        }
      }

      // Persist token
      const token = await auth.currentUser?.getIdToken();
      if (token && typeof window !== "undefined") {
        localStorage.setItem("idToken", token);
      }
      // Fetch role and persist for immediate sidebar rendering (after suspension check)
      try {
        const uid2 = auth.currentUser?.uid;
        if (uid2) {
          const snap = await getDoc(doc(db, "users", uid2));
          const data = snap.data();
          const role = (data?.role || "").toString();
          const name = (data?.displayName || data?.name || "").toString();
          if (typeof window !== "undefined") {
            localStorage.setItem("role", role);
            if (name) localStorage.setItem("userName", name);
          }
        }
      } catch {}
      // Avoid immediate redirect if we are already on a page that might redirect back
      // Instead, verify role logic one last time
      if (localStorage.getItem("role") === "salon_branch_admin") {
        router.replace("/branches");
      } else {
        router.replace("/dashboard");
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(friendlyAuthMessage(err?.code));
      setAuthErrorCode(err?.code || null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-pink-600 rounded-xl flex items-center justify-center shadow-lg">
              <i className="fas fa-scissors text-white text-lg" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-900">BMS PRO</h1>
              <p className="text-xs font-semibold text-pink-600">PINK — Admin</p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
          </div>
          <p className="text-sm text-slate-500 mb-6">
            Access your admin dashboard
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                  if (authErrorCode) setAuthErrorCode(null);
                }}
                onBlur={() => {
                  if (!email.trim()) setEmailError("Email is required.");
                  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) setEmailError("Enter a valid email address.");
                }}
                aria-invalid={!!emailError}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent ${
                  emailError || authErrorCode === "auth/user-not-found" || authErrorCode === "auth/invalid-email"
                    ? "border-rose-400"
                    : "border-slate-300"
                }`}
              />
              {emailError && <p className="mt-1 text-xs text-rose-600">{emailError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                    if (authErrorCode) setAuthErrorCode(null);
                  }}
                  onBlur={() => {
                    if (!password) setPasswordError("Password is required.");
                  }}
                  aria-invalid={!!passwordError}
                  className={`w-full px-4 py-3 pr-12 border rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent ${
                    passwordError || authErrorCode === "auth/wrong-password" || authErrorCode === "auth/invalid-credential"
                      ? "border-rose-400"
                      : "border-slate-300"
                  }`}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700"
                >
                  <i className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"}`} />
                </button>
              </div>
              {passwordError && <p className="mt-1 text-xs text-rose-600">{passwordError}</p>}
            </div>
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 p-3 flex items-start gap-2">
                <i className="fas fa-circle-exclamation mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold">Sign in failed</p>
                  <p className="text-sm">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAuthErrorCode(null);
                  }}
                  aria-label="Dismiss error"
                  className="text-rose-700/70 hover:text-rose-800"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-5 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition disabled:opacity-70"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-xs text-slate-500 mt-6 text-center">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}


