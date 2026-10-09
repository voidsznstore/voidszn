-- One-time link for creating the first admin account. Only the hash of the
-- link's code is stored here; the link itself was handed to the owner. It stops
-- working once an admin exists or after 14 days, whichever comes first.
INSERT INTO "store_settings" ("key", "value")
VALUES (
  'admin.setup',
  json_build_object('hash', 'f92b6c7a045f9a2b4a088fb387a86c1970c242eb0e755f675431c35752d86cbd', 'expiresAt', now() + interval '14 days')::text
)
ON CONFLICT ("key") DO NOTHING;
