/** The email texts of docs/PLATFORM.md §10.3. */
export interface MailContent {
  subject: string;
  text: string;
}

export const passwordResetMail = (code: string): MailContent => ({
  subject: 'Your InstaSupply password reset code',
  text: `${code} is your InstaSupply password reset code. It expires in 15 minutes.\n\nIf you did not ask for it, you can ignore this email.`,
});

export const inviteMail = (input: { displayName: string; link: string; hours: number }): MailContent => ({
  subject: 'Set up your InstaSupply account',
  text:
    `Hi ${input.displayName || 'there'},\n\nYou have been invited to InstaSupply. Choose your password here:\n\n` +
    `${input.link}\n\nThe link works once and is valid for ${input.hours} hours.`,
});
