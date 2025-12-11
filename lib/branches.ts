import { db } from "@/lib/firebase";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { promoteStaffToBranchAdmin, demoteStaffFromBranchAdmin, WeeklySchedule } from "@/lib/salonStaff";

// Staff assignment by day for a branch
export type StaffByDay = {
  Monday?: string[];
  Tuesday?: string[];
  Wednesday?: string[];
  Thursday?: string[];
  Friday?: string[];
  Saturday?: string[];
  Sunday?: string[];
};

export type BranchInput = {
  name: string;
  address: string;
  phone?: string;
  email?: string;
  staffIds?: string[];
  staffByDay?: StaffByDay;
  serviceIds?: string[];
  hours?:
    | string
    | {
        Monday?: { open?: string; close?: string; closed?: boolean };
        Tuesday?: { open?: string; close?: string; closed?: boolean };
        Wednesday?: { open?: string; close?: string; closed?: boolean };
        Thursday?: { open?: string; close?: string; closed?: boolean };
        Friday?: { open?: string; close?: string; closed?: boolean };
        Saturday?: { open?: string; close?: string; closed?: boolean };
        Sunday?: { open?: string; close?: string; closed?: boolean };
      };
  capacity?: number;
  manager?: string;
  adminStaffId?: string | null;
  status?: "Active" | "Pending" | "Closed";
};

export async function createBranchForOwner(ownerUid: string, data: BranchInput) {
  const ref = await addDoc(collection(db, "branches"), {
    ownerUid,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // If admin is assigned, promote them and set their schedule to match branch hours
  if (data.adminStaffId) {
    const { weeklySchedule } = await promoteStaffToBranchAdmin(data.adminStaffId, {
      branchId: ref.id,
      branchName: data.name,
      branchHours: data.hours,
    });
    
    // Sync the branch's staffByDay with the admin's new schedule
    if (weeklySchedule) {
      await syncBranchStaffFromSchedule(data.adminStaffId, weeklySchedule, null, ownerUid);
    }
  }

  return ref.id;
}

export async function updateBranch(branchId: string, data: Partial<BranchInput>) {
  const branchRef = doc(db, "branches", branchId);
  
  // Fetch current branch to see if admin changed
  const snap = await getDoc(branchRef);
  const currentData = snap.data();
  const oldAdminId = currentData?.adminStaffId;
  const ownerUid = currentData?.ownerUid;

  await updateDoc(branchRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  const newAdminId = data.adminStaffId;

  // 1. If there was an old admin, and (we are setting a new one OR explicitly clearing it), and it's different
  if (oldAdminId && newAdminId !== undefined && oldAdminId !== newAdminId) {
    await demoteStaffFromBranchAdmin(oldAdminId);
  }

  // 2. If there is a new admin, promote them and update their schedule to match branch hours
  if (newAdminId) {
    // Get the branch name and hours (either from new data or existing)
    const branchName = data.name || currentData?.name || "";
    const branchHours = data.hours || currentData?.hours;
    
    const { weeklySchedule } = await promoteStaffToBranchAdmin(newAdminId, {
      branchId,
      branchName,
      branchHours,
    });
    
    // Sync the branch's staffByDay with the admin's new schedule
    if (weeklySchedule && ownerUid) {
      await syncBranchStaffFromSchedule(newAdminId, weeklySchedule, null, ownerUid);
    }
  }
}

export async function deleteBranch(branchId: string) {
  // Optional: Demote admin before deleting?
  // For now, simple delete.
  await deleteDoc(doc(db, "branches", branchId));
}

export function subscribeBranchesForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  const q = query(collection(db, "branches"), where("ownerUid", "==", ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })));
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for branches query. User may not be authenticated.");
        onChange([]);
      } else {
        console.error("Error in branches snapshot:", error);
        onChange([]);
      }
    }
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/**
 * Syncs branch staffIds and staffByDay when a staff member's schedule changes.
 * This function:
 * 1. Removes the staff from all branches they were previously assigned to
 * 2. Adds the staff to the branches they are now assigned to based on weeklySchedule
 */
