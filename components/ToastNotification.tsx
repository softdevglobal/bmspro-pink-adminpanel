"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";

interface ToastNotificationProps {
  id: string;
  title: string;
  message: string;
  serviceName?: string;
  price?: number;
  bookingId?: string;
  onClose: () => void;
}

export default function ToastNotification({
  id,
  title,
  message,
  serviceName,
  price,
  bookingId,
  onClose,
}: ToastNotificationProps) {
  const router = useRouter();

  useEffect(() => {
    // Auto close after 5 seconds
    const timer = setTimeout(() => {
      onClose();
    }, 5000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const handleClick = () => {
    if (bookingId) {
      router.push("/bookings/pending");
    }
    onClose();
  };

  return (
    <div
      className="bg-white rounded-xl shadow-2xl border border-slate-200 p-4 min-w-[320px] max-w-sm animate-slideInRight cursor-pointer hover:shadow-3xl transition-all duration-300 hover:scale-[1.02]"
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center flex-shrink-0">
          <i className="fas fa-bell text-white text-lg" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-slate-900 text-sm mb-1">{title}</h4>
          <p className="text-xs text-slate-600 mb-2 line-clamp-2">{message}</p>
          
          {/* Service and Price Info */}
          <div className="flex items-center gap-2 text-xs">
            {serviceName && (
              <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md font-medium">
                {serviceName}
              </span>
            )}
            {price && (
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-md font-semibold">
                ${price.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center flex-shrink-0 transition-colors"
          title="Close"
        >
          <i className="fas fa-times text-slate-400 text-xs" />
        </button>
      </div>
    </div>
  );
}
