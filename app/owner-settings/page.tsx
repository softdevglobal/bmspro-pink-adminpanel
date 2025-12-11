"use client";
import React, { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

type UserData = {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  contactPhone?: string;
  abn?: string;
  address?: string;
  locationText?: string;
  businessStructure?: string;
  gstRegistered?: boolean;
  state?: string;
  plan?: string;
  price?: string;
  role: string;
  logoUrl?: string;
  termsAndConditions?: string;
};

export default function OwnerSettingsPage() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);

  // Form states
  const [salonName, setSalonName] = useState("");
  const [abn, setAbn] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [showRemoveLogoModal, setShowRemoveLogoModal] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Toast notifications
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        if (typeof window !== "undefined") localStorage.setItem("idToken", token);
        
        // Fetch user data
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.data();
        const role = (data?.role || "").toString();
        
        if (role === "salon_branch_admin") {
          router.replace("/branches");
          return;
        }
        if (role !== "salon_owner") {
          router.replace("/dashboard");
          return;
        }

        // Set user data - use locationText as address and contactPhone as phone
        const userData: UserData = {
          uid: user.uid,
          name: data?.name || data?.displayName || "",
          email: user.email || data?.email || "",
          phone: data?.contactPhone || data?.phone || "",
          contactPhone: data?.contactPhone || "",
          abn: data?.abn || "",
          address: data?.locationText || data?.address || "",
          locationText: data?.locationText || "",
          businessStructure: data?.businessStructure || "",
          gstRegistered: data?.gstRegistered ?? false,
          state: data?.state || "",
          plan: data?.plan || "",
          price: data?.price || "",
          role: role,
          logoUrl: data?.logoUrl || "",
          termsAndConditions: data?.termsAndConditions || "",
        };
        
        setUserData(userData);
        
        // Initialize form fields - use locationText for address and contactPhone for phone
        setSalonName(userData.name);
        setAbn(userData.abn || "");
        setAddress(userData.locationText || userData.address || "");
        setPhone(userData.contactPhone || userData.phone || "");
        setLogoUrl(userData.logoUrl || "");
        setTermsAndConditions(userData.termsAndConditions || "");
        
        setMounted(true);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching user data:", error);
        router.replace("/login");
      }
    });
    return () => unsub();
  }, [router]);

  const handleSaveProfile = async () => {
    if (!userData) return;
    setSaving("profile");
    try {
      await updateDoc(doc(db, "users", userData.uid), {
        name: salonName,
        displayName: salonName,
        abn: abn,
        locationText: address,
        contactPhone: phone,
        updatedAt: serverTimestamp(),
      });
      setUserData({ ...userData, name: salonName, abn, address, locationText: address, phone, contactPhone: phone });
      showToast("Profile saved successfully!");
    } catch (error) {
      console.error("Error saving profile:", error);
      showToast("Failed to save profile. Please try again.", "error");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveTerms = async () => {
    if (!userData) return;
    setSaving("terms");
    try {
      await updateDoc(doc(db, "users", userData.uid), {
        termsAndConditions: termsAndConditions,
        updatedAt: serverTimestamp(),
      });
      setUserData({ ...userData, termsAndConditions });
      showToast("Terms & Conditions saved successfully!");
    } catch (error) {
      console.error("Error saving terms:", error);
      showToast("Failed to save terms. Please try again.", "error");
    } finally {
      setSaving(null);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userData) return;

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast("Please upload a valid image file (PNG, JPG, SVG, or WebP)", "error");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast("File size must be less than 5MB", "error");
      return;
    }

    setUploadingLogo(true);
    try {
      // Create a unique filename
      const fileExtension = file.name.split('.').pop();
      const fileName = `salon-logos/${userData.uid}/logo-${Date.now()}.${fileExtension}`;
      const storageRef = ref(storage, fileName);

      // Upload the file
      await uploadBytes(storageRef, file);

      // Get the download URL
      const downloadUrl = await getDownloadURL(storageRef);

      // Save URL to Firestore
      await updateDoc(doc(db, "users", userData.uid), {
        logoUrl: downloadUrl,
        updatedAt: serverTimestamp(),
      });

      setLogoUrl(downloadUrl);
      setUserData({ ...userData, logoUrl: downloadUrl });
      showToast("Logo uploaded successfully!");
    } catch (error) {
      console.error("Error uploading logo:", error);
      showToast("Failed to upload logo. Please try again.", "error");
    } finally {
      setUploadingLogo(false);
      // Reset the input
      if (logoInputRef.current) {
        logoInputRef.current.value = "";
      }
    }
  };

  const handleRemoveLogo = () => {
    if (!userData) return;
    setShowRemoveLogoModal(true);
  };

  const confirmRemoveLogo = async () => {
    if (!userData) return;
    setShowRemoveLogoModal(false);
    setUploadingLogo(true);
    try {
      await updateDoc(doc(db, "users", userData.uid), {
        logoUrl: "",
        updatedAt: serverTimestamp(),
      });
      setLogoUrl("");
      setUserData({ ...userData, logoUrl: "" });
      showToast("Logo removed successfully!");
    } catch (error) {
      console.error("Error removing logo:", error);
      showToast("Failed to remove logo. Please try again.", "error");
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div id="app" className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="md:hidden mb-4">
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => setMobileOpen(true)}
            >
              <i className="fas fa-bars" />
              Menu
            </button>
          </div>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
              <div className="absolute left-0 top-0 bottom-0">
                <Sidebar mobile onClose={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <i className="fas fa-circle-notch fa-spin text-4xl text-pink-500" />
                <p className="text-slate-500 font-medium">Loading settings...</p>
              </div>
            </div>
          ) : mounted && userData && (
            <>
              <div className="mb-8">
                <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                        <i className="fas fa-cog" />
                      </div>
                      <div>
                        <h1 className="text-2xl font-bold">Salon Settings</h1>
                        <p className="text-sm text-white/80 mt-1">Business profile, branding, booking rules, notifications</p>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-full">
                      <i className="fas fa-user-tie text-sm" />
                      <span className="text-sm font-medium">{userData.email}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <section className="lg:col-span-2 space-y-6">
                  {/* Business Profile */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-slate-900 mb-4">Business Profile</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Salon Name</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="Your Salon Name"
                          value={salonName}
                          onChange={(e) => setSalonName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">ABN</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="00 000 000 000"
                          value={abn}
                          onChange={(e) => setAbn(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="+61 xxx xxx xxx"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                        <input 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed" 
                          value={userData.email}
                          disabled
                          title="Email cannot be changed"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Address</label>
                        <textarea 
                          rows={3} 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent" 
                          placeholder="Street, City, Postcode"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleSaveProfile}
                        disabled={saving === "profile"}
                        className="px-5 py-2.5 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {saving === "profile" ? (
                          <>
                            <i className="fas fa-spinner fa-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-save" />
                            Save Profile
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Terms and Conditions */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center">
                        <i className="fas fa-file-contract" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Terms & Conditions</h2>
                        <p className="text-sm text-slate-500">Set your booking terms that customers must agree to</p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Terms & Conditions Text
                        </label>
                        <textarea 
                          rows={8} 
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                          placeholder="Enter your salon's terms and conditions here...

Example:
• Cancellations must be made at least 24 hours in advance
• Late arrivals may result in shortened service time
• A deposit may be required for certain services
• We reserve the right to refuse service
• All prices are subject to change without notice"
                          value={termsAndConditions}
                          onChange={(e) => setTermsAndConditions(e.target.value)}
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          <i className="fas fa-info-circle mr-1" />
                          These terms will be shown to customers during the booking process
                        </p>
                      </div>
                      
                      {termsAndConditions && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <i className="fas fa-eye" />
                            Preview
                          </h4>
                          <div className="text-sm text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {termsAndConditions}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleSaveTerms}
                        disabled={saving === "terms"}
                        className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {saving === "terms" ? (
                          <>
                            <i className="fas fa-spinner fa-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <i className="fas fa-save" />
                            Save Terms
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                </section>

                <aside className="space-y-6">
                  {/* Account Info Card */}
                  <div className="bg-gradient-to-br from-pink-50 to-purple-50 border border-pink-100 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      {logoUrl ? (
                        <div className="w-12 h-12 rounded-full border-2 border-pink-200 overflow-hidden bg-white">
                          <img src={logoUrl} alt="Salon Logo" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center font-bold text-lg">
                          {salonName ? salonName.slice(0, 2).toUpperCase() : "SA"}
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold text-slate-900">{salonName || "Your Salon"}</h3>
                        <p className="text-xs text-slate-500">{userData.email}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between py-2 border-b border-pink-100">
                        <span className="text-slate-600">Role</span>
                        <span className="px-2 py-0.5 bg-pink-100 text-pink-700 rounded-full text-xs font-medium">Salon Owner</span>
                      </div>
                      {abn && (
                        <div className="flex items-center justify-between py-2 border-b border-pink-100">
                          <span className="text-slate-600">ABN</span>
                          <span className="text-slate-800 font-medium">{abn}</span>
                        </div>
                      )}
                      {phone && (
                        <div className="flex items-center justify-between py-2 border-b border-pink-100">
                          <span className="text-slate-600">Phone</span>
                          <span className="text-slate-800">{phone}</span>
                        </div>
                      )}
                      {address && (
                        <div className="py-2 border-b border-pink-100">
                          <span className="text-slate-600 block mb-1">Address</span>
                          <span className="text-slate-800 text-xs">{address}</span>
                        </div>
                      )}
                      {userData.businessStructure && (
                        <div className="flex items-center justify-between py-2 border-b border-pink-100">
                          <span className="text-slate-600">Structure</span>
                          <span className="text-slate-800">{userData.businessStructure}</span>
                        </div>
                      )}
                      {userData.state && (
                        <div className="flex items-center justify-between py-2 border-b border-pink-100">
                          <span className="text-slate-600">State</span>
                          <span className="text-slate-800">{userData.state}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between py-2 border-b border-pink-100">
                        <span className="text-slate-600">GST Registered</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${userData.gstRegistered ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {userData.gstRegistered ? 'Yes' : 'No'}
                        </span>
                      </div>
                      {userData.plan && (
                        <div className="flex items-center justify-between py-2">
                          <span className="text-slate-600">Plan</span>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                            {userData.plan} {userData.price ? `(${userData.price})` : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Branding - Logo Upload */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <h3 className="text-base font-semibold text-slate-900 mb-4">Salon Logo</h3>
                    <div className="space-y-4">
                      <div>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                          className="hidden"
                          onChange={handleLogoUpload}
                          disabled={uploadingLogo}
                        />
                        
                        {logoUrl ? (
                          <div className="space-y-3">
                            <div className="relative w-full h-32 rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                              <img 
                                src={logoUrl} 
                                alt="Salon Logo" 
                                className="w-full h-full object-contain p-2"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => logoInputRef.current?.click()}
                                disabled={uploadingLogo}
                                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              >
                                {uploadingLogo ? (
                                  <>
                                    <i className="fas fa-spinner fa-spin" />
                                    Uploading...
                                  </>
                                ) : (
                                  <>
                                    <i className="fas fa-sync-alt" />
                                    Change Logo
                                  </>
                                )}
                              </button>
                              <button
                                onClick={handleRemoveLogo}
                                disabled={uploadingLogo}
                                className="px-4 py-2 border border-red-200 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <i className="fas fa-trash" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div 
                            onClick={() => !uploadingLogo && logoInputRef.current?.click()}
                            className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl h-32 transition cursor-pointer ${
                              uploadingLogo 
                                ? 'border-pink-300 bg-pink-50' 
                                : 'border-slate-300 hover:border-pink-400 hover:bg-pink-50'
                            }`}
                          >
                            {uploadingLogo ? (
                              <div className="text-center text-pink-600">
                                <i className="fas fa-spinner fa-spin text-2xl mb-2" />
                                <p className="text-sm font-medium">Uploading...</p>
                              </div>
                            ) : (
                              <div className="text-center text-slate-500">
                                <i className="fas fa-cloud-upload-alt text-2xl mb-2" />
                                <p className="text-sm font-medium">Click to upload logo</p>
                                <p className="text-xs text-slate-400 mt-1">PNG, JPG, SVG or WebP (max 5MB)</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Remove Logo Confirmation Modal */}
      {showRemoveLogoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRemoveLogoModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-slide-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-500 to-pink-600 p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <i className="fas fa-trash-alt text-white text-xl" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">Remove Logo</h3>
                  <p className="text-white/80 text-sm">This action cannot be undone</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                {logoUrl && (
                  <div className="w-16 h-16 rounded-xl border-2 border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0">
                    <img src={logoUrl} alt="Current Logo" className="w-full h-full object-contain p-1" />
                  </div>
                )}
                <p className="text-slate-600">
                  Are you sure you want to remove your salon logo? Your profile will display default initials instead.
                </p>
              </div>
              
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-start gap-2">
                <i className="fas fa-exclamation-triangle mt-0.5" />
                <span>This will remove the logo from your profile and all public-facing pages.</span>
              </div>
            </div>
            
            {/* Actions */}
            <div className="px-6 pb-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRemoveLogoModal(false)}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveLogo}
                className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-700 transition flex items-center gap-2"
              >
                <i className="fas fa-trash-alt" />
                Remove Logo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg border-l-4 flex items-center gap-2 animate-slide-in ${
              t.type === 'error' ? 'border-red-500' : 'border-pink-500'
            }`}
          >
            <i className={`fas ${t.type === 'error' ? 'fa-circle-xmark text-red-500' : 'fa-circle-check text-pink-500'}`} />
            <span className="text-sm">{t.message}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
