export type MediaPostPersona = Readonly<{
  id: 'ada' | 'grace';
  displayName: string;
  email: string;
  password: string;
  accent: string;
}>;

export const MEDIA_POST_PERSONAS: readonly MediaPostPersona[];
