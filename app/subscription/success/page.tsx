"use client";
import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function SubscriptionSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push("/subscription");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Success Header */}
          <div className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 p-8 text-center">
            <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-check text-4xl text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Payment Successful!</h1>
            <p className="text-white/90">Your subscription has been activated</p>
          </div>

          {/* Content */}
          <div className="p-8 text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-crown text-2xl text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Welcome to Premium!</h2>
              <p className="text-slate-600">
                Thank you for subscribing. You now have full access to all features included in your plan.
              </p>
            </div>

            {sessionId && (
              <div className="bg-slate-50 rounded-xl p-4 mb-6">
                <p className="text-xs text-slate-500 mb-1">Session ID</p>
                <p className="text-sm font-mono text-slate-700 break-all">{sessionId}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => router.push("/subscription")}
                className="w-full py-3 px-6 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold rounded-xl hover:shadow-lg transition-all"
              >
                <i className="fas fa-arrow-right mr-2" />
                Go to Subscription Page
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full py-3 px-6 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-all"
              >
                <i className="fas fa-home mr-2" />
                Go to Dashboard
              </button>
            </div>

            <p className="text-sm text-slate-500 mt-6">
              Redirecting in {countdown} seconds...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
