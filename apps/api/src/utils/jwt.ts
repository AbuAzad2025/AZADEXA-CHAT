import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const developmentAccessSecret = "change-me-in-production";
const developmentRefreshSecret = "change-me-refresh";

const getSecret = (
  name: "JWT_SECRET" | "JWT_REFRESH_SECRET",
  developmentFallback: string,
): string => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be configured in production`);
  }
  return developmentFallback;
};

const getJwtSecret = () => getSecret("JWT_SECRET", developmentAccessSecret);
const getJwtRefreshSecret = () =>
  getSecret("JWT_REFRESH_SECRET", developmentRefreshSecret);

export const validateJwtConfiguration = (): void => {
  getJwtSecret();
  getJwtRefreshSecret();
};

export const generateToken = (userId: string): string => {
  return jwt.sign({ userId, jti: randomUUID() }, getJwtSecret(), {
    expiresIn: "15m",
  });
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ userId, jti: randomUUID() }, getJwtRefreshSecret(), {
    expiresIn: "7d",
  });
};

export const verifyToken = (token: string): jwt.JwtPayload => {
  return jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
};

export const verifyRefreshToken = (token: string): jwt.JwtPayload => {
  return jwt.verify(token, getJwtRefreshSecret()) as jwt.JwtPayload;
};
