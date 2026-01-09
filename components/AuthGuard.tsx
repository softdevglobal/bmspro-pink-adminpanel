"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface AuthGuardProps {
  children: React.ReactNode;
}

// Pages that super_admin is allowed to access
const SUPER_ADMIN_ALLOWED_PAGES = ["/admin-dashboard", "/tenants", "/login", "/"];

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          router.replace("/login");
          setLoading(false);
          return;
        }

        try {
          // Check super_admins collection first
          const superAdminDoc = await getDoc(doc(db, "super_admins", user.uid));
          let userRole: string;
          
          if (superAdminDoc.exists()) {
            userRole = "super_admin";
            
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
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const userData = userDoc.data();
            userRole = (userData?.role || "").toString().toLowerCase();
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

  return <>{children}</>;
}

