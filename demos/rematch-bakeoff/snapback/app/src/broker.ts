export type Persona = {
  handle: string;
  name: string;
  email: string;
  color: string;
};

export type MintResult = {
  bearerToken: string;
  userId: string;
  serverUrl: string;
  persona: Persona;
};

const BROKER_URL = 'http://127.0.0.1:8788';

export async function fetchPersonas(): Promise<{ personas: Persona[]; serverUrl: string }> {
  const response = await fetch(`${BROKER_URL}/personas`);
  if (!response.ok) throw new Error(`broker personas failed: ${response.status}`);
  return await response.json();
}

export async function mintPersonaSession(email: string): Promise<MintResult> {
  const response = await fetch(`${BROKER_URL}/mint?email=${encodeURIComponent(email)}`);
  if (!response.ok) throw new Error(`broker mint failed: ${response.status}`);
  return await response.json();
}

export const PERSONAS: Persona[] = [
  { handle: 'ada', name: 'Ada Lovelace', email: 'ada@rematch.dev', color: '#7c5cff' },
  { handle: 'grace', name: 'Grace Hopper', email: 'grace@rematch.dev', color: '#00a884' },
  { handle: 'kai', name: 'Kai Tanaka', email: 'kai@rematch.dev', color: '#e8590c' },
];
