import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { promoteStaffToBranchAdmin, demoteStaffFromBranchAdmin } from "@/lib/salonStaff";

export type BranchInput = {
  name: string;
  address: string;
  phone?: string;
  email?: string;
  staffIds?: string[];
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

  if (data.adminStaffId) {
    await promoteStaffToBranchAdmin(data.adminStaffId);
  }

  return ref.id;
}

export async function updateBranch(branchId: string, data: Partial<BranchInput>) {
  const branchRef = doc(db, "branches", branchId);
  
  // Fetch current branch to see if admin changed
  const snap = await getDoc(branchRef);
  const currentData = snap.data();
  const oldAdminId = currentData?.adminStaffId;

  await updateDoc(branchRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  const newAdminId = data.adminStaffId;

  // 1. If there was an old admin, and (we are setting a new one OR explicitly clearing it), and it's different
  if (oldAdminId && newAdminId !== undefined && oldAdminId !== newAdminId) {
    await demoteStaffFromBranchAdmin(oldAdminId);
  }

  // 2. If there is a new admin, promote them
  if (newAdminId) {
    await promoteStaffToBranchAdmin(newAdminId);
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
