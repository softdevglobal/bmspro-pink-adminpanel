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
  
  return onSnapshot(
    q,
    (snap) => {
      const staffList = snap.docs
        .map((d) => {
          const data = d.data();
          return { 
            id: d.id, 
            ...data,
            // Ensure authUid is available (should match doc.id for properly created staff)
            authUid: data.authUid || data.uid || d.id,
            uid: data.uid || data.authUid || d.id,
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
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for staff query. User may not be authenticated.");
        onChange([]);
      } else {
        console.error("Error in staff snapshot:", error);
        onChange([]);
      }
    }
  );
}

type BranchHours = {
  Monday?: { open?: string; close?: string; closed?: boolean };
  Tuesday?: { open?: string; close?: string; closed?: boolean };
  Wednesday?: { open?: string; close?: string; closed?: boolean };
  Thursday?: { open?: string; close?: string; closed?: boolean };
  Friday?: { open?: string; close?: string; closed?: boolean };
  Saturday?: { open?: string; close?: string; closed?: boolean };
  Sunday?: { open?: string; close?: string; closed?: boolean };
};

type PromoteOptions = {
  branchId: string;
  branchName: string;
  branchHours?: string | BranchHours;
};

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export async function promoteStaffToBranchAdmin(staffId: string, options?: PromoteOptions): Promise<{ weeklySchedule: WeeklySchedule | null }> {
  const userRef = doc(db, "users", staffId);
  
  // Build the weekly schedule based on branch hours (work all days the branch is open)
  let weeklySchedule: WeeklySchedule | null = null;
  
  if (options) {
    weeklySchedule = {};
    const { branchId, branchName, branchHours } = options;
    
    // If branchHours is an object, use it to determine open days
    if (branchHours && typeof branchHours === "object") {
      for (const day of DAYS_OF_WEEK) {
        const dayHours = branchHours[day];
        // If the day is not closed, assign the staff to work at this branch on that day
        if (dayHours && !dayHours.closed) {
          weeklySchedule[day] = { branchId, branchName };
        } else {
          weeklySchedule[day] = null; // Off day
        }
      }
    } else {
      // If no hours object, default to working all weekdays
      for (const day of DAYS_OF_WEEK) {
        if (day === "Sunday") {
          weeklySchedule[day] = null; // Default Sunday off
        } else {
          weeklySchedule[day] = { branchId, branchName };
        }
      }
    }
  }
  
  const updatePayload: any = {
    role: "salon_branch_admin",
    systemRole: "salon_branch_admin",
    updatedAt: serverTimestamp(),
  };
  
  // Update branch assignment and schedule if provided
  if (options) {
    updatePayload.branchId = options.branchId;
    updatePayload.branchName = options.branchName;
    if (weeklySchedule) {
      updatePayload.weeklySchedule = weeklySchedule;
    }
  }
  
  await updateDoc(userRef, updatePayload);
  
  return { weeklySchedule };
}

export async function demoteStaffFromBranchAdmin(staffId: string) {
  const userRef = doc(db, "users", staffId);
  await updateDoc(userRef, {
    role: "salon_staff",
    systemRole: "salon_staff",
    updatedAt: serverTimestamp(),
  });
}
