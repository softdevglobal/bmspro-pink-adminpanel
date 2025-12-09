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

/**
 * Add service ID to a branch's serviceIds array
 */
async function addServiceToBranch(branchId: string, serviceId: string) {
  const branchRef = doc(db, "branches", branchId);
  await updateDoc(branchRef, {
    serviceIds: arrayUnion(serviceId),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Remove service ID from a branch's serviceIds array
 */
async function removeServiceFromBranch(branchId: string, serviceId: string) {
  const branchRef = doc(db, "branches", branchId);
  await updateDoc(branchRef, {
    serviceIds: arrayRemove(serviceId),
    updatedAt: serverTimestamp(),
  });
}

export async function createServiceForOwner(ownerUid: string, data: ServiceInput) {
  const ref = await addDoc(collection(db, "services"), {
    ownerUid,
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Add service ID to all selected branches
  if (data.branches && data.branches.length > 0) {
    await Promise.all(
      data.branches.map((branchId) => addServiceToBranch(branchId, ref.id))
    );
  }

  return ref.id;
}

export async function updateService(serviceId: string, data: Partial<ServiceInput>) {
  // Get current service data to compare branches
  const serviceRef = doc(db, "services", serviceId);
  const serviceSnap = await getDoc(serviceRef);
  const currentData = serviceSnap.data();
  const oldBranches: string[] = currentData?.branches || [];
  const newBranches: string[] = data.branches || [];

  // Find branches to add and remove
  const branchesToAdd = newBranches.filter((b) => !oldBranches.includes(b));
  const branchesToRemove = oldBranches.filter((b) => !newBranches.includes(b));

  // Update the service document
  await updateDoc(serviceRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });

  // Update branch documents
  await Promise.all([
    ...branchesToAdd.map((branchId) => addServiceToBranch(branchId, serviceId)),
    ...branchesToRemove.map((branchId) => removeServiceFromBranch(branchId, serviceId)),
  ]);
}

export async function deleteService(serviceId: string) {
  // Get the service to find which branches have this service
  const serviceRef = doc(db, "services", serviceId);
  const serviceSnap = await getDoc(serviceRef);
  const serviceData = serviceSnap.data();
  const branches: string[] = serviceData?.branches || [];

  // Remove service ID from all branches
  if (branches.length > 0) {
    await Promise.all(
      branches.map((branchId) => removeServiceFromBranch(branchId, serviceId))
    );
  }

  // Delete the service document
  await deleteDoc(serviceRef);
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


