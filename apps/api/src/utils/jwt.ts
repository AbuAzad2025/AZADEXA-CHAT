import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const getJwtSecret = () => process.env.JWT_SECRET || "change-me-in-production";
const getJwtRefreshSecret = () =>
  process.env.JWT_REFRESH_SECRET || "change-me-refresh";

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
