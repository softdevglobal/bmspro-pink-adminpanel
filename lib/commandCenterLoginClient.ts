import {
  AGENT_SESSION_KEYS,
  clearCommandCenterAndBlackTokens,
} from "@/lib/agentSessionTokens";

type FirebaseToolkitOk = {
  ok: true;
  idToken?: string;
};

type FirebaseToolkitErr = { ok: false; error?: string };

type CommandCenterLoginBody = {
  access_token?: string;
  refresh_token?: string;
  firebaseIdentityToolkit?: FirebaseToolkitOk | FirebaseToolkitErr;
  firebasePinkIdentityToolkit?: FirebaseToolkitOk | FirebaseToolkitErr;
};

function commandCenterBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_COMMAND_CENTER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/**
 * Calls Command Center `POST /api/auth/login` and persists Supabase + Black + Pink Firebase tokens.
 * Pink SDK token stays on `localStorage.idToken` from Firebase sign-in; when CC returns Pink toolkit,
 * also stores `ccPinkFirebaseIdToken` and refreshes `idToken` for consistency.
 */
export async function tryPersistCommandCenterSession(
  email: string,
  password: string
): Promise<void> {
  if (typeof window === "undefined") return;

  const base = commandCenterBaseUrl();
  if (!base) {
    clearCommandCenterAndBlackTokens();
    return;
  }

  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password,
      }),
    });

    if (!res.ok) {
      clearCommandCenterAndBlackTokens();
      return;
    }

    const body = (await res.json()) as CommandCenterLoginBody;

    if (body.access_token) {
      localStorage.setItem(
        AGENT_SESSION_KEYS.commandCenterAccessToken,
        body.access_token
      );
    } else {
      localStorage.removeItem(AGENT_SESSION_KEYS.commandCenterAccessToken);
    }

    if (body.refresh_token) {
      localStorage.setItem(
        AGENT_SESSION_KEYS.commandCenterRefreshToken,
        body.refresh_token
      );
    } else {
      localStorage.removeItem(AGENT_SESSION_KEYS.commandCenterRefreshToken);
    }

    const toolkit = body.firebaseIdentityToolkit;
    if (
      toolkit &&
      toolkit.ok === true &&
      typeof toolkit.idToken === "string" &&
      toolkit.idToken
    ) {
      localStorage.setItem(
        AGENT_SESSION_KEYS.blackFirebaseIdToken,
        toolkit.idToken
      );
    } else {
      localStorage.removeItem(AGENT_SESSION_KEYS.blackFirebaseIdToken);
    }

    const pinkToolkit = body.firebasePinkIdentityToolkit;
    if (
      pinkToolkit &&
      pinkToolkit.ok === true &&
      typeof pinkToolkit.idToken === "string" &&
      pinkToolkit.idToken
    ) {
      localStorage.setItem(
        AGENT_SESSION_KEYS.ccPinkFirebaseIdToken,
        pinkToolkit.idToken
      );
      localStorage.setItem(
        AGENT_SESSION_KEYS.pinkFirebaseIdToken,
        pinkToolkit.idToken
      );
    } else {
      localStorage.removeItem(AGENT_SESSION_KEYS.ccPinkFirebaseIdToken);
    }
  } catch {
    clearCommandCenterAndBlackTokens();
  }
}
