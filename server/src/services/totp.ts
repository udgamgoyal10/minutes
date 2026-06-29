import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Meeting Minutes";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secret: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.toString();
}

export async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpUri(email, secret), { margin: 1, width: 220 });
}

export function verifyTotp(secret: string, token: string): boolean {
  const normalized = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.validate({ token: normalized, window: 1 }) != null;
}
