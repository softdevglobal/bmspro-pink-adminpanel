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
import { 
  getCurrentUserForAudit, 
  logBranchCreated, 
  logBranchUpdated, 
  logBranchDeleted,
  logBranchAdminAssigned
} from "@/lib/auditLog";

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

// Branch location data for geofencing
export type BranchLocation = {
  latitude: number;
  longitude: number;
  placeId?: string; // Google Places ID for reference
  formattedAddress?: string;
};

export type BranchInput = {
  name: string;
  address: string;
  phone?: string;
  email?: string;
  timezone?: string; // IANA timezone (e.g., 'Australia/Sydney', 'Australia/Melbourne')
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
  // Geolocation fields for staff check-in
  location?: BranchLocation;
  allowedCheckInRadius?: number; // in meters (default 100m)
};

export async function createBranchForOwner(ownerUid: string, data: BranchInput, adminName?: string) {
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

  // Audit log for branch creation
  try {
    const performer = await getCurrentUserForAudit();
    if (performer) {
      await logBranchCreated(
        ownerUid,
        ref.id,
        data.name,
        data.address,
        performer
      );

      // Log admin assignment if applicable
      if (data.adminStaffId && adminName) {
        await logBranchAdminAssigned(
          ownerUid,
          ref.id,
          data.name,
          data.adminStaffId,
          adminName,
          performer
        );
      }
    }
  } catch (e) {
    console.error("Failed to create audit log for branch creation:", e);
  }

  return ref.id;
}

export async function updateBranch(branchId: string, data: Partial<BranchInput>, newAdminName?: string) {
  const branchRef = doc(db, "branches", branchId);
  
  // Fetch current branch to see if admin changed
  const snap = await getDoc(branchRef);
  const currentData = snap.data();
  const oldAdminId = currentData?.adminStaffId;
  const ownerUid = currentData?.ownerUid;
  const branchName = data.name || currentData?.name || "";

  // Build change description for audit log
  const changes: string[] = [];
  if (data.name && data.name !== currentData?.name) changes.push(`Name: ${currentData?.name} → ${data.name}`);
  if (data.address && data.address !== currentData?.address) changes.push(`Address updated`);
  if (data.phone && data.phone !== currentData?.phone) changes.push(`Phone updated`);
  if (data.status && data.status !== currentData?.status) changes.push(`Status: ${currentData?.status} → ${data.status}`);

  await updateDoc(branchRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  const newAdminId = data.adminStaffId;

  // 1. If there was an old admin, and (we are setting a new one OR explicitly clearing it), and it's different
  if (oldAdminId && newAdminId !== undefined && oldAdminId !== newAdminId) {
    await demoteStaffFromBranchAdmin(oldAdminId);
    changes.push(`Admin changed`);
  }

  // 2. If there is a new admin, promote them and update their schedule to match branch hours
  if (newAdminId && newAdminId !== oldAdminId) {
    // Get the branch name and hours (either from new data or existing)
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

  // Audit log for branch update
  try {
    const performer = await getCurrentUserForAudit();
    if (performer && ownerUid) {
      await logBranchUpdated(
        ownerUid,
        branchId,
        branchName,
        performer,
        changes.length > 0 ? changes.join(", ") : "Minor updates"
      );

      // Log admin assignment if applicable
      if (newAdminId && newAdminId !== oldAdminId && newAdminName) {
        await logBranchAdminAssigned(
          ownerUid,
          branchId,
          branchName,
          newAdminId,
          newAdminName,
          performer
        );
      }
    }
  } catch (e) {
    console.error("Failed to create audit log for branch update:", e);
  }
}

export async function deleteBranch(branchId: string, ownerUid?: string) {
  // Get branch data before deleting for audit log
  const branchRef = doc(db, "branches", branchId);
  const branchSnap = await getDoc(branchRef);
  const branchData = branchSnap.data();
  const branchName = branchData?.name || "Unknown Branch";
  const branchOwnerUid = ownerUid || branchData?.ownerUid || "";

  // Optional: Demote admin before deleting?
  // For now, simple delete.
  await deleteDoc(branchRef);

  // Audit log for branch deletion
  try {
    const performer = await getCurrentUserForAudit();
    if (performer && branchOwnerUid) {
      await logBranchDeleted(
        branchOwnerUid,
        branchId,
        branchName,
        performer
      );
    }
  } catch (e) {
    console.error("Failed to create audit log for branch deletion:", e);
  }
}

export function subscribeBranchesForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void,
  userRole?: string,
  currentUserUid?: string
) {
  // For branch admins, query by adminStaffId instead of ownerUid
  // This allows branch admins to read their assigned branch
  let q;
  if (userRole === "salon_branch_admin" && currentUserUid) {
    console.log("Branch admin query: querying branches by adminStaffId:", currentUserUid);
    q = query(collection(db, "branches"), where("adminStaffId", "==", currentUserUid));
  } else {
    console.log("Owner query: querying branches by ownerUid:", ownerUid);
    q = query(collection(db, "branches"), where("ownerUid", "==", ownerUid));
  }
  
  return onSnapshot(
    q,
    (snap) => {
      console.log("Branches query successful, found", snap.size, "branches");
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })));
    },
    (error) => {
      console.error("Branches query error:", error.code, error.message);
      if (error.code === "permission-denied") {
        console.warn("Permission denied for branches query. User role:", userRole, "currentUserUid:", currentUserUid);
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
