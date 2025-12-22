/**
 * Google Maps loader utility
 * Prevents multiple script loads across components
 */

/// <reference types="@types/google.maps" />

// Google Maps API key from environment variable (prefer env; fallback to hard-coded dev value)
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "AIzaSyA2LP8ornek2rve4QBm5d9FLQKOrF78I6M";

// Track loading state
let isLoading = false;
let isLoaded = false;
let loadPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google: typeof google;
    initGoogleMapsCallback?: () => void;
  }
}

/**
 * Load Google Maps script once and return a promise
 */
export function loadGoogleMaps(): Promise<void> {
  // Already loaded
  if (isLoaded || window.google?.maps) {
    isLoaded = true;
    return Promise.resolve();
  }

  // Currently loading - return existing promise
  if (isLoading && loadPromise) {
    return loadPromise;
  }

  // Start loading
  isLoading = true;
  
  loadPromise = new Promise((resolve, reject) => {
    // Check again in case it loaded while we were setting up
    if (window.google?.maps) {
      isLoaded = true;
      isLoading = false;
      resolve();
      return;
    }

    // Check if script tag already exists
    const existingScript = document.querySelector(
      `script[src*="maps.googleapis.com/maps/api/js"]`
    );
    
    if (existingScript) {
      // Script exists, wait for it to load
      const checkLoaded = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(checkLoaded);
          isLoaded = true;
          isLoading = false;
          resolve();
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkLoaded);
        if (!window.google?.maps) {
          reject(new Error("Google Maps failed to load"));
        }
      }, 10000);
      
      return;
    }

    // Create and load script
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,marker&callback=initGoogleMapsCallback`;
    script.async = true;
    script.defer = true;

    window.initGoogleMapsCallback = () => {
      isLoaded = true;
      isLoading = false;
      window.initGoogleMapsCallback = undefined;
      resolve();
    };

    script.onerror = () => {
      isLoading = false;
      loadPromise = null;
      reject(new Error("Failed to load Google Maps script"));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Check if Google Maps is loaded
 */
export function isGoogleMapsLoaded(): boolean {
  return isLoaded || !!window.google?.maps;
}

/**
 * Get Google Maps API key
 */
export function getGoogleMapsApiKey(): string {
  return GOOGLE_MAPS_API_KEY;
}
