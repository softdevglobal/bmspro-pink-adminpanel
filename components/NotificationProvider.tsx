"use client";
import React, { createContext, useContext, useEffect, useRef, useState, ReactNode, useMemo } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import ToastNotification from "./ToastNotification";

interface Notification {
  id: string;
  bookingId: string;
  type: string;
  title: string;
  message: string;
  serviceName?: string;
  branchName?: string;
  date?: string;
  time?: string;
  price?: number;
  createdAt: Date;
  read: boolean;
  status?: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export default function NotificationProvider({ children }: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pendingBookings, setPendingBookings] = useState<any[]>([]);
  const [readPendingBookings, setReadPendingBookings] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastNotifications, setToastNotifications] = useState<any[]>([]);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const previousNotificationIdsRef = useRef<Set<string>>(new Set());
  const previousPendingIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioInitializedRef = useRef(false);

  // Initialize audio element for notification sound
  useEffect(() => {
    if (typeof window !== "undefined" && !audioInitializedRef.current) {
      try {
        // Use the correct path to the sound file in public/sounds
        const audio = new Audio("/sounds/shopify_sale_sound.mp3");
        audio.volume = 0.7; // Set volume to 70%
        audio.preload = "auto";
        
        // Handle audio loading errors
        audio.addEventListener("error", (e) => {
          console.error("Audio loading error:", e);
          console.error("Audio error details:", {
            code: audio.error?.code,
            message: audio.error?.message,
            src: audio.src,
          });
        });

        // Handle successful load
        audio.addEventListener("canplaythrough", () => {
          console.log("Audio file loaded and ready to play");
        });

        // Load the audio (load() doesn't return a promise, it's a void method)
        try {
          audio.load();
        } catch (error) {
          console.error("Error loading audio file:", error);
        }

        audioRef.current = audio;
        audioInitializedRef.current = true;
      } catch (error) {
        console.error("Error initializing audio:", error);
      }
    }
  }, []);

  // Play notification sound
  const playNotificationSound = () => {
    if (!audioInitializedRef.current) {
      console.log("Audio not initialized yet");
      return;
    }

    try {
      // Create a new Audio instance each time to ensure it plays
      // This avoids issues with cloning and ensures the file is loaded fresh
      const audio = new Audio("/sounds/shopify_sale_sound.mp3");
      audio.volume = 0.7;
      
      // Reset to start
      audio.currentTime = 0;
      
      // Handle errors for this specific playback
      audio.addEventListener("error", (e) => {
        console.error("Error playing notification sound:", e);
        console.error("Audio src:", audio.src);
      });
      
      // Play the sound
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Audio is playing successfully
            console.log("Notification sound played successfully");
          })
          .catch((error) => {
            // Autoplay was prevented or other error
            console.log("Autoplay prevented or error:", error.name, error.message);
            // Try to play on next user interaction
            const enableAudio = () => {
              const retryAudio = new Audio("/sounds/shopify_sale_sound.mp3");
              retryAudio.volume = 0.7;
              retryAudio.play().catch(() => {
                console.log("Still unable to play audio after user interaction");
              });
              document.removeEventListener("click", enableAudio, { capture: true });
              document.removeEventListener("touchstart", enableAudio, { capture: true });
            };
            document.addEventListener("click", enableAudio, { once: true, capture: true });
            document.addEventListener("touchstart", enableAudio, { once: true, capture: true });
          });
      }
    } catch (error) {
      console.error("Error playing notification sound:", error);
    }
  };

  // Show toast notification
  const showToastNotification = (booking: any) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast = {
      id,
      title: "New Booking Request!",
      message: `${booking.customerName || booking.clientName || "A customer"} requested a booking`,
      serviceName: booking.serviceName || booking.services?.[0]?.name || "Service",
      price: booking.price || booking.totalPrice,
      bookingId: booking.id,
    };
    setToastNotifications((prev) => [...prev, toast]);

    // Auto remove after 5 seconds
    setTimeout(() => {
      setToastNotifications((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  // Authentication and user setup
  useEffect(() => {
    (async () => {
      const { auth, db } = await import("@/lib/firebase");
      const { doc, getDoc } = await import("firebase/firestore");
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setOwnerUid(null);
          setIsSuperAdmin(false);
          return;
        }
        try {
          setOwnerUid(user.uid);

          // Check if user is super admin or branch admin
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const userData = userDoc.data();
          const role = userData?.role || "";

          setIsSuperAdmin(role === "super_admin");

          // For branch admin, use their owner UID for notifications
          if (role === "salon_branch_admin" && userData?.ownerUid) {
            setOwnerUid(userData.ownerUid);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        }
      });

      return () => unsub();
    })();
  }, []);

  // Listen to notifications collection from Firestore
  useEffect(() => {
    if (!ownerUid || isSuperAdmin) return;

    let unsubNotifications: (() => void) | undefined;
    let unsubBookings: (() => void) | undefined;

    (async () => {
      const { db } = await import("@/lib/firebase");
      const { doc, getDoc } = await import("firebase/firestore");

      // Subscribe to notifications collection for this owner
      const notificationsQuery = query(
        collection(db, "notifications"),
        where("ownerUid", "==", ownerUid)
      );

      unsubNotifications = onSnapshot(
        notificationsQuery,
        async (snapshot) => {
          const allNotifications: (Notification | null)[] = await Promise.all(
            snapshot.docs.map(async (docSnapshot): Promise<Notification | null> => {
              const data = docSnapshot.data();
              const notifId = docSnapshot.id;
              
              // Get booking status to filter out confirmed/canceled
              let bookingStatus = data.status;
              if (data.bookingId) {
                try {
                  const bookingDoc = await getDoc(doc(db, "bookings", data.bookingId));
                  if (bookingDoc.exists()) {
                    bookingStatus = bookingDoc.data()?.status || data.status;
                  }
                } catch (error) {
                  console.error("Error fetching booking status:", error);
                }
              }

              // Only show notifications for bookings that are not confirmed or canceled
              // Also show admin notifications (staff_rejected, staff_accepted) regardless of status
              const isAdminNotification = data.type === "staff_rejected" || data.type === "staff_accepted";
              const shouldShow = isAdminNotification || 
                (bookingStatus !== "Confirmed" && bookingStatus !== "Canceled" && bookingStatus !== "Completed");

              if (!shouldShow) {
                return null;
              }

              const notification: Notification = {
                id: notifId,
                bookingId: data.bookingId || "",
                type: data.type || "booking_request",
                title: data.title || "Notification",
                message: data.message || "",
                serviceName: data.serviceName || data.services?.[0]?.name,
                branchName: data.branchName || "",
                date: data.bookingDate || data.date,
                time: data.bookingTime || data.time,
                price: data.price,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt?.seconds * 1000 || Date.now()),
                read: data.read || false,
                status: bookingStatus || data.status,
              };
              
              return notification;
            })
          );

          // Filter out null values and sort by createdAt (newest first)
          const validNotifications = allNotifications
            .filter((n): n is Notification => n !== null)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, 50);

          // Find new notifications (IDs that weren't in previous snapshot)
          const currentNotificationIds = new Set(validNotifications.map((n) => n.id));
          const newNotifications = validNotifications.filter(
            (n) => !previousNotificationIdsRef.current.has(n.id)
          );

          // Only play sound and show toast after initial load
          if (!isInitialLoadRef.current && newNotifications.length > 0) {
            // Play notification sound
            playNotificationSound();

            // Show toast notifications for new notifications
            newNotifications.forEach((notif) => {
              showToastNotification({
                id: notif.bookingId,
                customerName: notif.message.split(" ")[0] || "A customer",
                serviceName: notif.serviceName,
                price: notif.price,
              });
            });
          }

          // Store notifications from Firestore (will be combined with pending bookings)
          setNotifications(validNotifications);

          // Update previous IDs ref
          previousNotificationIdsRef.current = currentNotificationIds;

          // Mark initial load as complete
          if (isInitialLoadRef.current) {
            isInitialLoadRef.current = false;
          }
        },
        (error) => {
          console.error("Error listening to notifications:", error);
        }
      );

      // Also listen to pending bookings to include them in the notification panel
      const pendingQuery = query(
        collection(db, "bookings"),
        where("ownerUid", "==", ownerUid),
        where("status", "==", "Pending")
      );

      unsubBookings = onSnapshot(
        pendingQuery,
        (snapshot) => {
          const bookings = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));

          // Find new bookings
          const currentPendingIds = new Set(bookings.map((b: any) => b.id));
          const newBookings = bookings.filter(
            (b: any) => !previousPendingIdsRef.current.has(b.id)
          );

          // Only trigger for new bookings after initial load
          if (!isInitialLoadRef.current && newBookings.length > 0) {
            // Play notification sound
            playNotificationSound();

            // Show toast notifications
            newBookings.forEach((booking: any) => {
              showToastNotification(booking);
            });
          }

          // Update pending bookings state
          setPendingBookings(bookings);
          previousPendingIdsRef.current = currentPendingIds;
        },
        (error) => {
          console.error("Error listening to pending bookings:", error);
        }
      );
    })();

    return () => {
      unsubNotifications?.();
      unsubBookings?.();
    };
  }, [ownerUid, isSuperAdmin]);

  // Mark notification as read
  const markAsRead = async (notifId: string) => {
    // For pending bookings (prefixed with "pending-"), track read state
    if (notifId.startsWith("pending-")) {
      const bookingId = notifId.replace("pending-", "");
      setReadPendingBookings((prev) => new Set([...prev, bookingId]));
      return;
    }

    // For Firestore notifications, update both UI and Firestore
    // Optimistically update UI
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, read: true } : n))
    );

    // Update in Firestore
    try {
      const { db } = await import("@/lib/firebase");
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "notifications", notifId), {
        read: true,
      });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      // Revert on error
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, read: false } : n))
      );
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    const unreadNotifications = combinedNotifications.filter((n) => !n.read);
    if (unreadNotifications.length === 0) return;

    // Optimistically update UI
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    // Mark all pending bookings as read
    setReadPendingBookings(new Set(pendingBookings.map((b) => b.id)));

    // Update Firestore notifications
    const firestoreNotifications = unreadNotifications.filter((n) => !n.id.startsWith("pending-"));
    if (firestoreNotifications.length > 0) {
      try {
        const { db } = await import("@/lib/firebase");
        const { doc, updateDoc } = await import("firebase/firestore");
        
        await Promise.all(
          firestoreNotifications.map((notif) =>
            updateDoc(doc(db, "notifications", notif.id), {
              read: true,
            })
          )
        );
      } catch (error) {
        console.error("Error marking all notifications as read:", error);
        // Revert on error
        setNotifications((prev) =>
          prev.map((n) => {
            const wasUnread = firestoreNotifications.some((un) => un.id === n.id);
            return wasUnread ? { ...n, read: false } : n;
          })
        );
      }
    }
  };

  // Combine notifications from Firestore with pending bookings
  const combinedNotifications = useMemo(() => {
    // Convert pending bookings to notification format
    // Only include bookings that are still Pending (filter out confirmed/canceled)
    const pendingNotifications: Notification[] = pendingBookings
      .filter((booking: any) => {
        // Only include if status is still Pending
        const status = booking.status || "Pending";
        return status === "Pending";
      })
      .map((booking: any) => ({
        id: `pending-${booking.id}`,
        bookingId: booking.id,
        type: "booking_request",
        title: "New Booking Request",
        message: `${booking.customerName || booking.clientName || "A customer"} requested a booking`,
        serviceName: booking.serviceName || booking.services?.[0]?.name || "Service",
        branchName: booking.branchName || "",
        date: booking.date,
        time: booking.time,
        price: booking.price || booking.totalPrice,
        createdAt: booking.createdAt?.toDate ? booking.createdAt.toDate() : new Date(booking.createdAt?.seconds * 1000 || Date.now()),
        read: readPendingBookings.has(booking.id),
        status: "Pending",
      }));

    // Filter notifications to exclude those with confirmed/canceled bookings
    // Also show admin notifications (staff_rejected, staff_accepted) regardless of status
    const validNotifications = notifications.filter((notif) => {
      const isAdminNotification = notif.type === "staff_rejected" || notif.type === "staff_accepted";
      if (isAdminNotification) return true;
      
      // Exclude if status is Confirmed, Canceled, or Completed
      return notif.status !== "Confirmed" && 
             notif.status !== "Canceled" && 
             notif.status !== "Completed";
    });

    // Combine and deduplicate by bookingId (prefer Firestore notifications over pending)
    const allNotifications = [...pendingNotifications, ...validNotifications];
    const unique = Array.from(
      new Map(allNotifications.map((n) => [n.bookingId, n])).values()
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return unique.slice(0, 50);
  }, [notifications, pendingBookings, readPendingBookings]);

  // Calculate unread count from combined notifications
  const combinedUnreadCount = useMemo(() => {
    return combinedNotifications.filter((n) => !n.read).length;
  }, [combinedNotifications]);

  const value: NotificationContextType = {
    notifications: combinedNotifications,
    unreadCount: combinedUnreadCount,
    markAsRead,
    markAllAsRead,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {/* Toast Notifications Container - Bottom Right */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 max-w-sm">
        {toastNotifications.map((toast) => (
          <ToastNotification
            key={toast.id}
            id={toast.id}
            title={toast.title}
            message={toast.message}
            serviceName={toast.serviceName}
            price={toast.price}
            bookingId={toast.bookingId}
            onClose={() => {
              setToastNotifications((prev) => prev.filter((t) => t.id !== toast.id));
            }}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
