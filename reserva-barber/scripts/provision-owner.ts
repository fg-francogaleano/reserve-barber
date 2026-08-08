// One-time (idempotent, re-runnable) owner provisioning script.
// Creates the Supabase auth user for the owner and links it to the single
// Owner row via `authUserId`. Never bundled into the app — run manually:
//
//   SUPABASE_SERVICE_ROLE_KEY=... OWNER_EMAIL=... OWNER_INITIAL_PASSWORD=... npx tsx scripts/provision-owner.ts
//
// The service-role key and initial password MUST NOT be stored in `.env` —
// pass them inline for this one-off invocation only.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const ownerEmail = requireEnv('OWNER_EMAIL').trim().toLowerCase();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const directUrl = requireEnv('DIRECT_URL');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const adapter = new PrismaPg({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    // Exactly one Owner row is expected — created by the A1 migration.
    const owner = await prisma.owner.findFirst();
    if (!owner) {
      throw new Error('No Owner row found — run the A1 migration before provisioning');
    }

    // "Exactly one Owner" guardrail: refuse to provision a mismatched email
    // rather than silently operating on (or creating) a second identity.
    if (owner.email !== ownerEmail) {
      throw new Error(
        `Refusing to provision: OWNER_EMAIL ("${ownerEmail}") does not match the existing Owner row ("${owner.email}")`
      );
    }

    if (owner.authUserId) {
      console.log(`Already provisioned. Owner ${ownerEmail} -> authUserId ${owner.authUserId}`);
      return;
    }

    // Idempotent lookup: reconcile with an existing Supabase auth user before creating.
    // Sign-ups are disabled, so this account is the only auth user expected to exist.
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      throw new Error(`Failed to list Supabase auth users: ${listError.message}`);
    }

    let authUserId = existingUsers.users.find((user) => user.email?.toLowerCase() === ownerEmail)?.id;

    if (!authUserId) {
      const initialPassword = requireEnv('OWNER_INITIAL_PASSWORD');
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: initialPassword,
        email_confirm: true,
      });
      if (createError || !created.user) {
        throw new Error(`Failed to create Supabase auth user: ${createError?.message ?? 'unknown error'}`);
      }
      authUserId = created.user.id;
    }

    await prisma.owner.update({
      where: { id: owner.id },
      data: { authUserId },
    });

    console.log(`Provisioning complete. Owner ${ownerEmail} -> authUserId ${authUserId}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Provisioning failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
