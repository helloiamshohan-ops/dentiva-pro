import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { AppError } from "../errors.ts";

const KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(secret: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(secret, salt, keylen, SCRYPT_OPTIONS, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashSecret(secret: string): Promise<string> {
  if (typeof secret !== "string" || secret.length < 4) {
    throw new AppError("VALIDATION", "Password or PIN must be at least 4 characters.");
  }
  if (secret.length > 256) {
    throw new AppError("VALIDATION", "Password is too long.");
  }
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const saltHex = parts[1]!;
  const keyHex = parts[2]!;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scryptAsync(secret, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function looksHashed(value: string): boolean {
  return value.startsWith("scrypt$");
}
