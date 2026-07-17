/** localStorage keys for Command Center + cross-product Firebase sessions */

export const AGENT_SESSION_KEYS = {
  /** Pink Firebase ID token from client SDK sign-in (primary Bearer for Pink APIs). */
  pinkFirebaseIdToken: "idToken",
  /**
   * Pink Firebase ID token from Command Center `firebasePinkIdentityToolkit.idToken` when present.
   */
  ccPinkFirebaseIdToken: "ccPinkFirebaseIdToken",
  commandCenterAccessToken: "commandCenterAccessToken",
  commandCenterRefreshToken: "commandCenterRefreshToken",
  /** Identity Toolkit id token for BMS Black (from Command Center login JSON). */
  blackFirebaseIdToken: "blackFirebaseIdToken",
} as const;

export function clearCommandCenterAndBlackTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AGENT_SESSION_KEYS.commandCenterAccessToken);
  localStorage.removeItem(AGENT_SESSION_KEYS.commandCenterRefreshToken);
  localStorage.removeItem(AGENT_SESSION_KEYS.blackFirebaseIdToken);
  localStorage.removeItem(AGENT_SESSION_KEYS.ccPinkFirebaseIdToken);
}
