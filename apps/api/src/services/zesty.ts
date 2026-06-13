import { createHash } from "crypto";
import OpenAI from "openai";
import { AppError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";

export const DEFAULT_ZESTY_MODEL = "gpt-5.4-mini";
export const ZESTY_DAILY_MESSAGE_LIMIT = 20;
export const ZESTY_BLOCKED_PLACEHOLDER = "[Blocked by Safety Shield]";
export const ZESTY_SAFE_FALLBACK =
  "I cannot answer that safely. Try asking in a different way, or talk to a trusted person if this feels urgent.";

const ZESTY_INSTRUCTIONS = [
  "You are Zesty, a warm, upbeat older-sibling-style assistant for teens and young adults.",
  "Reply in the user's language and keep answers concise, practical, respectful, and age-appropriate.",
  "Do not provide sexual, violent, hateful, illegal, drug-related, self-harm, or otherwise dangerous instructions.",
  "Do not diagnose medical or mental-health conditions. For immediate danger or self-harm risk, encourage contacting local emergency services and a trusted adult now.",
  "Protect privacy: do not request passwords, precise addresses, financial details, or other sensitive personal data.",
  "Never claim to be human, a therapist, a doctor, or an emergency service.",
].join(" ");

export type ZestyMessageRole = "user" | "assistant";

export interface ZestyMessage {
  role: ZestyMessageRole;
  content: string;
  createdAt: string;
  blocked?: boolean;
}

export interface ZestyModerationResult {
  flagged: boolean;
  categories: string[];
}

export interface ZestyProvider {
  isConfigured(): boolean;
  moderate(content: string): Promise<ZestyModerationResult>;
  generateReply(
    messages: Pick<ZestyMessage, "role" | "content">[],
    userId: string
  ): Promise<string>;
}

export const getConfiguredBlockedTerms = (): string[] =>
  (process.env.ZESTY_BLOCKED_TERMS || "")
    .split(",")
    .map((term) => term.trim().toLocaleLowerCase())
    .filter((term) => term.length >= 2);

export const findConfiguredBlockedTerm = (content: string): string | null => {
  const normalized = content.toLocaleLowerCase();
  return getConfiguredBlockedTerms().find((term) => normalized.includes(term)) || null;
};

const getSafeIdentifier = (userId: string): string =>
  createHash("sha256").update(userId).digest("hex");

export class OpenAIZestyProvider implements ZestyProvider {
  private client: OpenAI | null = null;
  private activeApiKey: string | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  private getClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError("Zesty AI is not configured", 503);
    }

    if (!this.client || this.activeApiKey !== apiKey) {
      this.client = new OpenAI({
        apiKey,
        timeout: 20_000,
        maxRetries: 2,
      });
      this.activeApiKey = apiKey;
    }

    return this.client;
  }

  async moderate(content: string): Promise<ZestyModerationResult> {
    try {
      const response = await this.getClient().moderations.create({
        model: "omni-moderation-latest",
        input: content,
      });
      const result = response.results[0];
      if (!result) throw new Error("Moderation result missing");

      return {
        flagged: result.flagged,
        categories: Object.entries(result.categories)
          .filter(([, flagged]) => flagged)
          .map(([category]) => category),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("Zesty moderation request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw new AppError("Zesty safety check is temporarily unavailable", 503);
    }
  }

  async generateReply(
    messages: Pick<ZestyMessage, "role" | "content">[],
    userId: string
  ): Promise<string> {
    try {
      const response = await this.getClient().responses.create({
        model: process.env.OPENAI_MODEL?.trim() || DEFAULT_ZESTY_MODEL,
        instructions: ZESTY_INSTRUCTIONS,
        input: messages.map(({ role, content }) => ({ role, content })),
        max_output_tokens: 500,
        reasoning: { effort: "low" },
        text: { verbosity: "low" },
        safety_identifier: getSafeIdentifier(userId),
        store: false,
      });
      const reply = response.output_text.trim();
      if (!reply) throw new Error("AI response was empty");
      return reply;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("Zesty response request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw new AppError("Zesty AI is temporarily unavailable", 503);
    }
  }
}
