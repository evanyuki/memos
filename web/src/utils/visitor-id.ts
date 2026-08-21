const VISITOR_ID_STORAGE_KEY = "memos-visitor-id";
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedVisitorID: string | undefined;

const createVisitorID = (): string | undefined => {
  try {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return undefined;
  }
};

export const getVisitorID = (): string | undefined => {
  if (cachedVisitorID) {
    return cachedVisitorID;
  }

  try {
    const storedVisitorID = localStorage.getItem(VISITOR_ID_STORAGE_KEY);
    if (storedVisitorID && VISITOR_ID_PATTERN.test(storedVisitorID)) {
      cachedVisitorID = storedVisitorID.toLowerCase();
      return cachedVisitorID;
    }
  } catch {
    // Keep a stable in-memory identity when storage is unavailable.
  }

  cachedVisitorID = createVisitorID();
  if (!cachedVisitorID) {
    return undefined;
  }
  try {
    localStorage.setItem(VISITOR_ID_STORAGE_KEY, cachedVisitorID);
  } catch {
    // The in-memory identity still lets reactions work for this page session.
  }
  return cachedVisitorID;
};
