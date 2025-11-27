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

export type StaffStatus = "Active" | "Suspended";

export type StaffTraining = {
  ohs?: boolean;
  prod?: boolean;
  tool?: boolean;
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
  authUid?: string;
  systemRole?: string;
};

export async function createSalonStaffForOwner(ownerUid: string, data: SalonStaffInput) {
  const ref = await addDoc(collection(db, "salon_staff"), {
    ownerUid,
    email: data.email || null,
    name: data.name,
    role: data.role,
    branchId: data.branchId,
    branchName: data.branchName,
    status: data.status || "Active",
    avatar: data.avatar || data.name,
    training: data.training || { ohs: false, prod: false, tool: false },
    authUid: data.authUid || null,
    systemRole: data.systemRole || "salon_staff",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSalonStaff(staffId: string, data: Partial<SalonStaffInput>) {
  await updateDoc(doc(db, "salon_staff", staffId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function updateSalonStaffStatus(staffId: string, status: StaffStatus) {
  await updateDoc(doc(db, "salon_staff", staffId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSalonStaff(staffId: string) {
  await deleteDoc(doc(db, "salon_staff", staffId));
}

export function subscribeSalonStaffForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  const q = query(collection(db, "salon_staff"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })));
  });
}


