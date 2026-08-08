import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addRealtimeKitParticipant,
  createRealtimeKitMeeting,
  deleteRealtimeKitParticipant,
  getRealtimeKitCredentials,
  RealtimeKitApiError,
  refreshRealtimeKitParticipantToken,
  type RealtimeKitCredentials,
} from './realtimekit';

const credentials: RealtimeKitCredentials = {
  accountId: 'account-id',
  appId: 'app-id',
  apiToken: 'unit-test-value',
  presetName: 'voice-player',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RealtimeKit API client', () => {
  it('creates a meeting with server-side authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { id: 'meeting-id' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRealtimeKitMeeting(credentials, 'Avalon ABC123')).resolves.toBe(
      'meeting-id',
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-id/realtime/kit/app-id/meetings',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization?.split(' ')).toEqual(['Bearer', credentials.apiToken]);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Avalon ABC123' });
  });

  it('adds a participant using the configured voice preset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: { id: 'participant-id', token: 'participant-token' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      addRealtimeKitParticipant(credentials, 'meeting-id', 'player-id', 'Player 1'),
    ).resolves.toEqual({
      participantId: 'participant-id',
      authToken: 'participant-token',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      custom_participant_id: 'player-id',
      preset_name: 'voice-player',
      name: 'Player 1',
    });
  });

  it('refreshes an existing participant token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ success: true, data: { token: 'refreshed-token' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      refreshRealtimeKitParticipantToken(credentials, 'meeting-id', 'participant-id'),
    ).resolves.toBe('refreshed-token');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-id/realtime/kit/app-id/meetings/meeting-id/participants/participant-id/token',
    );
  });

  it('deletes a participant when the provider returns no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      deleteRealtimeKitParticipant(credentials, 'meeting-id', 'participant-id'),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-id/realtime/kit/app-id/meetings/meeting-id/participants/participant-id',
    );
    expect(init.method).toBe('DELETE');
  });

  it('reports provider failures without returning response details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ success: false, errors: [{ message: 'sensitive detail' }] }, { status: 503 }),
      ),
    );

    const error = await createRealtimeKitMeeting(credentials, 'Avalon').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RealtimeKitApiError);
    expect(error).toMatchObject({ message: 'RealtimeKit request failed', status: 503 });
  });
});

describe('RealtimeKit environment', () => {
  it('requires every server-side setting', () => {
    expect(
      getRealtimeKitCredentials({
        CLOUDFLARE_ACCOUNT_ID: 'account-id',
        REALTIMEKIT_APP_ID: 'app-id',
        REALTIMEKIT_API_TOKEN: 'unit-test-value',
      } as never),
    ).toBeNull();
  });
});
