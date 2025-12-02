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

export type ServiceInput = {
  name: string;
  price: number;
  duration: number; // minutes
  icon?: string;
  imageUrl?: string;
  reviews?: number;
  branches: string[]; // branchIds
  staffIds: string[]; // salon_staff ids
};

export async function createServiceForOwner(ownerUid: string, data: ServiceInput) {
  const ref = await addDoc(collection(db, "services"), {
    ownerUid,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateService(serviceId: string, data: Partial<ServiceInput>) {
  await updateDoc(doc(db, "services", serviceId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteService(serviceId: string) {
  await deleteDoc(doc(db, "services", serviceId));
}

export function subscribeServicesForOwner(
  ownerUid: string,
  onChange: (rows: Array<{ id: string } & DocumentData>) => void
) {
  const q = query(collection(db, "services"), where("ownerUid", "==", ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })));
    },
    (error) => {
      if (error.code === "permission-denied") {
        console.warn("Permission denied for services query. User may not be authenticated.");
        onChange([]);
      } else {
        console.error("Error in services snapshot:", error);
        onChange([]);
      }
    }
  );
}