export async function syncBranchStaffFromSchedule(
  staffId: string,
  newSchedule: WeeklySchedule | null | undefined,
  oldSchedule: WeeklySchedule | null | undefined,
  ownerUid: string
) {
  // Collect all unique branch IDs that need updating
  const branchIdsToUpdate = new Set<string>();
  
  // Add branches from old schedule (to remove staff from)
  if (oldSchedule) {
    for (const day of DAYS) {
      const assignment = oldSchedule[day];
      if (assignment?.branchId) {
        branchIdsToUpdate.add(assignment.branchId);
      }
    }
  }
  
  // Add branches from new schedule (to add staff to)
  if (newSchedule) {
    for (const day of DAYS) {
      const assignment = newSchedule[day];
      if (assignment?.branchId) {
        branchIdsToUpdate.add(assignment.branchId);
      }
    }
  }
  
  // Update each affected branch
  for (const branchId of branchIdsToUpdate) {
    try {
      const branchRef = doc(db, "branches", branchId);
      const branchSnap = await getDoc(branchRef);
      
      if (!branchSnap.exists()) continue;
      
      const branchData = branchSnap.data();
      
      // Build the new staffByDay for this branch
      const currentStaffByDay: StaffByDay = branchData.staffByDay || {};
      const newStaffByDay: StaffByDay = { ...currentStaffByDay };
      
      // For each day, check if this staff should be added or removed
      for (const day of DAYS) {
        const oldAssignment = oldSchedule?.[day];
        const newAssignment = newSchedule?.[day];
        
        // Get current day staff array or empty array
        const dayStaff = new Set(newStaffByDay[day] || []);
        
        // If staff was previously assigned to this branch on this day, remove them
        if (oldAssignment?.branchId === branchId) {
          dayStaff.delete(staffId);
        }
        
        // If staff is now assigned to this branch on this day, add them
        if (newAssignment?.branchId === branchId) {
          dayStaff.add(staffId);
        }
        
        // Update the day array (only if it has staff, otherwise leave undefined)
        if (dayStaff.size > 0) {
          newStaffByDay[day] = Array.from(dayStaff);
        } else {
          delete newStaffByDay[day];
        }
      }
      
      // Build unique staffIds from all days
      const allStaffIds = new Set<string>();
      for (const day of DAYS) {
        const dayStaff = newStaffByDay[day] || [];
        for (const id of dayStaff) {
          allStaffIds.add(id);
        }
      }
      
      // Update the branch document
      await updateDoc(branchRef, {
        staffByDay: newStaffByDay,
        staffIds: Array.from(allStaffIds),
        updatedAt: serverTimestamp(),
      });
      
    } catch (error) {
      console.error(`Failed to sync staff for branch ${branchId}:`, error);
    }
  }
}

/**
 * Removes a staff member from all branches when they are deleted
 */
export async function removeStaffFromAllBranches(staffId: string, ownerUid: string) {
  try {
    // Get all branches for this owner
    const branchesQuery = query(collection(db, "branches"), where("ownerUid", "==", ownerUid));
    const branchesSnap = await getDocs(branchesQuery);
    
    for (const branchDoc of branchesSnap.docs) {
      const branchData = branchDoc.data();
      const staffIds = branchData.staffIds || [];
      const staffByDay: StaffByDay = branchData.staffByDay || {};
      
      // Check if staff is in this branch
      if (!staffIds.includes(staffId)) continue;
      
      // Remove from staffByDay
      const newStaffByDay: StaffByDay = {};
      for (const day of DAYS) {
        const dayStaff = (staffByDay[day] || []).filter((id: string) => id !== staffId);
        if (dayStaff.length > 0) {
          newStaffByDay[day] = dayStaff;
        }
      }
      
      // Remove from staffIds
      const newStaffIds = staffIds.filter((id: string) => id !== staffId);
      
      await updateDoc(branchDoc.ref, {
        staffByDay: newStaffByDay,
        staffIds: newStaffIds,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error("Failed to remove staff from branches:", error);
  }
}
