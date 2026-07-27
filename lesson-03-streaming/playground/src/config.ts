/** Characters used when generating short codes. */
export const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** How many characters each short code has. */
export const CODE_LENGTH = 6;

/** Upper bound on stored links, so the process cannot grow forever. */
export const MAX_ENTRIES = 10_000;

export const PORT = 8080;
