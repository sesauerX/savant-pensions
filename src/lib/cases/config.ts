// Environment access for the case pipeline. Never log values from here.

const env = (key: string) => (process.env[key] ?? "").trim();

export const config = {
  enabled: () => env("CASES_ENABLED") === "true",
  live: () => env("LIVE_MODE") === "true",
  templatesApproved: () => env("TEMPLATES_APPROVED") === "true",
  showPassport: () => env("AWARD_LETTER_SHOW_PASSPORT") !== "false",
  testRecipient: () => env("TEST_RECIPIENT"),
  inboundAddress: () => env("INBOUND_ADDRESS").toLowerCase(),
  allowedSenders: () =>
    env("INTAKE_ALLOWED_SENDERS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  clientFrom: () => env("CLIENT_FROM") || "Sterling Pension Group <noreply@sterlingpensiongroup.com>",
  /** Where client replies go; falls back to the intake address so replies always reach a case. */
  replyTo: () => env("SPG_REPLY_TO") || env("INBOUND_ADDRESS"),
  bcc: () => env("SPG_BCC"),
  adminNotifyTo: () => env("ADMIN_NOTIFY_TO").split(",").map((s) => s.trim()).filter(Boolean),
  resendKey: () => env("RESEND_API_KEY"),
  resendWebhookSecret: () => env("RESEND_WEBHOOK_SECRET"),
  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  anthropicModel: () => env("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
  boldsignKey: () => env("BOLDSIGN_API_KEY"),
  boldsignWebhookSecret: () => env("BOLDSIGN_WEBHOOK_SECRET"),
  spgSignerName: () => env("SPG_SIGNER_NAME") || "Pocholo Delicana",
  spgSignerEmail: () => env("SPG_SIGNER_EMAIL"),
  sessionSecret: () => env("SESSION_SECRET"),
  cronSecret: () => env("CRON_SECRET"),
  blobConfigured: () => Boolean(env("BLOB_READ_WRITE_TOKEN")),
  /** Prefix for every Blob path; local dev writes under "dev/" so it never touches live cases. */
  blobPrefix: () => env("CASES_BLOB_PREFIX") || (process.env.VERCEL ? "" : "dev/"),
  siteUrl: () => env("CASES_SITE_URL") || "https://sterlingpensiongroup.com",
  chromePath: () => env("CHROME_PATH"),
  adminUsers: (): AdminUser[] => {
    try {
      const list = JSON.parse(env("ADMIN_USERS") || "[]");
      return Array.isArray(list)
        ? list
            .filter((u) => u && typeof u.email === "string")
            .map((u) => ({ name: String(u.name || u.email), email: String(u.email).toLowerCase(), role: u.role === "owner" ? "owner" : "admin" }))
        : [];
    } catch {
      return [];
    }
  },
};

export type AdminUser = { name: string; email: string; role: "owner" | "admin" };

/** Integration status for the settings page (booleans only, never values). */
export function integrationStatus() {
  return {
    "Blob storage": config.blobConfigured(),
    "Resend sending": Boolean(config.resendKey()),
    "Resend inbound webhook secret": Boolean(config.resendWebhookSecret()),
    "Claude API": Boolean(config.anthropicKey()),
    "BoldSign API": Boolean(config.boldsignKey()),
    "BoldSign webhook secret": Boolean(config.boldsignWebhookSecret()),
    "BoldSign Sterling signer": Boolean(config.spgSignerEmail()),
    "Session secret": config.sessionSecret().length >= 32,
    "Cron secret": Boolean(config.cronSecret()),
    "Admin users": config.adminUsers().length > 0,
  };
}
