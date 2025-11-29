import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

export type StaffStatus = "Active" | "Suspended";

export type StaffTraining = {
  ohs?: boolean;
  prod?: boolean;
  tool?: boolean;
};

export type WeeklySchedule = {
  Monday?: { branchId: string; branchName: string } | null;
  Tuesday?: { branchId: string; branchName: string } | null;
  Wednesday?: { branchId: string; branchName: string } | null;
  Thursday?: { branchId: string; branchName: string } | null;
  Friday?: { branchId: string; branchName: string } | null;
  Saturday?: { branchId: string; branchName: string } | null;
  Sunday?: { branchId: string; branchName: string } | null;
};

export type SalonStaffInput = {
  email?: string;
  name: string;
  role: string;
  branchId: string;
  branchName: string;
  status?: StaffStatus;
  avatar?: string;
  training?: StaffTraining;
  authUid?: string; // This should now be mandatory or strongly encouraged for 'users' model
  systemRole?: string;
  weeklySchedule?: WeeklySchedule;
};

// Creates a staff member directly in the 'users' collection using the authUid as the document key
export async function createSalonStaffForOwner(ownerUid: string, data: SalonStaffInput) {
  if (!data.authUid) {
    throw new Error("authUid is required to create a staff member in the users table.");
  }

  await setDoc(doc(db, "users", data.authUid), {
    uid: data.authUid,
    email: data.email || null,
    displayName: data.name,
    name: data.name, // Keep 'name' for compatibility with staff views
    role: data.systemRole || "salon_staff", // 'role' in users table is the system role
    staffRole: data.role, // 'staffRole' stores the job title (e.g. "Therapist")
    
    ownerUid,
    branchId: data.branchId,
    branchName: data.branchName,
    status: data.status || "Active",
    avatar: data.avatar || data.name,
    training: data.training || { ohs: false, prod: false, tool: false },
    authUid: data.authUid, // Redundant but keeps schema consistent if UI expects it
    systemRole: data.systemRole || "salon_staff",
    weeklySchedule: data.weeklySchedule || null,
    
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    provider: "password", // Assumed
  });
  return data.authUid;
}

export async function updateSalonStaff(staffId: string, data: Partial<SalonStaffInput>) {
  // Map staff-specific fields to user schema if necessary
  const updatePayload: any = { ...data, updatedAt: serverTimestamp() };
  
  if (data.name) updatePayload.displayName = data.name;
  if (data.role) updatePayload.staffRole = data.role; // Update job title
  if (data.systemRole) updatePayload.role = data.systemRole; // Update system access level

  await updateDoc(doc(db, "users", staffId), updatePayload);
}

export async function updateSalonStaffStatus(staffId: string, status: StaffStatus) {
  await updateDoc(doc(db, "users", staffId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSalonStaff(staffId: string) {
  await deleteDoc(doc(db, "users", staffId));
}

export function subscribeSalonStaffForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  // Subscribe to all users belonging to this owner (staff & branch admins)
  // We filter for roles that are NOT 'salon_owner' just in case, though ownerUid check usually suffices for staff
  const q = query(collection(db, "users"), where("ownerUid", "==", ownerUid));
  
  return onSnapshot(q, (snap) => {
    const staffList = snap.docs
      .map((d) => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data,
          // Ensure compatibility with UI which expects 'name' and 'role' (job title)
          name: data.displayName || data.name || "Unknown",
          role: data.staffRole || data.role || "Staff", // prioritize job title, fallback to system role
          systemRole: data.role // 'role' field in users is the system role
        }; 
      })
      // Filter out non-staff if necessary (e.g. customers if they have ownerUid?)
      // Assuming customers don't have ownerUid or are in a different collection/structure.
      // We only want staff-like roles.
      .filter(u => ["salon_staff", "salon_branch_admin"].includes(u.systemRole as string));
      
    onChange(staffList);
  });
}

export async function promoteStaffToBranchAdmin(staffId: string) {
  const userRef = doc(db, "users", staffId);
  await updateDoc(userRef, {
    role: "salon_branch_admin",
    systemRole: "salon_branch_admin", // update both for consistency
    updatedAt: serverTimestamp(),
  });
}

export async function demoteStaffFromBranchAdmin(staffId: string) {
  const userRef = doc(db, "users", staffId);
  await updateDoc(userRef, {
    role: "salon_staff",
    systemRole: "salon_staff",
    updatedAt: serverTimestamp(),
  });
}
