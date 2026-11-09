function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — see .env.example`);
  return v;
}

export const env = {
  get databaseUrl() { return required("DATABASE_URL"); },
  get apiToken() { return required("HUB_API_TOKEN"); },
  get tz() { return process.env.HUB_TIMEZONE || "America/New_York"; },
};
