"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import PaymentRequiredModal from "./PaymentRequiredModal";

interface AuthGuardProps {
  children: React.ReactNode;
}

// Pages that super_admin is allowed to access
const SUPER_ADMIN_ALLOWED_PAGES = ["/admin-dashboard", "/tenants", "/login", "/", "/packages", "/super-admin-audit-logs"];

// Pages that don't require payment check (allow access even if pending payment)
const PAYMENT_EXEMPT_PAGES = ["/subscription", "/login", "/reset-password"];

interface PaymentInfo {
  required: boolean;
  planName?: string;
  planPrice?: string;
  planId?: string;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>({ required: false });

  useEffect(() => {
    const checkAuth = async () => {
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          router.replace("/login");
          setLoading(false);
          return;
        }

        try {
          console.log("[AuthGuard] Checking user:", user.uid, user.email);
          
          // Check super_admins collection first
          const superAdminDoc = await getDoc(doc(db, "super_admins", user.uid));
          let userRole: string;
          let userData: any = null;
          
          if (superAdminDoc.exists()) {
            userRole = "super_admin";
            console.log("[AuthGuard] User is super_admin");
            
            // Super admin route restriction: only allow admin-dashboard and tenants
            const isAllowedPage = pathname && SUPER_ADMIN_ALLOWED_PAGES.some(page => {
              if (page === "/") return pathname === "/" || pathname === "/admin-dashboard";
              return pathname === page || pathname.startsWith(page + "/");
            });
            
            if (!isAllowedPage) {
              // Redirect super_admin to admin-dashboard if trying to access unauthorized page
              router.replace("/admin-dashboard");
              setLoading(false);
              return;
            }
          } else {
            // Get user role from users collection
            console.log("[AuthGuard] Looking up user document at: users/" + user.uid);
            const userDoc = await getDoc(doc(db, "users", user.uid));
            console.log("[AuthGuard] User document exists:", userDoc.exists());
            userData = userDoc.data();
            console.log("[AuthGuard] User data:", userData);
            userRole = (userData?.role || "").toString().toLowerCase();
            console.log("[AuthGuard] User role:", userRole);
          }
          
          // Check if user has admin role
          const allowedRoles = ["salon_owner", "salon_branch_admin", "super_admin"];
          
          if (!allowedRoles.includes(userRole)) {
            // User is not an admin (probably a customer)
            await auth.signOut();
            router.replace("/login");
            setLoading(false);
            return;
          }

          // Check payment status for salon_owner
          console.log("[AuthGuard] Checking payment status. Role:", userRole, "Has userData:", !!userData);
          if (userRole === "salon_owner" && userData) {
            const accountStatus = userData.accountStatus || "active";
            const subscriptionStatus = userData.subscriptionStatus || "active";
            console.log("[AuthGuard] Account status:", accountStatus, "Subscription status:", subscriptionStatus);
            
            // Check if payment is required
            const needsPayment = 
              accountStatus === "pending_payment" || 
              accountStatus === "suspended" ||
              subscriptionStatus === "pending" ||
              subscriptionStatus === "past_due" ||
              subscriptionStatus === "unpaid";
            
            console.log("[AuthGuard] Needs payment:", needsPayment, "Pathname:", pathname);
            
            if (needsPayment) {
              // Check if current page is payment-exempt
              const isPaymentExemptPage = pathname && PAYMENT_EXEMPT_PAGES.some(page => 
                pathname === page || pathname.startsWith(page + "/")
              );
              
              // If on subscription success page, don't show modal
              const isSuccessPage = pathname?.includes("/subscription/success");
              
              console.log("[AuthGuard] Is payment exempt page:", isPaymentExemptPage, "Is success page:", isSuccessPage);
              
              if (!isPaymentExemptPage && !isSuccessPage) {
                console.log("[AuthGuard] SHOWING PAYMENT MODAL with planId:", userData.planId);
                setPaymentInfo({
                  required: true,
                  planName: userData.plan || undefined,
                  planPrice: userData.price || undefined,
                  planId: userData.planId || undefined,
                });
              } else {
                setPaymentInfo({ required: false });
              }
            } else {
              setPaymentInfo({ required: false });
            }
          } else {
            console.log("[AuthGuard] Not showing payment modal - not salon_owner or no userData");
            setPaymentInfo({ required: false });
          }

          // User is authorized
          setAuthorized(true);
          setLoading(false);
        } catch (error) {
          console.error("Auth check error:", error);
          router.replace("/login");
          setLoading(false);
        }
      });

      return () => unsub();
    };

    checkAuth();
  }, [router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return (
    <>
      {children}
      <PaymentRequiredModal
        isOpen={paymentInfo.required}
        planName={paymentInfo.planName}
        planPrice={paymentInfo.planPrice}
        planId={paymentInfo.planId}
      />
    </>
  );
}

