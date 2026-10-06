import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Key fingerprint: three emoji naming an X25519 public key.
 *
 *   d = sha256(publicKey)            (32 raw bytes of the X25519 public key)
 *   fingerprint = EMOJI[d[0]] + EMOJI[d[1]] + EMOJI[d[2]]
 *
 * The table below is fixed forever (changing it changes everyone's fingerprint). It holds 256
 * distinct single-code-point emoji with default emoji presentation, all from Unicode Emoji 11.0
 * or earlier so Android 9+ renders them. Order is the index. 24 bits of the hash are shown, which
 * is a recognition aid between friends, not a security proof.
 */
export const FINGERPRINT_EMOJI: readonly string[] = [
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
  "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞",
  "🐜", "🦂", "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬",
  "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🐑",
  "🦙", "🐓", "🦃", "🦚", "🦜", "🦢", "🐇", "🦝", "🦡", "🦔", "🌵", "🎄", "🌲", "🌳", "🌴", "🌱",
  "🌿", "🍀", "🎍", "🍁", "🍂", "🍃", "🍄", "🌾", "💐", "🌷", "🌹", "🥀", "🌺", "🌸", "🌼", "🌻",
  "🌞", "🌙", "🌍", "💫", "⭐", "🌟", "✨", "⚡", "🔥", "💥", "🌈", "⛅", "🌊", "💧", "☔", "⛄",
  "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆",
  "🥑", "🥦", "🥬", "🥒", "🌽", "🥕", "🥔", "🥐", "🥯", "🍞", "🧀", "🥚", "🍳", "🥞", "🥓", "🥩",
  "🍗", "🌭", "🍔", "🍟", "🍕", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜", "🍣", "🍤", "🍨", "🍦", "🥧",
  "🧁", "🍰", "🎂", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "☕", "🍵", "🍺", "🥂",
  "🍷", "🍹", "🍾", "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🥏", "🎱", "🏓", "🏸", "🏒", "⛳",
  "🏹", "🎣", "🥊", "🥋", "🛹", "🎿", "🏆", "🥇", "🎪", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹",
  "🥁", "🎷", "🎺", "🎸", "🎻", "🎲", "🧩", "🎯", "🎳", "🎮", "🚗", "🚌", "🚲", "🚂", "🚀", "🛸",
  "🚁", "⛵", "🚢", "⚓", "🎈", "🎁", "🎀", "🎉", "🎊", "🔮", "🧿", "💎", "🔔", "🔑", "🔒", "💡",
  "🔦", "📷", "📚", "🧭", "⏰", "⌛", "🧸", "🧶", "👑", "🧢", "👓", "🌂", "🍙", "🚑", "🥨", "🍸",
];

/** Three emoji for an X25519 public key (32 bytes). */
export function keyFingerprint(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("public key must be 32 bytes");
  const d = sha256(publicKey);
  return FINGERPRINT_EMOJI[d[0]] + FINGERPRINT_EMOJI[d[1]] + FINGERPRINT_EMOJI[d[2]];
}

/** Same, as an array of three emoji (for spaced layouts). */
export function keyFingerprintParts(publicKey: Uint8Array): [string, string, string] {
  const d = sha256(publicKey);
  return [FINGERPRINT_EMOJI[d[0]], FINGERPRINT_EMOJI[d[1]], FINGERPRINT_EMOJI[d[2]]];
}
