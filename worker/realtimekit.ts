import type { Env } from './env';

export interface RealtimeKitCredentials {
  accountId: string;
  appId: string;
  apiToken: string;
  presetName: string;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

export class RealtimeKitApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RealtimeKitApiError';
  }
}

export function getRealtimeKitCredentials(env: Env): RealtimeKitCredentials | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const appId = env.REALTIMEKIT_APP_ID?.trim();
  const apiToken = env.REALTIMEKIT_API_TOKEN?.trim();
  const presetName = env.REALTIMEKIT_PRESET_NAME?.trim();
  if (!accountId || !appId || !apiToken || !presetName) return null;
  return { accountId, appId, apiToken, presetName };
}

export async function createRealtimeKitMeeting(
  credentials: RealtimeKitCredentials,
  title: string,
): Promise<string> {
  const data = await request<{ id: string }>(credentials, '/meetings', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  if (!data?.id) throw new RealtimeKitApiError('Meeting response did not include an id', 502);
  return data.id;
}

export async function addRealtimeKitParticipant(
  credentials: RealtimeKitCredentials,
  meetingId: string,
  playerId: string,
  name: string,
): Promise<{ participantId: string; authToken: string }> {
  const data = await request<{ id: string; token: string }>(
    credentials,
    `/meetings/${encodeURIComponent(meetingId)}/participants`,
    {
      method: 'POST',
      body: JSON.stringify({
        custom_participant_id: playerId,
        preset_name: credentials.presetName,
        name,
      }),
    },
  );
  if (!data?.id || !data.token) {
    throw new RealtimeKitApiError('Participant response was incomplete', 502);
  }
  return { participantId: data.id, authToken: data.token };
}

export async function refreshRealtimeKitParticipantToken(
  credentials: RealtimeKitCredentials,
  meetingId: string,
  participantId: string,
): Promise<string> {
  const data = await request<{ token: string }>(
    credentials,
    `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}/token`,
    { method: 'POST' },
  );
  if (!data?.token) throw new RealtimeKitApiError('Token response was incomplete', 502);
  return data.token;
}

export async function deleteRealtimeKitParticipant(
  credentials: RealtimeKitCredentials,
  meetingId: string,
  participantId: string,
): Promise<void> {
  await request(
    credentials,
    `/meetings/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}`,
    { method: 'DELETE' },
  );
}

async function request<T>(
  credentials: RealtimeKitCredentials,
  path: string,
  init: RequestInit,
): Promise<T | undefined> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/realtime/kit/${encodeURIComponent(credentials.appId)}${path}`,
    {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: ['Bearer', credentials.apiToken].join(' '),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    },
  );

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    if (!response.ok) throw new RealtimeKitApiError('RealtimeKit request failed', response.status);
  }
  if (!response.ok || payload?.success === false) {
    throw new RealtimeKitApiError('RealtimeKit request failed', response.status);
  }
  return payload?.data;
}
