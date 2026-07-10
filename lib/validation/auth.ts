import { z } from "zod";

/** Shared Zod schemas — validate identically on the client (RHF) and the server (actions). */

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const stepUpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type StepUpInput = z.infer<typeof stepUpSchema>;

export const resetRequestSchema = z.object({
  email: z.string().email("Enter a valid email"),
});
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

export const newPasswordSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

export const ROLE_KEYS = ["super_admin", "branch_manager", "production", "inventory"] as const;

export const createUserSchema = z.object({
  email: z.string().email("Enter a valid email"),
  fullName: z.string().min(2, "Enter the person's name"),
  roleKeys: z.array(z.enum(ROLE_KEYS)).min(1, "Assign at least one role"),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserStatusSchema = z.object({
  profileId: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
