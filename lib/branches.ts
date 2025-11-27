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
  updateDoc,
  where,
} from "firebase/firestore";
import { promoteStaffToBranchAdmin } from "@/lib/salonStaff";

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
  adminStaffId?: string;
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
  await updateDoc(doc(db, "branches", branchId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

  if (data.adminStaffId) {
    await promoteStaffToBranchAdmin(data.adminStaffId);
  }
}

export async function deleteBranch(branchId: string) {
  await deleteDoc(doc(db, "branches", branchId));
}

export function subscribeBranchesForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  const q = query(collection(db, "branches"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })));
  });
}
