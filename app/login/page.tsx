"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authed = typeof window !== "undefined" && localStorage.getItem("auth");
    if (authed) {
      router.replace("/dashboard");
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      localStorage.setItem("auth", "1");
      router.replace("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Unable to sign in");
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

          <h2 className="text-xl font-bold text-slate-900 mb-1">Sign in</h2>
          <p className="text-sm text-slate-500 mb-6">Access your admin dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
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
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
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


