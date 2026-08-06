import { z } from 'zod';

/** Validates and normalizes login input before it reaches business logic. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
